import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { syncAllWithingsData } from '$lib/server/integrations/withings-sync';
import {
	isValidFloor,
	WITHINGS_FULL_SYNC_DEFAULT_FLOOR
} from '$lib/domain/health/withings-sync-window';
import { aggregateCurrentPeriods, aggregateAllPeriods, aggregatePeriodsFrom } from '$lib/server/integrations/aggregation';

/**
 * POST /api/sensors/withings/sync
 *
 * Query params:
 *   ?days=N              — inkrementell synk fra N dager siden (1–365). Additiv.
 *   ?full=true           — slett Withings-radene og reimporter fra gulvet.
 *   ?from=YYYY-MM-DD     — flytt gulvet. Krever `full=true`. Default 2017-09-01.
 *   ?from2017=true       — alias for `full=true`, beholdt for eksisterende kallsteder.
 *
 * ## Hva `full` faktisk sletter
 *
 * Bare **Withings-sensorens egne** hendelser. Fram til august 2026 slettet den alle
 * `sensor_events` for brukeren, altså også ernæringsloggen, sultmeldingene, manuelle
 * søvnlogger, Strava og Tesla — data som ikke kan hentes inn igjen fra noen kilde.
 * Knappen sto i `/settings/sources`, ett trykk unna, merket som en importvalgmulighet.
 * Se `syncAllWithingsData`.
 *
 * Aggregatene slettes fortsatt i sin helhet og bygges opp igjen under, fordi en
 * aggregatrad bærer metrikker fra alle kilder og ikke kan scopes til én.
 */
export const POST: RequestHandler = async ({ locals, url }) => {
	try {
		const userId = locals.userId;

		// `from2017` beholdt som alias: navnet bakte datoen inn i API-et, og det var
		// halve grunnen til at eldre historikk var uoppnåelig.
		const fullSync =
			url.searchParams.get('full') === 'true' || url.searchParams.get('from2017') === 'true';
		const floor = url.searchParams.get('from');
		const daysParam = url.searchParams.get('days');
		const days = daysParam ? Math.max(1, Math.min(365, parseInt(daysParam, 10))) : null;

		if (floor && !isValidFloor(floor)) {
			throw error(400, 'from må være YYYY-MM-DD');
		}
		if (floor && !fullSync) {
			// Ellers ser det ut som gulvet virket mens synken bare hentet siste uke.
			throw error(400, 'from krever full=true');
		}

		let overrideLastSync: Date | undefined;
		if (days) {
			overrideLastSync = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
		}

		const results = await syncAllWithingsData(userId, fullSync, overrideLastSync, undefined, floor);

		if (fullSync) {
			await aggregateAllPeriods(userId);
		} else if (overrideLastSync) {
			await aggregatePeriodsFrom(userId, overrideLastSync);
		} else {
			await aggregateCurrentPeriods(userId);
		}

		return json({
			success: true,
			floor: fullSync ? (floor ?? WITHINGS_FULL_SYNC_DEFAULT_FLOOR) : null,
			synced: results
		});
	} catch (err) {
		console.error('Withings sync error:', err);
		throw error(500, 'Failed to sync Withings data');
	}
};
