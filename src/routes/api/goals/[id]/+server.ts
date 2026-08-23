import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { updateGoalMetric } from '$lib/server/goals';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json();
	const { title, description, targetDate, status, metadata, metric, themeId } = body;

	// Verify ownership
	const existingGoal = await db.query.goals.findFirst({
		where: and(eq(goals.id, params.id), eq(goals.userId, locals.userId))
	});

	if (!existingGoal) {
		return json({ error: 'Goal not found' }, { status: 404 });
	}

	// Build update object
	const updateData: {
		title?: string;
		description?: string | null;
		targetDate?: Date | null;
		status?: string;
		metadata?: unknown;
		themeId?: string | null;
		updatedAt: Date;
	} = {
		updatedAt: new Date()
	};

	const ALLOWED_STATUSES = ['active', 'completed', 'archived'];

	if (title !== undefined) updateData.title = title;
	if (description !== undefined) updateData.description = description;
	if (targetDate !== undefined) updateData.targetDate = targetDate ? new Date(targetDate) : null;
	if (status !== undefined) {
		if (!ALLOWED_STATUSES.includes(status)) {
			return json({ error: `Ugyldig status: ${status}` }, { status: 400 });
		}
		updateData.status = status;
	}
	// Rå metadata FLETTES inn — et skjema som bare eier noen felt skal ikke slette
	// `visionHorizon` eller intent-feltene, jf. samme regel for metrikk-arket.
	if (metadata !== undefined && metadata !== null && typeof metadata === 'object') {
		updateData.metadata = { ...((existingGoal.metadata ?? {}) as Record<string, unknown>), ...metadata };
	}
	if (themeId !== undefined) updateData.themeId = typeof themeId === 'string' && themeId.length > 0 ? themeId : null;

	const [updatedGoal] = await db
		.update(goals)
		.set(updateData)
		.where(eq(goals.id, params.id))
		.returning();

	// Metrikkfeltene går gjennom updateGoalMetric: den normaliserer vekt-tallene,
	// skriver `metadata.goalTrack` (der leserne finner målverdien) og holder
	// `goal_tracks`-raden i synk. En klient som bygger metadataen selv kan ikke det.
	if (metric !== undefined && metric !== null && typeof metric === 'object') {
		try {
			const withMetric = await updateGoalMetric({
				userId: locals.userId,
				goalId: params.id,
				metricId: metric.metricId ?? null,
				startDate: metric.startDate,
				endDate: metric.endDate,
				fields: {
					goalKind: metric.goalKind,
					goalWindow: metric.goalWindow,
					targetValue: metric.targetValue,
					startValue: metric.startValue,
					unit: metric.unit,
					durationDays: metric.durationDays,
					targetDate: metric.endDate ?? metric.targetDate
				}
			});
			return json({ goal: withMetric });
		} catch (error) {
			console.error('[goals PATCH] kunne ikke oppdatere metrikkfeltene:', error);
			return json(
				{ error: error instanceof Error ? error.message : 'Kunne ikke oppdatere målverdiene.' },
				{ status: 400 }
			);
		}
	}

	return json({ goal: updatedGoal });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	// Verify ownership
	const existingGoal = await db.query.goals.findFirst({
		where: and(eq(goals.id, params.id), eq(goals.userId, locals.userId))
	});

	if (!existingGoal) {
		return json({ error: 'Goal not found' }, { status: 404 });
	}

	// Archive instead of delete
	const [archivedGoal] = await db
		.update(goals)
		.set({ status: 'archived', updatedAt: new Date() })
		.where(eq(goals.id, params.id))
		.returning();

	return json({ goal: archivedGoal });
};
