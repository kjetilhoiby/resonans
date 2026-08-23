import { db, rowsOf } from '$lib/db';
import { goals, tasks, categories, sensorGoals } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { findSimilar } from './similarity';
import { METRIC_CATALOG, resolveMetricId, type MetricId } from '$lib/domain/metric-catalog';
import type { GoalTrack, GoalTrackKind, GoalWindow } from '$lib/domain/goal-tracks';
import { upsertGoalTrack } from './goal-tracks';
import { openai } from './openai';
import { PersonMentionService } from './services/person-mention-service';
import { readLatestWeight } from './goal-progress';
import { resolveWeightGoalNumbers } from '$lib/domain/health/weight-goal';

export interface GoalCreationParams {
	userId: string;
	categoryName: string;
	themeId?: string;
	title: string;
	description: string;
	targetDate?: string;
	metricId?: string;
	goalKind?: GoalTrackKind;
	goalWindow?: GoalWindow;
	targetValue?: number;
	unit?: string;
	durationDays?: number;
	// Health goal specific fields
	startDate?: string; // For date-bounded goals (running) and baseline tracking (weight)
	endDate?: string;   // For explicit period end (running goals)
	/**
	 * Baseline for trajectory-mål (vekt). Utelates den på et `weight_change`-mål,
	 * fylles den fra siste vektmåling — uten baseline er målet umålbart, og alle
	 * fire leserne hopper over det uten å si fra.
	 */
	startValue?: number;
	/** Kobler målet til en brukerforfattet visjon (Retning-fanen). */
	visionHorizon?: 'vision_yearly' | 'vision_5year' | 'vision_10year';
	/** For category_spend-mål: hvilken categorized_events-kategori taket gjelder. */
	spendCategory?: string;
	/** For parent_time-mål: hvilket barn timene gjelder. */
	childName?: string;
}

export interface TaskCreationParams {
	goalId: string;
	userId?: string;
	title: string;
	description?: string;
	frequency?: string;
	periodType?: string;
	periodId?: string;
	targetValue?: number;
	unit?: string;
	personId?: string | null;
}

function normalizeGoalText(title: string, description: string): string {
	return `${title} ${description}`.toLowerCase();
}

function isRunningGoalText(text: string): boolean {
	return /\b(løp(e|ing)?|jogg(e|ing)?|run(ning)?|løpetur(er)?)\b/.test(text);
}

function isLikelyNonRunningActivityGoalText(text: string): boolean {
	return /\b(yoga|mikroyoga|styrke(trening)?|sykl(e|ing)?|svøm(me|ming)?|gåtur(er)?|walk(ing)?)\b/.test(text);
}

const METRIC_LABELS_FOR_PROMPT = Object.values(METRIC_CATALOG)
	.map((m) => `- ${m.id}: ${m.label} (enhet: ${m.defaultUnit})`)
	.join('\n');

async function classifyMetricFromGoalText(
	title: string,
	description: string
): Promise<MetricId | null> {
	try {
		const response = await openai.chat.completions.create({
			model: 'gpt-4o-mini',
			temperature: 0,
			response_format: { type: 'json_object' },
			messages: [
				{
					role: 'system',
					content: `Du er en metrikk-klassifiserer. Gitt et mål-tittel og beskrivelse, avgjør hvilken metrikk (om noen) som passer best.

Gyldige metrikker:
${METRIC_LABELS_FOR_PROMPT}

Svar alltid med JSON:
{
  "metricId": "<id> eller null",
  "confidence": <0.0–1.0>,
  "reason": "<kort begrunnelse>"
}

Returner null for metricId hvis:
- Ingen metrikk passer godt (confidence under 0.8)
- Målet handler om aktivitet som ikke har en dedikert metrikk (yoga, styrketrening, sykling, gåtur osv.) — da er metricId null
- Målet er generell vane eller atferd uten numerisk sporing

Vær konservativ. Bruk kun metrikker som åpenbart matcher.`
				},
				{
					role: 'user',
					content: `Tittel: ${title}\nBeskrivelse: ${description}`
				}
			]
		});

		const raw = response.choices[0]?.message?.content;
		if (!raw) return null;

		const parsed = JSON.parse(raw) as { metricId: string | null; confidence: number; reason: string };

		if (parsed.confidence < 0.8 || !parsed.metricId) {
			console.log('[classifyMetricFromGoalText] Low confidence or null:', parsed);
			return null;
		}

		const resolved = resolveMetricId(parsed.metricId);
		if (!resolved) {
			console.warn('[classifyMetricFromGoalText] Unknown metricId from LLM:', parsed.metricId);
			return null;
		}

		console.log('[classifyMetricFromGoalText] Classified:', resolved, '| reason:', parsed.reason);
		return resolved;
	} catch (err) {
		console.error('[classifyMetricFromGoalText] Error:', err);
		return null;
	}
}

async function sanitizeMetricId(params: GoalCreationParams): Promise<MetricId | null> {
	const requestedMetric = params.metricId ? resolveMetricId(params.metricId) : null;
	const text = normalizeGoalText(params.title, params.description);

	// 1. Ingen metrikk oppgitt — prøv deterministisk + LLM
	if (!requestedMetric) {
		if (isRunningGoalText(text)) return 'running_distance';
		return classifyMetricFromGoalText(params.title, params.description);
	}

	// 2. Oppgitt metrikk er running_distance men teksten tyder på noe annet
	if (requestedMetric === 'running_distance') {
		if (isRunningGoalText(text)) return requestedMetric;
		if (isLikelyNonRunningActivityGoalText(text)) {
			// Aktivitets-ord uten løp — bruk LLM for å finne eventuell bedre metrikk
			return classifyMetricFromGoalText(params.title, params.description);
		}
		// Usikker — la LLM avgjøre
		return classifyMetricFromGoalText(params.title, params.description);
	}

	// 3. Oppgitt metrikk er noe annet — stol på den
	return requestedMetric;
}

/** Metrikkfelt et mål kan bære. Delt mellom opprettelse og redigering. */
export interface GoalMetricFields {
	goalKind?: GoalTrackKind;
	goalWindow?: GoalWindow;
	targetValue?: number | null;
	startValue?: number | null;
	unit?: string;
	durationDays?: number | null;
	targetDate?: string;
}

function finiteOrNull(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Vektmål har TO tall, og lagringen bærer bare deltaet — baselinen er derfor ikke et
 * ekstra felt, den er halve målet. Alle leserne hopper over et vektmål uten
 * `startValue`, så et mål opprettet uten den havner under «Uten måling» uten at noe
 * sier fra. Baselinen fylles fra siste måling når kalleren ikke oppgir den, og
 * målverdien tolkes: 95 er en målvekt, −3 er en endring.
 */
async function resolveWeightGoalFields(
	userId: string,
	fields: { targetValue: number | null; startValue: number | null },
	context: string
): Promise<{ targetValue: number | null; startValue: number | null }> {
	const fallbackStartWeight = fields.startValue === null ? await readLatestWeight(userId) : null;
	const resolved = resolveWeightGoalNumbers({
		rawTargetValue: fields.targetValue,
		startValue: fields.startValue,
		fallbackStartWeight
	});

	if (!resolved) {
		console.warn(
			`[${context}] vektmål uten målbare tall (målverdi=${fields.targetValue}, startvekt=${fields.startValue}, siste måling=${fallbackStartWeight}) — målet lagres, men uten måling`
		);
		return fields;
	}

	console.log(
		`[${context}] vektmål: fra ${resolved.startWeight} kg (${resolved.startSource}) til ${resolved.targetWeight} kg (delta ${resolved.targetDelta}, råverdi lest som ${resolved.targetInterpretation})`
	);
	return { targetValue: resolved.targetDelta, startValue: resolved.startWeight };
}

type GoalTrackMetadata = {
	kind: GoalTrackKind;
	window: GoalWindow;
	targetValue: number;
	unit: string;
	durationDays: number | null;
};

/** `metadata.goalTrack` — formen leserne slår opp målverdien i. */
function buildGoalTrackMetadata(
	metricId: MetricId | null,
	targetValue: number | null,
	fields: GoalMetricFields
): GoalTrackMetadata | null {
	if (!metricId || targetValue === null) return null;
	return {
		kind: fields.goalKind ?? inferGoalKind(metricId, targetValue),
		window: fields.goalWindow ?? inferGoalWindow(fields.targetDate),
		targetValue,
		unit: fields.unit || METRIC_CATALOG[metricId].defaultUnit,
		durationDays:
			(fields.goalWindow ?? inferGoalWindow(fields.targetDate)) === 'custom'
				? finiteOrNull(fields.durationDays)
				: null
	};
}

/** Raden i `goal_tracks` — samme tall som metadataen, aldri bygget for seg. */
function buildGoalTrack(
	metricId: MetricId,
	goal: { id: string; title: string },
	track: GoalTrackMetadata,
	source: 'goal_create' | 'goal_edit'
): GoalTrack {
	return {
		id: `goal-${goal.id}`,
		metricId,
		label: goal.title,
		kind: track.kind,
		window: track.window,
		durationDays: track.durationDays ?? undefined,
		targetValue: track.targetValue,
		unit: track.unit,
		priority: 80,
		metadata: { goalId: goal.id, source }
	};
}

export async function createGoal(params: GoalCreationParams) {
	const resolvedMetricId = await sanitizeMetricId(params);
	let numericTargetValue = finiteOrNull(params.targetValue);
	let startValue = finiteOrNull(params.startValue);

	if (resolvedMetricId === 'weight_change') {
		({ targetValue: numericTargetValue, startValue } = await resolveWeightGoalFields(
			params.userId,
			{ targetValue: numericTargetValue, startValue },
			'createGoal'
		));
	}

	const goalTrackMetadata = buildGoalTrackMetadata(resolvedMetricId, numericTargetValue, params);

	// Build health-aware metadata
	const metadata = {
		metricId: resolvedMetricId,
		...(params.visionHorizon ? { visionHorizon: params.visionHorizon } : {}),
		...(resolvedMetricId === 'category_spend' && params.spendCategory
			? { spendCategory: params.spendCategory }
			: {}),
		...(resolvedMetricId === 'parent_time' && params.childName
			? { childName: params.childName }
			: {}),
		startDate: params.startDate || null,
		endDate: params.endDate || null,
		startValue,
		goalTrack: goalTrackMetadata
	};

	// Finn eller opprett kategori
	let category = await db.query.categories.findFirst({
		where: eq(categories.name, params.categoryName)
	});

	if (!category) {
		const [newCategory] = await db.insert(categories).values({
			name: params.categoryName,
			description: `Mål relatert til ${params.categoryName.toLowerCase()}`
		}).returning();
		category = newCategory;
	}

	// Opprett mål
	const [goal] = await db.insert(goals).values({
		userId: params.userId,
		categoryId: category.id,
		themeId: params.themeId || null,
		title: params.title,
		description: params.description,
		targetDate: params.targetDate ? new Date(params.targetDate) : null,
		status: 'active',
		metadata
	}).returning();

	if (resolvedMetricId && goalTrackMetadata) {
		await upsertGoalTrack(
			params.userId,
			resolvedMetricId,
			buildGoalTrack(resolvedMetricId, goal, goalTrackMetadata, 'goal_create')
		);
	}

	return goal;
}

/**
 * Oppdaterer metrikkfeltene på et eksisterende mål — én vei inn, samme normalisering
 * som opprettelsen. Redigeringen skrev tidligere metadata rått fra klienten: uten
 * `goalTrack` (som er der leserne finner målverdien), uten `goal_tracks`-raden, og
 * den slettet nøkler skjemaet ikke eier (`visionHorizon`, intent-feltene). Et
 * vektmål «reparert» i skjemaet mistet altså målverdien sin.
 */
export async function updateGoalMetric(params: {
	userId: string;
	goalId: string;
	metricId?: string | null;
	fields: GoalMetricFields;
	startDate?: string | null;
	endDate?: string | null;
}) {
	const goal = await db.query.goals.findFirst({
		where: and(eq(goals.id, params.goalId), eq(goals.userId, params.userId))
	});
	if (!goal) throw new Error('Goal not found for user');

	// Kaster framfor å skrive `metricId: null`: en oppdatering uten gjenkjennelig
	// metrikk ville tømt målet for både spor og målverdi, og sett ut som en lagring
	// som gikk bra.
	const resolvedMetricId = params.metricId ? resolveMetricId(params.metricId) : null;
	if (!resolvedMetricId) throw new Error(`Unknown metric id: ${params.metricId}`);
	let targetValue = finiteOrNull(params.fields.targetValue);
	let startValue = finiteOrNull(params.fields.startValue);

	if (resolvedMetricId === 'weight_change') {
		({ targetValue, startValue } = await resolveWeightGoalFields(
			params.userId,
			{ targetValue, startValue },
			'updateGoalMetric'
		));
	}

	const goalTrackMetadata = buildGoalTrackMetadata(resolvedMetricId, targetValue, params.fields);
	const existing = (goal.metadata ?? {}) as Record<string, unknown>;
	// `undefined` = feltet ble ikke sendt (behold), `null` = tømt med vilje.
	const metadata: Record<string, unknown> = {
		...existing,
		metricId: resolvedMetricId,
		startDate: params.startDate !== undefined ? params.startDate || null : (existing.startDate ?? null),
		endDate: params.endDate !== undefined ? params.endDate || null : (existing.endDate ?? null),
		startValue,
		goalTrack: goalTrackMetadata
	};

	const [updated] = await db
		.update(goals)
		.set({ metadata, updatedAt: new Date() })
		.where(eq(goals.id, goal.id))
		.returning();

	if (resolvedMetricId && goalTrackMetadata) {
		await upsertGoalTrack(
			params.userId,
			resolvedMetricId,
			buildGoalTrack(resolvedMetricId, updated, goalTrackMetadata, 'goal_edit')
		);
	}

	return updated;
}

function inferGoalWindow(targetDate?: string): GoalWindow {
	if (!targetDate) return 'month';
	const now = Date.now();
	const target = new Date(targetDate).getTime();
	if (!Number.isFinite(target) || target <= now) return 'month';
	const days = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
	if (days <= 10) return 'week';
	if (days <= 45) return 'month';
	if (days <= 140) return 'quarter';
	return 'year';
}

function inferGoalKind(metricId: MetricId, targetValue: number): GoalTrackKind {
	if (metricId === 'weight_change') return 'change';
	if (metricId === 'grocery_spend') return 'level';
	if (targetValue < 0) return 'change';
	return 'level';
}

export async function createTask(params: TaskCreationParams) {
	if (params.userId) {
		const ownerGoal = await db.query.goals.findFirst({
			where: and(eq(goals.id, params.goalId), eq(goals.userId, params.userId)),
			columns: { id: true }
		});

		if (!ownerGoal) {
			throw new Error('Goal not found for user');
		}
	}

	const [task] = await db.insert(tasks).values({
		goalId: params.goalId,
		title: params.title,
		description: params.description || null,
		frequency: params.frequency || 'once',
		periodType: params.periodType || null,
		periodId: params.periodId || null,
		targetValue: params.targetValue || null,
		unit: params.unit || null,
		personId: params.personId ?? null,
		status: 'active'
	}).returning();

	if (params.userId) {
		PersonMentionService.indexTask(
			params.userId,
			task.id,
			params.title,
			params.description ?? null,
			params.personId ? [params.personId] : []
		).catch((err) => console.warn('person-mention task indexing failed:', err));
	}

	return task;
}

/**
 * Hent brukerens aktive mål og oppgaver
 */
export async function getUserActiveGoalsAndTasks(userId: string) {
	const userGoals = await db.query.goals.findMany({
		where: eq(goals.userId, userId),
		with: {
			category: true,
			tasks: {
				where: eq(tasks.status, 'active'),
				with: {
					progress: true
				}
			}
		}
	});

	return userGoals;
}

export async function getUserGoals(userId: string) {
	return await db.query.goals.findMany({
		where: eq(goals.userId, userId),
		with: {
			category: true
		}
	});
}

export async function getGoalTasks(goalId: string) {
	return await db.query.tasks.findMany({
		where: eq(tasks.goalId, goalId)
	});
}

/**
 * Finn lignende mål basert på tittel
 */
export async function findSimilarGoals(userId: string, title: string, threshold = 70) {
	const allGoals = await db.query.goals.findMany({
		where: eq(goals.userId, userId),
		with: {
			category: true,
			tasks: true
		}
	});

	const similar = findSimilar(
		title,
		allGoals,
		(goal) => goal.title,
		threshold
	);

	return similar.map(({ item, similarity }) => ({
		id: item.id,
		title: item.title,
		description: item.description,
		status: item.status,
		category: item.category,
		tasks: item.tasks,
		similarity
	}));
}

/**
 * Finn lignende oppgaver under et mål
 */
export async function findSimilarTasks(goalId: string, title: string, threshold = 70) {
	const allTasks = await db.query.tasks.findMany({
		where: eq(tasks.goalId, goalId)
	});

	const similar = findSimilar(
		title,
		allTasks,
		(task) => task.title,
		threshold
	);

	return similar.map(({ item, similarity }) => ({
		id: item.id,
		title: item.title,
		description: item.description,
		status: item.status,
		frequency: item.frequency,
		targetValue: item.targetValue,
		unit: item.unit,
		similarity
	}));
}

/**
 * Enable automatic sensor-based progress tracking for a goal
 * E.g., link a "Run 3x/week" goal to Withings workout data (metricType='running')
 * Once linked, new workouts matching the metricType will auto-create progress records
 */
export async function enableSensorGoalTracking(
	goalId: string,
	metricType: string,
	options?: {
		targetValue?: number;
		unit?: string;
	}
) {
	// Check if this sensor goal already exists
	const existing = await db.query.sensorGoals.findFirst({
		where: eq(sensorGoals.goalId, goalId)
	});

	if (existing) {
		console.log(`[goals] sensor goal already exists for goal=${goalId}`);
		return existing;
	}

	// Create new sensor goal linking
	const [sensorGoal] = await db
		.insert(sensorGoals)
		.values({
			goalId,
			metricType,
			targetValue: options?.targetValue ? String(options.targetValue) : null,
			unit: options?.unit || null,
			autoUpdate: true,
			lastUpdated: new Date(),
			createdAt: new Date()
		})
		.returning();

	console.log(
		`[goals] enabled auto-tracking for goal=${goalId} with metricType=${metricType}`
	);
	return sensorGoal;
}

/**
 * Returns the id of the user's "Planlegging" meta-goal, creating it if it doesn't exist.
 * Used when checklist items in week/day planning need a task but have no explicit goal.
 */
export async function getOrCreatePlanningGoal(userId: string): Promise<string> {
	const rows = await db.execute(sql`
		SELECT id FROM goals
		WHERE user_id = ${userId}
		  AND status = 'active'
		  AND metadata->>'isPlanningGoal' = 'true'
		LIMIT 1
	`);
	const existing = rowsOf<{ id: string }>(rows);
	if (existing.length > 0) return existing[0].id;

	const [goal] = await db.insert(goals).values({
		userId,
		title: 'Planlegging',
		description: 'Ukesmål og planlagte oppgaver uten overordnet mål',
		status: 'active',
		metadata: { isPlanningGoal: true }
	}).returning({ id: goals.id });

	return goal!.id;
}
