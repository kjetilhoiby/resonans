/**
 * Rekkefølgen på manusets deler.
 *
 * Klienten sender hele den ønskede rekkefølgen (`{ order: [id, …] }`) framfor
 * «flytt id én opp». Det gjør operasjonen idempotent og gjør at to raske trykk
 * ikke kan bytte plass med hverandre — den siste vinner, og den bærer hele
 * sannheten.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProject, reorderManuscript } from '$lib/server/writing/projects';
import { countWords } from '$lib/domain/writing/doc-kinds';

export const PUT: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Ugyldig forespørsel.');

	const order = (body as Record<string, unknown>).order;
	if (!Array.isArray(order) || order.some((id) => typeof id !== 'string')) {
		throw error(400, 'Feltet «order» må være en liste med dokument-id-er.');
	}

	const project = await getProject(locals.userId, params.id);
	if (!project) throw error(404, 'Fant ikke skriveprosjektet.');

	const manuscript = await reorderManuscript(locals.userId, params.id, order as string[]);

	return json(
		manuscript.map((d) => ({
			id: d.id,
			kind: d.kind,
			title: d.title,
			body: d.body,
			status: d.status,
			sortOrder: d.sortOrder,
			words: countWords(d.body),
			updatedAt: d.updatedAt.toISOString()
		}))
	);
};
