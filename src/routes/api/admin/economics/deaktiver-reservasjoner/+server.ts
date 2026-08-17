import { error, json } from '@sveltejs/kit';
import { requireAdmin } from '$lib/server/admin-auth';
import { deactivateSupersededReservations } from '$lib/server/economics/deactivate-superseded';
import type { RequestHandler } from './$types';

/**
 * POST /api/admin/economics/deaktiver-reservasjoner?days=90&dryRun=true
 *
 * Deaktiverer reservasjoner som er erstattet av en bokført rad — fase 3. Se
 * `docs/changelog/2026-08-12-livslop-forsvinning.md`.
 *
 * **`dryRun` er standard.** Skriving krever `dryRun=false` eksplisitt. En jobb som endrer
 * hundrevis av rader skal ikke kunne kjøres ved et uhell, og planen skal kunne leses først —
 * samme mønster som `POST /api/helse/trening/reprojiser?dryRun=true`.
 *
 * Idempotent: bare aktive rader vurderes, så en andre kjøring finner ingen nye par.
 * `is_active = false` sletter ingenting, så en feilaktig deaktivering kan reverseres.
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
		// Taket er ikke vilkårlig: hele vurderingen hviler på en måling gjort over 90 dager,
		// og et vindu på flere år ville anvendt terskler på data ingen har sett på.
		error(400, `days over ${MAX_DAYS} er ikke målt. Kjør i bolker framfor å utvide vinduet.`);
	}

	const dryRun = url.searchParams.get('dryRun') !== 'false';

	// **Standard er `out` — bare forbruk.** Inntektsparene bar fortsatt preg av runde
	// overføringsbeløp i tørrkjøringen, og de to retningene har ulik troverdighet.
	const directionParam = url.searchParams.get('direction') ?? 'out';
	if (directionParam !== 'out' && directionParam !== 'in' && directionParam !== 'all') {
		error(400, 'direction må være «out», «in» eller «all».');
	}

	const result = await deactivateSupersededReservations(locals.userId, {
		days: Math.floor(daysParam),
		dryRun,
		direction: directionParam
	});

	return json(result);
};
