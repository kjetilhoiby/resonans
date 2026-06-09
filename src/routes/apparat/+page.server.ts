import { redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/db';
import { sensorEvents, sensors } from '$lib/db/schema';
import { and, eq, desc, inArray } from 'drizzle-orm';
import { HOME_APPLIANCE_SUBTYPES } from '$lib/domains/home';
import { SensorEventService } from '$lib/server/services/sensor-event-service';

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.userId;
	const cycleId = url.searchParams.get('cycle');
	const applianceName = url.searchParams.get('appliance');

	if (!cycleId || !applianceName) {
		redirect(302, '/');
	}

	const ownedSensors = await db
		.select({ id: sensors.id })
		.from(sensors)
		.where(
			and(
				eq(sensors.userId, userId),
				inArray(sensors.subtype, HOME_APPLIANCE_SUBTYPES as unknown as string[])
			)
		);

	if (ownedSensors.length === 0) redirect(302, '/');

	const sensorIds = ownedSensors.map((s) => s.id);
	const latest = await db
		.select({
			id: sensorEvents.id,
			sensorId: sensorEvents.sensorId,
			eventType: sensorEvents.eventType,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				inArray(sensorEvents.sensorId, sensorIds)
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(30);

	const cycleEvents = latest.filter(
		(e) => (e.data as Record<string, unknown>)?.cycle_id === cycleId
	);

	const startEvent = cycleEvents.find(
		(e) => (e.data as Record<string, unknown>)?.event === 'started'
	);
	const latestProgress = cycleEvents.find(
		(e) => {
			const ev = (e.data as Record<string, unknown>)?.event;
			return ev === 'progress' || ev === 'running';
		}
	);

	const currentEstimate = latestProgress
		? (latestProgress.data as Record<string, unknown>)?.estimated_minutes_remaining as number | undefined
		: undefined;

	const startedAt = startEvent?.timestamp ?? cycleEvents[cycleEvents.length - 1]?.timestamp;

	return {
		cycleId,
		appliance: applianceName,
		startedAt: startedAt ? (startedAt as Date).toISOString() : null,
		currentEstimateMinutes: currentEstimate ?? null,
		sensorId: cycleEvents[0]?.sensorId ?? sensorIds[0]
	};
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		const userId = locals.userId;
		const form = await request.formData();
		const sensorId = String(form.get('sensorId') || '');
		const cycleId = String(form.get('cycleId') || '');
		const appliance = String(form.get('appliance') || '');
		const program = String(form.get('program') || '').trim();
		const remainingStr = String(form.get('remainingMinutes') || '').trim();
		const remainingMinutes = remainingStr ? Number(remainingStr) : null;

		if (!sensorId || !cycleId || !appliance) {
			redirect(302, '/');
		}

		let estimatedFinishAt: string | undefined;
		if (remainingMinutes && remainingMinutes > 0) {
			estimatedFinishAt = new Date(Date.now() + remainingMinutes * 60_000).toISOString();
		}

		await SensorEventService.write(
			{
				userId,
				sensorId,
				eventType: 'state_change',
				dataType: 'appliance_correction',
				timestamp: new Date(),
				data: {
					event: 'running',
					cycle_id: cycleId,
					appliance,
					...(program ? { matched_program: program } : {}),
					...(estimatedFinishAt ? { estimated_finish_at: estimatedFinishAt } : {}),
					source: 'user_correction'
				},
				metadata: { sourceApp: 'ping' },
				source: 'ping_correction'
			},
			{ conflictMode: 'upsert_sensor_datatype_timestamp' }
		);

		redirect(302, '/');
	}
};
