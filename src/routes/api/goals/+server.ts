import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createGoal } from '$lib/server/goals';
import { enqueueBackgroundJob } from '$lib/server/background-jobs';
import { db } from '$lib/db';
import { goals } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request, locals }) => {
	try {
		const userId = locals.userId;
		if (!userId) {
			return json({ error: 'Unauthorized' }, { status: 401 });
		}

		const body = await request.json();
		const {
			categoryName,
			themeId,
			title,
			description,
			targetDate,
			metricId,
			goalKind,
			goalWindow,
			targetValue,
			unit,
			startDate,
			endDate,
			startValue
		} = body;

		if (!title || typeof title !== 'string') {
			return json({ error: 'Title is required' }, { status: 400 });
		}

		const goal = await createGoal({
			userId,
			categoryName: categoryName || undefined,
			themeId: themeId || undefined,
			title,
			description: description || undefined,
			targetDate: targetDate || undefined,
			metricId: metricId || undefined,
			goalKind: goalKind || undefined,
			goalWindow: goalWindow || undefined,
			targetValue: targetValue !== undefined ? targetValue : undefined,
			unit: unit || undefined,
			startDate: startDate || undefined,
			endDate: endDate || undefined,
			startValue: startValue !== undefined ? startValue : undefined
		});

		const textParts = [title, typeof description === 'string' ? description : '']
			.map((v) => (typeof v === 'string' ? v.trim() : ''))
			.filter(Boolean);
		const rawText = textParts.join('. ');
		const shouldQueueIntentParse = !metricId || typeof metricId !== 'string' || !metricId.trim();

		if (shouldQueueIntentParse) {
			try {
				await enqueueBackgroundJob({
					userId,
					type: 'goal_intent_parse',
					payload: {
						goalId: goal.id,
						rawText
					},
					priority: 10,
					maxAttempts: 2
				});

				const nextMetadata = {
					...((goal.metadata ?? {}) as Record<string, unknown>),
					intentStatus: 'pending',
					intentSourceText: rawText,
					intentQueuedAt: new Date().toISOString(),
					intentError: null
				};

				await db
					.update(goals)
					.set({
						metadata: nextMetadata,
						updatedAt: new Date()
					})
					.where(eq(goals.id, goal.id));

				goal.metadata = nextMetadata;
			} catch (queueError) {
				console.warn('Failed to enqueue goal intent parse job:', queueError);
			}
		}

		return json({ goal }, { status: 201 });
	} catch (error) {
		console.error('Error creating goal:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to create goal' },
			{ status: 500 }
		);
	}
};
