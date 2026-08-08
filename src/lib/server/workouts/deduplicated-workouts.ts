import { buildUnifiedWorkoutActivities, type UnifiedWorkoutActivity } from '$lib/server/activity-layer';
import { workoutSportFamily } from '$lib/domain/health/workout-sport';

/**
 * Én reell treningsøkt — kildene er allerede slått sammen.
 *
 * Samme løpetur skrives av opptil tre sensorer (Withings-klokka, GPX-fila fra
 * Dropbox og Ekko-opplastingen), med startpunkter som spriker noen minutter.
 * `buildUnifiedWorkoutActivities` klynger dem innenfor to timer per
 * sportsfamilie og velger distansen fra kilden med høyest prioritet — alt som
 * teller kilometer, økter eller haker av en oppgave skal lese gjennom den,
 * aldri telle `sensor_events` direkte.
 */
export type DeduplicatedWorkout = {
	/**
	 * Eldste evidence-event i klyngen. Brukes som dedupe-nøkkel av
	 * progresjons- og autohak-skriverne: det er en ekte `sensor_events.id`, så
	 * rader skrevet før dedupliseringen (én per kilde) fortsatt gjenkjennes —
	 * en re-kjøring lager ikke nye duplikater av gammel historikk.
	 */
	activityId: string;
	timestamp: Date;
	sportType: string;
	sportFamily: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	/** Antall kilder som beskrev denne økta — 3 betyr klokke + GPX + app. */
	evidenceCount: number;
};

/**
 * Klyngevinduet i activity-laget. Vi henter litt før `from` slik at en økt som
 * startet rett før vinduet ikke splittes fra sine egne duplikater inni det.
 */
const CLUSTER_LOOKBACK_MS = 2 * 60 * 60 * 1000;

/** Feltene vindusvalget trenger — activity-lagets økter oppfyller den. */
export type UnifiedWorkoutInput = Pick<
	UnifiedWorkoutActivity,
	'activityId' | 'startTime' | 'sportType' | 'distanceMeters' | 'durationSeconds' | 'evidenceCount'
>;

/**
 * Klipper allerede sammenslåtte økter til vinduet og påfører sportsfamilien.
 * Ren funksjon — `readDeduplicatedWorkouts` er bare denne pluss datainnhentingen.
 *
 * Vinduet måles på øktas STARTTID, som `canonical_workouts` og Perioder-tabellen.
 * Vi henter et par timer før `from` for at klyngingen skal bli riktig i kanten,
 * men de øktene skal ikke telle med i vinduet.
 */
export function selectWorkoutsInWindow(
	unified: UnifiedWorkoutInput[],
	from: Date,
	to: Date
): DeduplicatedWorkout[] {
	return unified
		.map((workout) => ({
			activityId: workout.activityId,
			timestamp: new Date(workout.startTime),
			sportType: workout.sportType,
			sportFamily: workoutSportFamily(workout.sportType),
			distanceMeters: workout.distanceMeters,
			durationSeconds: workout.durationSeconds,
			evidenceCount: workout.evidenceCount
		}))
		.filter((workout) => workout.timestamp >= from && workout.timestamp <= to)
		.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

/**
 * Deduplikerte økter i et tidsrom, eldste først.
 *
 * Leser live fra activity-laget framfor `canonical_workouts`: projeksjonen
 * dekker bare de periodene en jobb har bygd, og en flate som viser halve
 * sannheten er verre enn en som er treg. Tallene blir de samme — projeksjonen
 * bygges av nøyaktig denne funksjonen.
 *
 * Vinduet måles på øktas STARTTID, som `canonical_workouts` og Perioder-tabellen.
 * En økt som startet 23:50 hører derfor til den dagen, ikke til dagen dens
 * andre kilde tilfeldigvis ble stemplet.
 */
export async function readDeduplicatedWorkouts(
	userId: string,
	from: Date,
	to: Date,
	limit = 2000
): Promise<DeduplicatedWorkout[]> {
	const since = new Date(from.getTime() - CLUSTER_LOOKBACK_MS);
	const unified = await buildUnifiedWorkoutActivities(userId, { since, limit });

	// Taket ligger på RÅ events, som hentes eldst-først — treffer vi det, er det de
	// nyeste øktene som mangler, og et for lavt tall ser ut som en dårlig periode.
	if (unified.length >= limit) {
		console.warn(
			`[deduplicated-workouts] traff taket på ${limit} events for ${userId} (${from.toISOString()}–${to.toISOString()}) — nyere økter kan mangle`
		);
	}

	return selectWorkoutsInWindow(unified, from, to);
}
