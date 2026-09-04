import { and, desc, gte, lte, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { chatPerfSamples } from '$lib/db/schema';
import {
	parsePhases,
	summarizeChatPerf,
	type ChatPerfSample
} from '$lib/domain/chat-perf-stats';

/**
 * Lagring og lesing av chat-fasemålinger. Aggregeringen bor i domenelaget.
 *
 * Se `$lib/domain/chat-perf-stats.ts` for hvorfor målingen lagres og ikke
 * bare logges.
 */

/**
 * Oppbevaring. Rundt hundre meldinger i døgnet gir ~3 000 rader i måneden —
 * smått. Tretti dager dekker «ble det bedre etter forrige grep», som er det
 * spørsmålet en ytelsesmåling faktisk stilles for.
 */
export const RETENTION_DAYS = 30;

const PRUNE_PROBABILITY = 0.05;
const MAX_SAMPLES = 2000;

/**
 * Lagrer én måling.
 *
 * **Feiler stille, og det er hele poenget.** Dette er instrumentering på
 * chat-stien; en måling som ikke kan skrives skal aldri kunne velte en
 * melding brukeren venter på. Logglinja går ut uansett — den er fortsatt
 * primærkilden når man ser på én enkelt melding.
 */
export async function recordChatPerf(
	sample: ChatPerfSample,
	instance: string | null = null
): Promise<void> {
	try {
		await db.insert(chatPerfSamples).values({
			wallMs: sample.wallMs,
			phases: sample.phases,
			instance
		});

		if (Math.random() < PRUNE_PROBABILITY) {
			await db
				.delete(chatPerfSamples)
				.where(
					lte(
						chatPerfSamples.measuredAt,
						sql`now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`
					)
				);
		}
	} catch (err) {
		console.warn('[chat-perf] kunne ikke lagre måling:', err);
	}
}

/** Aggregatet for et vindu, med domenelagets dom. */
export async function loadChatPerfWindow(fromMs: number, toMs: number) {
	const rows = await db
		.select({
			measuredAt: chatPerfSamples.measuredAt,
			wallMs: chatPerfSamples.wallMs,
			phases: chatPerfSamples.phases
		})
		.from(chatPerfSamples)
		.where(
			and(
				gte(chatPerfSamples.measuredAt, new Date(fromMs)),
				lte(chatPerfSamples.measuredAt, new Date(toMs))
			)
		)
		.orderBy(desc(chatPerfSamples.measuredAt))
		.limit(MAX_SAMPLES);

	const samples: ChatPerfSample[] = rows.map((r) => ({
		wallMs: r.wallMs,
		// Gjennom hvitelisten, ikke rått fra jsonb.
		phases: parsePhases(r.phases)
	}));

	return {
		...summarizeChatPerf(samples),
		newest: rows[0]?.measuredAt.toISOString() ?? null,
		oldest: rows[rows.length - 1]?.measuredAt.toISOString() ?? null,
		truncated: rows.length >= MAX_SAMPLES
	};
}
