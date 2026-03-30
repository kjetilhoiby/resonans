import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createGoal } from '$lib/server/goals';

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

		return json({ goal }, { status: 201 });
	} catch (error) {
		console.error('Error creating goal:', error);
		return json(
			{ error: error instanceof Error ? error.message : 'Failed to create goal' },
			{ status: 500 }
		);
	}
};
