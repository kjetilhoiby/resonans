/**
 * Backfill av `data.movingDuration` på eksisterende workout-events.
 *
 * Nye økter får feltet ved opplasting (`movingDurationFor` i dropbox-sync), men
 * historikken har det ikke — og det er historikken ankeret i effort-budsjettet
 * leses fra. Uten en backfill ville nye og gamle uker ligget på hver sin skala:
 * nøyaktig fella CLAUDE.md advarer mot under «Endrer du skåringen, må historikken
 * reberegnes».
 *
 * Jobben er **additiv og idempotent**: den fyller bare rader som mangler feltet,
 * sletter aldri noe, og kan kjøres om igjen. Sporet er allerede nedsamplet til
 * `MAX_STORED_TRACK_POINTS` i basen — tett nok til å skille bevegelse fra
 * stillstand, men litt grovere enn det opplastingsstien regner på.
 */

import { db, rowsOf } from '$lib/db';
import { sql } from 'drizzle-orm';
import { computeMovingTime, type MovingTimePoint } from '$lib/domain/health/moving-time';

export interface MovingTimeBackfillWorkout {
	eventId: string;
	timestamp: string;
	sportType: string | null;
	elapsedSeconds: number | null;
	movingSeconds: number;
	/** Andel av opptaket som var stillstand, 0..1. */
	stoppedShare: number;
	coverage: number;
}

export interface MovingTimeBackfillResult {
	dryRun: boolean;
	/** Rader som ble vurdert (har spor, mangler `movingDuration`). */
	candidates: number;
	/** Rader der sporet faktisk ga et svar. */
	computed: number;
	/** Rader der sporet ikke kunne svare — for få punkter, dårlig dekning, styrke/yoga. */
	inconclusive: number;
	written: number;
	/** De største avvikene først. Kappet til `MAX_REPORTED`. */
	workouts: MovingTimeBackfillWorkout[];
	/** Eldste og nyeste berørte tidspunkt — vinduet som må reprojiseres. */
	fromTimestamp: string | null;
	toTimestamp: string | null;
}

const MAX_REPORTED = 50;
export const DEFAULT_BACKFILL_LIMIT = 500;

interface CandidateRow {
	id: string;
	timestamp: Date;
	sport_type: string | null;
	duration: number | null;
	track_points: MovingTimePoint[] | null;
}

/**
 * @param limit Maks antall rader per kjøring. Sporene er store (opptil 2000
 *   punkter hver), så hele historikken hentes i biter framfor i én payload.
 */
export async function backfillMovingTime(
	userId: string,
	options: { dryRun?: boolean; limit?: number } = {}
): Promise<MovingTimeBackfillResult> {
	const dryRun = options.dryRun ?? false;
	const limit = Math.max(1, Math.min(2000, options.limit ?? DEFAULT_BACKFILL_LIMIT));

	// Rå lesing er riktig her: vi trenger sporpunktene per *kilde-rad*, og det er
	// kilde-raden feltet skrives tilbake på. Den delte leseren gir klynger, ikke rader.
	const rows = rowsOf<CandidateRow>(
		await db.execute(sql`
			SELECT
				id,
				timestamp,
				data->>'sportType' AS sport_type,
				CASE WHEN jsonb_typeof(data->'duration') = 'number'
					THEN (data->>'duration')::numeric END AS duration,
				data->'trackPoints' AS track_points
			FROM sensor_events
			WHERE user_id = ${userId}
				AND data_type = 'workout'
				AND jsonb_typeof(data) = 'object'
				AND data ? 'trackPoints'
				AND NOT (data ? 'movingDuration')
			ORDER BY timestamp DESC
			LIMIT ${limit}
		`)
	);

	const result: MovingTimeBackfillResult = {
		dryRun,
		candidates: rows.length,
		computed: 0,
		inconclusive: 0,
		written: 0,
		workouts: [],
		fromTimestamp: null,
		toTimestamp: null
	};

	for (const row of rows) {
		const points = Array.isArray(row.track_points) ? row.track_points : null;
		if (!points) {
			result.inconclusive += 1;
			continue;
		}

		const moving = computeMovingTime(points, { sportType: row.sport_type });
		if (!moving) {
			result.inconclusive += 1;
			continue;
		}
		result.computed += 1;

		const timestamp = new Date(row.timestamp).toISOString();
		const elapsed = row.duration != null ? Number(row.duration) : moving.elapsedSeconds;
		result.workouts.push({
			eventId: row.id,
			timestamp,
			sportType: row.sport_type,
			elapsedSeconds: Number.isFinite(elapsed) ? elapsed : null,
			movingSeconds: moving.movingSeconds,
			stoppedShare:
				Number.isFinite(elapsed) && elapsed > 0
					? Math.round((1 - moving.movingSeconds / elapsed) * 1000) / 1000
					: 0,
			coverage: moving.coverage
		});

		if (!result.fromTimestamp || timestamp < result.fromTimestamp) result.fromTimestamp = timestamp;
		if (!result.toTimestamp || timestamp > result.toTimestamp) result.toTimestamp = timestamp;

		if (dryRun) continue;

		// jsonb bygges i SQL, aldri som en JSON-streng lagt til med `||`. En
		// `JSON.stringify(...)`-parameter når basen som en jsonb *streng*, og
		// `object || string` er konkatenering i Postgres — det gjorde søvnradene
		// til arrays i august 2026 (se 0048_repair_sleep_data_arrays.sql).
		await db.execute(sql`
			UPDATE sensor_events
			SET data = data || jsonb_build_object('movingDuration', ${moving.movingSeconds}::numeric)
			WHERE id = ${row.id}
				AND user_id = ${userId}
				AND jsonb_typeof(data) = 'object'
		`);
		result.written += 1;
	}

	result.workouts.sort((a, b) => b.stoppedShare - a.stoppedShare);
	result.workouts = result.workouts.slice(0, MAX_REPORTED);

	return result;
}
