import { json } from '@sveltejs/kit';
import { loadKavalkadeData } from '$lib/server/kavalkade-data';
import type { RequestHandler } from './$types';

/**
 * Kontekst for bursdagsintervjuets avsluttende chat-steg («Året i speilet»)
 * når flyten startes utenfor /kavalkade — f.eks. fra hjemmeskjermens
 * selvangivelse-chip.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const data = await loadKavalkadeData(locals.userId);
	return json({
		lastYearText: data.interview.lastYearText,
		kavalkadeText: data.interview.kavalkadeText
	});
};
