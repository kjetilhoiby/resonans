import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { refreshAfterDismissChange } from '$lib/server/workouts/dismiss-workout';

/**
 * Skiller en kilde ut av økta den er klynget inn i, eller slår den sammen igjen.
 *
 * Aktivitetslaget slår sammen alt i samme idrettsfamilie som starter innen to
 * timer (`clusterWorkoutEvents`). Det er riktig for samme tur fra klokke, fil og
 * app, og feil for to turer samme ettermiddag: 27. september 2026 slukte en
 * utetur mølleturen tre kvarter tidligere, fordi begge kom fra Ekko og
 * `latestPerSensor` tok den nyeste. Regelen beholdes; dette er utveien.
 *
 * **Utskilling er et flagg, ikke en sletting.** Raden får `metadata.clusterGroup`,
 * og klynges deretter bare med rader i samme gruppe. Flagget er brukereid
 * (`USER_OWNED_METADATA_KEYS`), så det overlever at kilden synker raden på nytt.
 *
 * **Et opptak flyttes helt.** Rader fra samme sensor med samme `sessionId` er
 * versjoner av samme opptak (en ny sending fra Ekko), og følger med – ellers ble
 * den gamle versjonen liggende igjen i klynga den ble skilt ut av.
 */

export type SplitWorkoutResult =
	| { ok: true; eventIds: string[]; group: string | null }
	| { ok: false; reason: 'not_found' };

export async function setWorkoutSplit(
	userId: string,
	eventId: string,
	options: { split: boolean }
): Promise<SplitWorkoutResult> {
	const target = await db.query.sensorEvents.findFirst({
		columns: { id: true, sensorId: true, timestamp: true, metadata: true },
		where: and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'workout'))
	});
	if (!target) return { ok: false, reason: 'not_found' };
	const metadata = (target.metadata ?? {}) as Record<string, unknown>;

	let ids: string[];
	if (options.split) {
		const sessionId = typeof metadata.sessionId === 'string' ? metadata.sessionId : null;
		const versions = sessionId
			? await db
					.select({ id: sensorEvents.id })
					.from(sensorEvents)
					.where(
						and(
							eq(sensorEvents.userId, userId),
							eq(sensorEvents.sensorId, target.sensorId),
							eq(sensorEvents.dataType, 'workout'),
							sql`${sensorEvents.metadata}->>'sessionId' = ${sessionId}`
						)
					)
			: [];
		ids = [...new Set([target.id, ...versions.map((row) => row.id)])];
	} else {
		// Sammenslåing gjelder hele gruppa raden er i.
		const group = typeof metadata.clusterGroup === 'string' ? metadata.clusterGroup : null;
		if (!group) return { ok: true, eventIds: [], group: null };
		const members = await db
			.select({ id: sensorEvents.id })
			.from(sensorEvents)
			.where(and(eq(sensorEvents.userId, userId), sql`${sensorEvents.metadata}->>'clusterGroup' = ${group}`));
		ids = members.map((row) => row.id);
	}

	const group = options.split ? crypto.randomUUID() : null;
	const next = group
		? sql`jsonb_set(COALESCE(${sensorEvents.metadata}, '{}'::jsonb), '{clusterGroup}', ${JSON.stringify(group)}::jsonb)`
		: sql`COALESCE(${sensorEvents.metadata}, '{}'::jsonb) - 'clusterGroup'`;

	await db
		.update(sensorEvents)
		.set({ metadata: next })
		.where(and(eq(sensorEvents.userId, userId), inArray(sensorEvents.id, ids)));

	await refreshAfterDismissChange(userId, target.timestamp);

	return { ok: true, eventIds: ids, group };
}
