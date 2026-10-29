/**
 * Retningssamtalen som tjeneste — lest og lagret likt fra appens flyt
 * (`/api/retning/kvartal`) og fra MCP (`query_direction`,
 * `save_direction_conversation`). Se docs/mcp.md, «Retningssamtalen».
 *
 * Tre lag, som i resten av Retning-systemet («samtalen er data»):
 * - gap-notatet (`retningsgap`) er gjeldende tilstand og ERSTATTES per kvartal —
 *   det er det chat-konteksten viser som «KJENTE GAP»;
 * - transkriptet (`retningssamtale`) er arkiv og legges ALLTID til;
 * - en justert kvartalsvisjon superseder den forrige, og historikken står.
 */

import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { memories, reflections } from '$lib/db/schema';
import { DreamService, type VisionHorizon } from '$lib/server/services/dream-service';
import { createReflection, getLatestReflection, getReflectionForPeriod, upsertReflectionForPeriod } from '$lib/server/reflections';
import { addCanonicalEventMessage } from '$lib/server/conversations';
import { osloDateOf } from '$lib/domain/plan-items';
import {
	compareQuarterKeys,
	daysIntoQuarter,
	isInQuarterWindow,
	isValidQuarterKey,
	quarterKeyFromIsoDate,
	sameTranscript
} from '$lib/flows/retning-kvartal';

const HORIZONS: { horizon: VisionHorizon; label: string }[] = [
	{ horizon: 'vision_10year', label: 'Om ti år' },
	{ horizon: 'vision_5year', label: 'Om fem år' },
	{ horizon: 'vision_yearly', label: 'Om ett år' },
	{ horizon: 'vision_quarterly', label: 'Kommende kvartal' }
];

/** Samme vindu som hurtighandlingen på hjemskjermen (`retning-kvartal.ts`). */
const WINDOW_DAYS = 21;

export class DirectionError extends Error {
	constructor(
		public code: 'invalid_argument',
		message: string
	) {
		super(message);
	}
}

/** Inneværende kvartal i Oslo — ikke serverens klokke, som går på UTC. */
export function currentQuarterKey(now = new Date()): string {
	return quarterKeyFromIsoDate(osloDateOf(now));
}

export async function loadDirectionState(userId: string, now = new Date()) {
	const today = osloDateOf(now);
	const periodKey = quarterKeyFromIsoDate(today);
	const [y, m, d] = today.split('-').map(Number);
	const localToday = new Date(y, m - 1, d);

	const [visions, valueRows, latestGap, conversations, gapThisQuarter, weekly, monthly, lifeInterview] = await Promise.all([
		Promise.all(HORIZONS.map((h) => DreamService.getActive(userId, h.horizon, now))),
		db.query.memories.findMany({
			where: and(eq(memories.userId, userId), eq(memories.category, 'values'), isNull(memories.supersededBy)),
			orderBy: [desc(memories.importance), desc(memories.createdAt)],
			limit: 10,
			columns: { content: true }
		}),
		getLatestReflection(userId, 'retningsgap'),
		db.query.reflections.findMany({
			where: and(eq(reflections.userId, userId), eq(reflections.kind, 'retningssamtale')),
			orderBy: [desc(reflections.createdAt)],
			limit: 8,
			columns: { id: true, periodKey: true, createdAt: true, content: true }
		}),
		getReflectionForPeriod(userId, 'retningsgap', periodKey),
		DreamService.getActive(userId, 'weekly_dream', now),
		DreamService.getActive(userId, 'monthly_dream', now),
		getLatestReflection(userId, 'livsintervju')
	]);

	const visionList = HORIZONS.flatMap((h, i) => {
		const v = visions[i];
		if (!v?.summary) return [];
		return [
			{
				horizon: h.horizon,
				label: h.label,
				text: v.summary,
				// Et AI-utkast er ikke brukerens retning, og skal ikke holdes opp mot hverdagen som om det var det.
				authored: v.originKind === 'user_authored',
				since: v.createdAt.toISOString()
			}
		];
	});
	const hasAuthored = visionList.some((v) => v.authored);
	const doneThisQuarter = !!gapThisQuarter || conversations.some((c) => c.periodKey === periodKey);

	const notes: string[] = [];
	if (!hasAuthored) {
		notes.push(
			'Brukeren har ingen egenformulert retning ennå. Retningssamtalen forutsetter den — foreslå livsintervjuet i appen (Retning-siden) framfor å gjette en retning å holde hverdagen opp mot.'
		);
	}
	if (doneThisQuarter) {
		notes.push(
			`Samtalen for ${periodKey} er alt lagret. Et nytt lagre-kall ERSTATTER gap-notatet for kvartalet; transkriptet legges til ved siden av det forrige.`
		);
	}
	if (!weekly?.summary && !monthly?.summary) {
		notes.push('Ingen ferske synteser av hverdagen. Hent tallene med query-verktøyene (query_plan, query_goals, query_training, …).');
	}

	return {
		quarter: {
			periodKey,
			dayInQuarter: daysIntoQuarter(localToday),
			// Appen foreslår samtalen de første tre ukene; den kan føres når som helst.
			suggestedNow: isInQuarterWindow(localToday, WINDOW_DAYS) && !doneThisQuarter,
			done: doneThisQuarter
		},
		visions: visionList,
		values: valueRows.map((r) => r.content),
		latestGap: latestGap
			? { periodKey: latestGap.periodKey, text: latestGap.content, savedAt: latestGap.createdAt.toISOString() }
			: null,
		previousConversations: conversations.map((c) => ({
			id: c.id,
			periodKey: c.periodKey,
			createdAt: c.createdAt.toISOString(),
			characters: c.content.length
		})),
		syntheses: {
			lastMonth: monthly?.summary ?? null,
			lastWeek: weekly?.summary ?? null
		},
		lifeInterview: lifeInterview
			? { periodKey: lifeInterview.periodKey, createdAt: lifeInterview.createdAt.toISOString() }
			: null,
		notes
	};
}

export interface SaveDirectionConversationInput {
	gap?: string;
	vision?: string;
	transcript?: string;
	/** Default: inneværende kvartal i Oslo. */
	periodKey?: string;
	/** Rå-samtalen i `messages`, når samtalen ble ført i appen. Må være validert mot brukeren. */
	conversationId?: string | null;
	/** Hvor samtalen ble ført. `mcp` merker transkriptet, så en senere leser vet at replikkene er gjengitt. */
	origin: 'app' | 'mcp';
	now?: Date;
}

export const MCP_TRANSCRIPT_HEADER =
	'[Ført i en ekstern assistent (Claude eller ChatGPT) over MCP. Replikkene er gjengitt av assistenten, ikke lagret fortløpende.]';

export async function saveDirectionConversation(userId: string, input: SaveDirectionConversationInput) {
	const now = input.now ?? new Date();
	const gap = input.gap?.trim() ?? '';
	const vision = input.vision?.trim() ?? '';
	const rawTranscript = input.transcript?.trim() ?? '';
	if (!gap && !vision) throw new DirectionError('invalid_argument', 'Tom samtale: send gap-notatet, en kvartalsvisjon eller begge.');

	const current = currentQuarterKey(now);
	const periodKey = input.periodKey?.trim() || current;
	if (!isValidQuarterKey(periodKey)) {
		throw new DirectionError('invalid_argument', `periodKey må se ut som «2026-Q4», fikk ${JSON.stringify(input.periodKey)}.`);
	}
	if (compareQuarterKeys(periodKey, current) > 0) {
		throw new DirectionError('invalid_argument', `${periodKey} har ikke begynt. En retningssamtale ser bakover; bruk ${current}.`);
	}

	const transcript = rawTranscript && input.origin === 'mcp' ? `${MCP_TRANSCRIPT_HEADER}\n\n${rawTranscript}` : rawTranscript;

	// Gap-notatet er «current state» (upsert); transkriptet er arkiv (append-only)
	const gapReflection = gap
		? await upsertReflectionForPeriod({ userId, kind: 'retningsgap', periodKey, content: gap })
		: null;

	// Append-only betyr ikke at et nytt forsøk på samme kall skal gi to rader.
	let transcriptReflection: { id: string } | null = null;
	let transcriptAlreadySaved = false;
	if (transcript) {
		const existing = await db.query.reflections.findMany({
			where: and(eq(reflections.userId, userId), eq(reflections.kind, 'retningssamtale'), eq(reflections.periodKey, periodKey)),
			columns: { id: true, content: true }
		});
		const same = existing.find((r) => sameTranscript(r.content, transcript));
		if (same) {
			transcriptReflection = same;
			transcriptAlreadySaved = true;
		} else {
			transcriptReflection = await createReflection({ userId, kind: 'retningssamtale', periodKey, content: transcript });
		}
	}

	let visionId: string | null = null;
	let visionUnchanged = false;
	if (vision) {
		const active = await DreamService.getActive(userId, 'vision_quarterly', now);
		if (active && active.originKind === 'user_authored' && active.summary.trim() === vision) {
			visionId = active.id;
			visionUnchanged = true;
		} else {
			const saved = await DreamService.saveAuthoredVision(userId, {
				horizon: 'vision_quarterly',
				summary: vision,
				inputRefs: {
					reflectionIds: [gapReflection?.id, transcriptReflection?.id].filter((id): id is string => Boolean(id)),
					conversationIds: input.conversationId ? [input.conversationId] : undefined
				},
				now
			});
			visionId = saved?.id ?? null;
		}
	}

	if (!transcriptAlreadySaved) {
		void addCanonicalEventMessage(userId, {
			kind: 'flow',
			icon: '🧭',
			title: `Retningssamtalen for ${periodKey} er gjennomført`,
			href: '/drommer'
		}).catch((err) => console.error('[retning] event-kort feilet:', err));
	}

	return {
		periodKey,
		gapNoteId: gapReflection?.id ?? null,
		transcriptId: transcriptReflection?.id ?? null,
		transcriptAlreadySaved,
		visionId,
		visionUnchanged
	};
}
