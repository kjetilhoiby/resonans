import { db } from '$lib/db';
import { dreams, goals, sensorEvents } from '$lib/db/schema';
import { and, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { openai } from '$lib/server/openai';
import { getRecentReflections } from '$lib/server/reflections';
import { getRecentPlanArtifacts } from '$lib/server/plan-artifacts';

const DREAM_PROMPT_VERSION = 'daily-dream-v1';

export type DreamMode = 'least_effort' | 'steady' | 'push';

export interface DreamHighlights {
	mode: DreamMode;
	rationale: string;
	wins: string[];
	frictions: string[];
	signals: Array<{ type: string; value: unknown; note?: string }>;
}

export interface DreamPayload {
	summary: string;
	highlights: DreamHighlights;
}

interface RunOptions {
	now?: Date;
	scopeDays?: number;
	model?: string;
}

/**
 * Henter siste 24t/3 dager med refleksjoner, planer og egenfrekvens-events,
 * sender dette til en LLM, og lagrer resultatet som et `daily_dream`-context_brief
 * som chat-prompt kan plukke direkte.
 */
export class DreamService {
	static async runDaily(userId: string, opts: RunOptions = {}) {
		const now = opts.now ?? new Date();
		const scopeDays = opts.scopeDays ?? 1;
		const scopeStart = new Date(now);
		scopeStart.setDate(scopeStart.getDate() - scopeDays);

		const inputs = await this.collectInputs(userId, scopeStart, now);
		const previousBrief = await db.query.dreams.findFirst({
			where: and(eq(dreams.userId, userId), eq(dreams.kind, 'daily_dream')),
			orderBy: [desc(dreams.createdAt)]
		});

		const payload = await this.synthesize({
			scopeStart,
			scopeEnd: now,
			inputs,
			previousBrief
		}, opts.model);

		const [created] = await db
			.insert(dreams)
			.values({
				userId,
				kind: 'daily_dream',
				scopeStart,
				scopeEnd: now,
				summary: payload.summary,
				highlights: payload.highlights as unknown as Record<string, unknown>,
				inputs: {
					reflectionIds: inputs.reflections.map((r) => r.id),
					planArtifactIds: inputs.plans.map((p) => p.id),
					goalIds: inputs.goals.map((g) => g.id),
					previousBriefId: previousBrief?.id
				},
				goalIds: inputs.goals.map((g) => g.id),
				model: opts.model ?? 'gpt-4o-mini',
				promptVersion: DREAM_PROMPT_VERSION,
				relevanceUntil: new Date(now.getTime() + 36 * 60 * 60 * 1000)
			})
			.returning();

		if (previousBrief && created) {
			await db
				.update(dreams)
				.set({ supersededBy: created.id })
				.where(eq(dreams.id, previousBrief.id));
		}

		return created;
	}

	private static async collectInputs(userId: string, from: Date, to: Date) {
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
				columns: { id: true, title: true, targetDate: true },
				orderBy: [desc(goals.updatedAt)],
				limit: 8
			})
		]);

		return { reflections, plans, egenfrekvensEvents, goals: activeGoals };
	}

	private static async synthesize(
		args: {
			scopeStart: Date;
			scopeEnd: Date;
			inputs: Awaited<ReturnType<typeof DreamService.collectInputs>>;
			previousBrief: typeof dreams.$inferSelect | undefined;
		},
		model = 'gpt-4o-mini'
	): Promise<DreamPayload> {
		const { inputs, previousBrief } = args;

		const prompt = [
			'Du komprimerer kontekst for en personlig AI-coach. Lag en KORT (≤180 ord) syntese av siste 24-72t.',
			'',
			'AKTIVE MÅL:',
			...inputs.goals.map((g) => `- ${g.title}${g.targetDate ? ` (frist ${g.targetDate.toISOString().slice(0, 10)})` : ''}`),
			'',
			'EGENFREKVENS (siste innsendinger):',
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
			}),
			'',
			previousBrief ? `FORRIGE DRØM (kontekst): ${previousBrief.summary}` : '',
			'',
			'Returner KUN gyldig JSON med følgende form:',
			'{',
			'  "summary": "2-4 setninger som oppsummerer hvor brukeren står og hva som er viktig i morgen",',
			'  "highlights": {',
			'    "mode": "least_effort" | "steady" | "push",',
			'    "rationale": "én setning som forklarer modus-valget basert på energi/mood",',
			'    "wins": ["kort win 1", "kort win 2"],',
			'    "frictions": ["kort friksjon 1"],',
			'    "signals": [{"type":"sleep_lag","value":2,"note":"valgfri"}]',
			'  }',
			'}'
		].join('\n');

		const completion = await openai.chat.completions.create({
			model,
			messages: [
				{ role: 'system', content: 'Du er en konsis, ærlig coach-assistent. Svar kun med JSON.' },
				{ role: 'user', content: prompt }
			],
			response_format: { type: 'json_object' },
			temperature: 0.4,
			max_tokens: 600
		});

		const raw = completion.choices[0]?.message?.content?.trim() ?? '{}';
		try {
			const parsed = JSON.parse(raw) as Partial<DreamPayload>;
			const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
			const highlights: DreamHighlights = {
				mode: (parsed.highlights?.mode as DreamMode) ?? 'steady',
				rationale: typeof parsed.highlights?.rationale === 'string' ? parsed.highlights.rationale : '',
				wins: Array.isArray(parsed.highlights?.wins) ? parsed.highlights.wins.filter((x) => typeof x === 'string') : [],
				frictions: Array.isArray(parsed.highlights?.frictions) ? parsed.highlights.frictions.filter((x) => typeof x === 'string') : [],
				signals: Array.isArray(parsed.highlights?.signals) ? parsed.highlights.signals : []
			};
			return { summary, highlights };
		} catch {
			return {
				summary: '',
				highlights: { mode: 'steady', rationale: 'Kunne ikke parse drøm-respons', wins: [], frictions: [], signals: [] }
			};
		}
	}

	/**
	 * Hent gjeldende drøm for chat-bruk. Velger den nyeste som ikke er utløpt.
	 */
	static async getActiveDream(userId: string, now = new Date()) {
		return db.query.dreams.findFirst({
			where: and(
				eq(dreams.userId, userId),
				eq(dreams.kind, 'daily_dream'),
				or(isNull(dreams.relevanceUntil), gte(dreams.relevanceUntil, now)),
				isNull(dreams.supersededBy)
			),
			orderBy: [desc(dreams.createdAt)]
		});
	}
}
