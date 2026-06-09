import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { sensorEvents, sensors, applianceProfiles } from '$lib/db/schema';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { HOME_APPLIANCE_SUBTYPES } from '$lib/domains/home';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;

	const ownedSensors = await db
		.select({ id: sensors.id })
		.from(sensors)
		.where(
			and(
				eq(sensors.userId, userId),
				inArray(sensors.subtype, HOME_APPLIANCE_SUBTYPES as unknown as string[])
			)
		);

	if (ownedSensors.length === 0) {
		return { cycles: [], profiles: [] };
	}

	const sensorIds = ownedSensors.map((s) => s.id);

	const summaries = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				inArray(sensorEvents.sensorId, sensorIds),
				eq(sensorEvents.dataType, 'appliance_cycle_summary'),
				sql`${sensorEvents.data}->'label' IS NULL`
			)
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(20);

	type CycleData = {
		appliance?: string;
		cycle_id?: string;
		duration_minutes?: number;
		total_kwh?: number;
	};

	const cycles = summaries.map((e) => {
		const d = e.data as CycleData;
		return {
			id: e.id,
			cycleId: d.cycle_id ?? '',
			appliance: d.appliance ?? '',
			timestamp: (e.timestamp as Date).toISOString(),
			durationMinutes: d.duration_minutes ?? 0,
			totalKwh: d.total_kwh ?? 0
		};
	});

	const profiles = await db
		.select({
			appliance: applianceProfiles.appliance,
			programName: applianceProfiles.programName
		})
		.from(applianceProfiles)
		.where(eq(applianceProfiles.userId, userId));

	return { cycles, profiles };
};
