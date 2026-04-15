import { json, type RequestHandler } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import { createTask } from '$lib/server/goals';
import { enqueueBackgroundJob } from '$lib/server/background-jobs';

export const POST: RequestHandler = async ({ locals, request }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;

	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const goalId = typeof body.goalId === 'string' ? body.goalId.trim() : '';
	const title = typeof body.title === 'string' ? body.title.trim() : '';
	const description = typeof body.description === 'string' ? body.description.trim() : undefined;
	const frequency = typeof body.frequency === 'string' ? body.frequency.trim() : undefined;
	const periodType = typeof body.periodType === 'string' ? body.periodType.trim() : undefined;
	const periodId = typeof body.periodId === 'string' ? body.periodId.trim() : undefined;
	const targetValue = typeof body.targetValue === 'number' && Number.isFinite(body.targetValue)
		? body.targetValue
		: undefined;
	const unit = typeof body.unit === 'string' ? body.unit.trim() : undefined;

	if (!goalId) return json({ error: 'goalId er påkrevd' }, { status: 400 });
	if (!title) return json({ error: 'title er påkrevd' }, { status: 400 });

	try {
		const task = await createTask({
			userId,
			goalId,
			title,
			description,
			frequency,
			periodType,
			periodId,
			targetValue,
			unit
		});

		const shouldQueueIntentParse = !frequency || targetValue === undefined || !unit;
		if (shouldQueueIntentParse) {
			const rawText = [title, description || '']
				.map((v) => v.trim())
				.filter(Boolean)
				.join('. ');

			try {
				await enqueueBackgroundJob({
					userId,
					type: 'task_intent_parse',
					payload: {
						taskId: task.id,
						rawText
					},
					priority: 8,
					maxAttempts: 2
				});
			} catch (queueError) {
				console.warn('Failed to enqueue task intent parse job:', queueError);
			}
		}

		return json({ task }, { status: 201 });
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message === 'Goal not found for user') {
			return json({ error: 'Goal ikke funnet for bruker' }, { status: 404 });
		}
		return json({ error: 'Kunne ikke opprette oppgave' }, { status: 500 });
	}
};
