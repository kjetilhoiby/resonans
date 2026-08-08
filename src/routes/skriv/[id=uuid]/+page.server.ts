import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getProject, getProjectContents } from '$lib/server/writing/projects';
import { getConversationHistory } from '$lib/server/conversations';
import { countWords } from '$lib/domain/writing/doc-kinds';
import { parseChecklist } from '$lib/domain/writing/checklist';

export const load: PageServerLoad = async ({ locals, params }) => {
	const project = await getProject(locals.userId, params.id);
	if (!project) throw error(404, 'Fant ikke skriveprosjektet.');

	const { manuscript, material } = await getProjectContents(locals.userId, params.id);

	const serialize = (d: (typeof manuscript)[number]) => ({
		id: d.id,
		kind: d.kind,
		title: d.title,
		body: d.body,
		status: d.status,
		sortOrder: d.sortOrder,
		words: countWords(d.body),
		tags: d.tags,
		checklist: (() => {
			const parsed = parseChecklist(d.body);
			return parsed.total > 0 ? { done: parsed.done, total: parsed.total } : null;
		})(),
		updatedAt: d.updatedAt.toISOString()
	});

	const history = project.conversationId
		? await getConversationHistory(project.conversationId, 30)
		: [];

	return {
		project: {
			id: project.id,
			title: project.title,
			genre: project.genre,
			summary: project.summary,
			status: project.status
		},
		manuscript: manuscript.map(serialize),
		material: material.map(serialize),
		messages: history
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }))
	};
};
