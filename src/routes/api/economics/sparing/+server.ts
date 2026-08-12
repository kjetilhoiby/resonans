import { json } from '@sveltejs/kit';
import { loadSavingsBufferData } from '$lib/server/economics/savings-buffer';
import type { RequestHandler } from './$types';

/**
 * GET /api/economics/sparing
 *
 * Sparekontoen som buffer: bunnivå over tid, måneders dekning, og uttaksmønsteret som
 * skiller støtdemper fra kassekreditt. Se
 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 5.
 *
 * Eget endepunkt framfor en del av tema-payloaden fordi den bygger en daglig saldoserie per
 * konto over to år — den skal hentes når fanen åpnes, ikke på hver temavisning.
 */
export const GET: RequestHandler = async ({ locals }) => {
	const data = await loadSavingsBufferData(locals.userId);
	return json(data);
};
