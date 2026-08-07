import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteProject,
	getProject,
	getProjectContents,
	updateProject
} from '$lib/server/writing/projects';

export const GET: RequestHandler = async ({ locals, params }) => {
	const project = await getProject(locals.userId, params.id);
	if (!project) throw error(404, 'Fant ikke skriveprosjektet.');
	const contents = await getProjectContents(locals.userId, params.id);
	return json({ project, ...contents });
};

export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Ugyldig forespørsel.');
	const payload = body as Record<string, unknown>;

	const project = await updateProject(locals.userId, params.id, {
		title: typeof payload.title === 'string' ? payload.title : undefined,
		genre: payload.genre === null || typeof payload.genre === 'string' ? (payload.genre as string | null) : undefined,
		summary:
			payload.summary === null || typeof payload.summary === 'string'
				? (payload.summary as string | null)
				: undefined,
		status: typeof payload.status === 'string' ? payload.status : undefined
	});
	if (!project) throw error(404, 'Fant ikke skriveprosjektet.');
	return json(project);
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
	const ok = await deleteProject(locals.userId, params.id);
	if (!ok) throw error(404, 'Fant ikke skriveprosjektet.');
	// Dokumentene overlever med project_id = NULL og havner i notatblokka.
	return json({ success: true });
};
