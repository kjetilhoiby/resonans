import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { canonicalWorkouts } from '$lib/db/schema';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Kumulativ løpsdistanse for år-mot-år-sammenligning.
 * GET /api/workouts/cumulative-running?years=5
 *
 * Leser projeksjonen `canonical_workouts` i stedet for rå `sensor_events`. Det gir
 * filtrering og sortering i databasen på `(user_id, start_time)`-indeksen, i stedet
 * for å hente 5000 rå-events og filtrere i JS.
 */

/**
 * sportType-verdiene som teller som løping her. Bevisst en eksakt liste framfor
 * `sportFamily = 'running'`: familien fanger også trail_running o.l., og ville
 * endret tallene i en graf som sammenligner år mot år.
 */
const RUNNING_SPORT_TYPES = ['running', 'indoor_running'];

const DEFAULT_YEARS = 5;
const MAX_YEARS = 50;

export const GET: RequestHandler = async ({ url, locals }) => {
	try {
		const userId = locals.userId;
		const currentYear = new Date().getFullYear();

		const requested = Number.parseInt(url.searchParams.get('years') ?? '', 10);
		const years = Number.isFinite(requested) && requested > 0
			? Math.min(requested, MAX_YEARS)
			: DEFAULT_YEARS;
		const startDate = new Date(currentYear - (years - 1), 0, 1);

		const rows = await db
			.select({
				id: canonicalWorkouts.id,
				startTime: canonicalWorkouts.startTime,
				sportType: canonicalWorkouts.sportType,
				distanceMeters: canonicalWorkouts.distanceMeters
			})
			.from(canonicalWorkouts)
			.where(
				and(
					eq(canonicalWorkouts.userId, userId),
					gte(canonicalWorkouts.startTime, startDate),
					inArray(canonicalWorkouts.sportType, RUNNING_SPORT_TYPES)
				)
			)
			.orderBy(asc(canonicalWorkouts.startTime));

		return json(
			rows.map((row) => ({
				// canonical_workouts.id — IKKE en sensor_events-id. Konsumenten bruker den
				// ikke; skal noe adressere økta (dismiss/source-role), må den gå via
				// evidence[].eventId.
				id: row.id,
				timestamp: row.startTime.toISOString(),
				data: {
					sportType: row.sportType,
					// decimal kommer som string fra drizzle — må konverteres, ellers
					// blir summeringen strengkonkatenering.
					distance: row.distanceMeters != null ? Number(row.distanceMeters) : undefined
				}
			}))
		);
	} catch (error) {
		console.error('Failed to fetch cumulative running data:', error);
		return json({ error: 'Failed to fetch data' }, { status: 500 });
	}
};
