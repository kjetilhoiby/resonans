import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { rebuildProfile } from '$lib/server/services/appliance-profile-service';

export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { cycleId: string; programName: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON body');
	}

	if (!body.cycleId || !body.programName?.trim()) {
		throw error(400, 'Missing cycleId or programName');
	}

	const programName = body.programName.trim();

	const [event] = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'appliance_cycle_summary'),
				sql`${sensorEvents.data}->>'cycle_id' = ${body.cycleId}`
			)
		)
		.limit(1);

	if (!event) {
		throw error(404, 'Cycle not found');
	}

	const data = event.data as Record<string, unknown>;
	const appliance = data.appliance as string;

	await db
		.update(sensorEvents)
		.set({
			data: { ...data, label: { program_name: programName } }
		})
		.where(eq(sensorEvents.id, event.id));

	await rebuildProfile(userId, appliance, programName);

	return json({ ok: true, cycleId: body.cycleId, programName, appliance });
};
