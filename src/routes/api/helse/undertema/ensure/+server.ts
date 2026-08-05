import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureHealthSubthemes } from '$lib/server/themes';

/**
 * Oppretter Helse-mortemaets undertemaer. Idempotent, så «Aktiver»-knappen
 * på mordashboardet kan trykkes uten fare for duplikater.
 *
 * NB: ikke under /api/health/ — det prefikset er public i hooks.server.ts og
 * får aldri locals.userId satt.
 */
export const POST: RequestHandler = async ({ locals }) => {
	const result = await ensureHealthSubthemes(locals.userId);
	return json(result);
};
