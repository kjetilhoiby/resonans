import { db } from '$lib/db';
import { dreams, goals, memories, sensorEvents, themes, users } from '$lib/db/schema';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { getRecentReflections } from '$lib/server/reflections';
import { getRecentPlanArtifacts, getPlanArtifact } from '$lib/server/plan-artifacts';

const DREAM_PROMPT_VERSION = 'pyramid-v1';

function isoWeekKeyFor(date: Date): string {
	// ISO-uke iht. ISO 8601: torsdagen i uka bestemmer årstallet.
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const day = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${d.getUTCFullYear()}W${String(weekNo).padStart(2, '0')}`;
}

export type DreamMode = 'least_effort' | 'steady' | 'push';

export type DreamKind =
	| 'daily_dream'
	| 'weekly_dream'
	| 'monthly_dream'
	| 'yearly_dream'
	| 'vision_5year'
	| 'vision_yearly'
	| 'vision_quarterly'
	| 'vision_themed';

export type DreamConfidence = 'user_confirmed' | 'llm_inferred' | 'llm_decomposed';
export type DreamOriginKind = 'synthesis' | 'user_authored' | 'llm_proposed' | 'decomposition';

export interface DreamHighlights {
	mode: DreamMode;
	rationale: string;
	wins: string[];
	frictions: string[];
	signals: Array<{ type: string; value: unknown; note?: string }>;
	alignment?: { yearGoal?: string; quarterGoal?: string; monthGoal?: string };
}

export interface DreamPayload {
	summary: string;
	highlights: DreamHighlights;
}

interface SynthRunOptions {
	now?: Date;
	model?: string;
}

const RELEVANCE_HOURS: Record<DreamKind, number | null> = {
	daily_dream: 36,
	weekly_dream: 8 * 24,
	monthly_dream: 35 * 24,
	yearly_dream: 366 * 24,
	vision_5year: null, // ingen utløp
	vision_yearly: 365 * 24,
	vision_quarterly: 95 * 24,
	vision_themed: 180 * 24
};

/**
 * DreamService håndterer både retninger:
 *   - Tilbakeblikk ("natt-drøm"): synthesize* metodene leser nivået under +
 *     plan-artefakter for samme periode.
 *   - Retning ("våken drøm"): envision* metodene leser memories, themes og
 *     forrige visjon for å foreslå/oppdatere langsiktig kurs.
 */
export class DreamService {
	// ── Tilbakeblikk-pyramide ─────────────────────────────────────────────────

	static async runDaily(userId: string, opts: SynthRunOptions = {}) {
		const now = opts.now ?? new Date();
		const scopeStart = new Date(now);
		scopeStart.setDate(scopeStart.getDate() - 1);

		const inputs = await this.collectDailyInputs(userId, scopeStart, now);
		const previous = await this.getLatest(userId, 'daily_dream');

		const payload = await this.synthesize({
			kind: 'daily_dream',
			scope: 'siste 24-72 timer',
			inputs: this.dailyInputsAsLines(inputs),
			previousSummary: previous?.summary,
			alignmentGoals: inputs.goals
		}, opts.model);

		return this.persist(userId, {
			kind: 'daily_dream',
			scopeStart,
			scopeEnd: now,
			payload,
			previousId: previous?.id,
			model: opts.model,
			inputRefs: {
				reflectionIds: inputs.reflections.map((r) => r.id),
				planArtifactIds: inputs.plans.map((p) => p.id),
				goalIds: inputs.goals.map((g) => g.id)
			}
		});
	}

	static async runWeekly(userId: string, weekKey: string, opts: SynthRunOptions = {}) {
		const now = opts.now ?? new Date();
		const scopeStart = new Date(now);
		scopeStart.setDate(scopeStart.getDate() - 7);

		// Hvert nivå leser nivået under + plan-artefakt for samme periode.
		const childDailies = await db.query.dreams.findMany({
			where: and(
				eq(dreams.userId, userId),
				eq(dreams.kind, 'daily_dream'),
				gte(dreams.scopeEnd, scopeStart)
			),
			orderBy: [desc(dreams.scopeEnd)],
			limit: 7
		});
		const weekArtifact = await getPlanArtifact(userId, 'week', weekKey);
		const previous = await this.getLatest(userId, 'weekly_dream');
		const activeGoals = await db.query.goals.findMany({
			where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
			columns: { id: true, title: true, targetDate: true, periodKey: true },
			limit: 8
		});

		const inputLines = [
			'DAGLIGE TILBAKEBLIKK (siste 7 dager):',
			...childDailies.map((d) => `- ${d.scopeEnd.toISOString().slice(0, 10)}: ${d.summary}`),
			'',
			'UKEPLAN:',
			weekArtifact?.headline ? `- overskrift: ${weekArtifact.headline}` : '',
			weekArtifact?.note ? `- notat: ${weekArtifact.note}` : '',
			weekArtifact?.reflection ? `- bruker-refleksjon: ${weekArtifact.reflection}` : ''
		].filter(Boolean);

		const payload = await this.synthesize({
			kind: 'weekly_dream',
			scope: `uke ${weekKey}`,
			inputs: inputLines,
			previousSummary: previous?.summary,
			alignmentGoals: activeGoals
		}, opts.model);

		return this.persist(userId, {
			kind: 'weekly_dream',
			scopeStart,
			scopeEnd: now,
			payload,
			previousId: previous?.id,
			model: opts.model,
			inputRefs: {
				childBriefIds: childDailies.map((d) => d.id),
				planArtifactIds: weekArtifact ? [weekArtifact.id] : [],
				goalIds: activeGoals.map((g) => g.id)
			}
		});
	}

	static async runMonthly(userId: string, monthKey: string, opts: SynthRunOptions = {}) {
		const now = opts.now ?? new Date();
		const scopeStart = new Date(now);
		scopeStart.setMonth(scopeStart.getMonth() - 1);

		const childWeeklies = await db.query.dreams.findMany({
			where: and(
				eq(dreams.userId, userId),
				eq(dreams.kind, 'weekly_dream'),
				gte(dreams.scopeEnd, scopeStart)
			),
			orderBy: [desc(dreams.scopeEnd)],
			limit: 6
		});
		const monthArtifact = await getPlanArtifact(userId, 'month', monthKey);
		const previous = await this.getLatest(userId, 'monthly_dream');

		const inputLines = [
			'UKE-TILBAKEBLIKK (siste måned):',
			...childWeeklies.map((d) => `- ${d.scopeEnd.toISOString().slice(0, 10)}: ${d.summary}`),
			'',
			'MÅNEDSPLAN:',
			monthArtifact?.note ? `- notat: ${monthArtifact.note}` : '',
			monthArtifact?.reflection ? `- bruker-refleksjon: ${monthArtifact.reflection}` : '',
			monthArtifact?.vision ? `- visjon: ${monthArtifact.vision}` : ''
		].filter(Boolean);

		const payload = await this.synthesize({
			kind: 'monthly_dream',
			scope: `måneden ${monthKey}`,
			inputs: inputLines,
			previousSummary: previous?.summary
		}, opts.model);

		return this.persist(userId, {
			kind: 'monthly_dream',
			scopeStart,
			scopeEnd: now,
			payload,
			previousId: previous?.id,
			model: opts.model,
			inputRefs: {
				childBriefIds: childWeeklies.map((d) => d.id),
				planArtifactIds: monthArtifact ? [monthArtifact.id] : []
			}
		});
	}

	static async runYearly(userId: string, year: string, opts: SynthRunOptions = {}) {
		const now = opts.now ?? new Date();
		const scopeStart = new Date(now);
		scopeStart.setFullYear(scopeStart.getFullYear() - 1);

		const childMonthlies = await db.query.dreams.findMany({
			where: and(
				eq(dreams.userId, userId),
				eq(dreams.kind, 'monthly_dream'),
				gte(dreams.scopeEnd, scopeStart)
			),
			orderBy: [desc(dreams.scopeEnd)],
			limit: 14
		});
		const previous = await this.getLatest(userId, 'yearly_dream');

		const inputLines = [
			'MÅNEDS-TILBAKEBLIKK (siste 12 måneder):',
			...childMonthlies.map((d) => `- ${d.scopeEnd.toISOString().slice(0, 7)}: ${d.summary}`)
		];

		const payload = await this.synthesize({
			kind: 'yearly_dream',
			scope: `året ${year}`,
			inputs: inputLines,
			previousSummary: previous?.summary
		}, opts.model);

		return this.persist(userId, {
			kind: 'yearly_dream',
			scopeStart,
			scopeEnd: now,
			payload,
			previousId: previous?.id,
			model: opts.model,
			inputRefs: { childBriefIds: childMonthlies.map((d) => d.id) }
		});
	}

	// ── Retning-pyramide (våken drøm) ─────────────────────────────────────────

	/**
	 * Foreslår eller fornyer en visjon. Stub som strukturerer prompten;
	 * utvides senere med dypere personliggjøring.
	 */
	static async envision(
		userId: string,
		args: { horizon: 'vision_5year' | 'vision_yearly' | 'vision_quarterly' | 'vision_themed'; themeId?: string },
		opts: SynthRunOptions = {}
	) {
		const now = opts.now ?? new Date();

		const [stableMemories, theme, previous] = await Promise.all([
			db.query.memories.findMany({
				where: eq(memories.userId, userId),
				orderBy: [desc(memories.importance), desc(memories.lastAccessedAt)],
				limit: 30
			}),
			args.themeId
				? db.query.themes.findFirst({ where: eq(themes.id, args.themeId) })
				: Promise.resolve(null),
			this.getLatest(userId, args.horizon)
		]);

		const inputLines = [
			'STABILE FAKTA OM BRUKEREN:',
			...stableMemories.slice(0, 15).map((m) => `- [${m.category}] ${m.content}`),
			theme ? `\nTEMA: ${theme.name}${theme.instructions ? `\nLangsiktig retning: ${theme.instructions}` : ''}` : '',
			previous ? `\nFORRIGE VISJON: ${previous.summary}` : ''
		].filter(Boolean);

		const horizonLabel = ({
			vision_5year: 'fem år frem',
			vision_yearly: 'ett år frem',
			vision_quarterly: 'kommende kvartal',
			vision_themed: theme ? `tema "${theme.name}"` : 'tema'
		} as const)[args.horizon];

		const payload = await this.envisionSynth({
			kind: args.horizon,
			horizon: horizonLabel,
			inputs: inputLines,
			previousSummary: previous?.summary
		}, opts.model);

		return this.persist(userId, {
			kind: args.horizon,
			scopeStart: now,
			scopeEnd: now,
			payload,
			previousId: previous?.id,
			model: opts.model,
			confidence: 'llm_inferred',
			originKind: 'llm_proposed',
			themeIds: args.themeId ? [args.themeId] : undefined,
			inputRefs: { memoryIds: stableMemories.map((m) => m.id), themeIds: args.themeId ? [args.themeId] : undefined }
		});
	}

	// ── Felles henting ────────────────────────────────────────────────────────

	/**
	 * Henter aktiv drøm for et gitt nivå. "Aktiv" = nyeste, ikke utløpt, ikke
	 * supersedert. Brukes av ContextService til å bygge chat-prompt.
	 */
	static async getActive(userId: string, kind: DreamKind, now = new Date()) {
		return db.query.dreams.findFirst({
			where: and(
				eq(dreams.userId, userId),
				eq(dreams.kind, kind),
				or(isNull(dreams.relevanceUntil), gte(dreams.relevanceUntil, now)),
				isNull(dreams.supersededBy)
			),
			orderBy: [desc(dreams.createdAt)]
		});
	}

	/** Bakoverkompatibel snarvei brukt av flere kallere. */
	static async getActiveDream(userId: string, now = new Date()) {
		return this.getActive(userId, 'daily_dream', now);
	}

	// ── Sched-helpers (kjøres fra scheduler.ts) ──────────────────────────────

	static async runDailyForAllUsers(opts: SynthRunOptions = {}) {
		const allUsers = await db.query.users.findMany({ columns: { id: true } });
		for (const user of allUsers) {
			try {
				await this.runDaily(user.id, opts);
			} catch (err) {
				console.error(`[DreamService] runDaily failed for user ${user.id}:`, err);
			}
		}
	}

	static async runWeeklyForAllUsers(opts: SynthRunOptions = {}) {
		const weekKey = isoWeekKeyFor(opts.now ?? new Date());
		const allUsers = await db.query.users.findMany({ columns: { id: true } });
		for (const user of allUsers) {
			try {
				await this.runWeekly(user.id, weekKey, opts);
			} catch (err) {
				console.error(`[DreamService] runWeekly failed for user ${user.id}:`, err);
			}
		}
	}

	static async runMonthlyForAllUsers(opts: SynthRunOptions = {}) {
		const now = opts.now ?? new Date();
		const prev = new Date(now);
		prev.setMonth(prev.getMonth() - 1);
		const monthKey = `${prev.getFullYear()}M${String(prev.getMonth() + 1).padStart(2, '0')}`;
		const allUsers = await db.query.users.findMany({ columns: { id: true } });
		for (const user of allUsers) {
			try {
				await this.runMonthly(user.id, monthKey, opts);
			} catch (err) {
				console.error(`[DreamService] runMonthly failed for user ${user.id}:`, err);
			}
		}
	}

	static async runYearlyForAllUsers(opts: SynthRunOptions = {}) {
		const now = opts.now ?? new Date();
		const year = String(now.getFullYear() - 1);
		const allUsers = await db.query.users.findMany({ columns: { id: true } });
		for (const user of allUsers) {
			try {
				await this.runYearly(user.id, year, opts);
			} catch (err) {
				console.error(`[DreamService] runYearly failed for user ${user.id}:`, err);
			}
		}
	}

	private static async getLatest(userId: string, kind: DreamKind) {
		return db.query.dreams.findFirst({
			where: and(eq(dreams.userId, userId), eq(dreams.kind, kind)),
			orderBy: [desc(dreams.createdAt)]
		});
	}

	// ── Intern: input-innsamling og persist ──────────────────────────────────

	private static async collectDailyInputs(userId: string, from: Date, to: Date) {
		const [reflections, plans, egenfrekvensEvents, activeGoals] = await Promise.all([
			getRecentReflections(userId, { sinceDays: 3, limit: 10 }),
			getRecentPlanArtifacts(userId, ['day', 'week', 'month'], 6),
			db
				.select({ timestamp: sensorEvents.timestamp, data: sensorEvents.data })
				.from(sensorEvents)
				.where(
					and(
						eq(sensorEvents.userId, userId),
						eq(sensorEvents.dataType, 'egenfrekvens_checkin'),
						gte(sensorEvents.timestamp, from),
						lte(sensorEvents.timestamp, to)
					)
				)
				.orderBy(desc(sensorEvents.timestamp))
				.limit(3),
			db.query.goals.findMany({
				where: and(eq(goals.userId, userId), eq(goals.status, 'active')),
				columns: { id: true, title: true, targetDate: true, periodKey: true },
				orderBy: [desc(goals.updatedAt)],
				limit: 8
			})
		]);

		return { reflections, plans, egenfrekvensEvents, goals: activeGoals };
	}

	private static dailyInputsAsLines(inputs: Awaited<ReturnType<typeof DreamService.collectDailyInputs>>) {
		return [
			'AKTIVE MÅL:',
			...inputs.goals.map((g) => `- ${g.title}${g.periodKey ? ` (${g.periodKey})` : ''}${g.targetDate ? ` frist ${g.targetDate.toISOString().slice(0, 10)}` : ''}`),
			'',
			'EGENFREKVENS:',
			...inputs.egenfrekvensEvents.map((e) => {
				const d = e.data as Record<string, unknown> | null;
				return `- ${e.timestamp.toISOString().slice(0, 10)}: balanse=${d?.balance ?? '?'}, tanker=${d?.thoughts ?? '?'}, følelser=${d?.feelings ?? '?'}, handlinger=${d?.actions ?? '?'}`;
			}),
			'',
			'REFLEKSJONER:',
			...inputs.reflections.map((r) => `- [${r.kind}] ${r.content}`),
			'',
			'AKTIVE PLANER:',
			...inputs.plans.map((p) => {
				const fields = [p.headline, p.note, p.reflection].filter(Boolean).join(' | ');
				return `- ${p.kind} ${p.periodKey}: ${fields}`;
			})
		];
	}

	private static async synthesize(
		args: {
			kind: DreamKind;
			scope: string;
			inputs: string[];
			previousSummary?: string;
			alignmentGoals?: Array<{ id: string; title: string; periodKey: string | null; targetDate: Date | null }>;
		},
		model = 'gpt-4o-mini'
	): Promise<DreamPayload> {
		const lines = [
			`Du komprimerer kontekst for en personlig AI-coach. Lag en KORT (≤200 ord) syntese for ${args.scope}.`,
			'',
			...args.inputs,
			'',
			args.previousSummary ? `FORRIGE SYNTESE: ${args.previousSummary}` : '',
			'',
			'Returner KUN gyldig JSON med formen:',
			'{',
			'  "summary": "2-4 setninger",',
			'  "highlights": {',
			'    "mode": "least_effort" | "steady" | "push",',
			'    "rationale": "én setning som forklarer modus-valget basert på energi/mood/fremdrift",',
			'    "wins": [], "frictions": [], "signals": [],',
			'    "alignment": { "yearGoal": "on_track|behind|ahead|unknown", "quarterGoal": "...", "monthGoal": "..." }',
			'  }',
			'}'
		].filter(Boolean);

		return this.callLlm(lines.join('\n'), model);
	}

	private static async envisionSynth(
		args: {
			kind: DreamKind;
			horizon: string;
			inputs: string[];
			previousSummary?: string;
		},
		model = 'gpt-4o-mini'
	): Promise<DreamPayload> {
		const lines = [
			`Du foreslår en realistisk og inspirerende visjon for brukeren — horisont: ${args.horizon}.`,
			'Bygg på stabile fakta, ikke finn på. Vær konkret og personlig.',
			'',
			...args.inputs,
			'',
			args.previousSummary ? `FORRIGE VISJON: ${args.previousSummary}` : '',
			'',
			'Returner KUN gyldig JSON med formen:',
			'{',
			'  "summary": "Hvor vil brukeren være ved horisonten? 3-5 setninger, første person.",',
			'  "highlights": {',
			'    "mode": "steady",',
			'    "rationale": "kort begrunnelse",',
			'    "wins": ["3-5 nøkkel-uttrykk for visjonen"],',
			'    "frictions": ["realistiske hindringer å være obs på"],',
			'    "signals": []',
			'  }',
			'}'
		].filter(Boolean);

		return this.callLlm(lines.join('\n'), model);
	}

	private static async callLlm(prompt: string, model: string): Promise<DreamPayload> {
		const completion = await openai.chat.completions.create({
			model,
			messages: [
				{ role: 'system', content: 'Du er en konsis, ærlig coach-assistent. Svar kun med JSON.' },
				{ role: 'user', content: prompt }
			],
			response_format: { type: 'json_object' },
			temperature: 0.4,
			max_tokens: 700
		});

		const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
		try {
			const parsed = JSON.parse(raw) as Partial<DreamPayload>;
			return {
				summary: typeof parsed.summary === 'string' ? parsed.summary : '',
				highlights: {
					mode: (parsed.highlights?.mode as DreamMode) ?? 'steady',
					rationale: typeof parsed.highlights?.rationale === 'string' ? parsed.highlights.rationale : '',
					wins: Array.isArray(parsed.highlights?.wins) ? parsed.highlights.wins.filter((x) => typeof x === 'string') : [],
					frictions: Array.isArray(parsed.highlights?.frictions) ? parsed.highlights.frictions.filter((x) => typeof x === 'string') : [],
					signals: Array.isArray(parsed.highlights?.signals) ? parsed.highlights.signals : [],
					alignment: parsed.highlights?.alignment
				}
			};
		} catch {
			return {
				summary: '',
				highlights: { mode: 'steady', rationale: 'Kunne ikke parse drøm-respons', wins: [], frictions: [], signals: [] }
			};
		}
	}

	private static async persist(
		userId: string,
		args: {
			kind: DreamKind;
			scopeStart: Date;
			scopeEnd: Date;
			payload: DreamPayload;
			previousId?: string;
			model?: string;
			confidence?: DreamConfidence;
			originKind?: DreamOriginKind;
			themeIds?: string[];
			inputRefs?: {
				reflectionIds?: string[];
				planArtifactIds?: string[];
				childBriefIds?: string[];
				goalIds?: string[];
				themeIds?: string[];
				memoryIds?: string[];
			};
		}
	) {
		const relevanceHours = RELEVANCE_HOURS[args.kind];
		const relevanceUntil = relevanceHours === null
			? null
			: new Date(args.scopeEnd.getTime() + relevanceHours * 60 * 60 * 1000);

		const [created] = await db
			.insert(dreams)
			.values({
				userId,
				kind: args.kind,
				scopeStart: args.scopeStart,
				scopeEnd: args.scopeEnd,
				summary: args.payload.summary,
				highlights: args.payload.highlights as unknown as Record<string, unknown>,
				inputs: { ...args.inputRefs, previousBriefId: args.previousId },
				goalIds: args.inputRefs?.goalIds,
				themeIds: args.themeIds,
				model: args.model ?? 'gpt-4o-mini',
				promptVersion: DREAM_PROMPT_VERSION,
				relevanceUntil,
				confidence: args.confidence ?? 'user_confirmed',
				originKind: args.originKind ?? (args.kind.startsWith('vision_') ? 'llm_proposed' : 'synthesis')
			})
			.returning();

		if (args.previousId && created) {
			await db
				.update(dreams)
				.set({ supersededBy: created.id })
				.where(eq(dreams.id, args.previousId));
		}

		return created;
	}
}
