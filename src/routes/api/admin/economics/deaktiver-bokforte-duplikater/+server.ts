import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { deactivateBookedDuplicates } from '$lib/server/economics/deactivate-booked-duplicates';
import type { RequestHandler } from './$types';

/**
 * POST /api/admin/economics/deaktiver-bokforte-duplikater?days=90&dryRun=true&confidence=high
 *
 * Samme kjøp bokført to ganger — en **annen mekanisme** enn reservasjon→bokføring, og derfor et
 * eget endepunkt. Målt i prod sto den for 52 av 54 gjenstående duplikatpar; livsløpet den andre
 * ryddingen er bygget for sto for ett.
 *
 * **`dryRun` er standard**, og planen kan leses med `GET /api/admin/economics/duplikater` uten å
 * røre noe i det hele tatt.
 *
 * `confidence=high` (standard) skriver bare valuta- og datoprefikser. `all` tar med personnavn,
 * som er samme signatur men ikke samme sikkerhet.
 *
 * Se `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 */

const DEFAULT_DAYS = 90;
const MAX_DAYS = 730;

export const POST: RequestHandler = async ({ locals, url }) => {
	await requireAdmin(locals.userId);

	const daysParam = Number(url.searchParams.get('days') ?? DEFAULT_DAYS);
	if (!Number.isFinite(daysParam) || daysParam < 1) {
		error(400, 'days må være et positivt tall.');
	}
	if (daysParam > MAX_DAYS) {
		error(400, `days over ${MAX_DAYS} er ikke målt. Kjør i bolker framfor å utvide vinduet.`);
	}

	const dryRun = url.searchParams.get('dryRun') !== 'false';

	const confidenceParam = url.searchParams.get('confidence') ?? 'high';
	if (confidenceParam !== 'high' && confidenceParam !== 'all') {
		error(400, 'confidence må være «high» eller «all».');
	}

	const result = await deactivateBookedDuplicates(locals.userId, {
		days: Math.floor(daysParam),
		dryRun,
		confidence: confidenceParam
	});

	return json(result);
};
