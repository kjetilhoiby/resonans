import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createProject, listProjects } from '$lib/server/writing/projects';

export const GET: RequestHandler = async ({ locals }) => {
	return json(await listProjects(locals.userId));
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Ugyldig forespørsel.');

	const payload = body as Record<string, unknown>;
	const title = typeof payload.title === 'string' ? payload.title.trim() : '';
	if (!title) throw error(400, 'Prosjektet trenger en tittel.');

	const project = await createProject({
		userId: locals.userId,
		title,
		genre: typeof payload.genre === 'string' ? payload.genre : null,
		summary: typeof payload.summary === 'string' ? payload.summary : null,
		themeId: typeof payload.themeId === 'string' ? payload.themeId : null
	});

	return json(project, { status: 201 });
};
