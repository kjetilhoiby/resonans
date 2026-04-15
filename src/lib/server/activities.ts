import { db } from '$lib/db';
import { sensorEvents, sensors, progress, tasks, goals } from '$lib/db/schema';
import { buildCanonicalActivityFeed } from '$lib/server/activity-layer';
import {
	buildTaskFingerprint,
	getOverrideCategory,
	loadClassificationOverrides,
	loadTaskClassificationRules,
	type TaskClassificationRule
} from '$lib/server/classification-overrides';
import { eq, and } from 'drizzle-orm';

export interface ActivityMetric {
	metricType: string;
	value: number;
	unit?: string;
}

export interface LogActivityParams {
	userId: string;
	type: string;
	completedAt?: Date;
	duration?: number;
	note?: string;
	metadata?: Record<string, any>;
	metrics: ActivityMetric[];
	taskIds?: string[]; // Optional: specify which tasks this counts towards
}

// Task classification rules now loaded from database via loadTaskClassificationRules()
// See task_classification_rules table in schema.ts
const UNIT_MATCH_SCORE = 3;

function normalizeText(value: string): string {
	return value.toLowerCase();
}

function scoreTaskForActivity(
	task: { title: string; description: string | null; unit: string | null; goal: { title: string } | null },
	effectiveCategory: string,
	metrics: ActivityMetric[],
	rules: TaskClassificationRule[]
): number {
	if (!task.goal) return 0;

	const normalizedCategory = effectiveCategory.toLowerCase();
	const rule = rules.find((candidate) => candidate.category === normalizedCategory);
	const taskText = normalizeText(`${task.title} ${task.description || ''} ${task.goal.title}`);

	let score = 0;

	if (rule) {
		const matchedKeywords = rule.keywords.filter((keyword) => taskText.includes(keyword));
		score += matchedKeywords.length * rule.priority;
	}

	if (task.unit) {
		const taskUnit = normalizeText(task.unit);
		const hasMatchingMetricUnit = metrics.some((metric) => normalizeText(metric.unit || '') === taskUnit);
		if (hasMatchingMetricUnit) {
			score += UNIT_MATCH_SCORE;
		}
	}

	return score;
}

function normalizeLoggedActivity(type: string, baseData: Record<string, any>) {
	if (type.startsWith('workout_')) {
		return {
			dataType: 'workout',
			data: {
				...baseData,
				sportType: type.replace(/^workout_/, ''),
				originalActivityType: type
			}
		};
	}

	return {
		dataType: type,
		data: {
			...baseData,
			originalActivityType: type
		}
	};
}

async function getOrCreateAiSensor(userId: string) {
	let [sensor] = await db
		.select()
		.from(sensors)
		.where(and(eq(sensors.provider, 'ai_assistant'), eq(sensors.userId, userId)))
		.limit(1);

	if (!sensor) {
		[sensor] = await db
			.insert(sensors)
			.values({
				userId,
				provider: 'ai_assistant',
				type: 'manual_log',
				name: 'AI Assistant',
				isActive: true,
				config: { model: 'gpt-4o', source: 'chat' }
			})
			.returning();
	}
	return sensor;
}

/**
 * Registrer en aktivitet med metrics — skriver til sensorEvents (unified lag)
 * og kobler automatisk til relevante tasks via progress-tabellen.
 */
export async function logActivity(params: LogActivityParams) {
	const {
		userId,
		type,
		completedAt = new Date(),
		duration,
		note,
		metadata,
		metrics,
		taskIds
	} = params;

	// Flaten metrics-array til navngitte felter i data-objektet
	const metricsData: Record<string, any> = {};
	for (const m of metrics) {
		metricsData[m.metricType] = m.value;
		if (m.unit) metricsData[`${m.metricType}Unit`] = m.unit;
	}
	if (duration) metricsData.duration = duration;
	if (note) metricsData.note = note;
	const normalizedActivity = normalizeLoggedActivity(type, { ...metricsData, _metrics: metrics, ...(metadata || {}) });

	const sensor = await getOrCreateAiSensor(userId);

	// 1. Skriv til sensorEvents (unified kilde for all aktivitetsdata)
	const [event] = await db
		.insert(sensorEvents)
		.values({
			userId,
			sensorId: sensor.id,
			eventType: 'activity',
			dataType: normalizedActivity.dataType,
			timestamp: completedAt,
			data: normalizedActivity.data,
			metadata: { source: 'log_activity_tool' }
		})
		.returning();

	// 2. Finn relevante tasks (eller bruk spesifiserte)
	let relevantTasks;
	if (taskIds && taskIds.length > 0) {
		const allTasks = await db.query.tasks.findMany({
			where: eq(tasks.status, 'active'),
			with: { goal: true }
		});
		relevantTasks = allTasks.filter((t) => taskIds.includes(t.id));
	} else {
		relevantTasks = await findMatchingTasks(db, userId, type, metrics);
	}

	// 3. Opprett progress entries tilknyttet tasks
	const progressEntries = [];
	for (const task of relevantTasks) {
		const value = calculateProgressValue(task, metrics);
		const [progressEntry] = await db
			.insert(progress)
			.values({
				taskId: task.id,
				userId,
				value,
				note,
				completedAt
			})
			.returning();
		progressEntries.push({ ...progressEntry, task });
	}

	return {
		activity: { id: event.id, type, completedAt, note },
		metrics,
		progressEntries
	};
}

/**
 * Finn tasks som matcher en gitt aktivitetstype
 */
async function findMatchingTasks(
	tx: any,
	userId: string,
	activityType: string,
	metrics: ActivityMetric[]
) {
	// Hent alle aktive tasks for brukeren (ekskluder de som har tracking series — de håndteres via record_tracking_event)
	const allTasksRaw = await tx.query.tasks.findMany({
		where: eq(tasks.status, 'active'),
		with: {
			goal: {
				where: and(eq(goals.userId, userId), eq(goals.status, 'active'))
			},
			trackingSeries: {
				where: (s: any, { eq: eqS }: any) => eqS(s.status, 'active'),
				columns: { id: true }
			}
		}
	});

	// Tasks koblet til en aktiv tracking series skal oppdateres via record_tracking_event, ikke log_activity
	const allTasks = allTasksRaw.filter((t: any) => !t.trackingSeries?.length);

	// Load classification rules and overrides
	const [overrideCache, classificationRules] = await Promise.all([
		loadClassificationOverrides(userId, 'task'),
		loadTaskClassificationRules()
	]);

	const taskFingerprint = buildTaskFingerprint(activityType, metrics);
	const overrideCategory = getOverrideCategory(overrideCache, taskFingerprint);
	const effectiveCategory = overrideCategory ?? activityType.split('_')[0].toLowerCase();

	const scoredMatches = allTasks
		.map((task: any) => ({
			task,
			score: scoreTaskForActivity(task, effectiveCategory, metrics, classificationRules)
		}))
		.filter((candidate) => candidate.score > 0)
		.sort((a, b) => b.score - a.score);

	// NOTE: Neste steg kan være LLM/tool-fallback når scoredMatches er tom.
	return scoredMatches.map((candidate) => candidate.task);
}

/**
 * Beregn progress-verdi basert på task og metrics
 */
function calculateProgressValue(task: any, metrics: ActivityMetric[]): number | null {
	// Hvis task har en targetValue og unit, prøv å finne matching metric
	if (task.unit) {
		const matchingMetric = metrics.find((m) => m.unit?.toLowerCase() === task.unit?.toLowerCase());
		if (matchingMetric) {
			return Math.round(matchingMetric.value);
		}
	}

	// Hvis task er frequency-basert (f.eks. "3 ganger per uke"), tell som 1
	if (task.frequency) {
		return 1;
	}

	// Default: null (aktiviteten er registrert, men uten spesifikk verdi)
	return null;
}

/**
 * Hent AI-registrerte aktiviteter for en bruker fra sensorEvents
 */
export async function getUserActivities(userId: string, limit = 50) {
	const feed = await buildCanonicalActivityFeed(userId, { limit });

	return feed.map((item) => ({
		id: item.activityId,
		type: item.dataType,
		completedAt: new Date(item.timestamp),
		note:
			typeof item.payload.note === 'string'
				? item.payload.note
				: typeof item.payload.notes === 'string'
					? item.payload.notes
					: item.summary,
		metadata: item.payload,
		metrics: (Array.isArray(item.payload._metrics) ? item.payload._metrics : []) as ActivityMetric[]
	}));
}
