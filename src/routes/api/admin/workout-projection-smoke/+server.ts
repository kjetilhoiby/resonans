import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { backgroundJobs, sensorEvents, sensors } from '$lib/db/schema';
import { requireAdmin } from '$lib/server/admin-auth';
import { SensorEventService } from '$lib/server/services/sensor-event-service';
import { WorkoutProjectionService } from '$lib/server/services/workout-projection-service';
import { and, eq, gte } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const config = { maxDuration: 60 };

async function findOrCreateSmokeSensor(userId: string) {
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'smoke_test'), eq(sensors.type, 'workout'))
	});
	if (existing) return existing;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: 'smoke_test',
			type: 'workout',
			name: 'Smoke Test Workout Sensor',
			isActive: true,
			config: { source: 'admin_smoke' }
		})
		.returning();

	return created;
}

export const GET: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const userId = url.searchParams.get('userId')?.trim() || locals.userId;
	const runEnsure = url.searchParams.get('ensure') === '1';
	const simulateWrite = url.searchParams.get('simulateWrite') === '1';

	const now = new Date();
	const startDate = new Date(now);
	startDate.setUTCDate(startDate.getUTCDate() - 30);

	const beforeFreshness = await WorkoutProjectionService.getFreshnessForRange(
		userId,
		startDate,
		now,
		WorkoutProjectionService.SOFT_STALE_MS,
		WorkoutProjectionService.HARD_STALE_MS
	);

	let ensuredFreshness = null as Awaited<ReturnType<typeof WorkoutProjectionService.ensureFreshnessForRange>> | null;
	if (runEnsure) {
		ensuredFreshness = await WorkoutProjectionService.ensureFreshnessForRange(
			userId,
			startDate,
			now,
			WorkoutProjectionService.SOFT_STALE_MS,
			WorkoutProjectionService.HARD_STALE_MS
		);
	}

	let writeSmoke: { inserted: boolean; enqueuedProjectionRefresh: boolean; queuedJobsLast2m: number } | null = null;
	if (simulateWrite) {
		const sensor = await findOrCreateSmokeSensor(userId);
		const writeResult = await SensorEventService.write(
			{
				userId,
				sensorId: sensor.id,
				eventType: 'activity',
				dataType: 'workout',
				timestamp: new Date(),
				data: {
					sportType: 'running',
					distance: 1000,
					duration: 300
				},
				metadata: {
					smoke: true
				},
				source: 'admin_smoke'
			},
			{ conflictMode: 'ignore' }
		);

		const queuedRows = await db
			.select({ id: backgroundJobs.id })
			.from(backgroundJobs)
			.where(
				and(
					eq(backgroundJobs.userId, userId),
					eq(backgroundJobs.type, 'workout_projection_refresh'),
					eq(backgroundJobs.status, 'queued'),
					gte(backgroundJobs.createdAt, new Date(Date.now() - 2 * 60 * 1000))
				)
			);

		if (writeResult.event?.id) {
			await db.delete(sensorEvents).where(eq(sensorEvents.id, writeResult.event.id));
		}

		writeSmoke = {
			inserted: writeResult.inserted,
			enqueuedProjectionRefresh: writeResult.enqueuedProjectionRefresh,
			queuedJobsLast2m: queuedRows.length
		};
	}

	return json({
		success: true,
		userId,
		range: {
			startDate: startDate.toISOString(),
			endDate: now.toISOString()
		},
		freshness: {
			before: beforeFreshness,
			afterEnsure: ensuredFreshness
		},
		writeSmoke
	});
};
