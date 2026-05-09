import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents, persons } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * GET /api/sensors/spond/groups
 * Returnerer distinkte (groupId, groupName) som er observert i synkede Spond-events,
 * sammen med hvilken person som eventuelt allerede er knyttet til hver gruppe.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');

	const groupRows = await db.execute(sql`
		SELECT
			data->>'groupId' AS group_id,
			MAX(data->>'groupName') AS group_name,
			COUNT(*)::int AS event_count,
			MAX(timestamp) AS last_seen
		FROM sensor_events
		WHERE user_id = ${userId}
		  AND data_type = 'spond_event'
		  AND data->>'groupId' IS NOT NULL
		GROUP BY data->>'groupId'
		ORDER BY MAX(data->>'groupName') NULLS LAST
	`);

	const allPersons = await db
		.select()
		.from(persons)
		.where(and(eq(persons.userId, userId), eq(persons.archived, false)));

	const groupToPerson = new Map<string, { id: string; name: string }>();
	for (const p of allPersons) {
		for (const g of p.spondGroupIds ?? []) {
			groupToPerson.set(g, { id: p.id, name: p.name });
		}
	}

	const groups = (groupRows as unknown as Array<{
		group_id: string;
		group_name: string | null;
		event_count: number;
		last_seen: string;
	}>).map((row) => ({
		groupId: row.group_id,
		groupName: row.group_name ?? row.group_id,
		eventCount: row.event_count,
		lastSeen: row.last_seen,
		assignedPerson: groupToPerson.get(row.group_id) ?? null
	}));

	return json({ groups });
};
