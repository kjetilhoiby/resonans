import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { PersonMentionService } from '$lib/server/services/person-mention-service';
import { PersonService } from '$lib/server/services/person-service';

export const GET: RequestHandler = async ({ locals, params, url }) => {
	const userId = locals.userId;
	const person = await PersonService.getById(params.id, userId);
	if (!person) return json({ error: 'Person ikke funnet' }, { status: 404 });

	const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);

	const [messageRows, taskRows, checklistItemRows] = await Promise.all([
		PersonMentionService.listMessageMentionsForPerson(userId, params.id, { limit }),
		PersonMentionService.listTaskMentionsForPerson(userId, params.id, { limit }),
		PersonMentionService.listChecklistItemMentionsForPerson(userId, params.id, { limit })
	]);

	function buildSnippet(content: string): string {
		const trimmed = content.trim();
		if (trimmed.length <= 200) return trimmed;
		return trimmed.slice(0, 197) + '…';
	}

	return json({
		messages: messageRows.map((r) => ({
			messageId: r.message.id,
			conversationId: r.message.conversationId,
			role: r.message.role,
			snippet: buildSnippet(r.message.content),
			createdAt: r.message.createdAt,
			confidence: r.mention.confidence
		})),
		tasks: taskRows.map((r) => ({
			taskId: r.task.id,
			goalId: r.task.goalId,
			title: r.task.title,
			status: r.task.status,
			frequency: r.task.frequency,
			createdAt: r.task.createdAt,
			confidence: r.mention.confidence
		})),
		checklistItems: checklistItemRows.map((r) => ({
			itemId: r.item.id,
			checklistId: r.item.checklistId,
			text: r.item.text,
			checked: r.item.checked,
			createdAt: r.item.createdAt,
			confidence: r.mention.confidence
		}))
	});
};
