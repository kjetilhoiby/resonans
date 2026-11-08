/**
 * Etterbehandling av Ping-hendelser (vaskemaskin, oppvaskmaskin, tørketrommel).
 *
 * Fram til november 2026 sendte denne fila push (og Google Chat som reserve) når
 * et apparat startet, når programmet ble kjent igjen og når det var ferdig. Heime
 * har tatt over ansvaret for maskinene, og varslene fra Resonans ble da dobbelt
 * opp. Pushen er fjernet; loggen er ikke det — hendelsene skrives fortsatt i
 * `sensor_events` av `/api/apps/event`, programgjenkjenningen lagres som
 * `appliance_match`, og en ferdig syklus legger fortsatt husarbeidet på hjem.
 * Se docs/changelog/2026-11-08-apparater-uten-push.md.
 *
 * Skal pushen tilbake, hører den hjemme i Heime, ikke her: to apper som varsler
 * om den samme maskinen er nettopp det som ble ryddet bort.
 */

import { addChoresForCycle } from '$lib/server/services/chore-service';

type PingEventData = {
	event: string;
	appliance: string;
	cycle_id?: string;
	duration_minutes?: number;
};

/** Det som skal skje når Ping melder en hendelse — i dag bare husarbeidet ved ferdig syklus. */
export async function afterPingEvent(args: { userId: string; data: PingEventData }): Promise<void> {
	const { userId, data } = args;
	if (data.event !== 'finished') return;

	await addChoresForCycle(userId, data.appliance, data.cycle_id, data.duration_minutes).catch((err) =>
		console.error('[ping-chore]', err)
	);
}
