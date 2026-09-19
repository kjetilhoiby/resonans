import { json } from '@sveltejs/kit';
import { readRanking, saveRanking } from '$lib/server/livskompass-ranking';
import type { RequestHandler } from './$types';

/**
 * Rekkefølgen — brukerens egen prioritering.
 *
 * PUT tar HELE lista, i motsetning til nedprioriteringenes handlings-PATCH, og
 * det er en beslutning om hva dataen ER: en rangering er ordnet, så «flytt
 * denne opp» er en endring av helheten. En delvis oppdatering måtte uansett
 * skrevet alle posisjonene på nytt.
 */

export const GET: RequestHandler = async ({ locals }) => {
	return json({ ranking: await readRanking(locals.userId) });
};

export const PUT: RequestHandler = async ({ locals, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') return json({ error: 'Ugyldig kropp' }, { status: 400 });

	const result = await saveRanking(locals.userId, body.priorities, new Date(), 'livskompass_ui');
	if (!result.ok) return json({ error: result.error }, { status: 400 });
	// En tom liste er lagret som en beslutning, men leses som «ingen rekkefølge»
	return json({ ranking: result.ranking.priorities.length > 0 ? result.ranking : null });
};
