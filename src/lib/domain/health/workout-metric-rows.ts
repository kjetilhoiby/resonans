import { matchesWorkoutSportFilter } from './workout-sport';

/**
 * Én verdi per deduplisert treningsøkt, klar for bøtting og aggregering.
 *
 * NB: workout-metrikker summeres ALDRI fra `sensor_events`. Én løpetur skrives
 * av opptil tre kilder (Withings-klokka, GPX-fila fra Dropbox, Ekko-opplasting)
 * med startpunkter som spriker minutter, så en rå SUM dobbelt- eller
 * trippeltteller. Widget-endepunktet prøvde å bøte på det med 5-minutters
 * bøtter på et fast rutenett: to registreringer 40 sekunder fra hverandre
 * havnet likevel i hver sin bøtte når de lå på hver sin side av et skille.
 * Sammenslåingen hører hjemme i activity-laget, som klynger på to timer per
 * sportsfamilie og velger distansen fra kilden med høyest prioritet.
 * Se docs/changelog/2026-08-08-widget-loepedistanse-dobbelttelling.md.
 */

export type WorkoutMetricInput = {
	timestamp: Date;
	sportType: string;
	distanceMeters: number | null;
};

export type WorkoutMetricRow = {
	timestamp: Date;
	value: number;
};

/**
 * Plukker verdien hver økt bidrar med til en widget-metrikk.
 *
 * `workoutCount` teller økter, alt annet leser distansen i meter.
 * Vinduet er inklusivt i begge ender, som resten av widget-lesingen.
 */
export function workoutMetricRows(
	workouts: WorkoutMetricInput[],
	metricType: string,
	from: Date,
	to: Date,
	sportFilter?: string | null
): WorkoutMetricRow[] {
	const rows: WorkoutMetricRow[] = [];

	for (const workout of workouts) {
		if (workout.timestamp < from || workout.timestamp > to) continue;
		if (!matchesWorkoutSportFilter(workout.sportType, sportFilter)) continue;

		if (metricType === 'workoutCount') {
			rows.push({ timestamp: workout.timestamp, value: 1 });
			continue;
		}

		// Økter uten registrert distanse holdes utenfor i stedet for å telle som 0 —
		// en styrkeøkt skal ikke dra ned snittet på en distansewidget.
		if (workout.distanceMeters === null || workout.distanceMeters <= 0) continue;
		rows.push({ timestamp: workout.timestamp, value: workout.distanceMeters });
	}

	return rows;
}
