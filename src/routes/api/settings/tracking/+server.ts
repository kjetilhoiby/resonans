import { json, type RequestHandler } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensorEvents, trackingSeries, recordTypeDefinitions } from '$lib/db/schema';
import { TaskExecutionService } from '$lib/server/services/task-execution-service';
import { and, eq } from 'drizzle-orm';
import { ensureUser } from '$lib/server/users';

export const GET: RequestHandler = async ({ locals }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;

	const series = await db.query.trackingSeries.findMany({
		where: eq(trackingSeries.userId, userId),
		with: { recordType: true },
		orderBy: (t, { desc }) => [desc(t.updatedAt)]
	});

	return json({ series });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const body = await request.json() as Record<string, unknown>;

	const seriesId = typeof body.id === 'string' ? body.id : null;
	if (!seriesId) return json({ error: 'id required' }, { status: 400 });

	const existing = await db.query.trackingSeries.findFirst({
		where: and(eq(trackingSeries.id, seriesId), eq(trackingSeries.userId, userId))
	});
	if (!existing) return json({ error: 'Not found' }, { status: 404 });

	type ConfirmationPolicy = 'always' | 'low_confidence_only' | 'never';
	const allowed: ConfirmationPolicy[] = ['always', 'low_confidence_only', 'never'];
	const updates: Partial<typeof trackingSeries.$inferInsert> = {};

	if (typeof body.title === 'string') updates.title = body.title.trim();
	if (typeof body.autoRegister === 'boolean') updates.autoRegister = body.autoRegister;
	if (typeof body.status === 'string' && ['active', 'paused', 'archived'].includes(body.status)) {
		updates.status = body.status as 'active' | 'paused' | 'archived';
	}
	if (typeof body.confirmationPolicy === 'string' && allowed.includes(body.confirmationPolicy as ConfirmationPolicy)) {
		updates.confirmationPolicy = body.confirmationPolicy as ConfirmationPolicy;
	}
	if (typeof body.promptHints === 'string') updates.promptHints = body.promptHints || null;

	const captureHints = typeof body.captureHints === 'object' && body.captureHints
		? (body.captureHints as { sources?: string[]; notes?: string })
		: null;
	if (captureHints !== null) updates.captureHints = captureHints;

	updates.updatedAt = new Date();

	const [updated] = await db
		.update(trackingSeries)
		.set(updates)
		.where(and(eq(trackingSeries.id, seriesId), eq(trackingSeries.userId, userId)))
		.returning();

	return json({ series: updated });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const body = await request.json() as Record<string, unknown>;
	const eventId = typeof body.eventId === 'string' ? body.eventId : null;

	if (eventId) {
		const existingEvent = await db.query.sensorEvents.findFirst({
			where: and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId)),
			columns: { id: true, timestamp: true, data: true, metadata: true }
		});
		if (!existingEvent) return json({ error: 'Event not found' }, { status: 404 });

		const eventData = (existingEvent.data ?? {}) as { trackingSeriesId?: string };
		const linkedSeriesId = typeof eventData.trackingSeriesId === 'string' ? eventData.trackingSeriesId : null;

		if (linkedSeriesId) {
			const linkedSeries = await db.query.trackingSeries.findFirst({
				where: and(eq(trackingSeries.id, linkedSeriesId), eq(trackingSeries.userId, userId)),
				columns: { taskId: true }
			});

			if (linkedSeries?.taskId) {
				await TaskExecutionService.deleteTaskProgressAtTimestamp(userId, linkedSeries.taskId, existingEvent.timestamp);
			}
		}

		await db
			.delete(sensorEvents)
			.where(and(eq(sensorEvents.id, eventId), eq(sensorEvents.userId, userId)));

		return json({ success: true });
	}

	const seriesId = typeof body.id === 'string' ? body.id : null;
	if (!seriesId) return json({ error: 'id required' }, { status: 400 });

	const existing = await db.query.trackingSeries.findFirst({
		where: and(eq(trackingSeries.id, seriesId), eq(trackingSeries.userId, userId))
	});
	if (!existing) return json({ error: 'Not found' }, { status: 404 });

	await db
		.delete(trackingSeries)
		.where(and(eq(trackingSeries.id, seriesId), eq(trackingSeries.userId, userId)));

	return json({ success: true });
};
