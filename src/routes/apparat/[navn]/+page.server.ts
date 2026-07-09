import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { db } from '$lib/db';
import { sensorEvents, sensors, applianceProfiles } from '$lib/db/schema';
import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { HOME_APPLIANCE_SUBTYPES, pingApplianceEmoji } from '$lib/domains/home';
import {
	buildApplianceCycle,
	buildVacuumState,
	type VacuumState,
	type ApplianceCycle
} from '$lib/server/services/appliance-cycle';
import { rebuildProfile } from '$lib/server/services/appliance-profile-service';

type EventRow = {
	id: string;
	sensorId?: string;
	eventType: string;
	dataType: string | null;
	timestamp: Date;
	data: unknown;
};

function toMapped(rows: EventRow[]) {
	return rows.map((e) => ({
		id: e.id,
		eventType: e.eventType,
		dataType: e.dataType ?? '',
		timestamp: (e.timestamp as Date).toISOString(),
		data: (e.data ?? {}) as Record<string, unknown>
	}));
}

async function ownedSensorIds(userId: string): Promise<string[]> {
	const rows = await db
		.select({ id: sensors.id })
		.from(sensors)
		.where(
			and(
				eq(sensors.userId, userId),
				inArray(sensors.subtype, HOME_APPLIANCE_SUBTYPES as unknown as string[])
			)
		);
	return rows.map((s) => s.id);
}

export const load: PageServerLoad = async ({ locals, params }) => {
	const userId = locals.userId;
	const applianceName = decodeURIComponent(params.navn);

	const sensorIds = await ownedSensorIds(userId);
	if (sensorIds.length === 0) throw error(404, 'Ingen apparater funnet');

	const applianceFilter = and(
		eq(sensorEvents.userId, userId),
		inArray(sensorEvents.sensorId, sensorIds),
		sql`${sensorEvents.data}->>'appliance' = ${applianceName}`
	);

	// Nyeste hendelser for status (progress/status/korreksjon m.m.).
	const recent = (await db
		.select({
			id: sensorEvents.id,
			sensorId: sensorEvents.sensorId,
			eventType: sensorEvents.eventType,
			dataType: sensorEvents.dataType,
			timestamp: sensorEvents.timestamp,
			data: sensorEvents.data
		})
		.from(sensorEvents)
		.where(applianceFilter)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(60)) as EventRow[];

	if (recent.length === 0) throw error(404, `Fant ingen data for «${applianceName}»`);

	const mapped = toMapped(recent);
	const isVacuum = mapped.some((e) => e.dataType.startsWith('vacuum_'));

	let vacuum: VacuumState | null = null;
	let cycle: ApplianceCycle | null = null;
	let runs: Array<Record<string, unknown>> = [];
	let programs: string[] = [];

	if (isVacuum) {
		vacuum = buildVacuumState(mapped);

		const runRows = (await db
			.select({
				id: sensorEvents.id,
				eventType: sensorEvents.eventType,
				dataType: sensorEvents.dataType,
				timestamp: sensorEvents.timestamp,
				data: sensorEvents.data
			})
			.from(sensorEvents)
			.where(and(applianceFilter, eq(sensorEvents.dataType, 'vacuum_clean')))
			.orderBy(desc(sensorEvents.timestamp))
			.limit(30)) as EventRow[];

		runs = runRows.map((e) => {
			const d = (e.data ?? {}) as Record<string, unknown>;
			return {
				id: e.id,
				cycleId: (d.cycle_id as string) ?? '',
				at: (e.timestamp as Date).toISOString(),
				areaM2: typeof d.area_m2 === 'number' ? d.area_m2 : null,
				durationMinutes: typeof d.duration_minutes === 'number' ? d.duration_minutes : null,
				cleanType: typeof d.clean_type === 'string' ? d.clean_type : null,
				mapName: typeof d.map_name === 'string' ? d.map_name : null,
				complete: typeof d.complete === 'boolean' ? d.complete : null,
				note: typeof d.note === 'string' ? d.note : null
			};
		});
	} else {
		const profileRows = await db
			.select()
			.from(applianceProfiles)
			.where(eq(applianceProfiles.userId, userId));
		cycle = buildApplianceCycle(
			applianceName,
			mapped,
			profileRows.map((p) => ({
				appliance: p.appliance,
				programName: p.programName,
				avgWattBuckets1min: p.avgWattBuckets1min,
				avgDurationMinutes: p.avgDurationMinutes,
				cycleCount: p.cycleCount
			}))
		);
		programs = [
			...new Set(profileRows.filter((p) => p.appliance === applianceName).map((p) => p.programName))
		];

		const runRows = (await db
			.select({
				id: sensorEvents.id,
				eventType: sensorEvents.eventType,
				dataType: sensorEvents.dataType,
				timestamp: sensorEvents.timestamp,
				data: sensorEvents.data
			})
			.from(sensorEvents)
			.where(and(applianceFilter, eq(sensorEvents.dataType, 'appliance_cycle_summary')))
			.orderBy(desc(sensorEvents.timestamp))
			.limit(30)) as EventRow[];

		runs = runRows.map((e) => {
			const d = (e.data ?? {}) as Record<string, unknown>;
			const label = d.label as { program_name?: string } | undefined;
			return {
				id: e.id,
				cycleId: (d.cycle_id as string) ?? '',
				at: (e.timestamp as Date).toISOString(),
				durationMinutes: typeof d.duration_minutes === 'number' ? d.duration_minutes : null,
				totalKwh: typeof d.total_kwh === 'number' ? d.total_kwh : null,
				program: label?.program_name ?? null
			};
		});
	}

	// Kjørende hvitevare-syklus → tilby korreksjon (program + gjenstående).
	let runningCycleId: string | null = null;
	if (!isVacuum && cycle?.isRunning) {
		runningCycleId =
			(mapped.find((e) => e.data?.cycle_id)?.data.cycle_id as string | undefined) ?? null;
	}

	return {
		applianceName,
		emoji: isVacuum ? '🧹' : pingApplianceEmoji(applianceName),
		isVacuum,
		vacuum,
		cycle,
		runningCycleId,
		sensorId: recent[0]?.sensorId ?? sensorIds[0],
		runs,
		programs
	};
};

async function findEventForCycle(userId: string, dataType: string, cycleId: string) {
	const [row] = await db
		.select({ id: sensorEvents.id, data: sensorEvents.data })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, dataType),
				sql`${sensorEvents.data}->>'cycle_id' = ${cycleId}`
			)
		)
		.limit(1);
	return row;
}

export const actions: Actions = {
	// Merk en hvitevare-syklus med program → oppdaterer profil.
	label: async ({ locals, request }) => {
		const userId = locals.userId;
		const form = await request.formData();
		const cycleId = String(form.get('cycleId') || '').trim();
		const programName = String(form.get('programName') || '').trim();
		if (!cycleId || !programName) return fail(400, { error: 'Mangler syklus eller program' });

		const event = await findEventForCycle(userId, 'appliance_cycle_summary', cycleId);
		if (!event) return fail(404, { error: 'Fant ikke syklusen' });

		const data = event.data as Record<string, unknown>;
		await db
			.update(sensorEvents)
			.set({ data: { ...data, label: { program_name: programName } } })
			.where(eq(sensorEvents.id, event.id));
		await rebuildProfile(userId, data.appliance as string, programName);
		return { ok: true };
	},

	// Fritekst-notat på en støvsuger-runde.
	note: async ({ locals, request }) => {
		const userId = locals.userId;
		const form = await request.formData();
		const eventId = String(form.get('eventId') || '').trim();
		const note = String(form.get('note') || '').trim();
		if (!eventId) return fail(400, { error: 'Mangler runde' });

		const [row] = await db
			.select({ id: sensorEvents.id, data: sensorEvents.data })
			.from(sensorEvents)
			.where(and(eq(sensorEvents.userId, userId), eq(sensorEvents.id, eventId)))
			.limit(1);
		if (!row) return fail(404, { error: 'Fant ikke runden' });

		const data = row.data as Record<string, unknown>;
		const next = { ...data };
		if (note) next.note = note;
		else delete next.note;
		await db.update(sensorEvents).set({ data: next }).where(eq(sensorEvents.id, row.id));
		return { ok: true };
	},

	// Korriger en kjørende hvitevare-syklus (program + gjenstående minutter).
	correct: async ({ locals, request }) => {
		const userId = locals.userId;
		const form = await request.formData();
		const sensorId = String(form.get('sensorId') || '');
		const cycleId = String(form.get('cycleId') || '');
		const appliance = String(form.get('appliance') || '');
		const program = String(form.get('program') || '').trim();
		const remainingStr = String(form.get('remainingMinutes') || '').trim();
		const remainingMinutes = remainingStr ? Number(remainingStr) : null;
		if (!sensorId || !cycleId || !appliance) return fail(400, { error: 'Mangler felt' });

		const { SensorEventService } = await import('$lib/server/services/sensor-event-service');
		const estimatedFinishAt =
			remainingMinutes && remainingMinutes > 0
				? new Date(Date.now() + remainingMinutes * 60_000).toISOString()
				: undefined;

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
		return { ok: true };
	}
};
