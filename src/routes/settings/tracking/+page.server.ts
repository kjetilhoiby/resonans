import { db } from '$lib/db';
import { sensorEvents, tasks, trackingSeries } from '$lib/db/schema';
import { desc, eq, inArray, sql } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;

	const series = await db.query.trackingSeries.findMany({
		where: eq(trackingSeries.userId, userId),
		with: { recordType: true },
		orderBy: (t, { desc }) => [desc(t.updatedAt)]
	});

	const rawEvents = await db
		.select({
			id: sensorEvents.id,
			timestamp: sensorEvents.timestamp,
			dataType: sensorEvents.dataType,
			data: sensorEvents.data,
			metadata: sensorEvents.metadata
		})
		.from(sensorEvents)
		.where(
			sql`${sensorEvents.userId} = ${userId}
				and ${sensorEvents.metadata}->>'source' = 'tracking_event_tool'`
		)
		.orderBy(desc(sensorEvents.timestamp))
		.limit(50);

	const trackingSeriesIds = Array.from(
		new Set(
			rawEvents
				.map((event) => {
					const data = event.data as { trackingSeriesId?: string } | null;
					return typeof data?.trackingSeriesId === 'string' ? data.trackingSeriesId : null;
				})
				.filter((value): value is string => Boolean(value))
		)
	);

	const linkedSeries = trackingSeriesIds.length
		? await db.query.trackingSeries.findMany({
				where: inArray(trackingSeries.id, trackingSeriesIds),
				columns: { id: true, title: true, taskId: true }
			})
		: [];

	const taskIds = Array.from(new Set(linkedSeries.map((entry) => entry.taskId).filter((value): value is string => Boolean(value))));
	const linkedTasks = taskIds.length
		? await db.query.tasks.findMany({
				where: inArray(tasks.id, taskIds),
				columns: { id: true, title: true }
			})
		: [];

	const seriesMap = new Map(linkedSeries.map((entry) => [entry.id, entry]));
	const taskMap = new Map(linkedTasks.map((entry) => [entry.id, entry]));

	const recentEvents = rawEvents.map((event) => {
		const data = (event.data ?? {}) as {
			recordTypeKey?: string;
			note?: string;
			trackingSeriesId?: string;
		};
		const seriesEntry = typeof data.trackingSeriesId === 'string' ? seriesMap.get(data.trackingSeriesId) : undefined;
		const taskEntry = seriesEntry?.taskId ? taskMap.get(seriesEntry.taskId) : undefined;

		return {
			id: event.id,
			timestamp: event.timestamp,
			recordTypeKey: data.recordTypeKey ?? event.dataType ?? 'ukjent',
			note: data.note ?? null,
			seriesId: seriesEntry?.id ?? null,
			seriesTitle: seriesEntry?.title ?? null,
			taskId: taskEntry?.id ?? null,
			taskTitle: taskEntry?.title ?? null
		};
	});

	return { series, recentEvents };
};
