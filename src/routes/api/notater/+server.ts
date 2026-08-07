/**
 * Notatblokka — liste, søk og oppretting.
 *
 * GET  /api/notater?q=…&kilde=alle|dokument|fangst&limit=…
 *      Ett søkefelt, to kilder (writing_docs + reflections), én rangert liste.
 * POST /api/notater
 *      Nytt dokument. Fangst opprettes ikke her — den kommer fra create_note.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchNotebook } from '$lib/server/writing/search';
import { createDoc } from '$lib/server/writing/docs';
import { promoteReflectionToDoc } from '$lib/server/writing/docs';

export const GET: RequestHandler = async ({ locals, url }) => {
	const query = url.searchParams.get('q')?.trim() || undefined;
	const kilde = url.searchParams.get('kilde') ?? 'alle';
	const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
	const projectParam = url.searchParams.get('prosjekt');

	const result = await searchNotebook(locals.userId, {
		query,
		limit: Number.isFinite(limitRaw) ? limitRaw : 30,
		includeCapture: kilde !== 'dokument',
		// Uten prosjekt-parameter viser notatblokka de frie dokumentene.
		projectId: projectParam ? projectParam : null
	});

	return json({
		hits: kilde === 'fangst' ? result.hits.filter((h) => h.source === 'fangst') : result.hits,
		mode: result.mode,
		counts: result.counts
	});
};

export const POST: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Ugyldig forespørsel.');

	const payload = body as Record<string, unknown>;

	// Forfremmelse av en fangst-rad til redigerbart dokument.
	if (typeof payload.fraRefleksjon === 'string') {
		const doc = await promoteReflectionToDoc({
			userId: locals.userId,
			reflectionId: payload.fraRefleksjon,
			projectId: typeof payload.projectId === 'string' ? payload.projectId : null,
			kind: typeof payload.kind === 'string' ? payload.kind : null
		});
		if (!doc) throw error(404, 'Fant ikke refleksjonen som skulle kopieres.');
		return json(doc, { status: 201 });
	}

	const title = typeof payload.title === 'string' ? payload.title : '';
	const docBody = typeof payload.body === 'string' ? payload.body : '';
	if (!title.trim() && !docBody.trim()) {
		throw error(400, 'Tomt dokument — skriv en tittel eller litt tekst først.');
	}

	const doc = await createDoc({
		userId: locals.userId,
		title,
		body: docBody,
		kind: typeof payload.kind === 'string' ? payload.kind : null,
		status: typeof payload.status === 'string' ? payload.status : null,
		projectId: typeof payload.projectId === 'string' ? payload.projectId : null,
		sortOrder: typeof payload.sortOrder === 'number' ? payload.sortOrder : undefined
	});

	return json(doc, { status: 201 });
};
