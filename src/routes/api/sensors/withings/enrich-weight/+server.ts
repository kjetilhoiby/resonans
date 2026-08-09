import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { enrichWeightComposition } from '$lib/server/integrations/withings-weight-enrichment';
import { isValidFloor } from '$lib/domain/health/withings-sync-window';

/**
 * POST /api/sensors/withings/enrich-weight?from=YYYY-MM-DD&to=YYYY-MM-DD&dryRun=true
 *
 * Fyller kroppssammensetning inn på vektrader som ble skrevet uten den.
 *
 * ## Hvorfor dette ikke er en full sync
 *
 * `?full=true` sletter alle Withings-hendelser for å komme rundt at
 * `conflictMode: 'ignore'` ikke oppdaterer. Men `hr_recovery` ligger under samme
 * sensor og er selvhelende bare 21 dager tilbake — en full sync ville kostet all
 * eldre pulsfallmåling for å hente inn en fettprosent. Denne rører bare feltene
 * som mangler, på radene som finnes.
 *
 * ## POST, ikke GET
 *
 * Den skriver. `?dryRun=true` gir hele planen uten å skrive, og er måten å se hva
 * en kjøring ville gjort før den gjøres.
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const from = url.searchParams.get('from');
	const to = url.searchParams.get('to');
	if (from && !isValidFloor(from)) throw error(400, 'from må være YYYY-MM-DD');
	if (to && !isValidFloor(to)) throw error(400, 'to må være YYYY-MM-DD');
	if (from && to && from > to) throw error(400, 'from må være før to');

	const dryRun = url.searchParams.get('dryRun') === 'true';

	try {
		const result = await enrichWeightComposition(userId, { from, to, dryRun });
		return json({
			ok: true,
			...result,
			hint: dryRun
				? 'Ingenting ble skrevet. Kjør uten dryRun for å gjennomføre.'
				: 'Felt som allerede hadde en verdi er urørt — jobben fyller bare hull.'
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Berikelse feilet';
		console.error('Withings-berikelse feilet:', err);
		return json({ error: message }, { status: 500 });
	}
};
