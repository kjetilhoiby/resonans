import { json, type RequestHandler } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import { createConversation } from '$lib/server/conversations';
import { attachConversationToTask } from '$lib/server/goals';

export const POST: RequestHandler = async ({ params, locals }) => {
	await ensureUser(locals.userId);
	const userId = locals.userId;
	const taskId = params.id!;

	try {
		const conversation = await createConversation(userId);
		const task = await attachConversationToTask(taskId, userId, conversation.id);
		return json({ task, conversation }, { status: 201 });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message === 'Task not found for user') {
			return json({ error: message }, { status: 404 });
		}
		console.error('[task conversation POST] failed:', err);
		return json({ error: 'Kunne ikke opprette prosjekt-chat' }, { status: 500 });
	}
};
