/**
 * GET /api/helse/vekt/maalinger?mistenkelige=false&dato=YYYY-MM-DD
 *
 * Vektmålinger med `sensor_events.id`, så en enkeltmåling kan slettes.
 *
 * ## Hvorfor
 *
 * En veiing på ~40 kg midt i en historikk rundt 100 var synlig i grafen med én gang,
 * men umulig å gjøre noe med: den lå som én rad blant 1 200, og resten av flaten
 * leser dagsverdier uten id-er. Sletting i Apple Health og Withings hjelper ikke —
 * synken vår er additiv, så vår kopi blir stående.
 *
 * `mistenkelige=true` er standard og gir bare radene `findWeightOutliers` peker på.
 * Uten den returneres alt, som er det man vil ha når feilmålingen ikke er ekstrem nok
 * til å bli flagget. `dato` snevrer til én dag.
 *
 * Lesingen bor i `weight-measurement-store`, delt med chat-verktøyet.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { findWeightOutliers } from '$lib/domain/health/weight-outliers';
import { listWeightMeasurements } from '$lib/server/health/weight-measurement-store';

/** Tak på rå-lista. Uteliggerlista er alltid kort og trenger ikke et tak. */
const MAX_ROWS = 2000;

export const GET: RequestHandler = async ({ locals, url }) => {
	const userId = locals.userId;
	if (!userId) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	const date = url.searchParams.get('dato');
	if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
		return json({ error: 'Ugyldig "dato" — forventer YYYY-MM-DD' }, { status: 400 });
	}
	// Spør man om en bestemt dag, vil man ha dagens målinger — ikke bare dem som
	// tilfeldigvis er ekstreme nok til å bli flagget.
	const onlySuspicious = !date && url.searchParams.get('mistenkelige') !== 'false';

	try {
		const all = await listWeightMeasurements(userId);

		if (date) {
			return json({
				dato: date,
				total: all.length,
				maalinger: all.filter((row) => row.date === date)
			});
		}

		if (onlySuspicious) {
			return json({
				mistenkelige: true,
				total: all.length,
				maalinger: findWeightOutliers(all)
			});
		}

		return json({
			mistenkelige: false,
			total: all.length,
			truncated: all.length > MAX_ROWS,
			maalinger: all.slice(-MAX_ROWS)
		});
	} catch (err) {
		console.error('[vekt-maalinger] failed:', err);
		return json({ error: err instanceof Error ? err.message : 'Failed' }, { status: 500 });
	}
};
