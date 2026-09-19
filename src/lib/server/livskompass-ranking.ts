/**
 * Rekkefølgen: lagring og lesing.
 *
 * Én `sensor_events`-rad per gang rekkefølgen settes, `dataType:
 * 'livskompass_ranking'`, på livskompassets egen sensor. Ingen ny tabell —
 * samme valg som nedprioriteringene, ukesinnsjekkene og viktighetsprofilen.
 *
 * **Append-only, nyeste vinner.** En rekkefølge rettes ikke; den settes på
 * nytt. Da er historikken gratis: «i fjor kom jobb først» er nøyaktig det et
 * re-intervju skal kunne holde opp mot brukeren, og en oppdatering på plass
 * ville slettet det. Samme grunn som at intervju-transkriptene er append-only.
 *
 * **Tidsstempelet er REGISTRERINGSTIDSPUNKTET.** Unikhetsindeksen på
 * `sensor_events` er (`sensor_id`, `data_type`, `timestamp`), så et dagsstempel
 * ville innført «én rekkefølge per dag» som en 500 uten feilmelding. `setOn`
 * bor i `data`.
 *
 * Reglene bor rent i `$lib/domains/livskompass/ranking.ts`.
 */

import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { osloDayKey } from '$lib/domain/oslo-time';
import { getOrCreateLivskompassSensor } from '$lib/server/livskompass-sensor';
import {
	normalizeStoredPriorities,
	validatePriorities,
	type Priority,
	type Ranking
} from '$lib/domains/livskompass/ranking';

export const RANKING_DATA_TYPE = 'livskompass_ranking';

export type SaveRankingResult = { ok: true; ranking: Ranking } | { ok: false; error: string };

function rowToRanking(data: unknown): Ranking | null {
	const d = (data ?? {}) as Record<string, unknown>;
	if (!Array.isArray(d.priorities)) return null;
	// TOLERANT ved lesing (`normalizeStoredPriorities`), strengt ved skriving.
	// Et senere lavere tak, eller en dimensjon som er fjernet, skal ikke få en
	// rekkefølge brukeren alt har satt til å forsvinne uten et ord.
	return {
		priorities: normalizeStoredPriorities(d.priorities),
		setOn: typeof d.setOn === 'string' ? d.setOn : ''
	};
}

/** Nyeste rekkefølge, eller null. En tom rekkefølge leses som «ingen». */
export async function readRanking(userId: string): Promise<Ranking | null> {
	const rows = await db
		.select({ data: sensorEvents.data })
		.from(sensorEvents)
		.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, RANKING_DATA_TYPE)))
		.orderBy(desc(sensorEvents.timestamp))
		.limit(1);
	const ranking = rows[0] ? rowToRanking(rows[0].data) : null;
	return ranking && ranking.priorities.length > 0 ? ranking : null;
}

/**
 * Sett rekkefølgen på nytt.
 *
 * En TOM liste er et gyldig svar og skrives som en rad: «jeg har ingen
 * rangering nå» er en beslutning, og uten raden ville den forrige blitt
 * stående som om den fortsatt gjaldt.
 */
export async function saveRanking(
	userId: string,
	priorities: unknown,
	now: Date = new Date(),
	source = 'livskompass_ranking'
): Promise<SaveRankingResult> {
	const validated = validatePriorities(priorities);
	if (!validated.ok) return validated;

	const ranking: Ranking = { priorities: validated.value as Priority[], setOn: osloDayKey(now) };
	const sensor = await getOrCreateLivskompassSensor(userId);
	const written = await SensorEventService.write({
		userId,
		sensorId: sensor.id,
		eventType: 'measurement',
		dataType: RANKING_DATA_TYPE,
		timestamp: now,
		data: { priorities: ranking.priorities, setOn: ranking.setOn },
		source
	});
	if (!written.event?.id) return { ok: false, error: 'Klarte ikke å lagre rekkefølgen.' };
	return { ok: true, ranking };
}
