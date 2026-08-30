/**
 * Krydderet på en økt — én setning som sier hva som var spesielt.
 *
 * Se `docs/changelog/2026-08-10-krydder-per-aktivitet.md`.
 *
 * Brukes som overskrift i push-varselet og som «mot egen historikk» i
 * øktvurderingen.
 *
 * **Alt telles per aktivitetstype.** Fram til august 2026 pooler streaken og
 * ukestellingen alle idretter, så en elsykkeltur mandag, en løpetur tirsdag og
 * en gåtur onsdag ble til «3 dager på rad!». Det er ikke en vane man har bygget,
 * det er tre ulike ting som tilfeldigvis skjedde etter hverandre — og setningen
 * gir ingen mening for den som leser den. Nå: «Løpt 4 dager på rad»,
 * «Elsykkeltur nr. 50 i år».
 *
 * Ren modul. Historikken som mates inn skal være **deduplisert** (samme tur fra
 * klokke, Dropbox og Ekko er én økt) — kallstedet har ansvaret for det.
 */

import { workoutActivityKind, type WorkoutActivityKind } from './workout-activity-kind';

export type NuggetWorkout = {
	timestamp: Date;
	sportType: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	elevationMeters?: number | null;
};

/** Vinduer vi leter etter «beste på N dager» i, lengst først. */
const PR_BUCKETS_DAYS = [365, 180, 90, 60, 30, 14, 7];

/** Minste antall tidligere økter i et vindu før en PR-påstand betyr noe. */
const MIN_SAMPLES_FOR_BUCKET_PR = 3;

/** Korteste streak verdt å nevne. To dager er ikke en serie. */
const MIN_STREAK_DAYS = 3;

/** Lengste streak vi leter etter — en vakt mot å gå gjennom hele historikken. */
const MAX_STREAK_LOOKBACK_DAYS = 400;

/**
 * Årsmilepæler. Krydder på hver eneste tur blir bakgrunnsstøy, og
 * bakgrunnsstøy blir slått av — så vi sier fra på runde tall, ikke på «nr. 37».
 */
const YEAR_MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300];

function startOfDayMs(date: Date): number {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function startOfWeekMondayMs(date: Date): number {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d.getTime();
}

function paceSecPerKm(workout: NuggetWorkout): number | null {
	if (!workout.distanceMeters || !workout.durationSeconds) return null;
	if (workout.distanceMeters < 100 || workout.durationSeconds <= 0) return null;
	return workout.durationSeconds / (workout.distanceMeters / 1000);
}

function withinDays(reference: Date, candidate: Date, days: number): boolean {
	const ms = days * 24 * 60 * 60 * 1000;
	const delta = reference.getTime() - candidate.getTime();
	return delta >= 0 && delta <= ms;
}

/** «Løpt 4 dager på rad!» — sammenhengende dager med SAMME aktivitet. */
export function streakNugget(
	current: NuggetWorkout,
	sameKind: NuggetWorkout[],
	kind: WorkoutActivityKind
): string | null {
	const today = startOfDayMs(current.timestamp);
	const days = new Set<number>([today]);
	for (const w of sameKind) days.add(startOfDayMs(w.timestamp));

	let streak = 1;
	const dayMs = 24 * 60 * 60 * 1000;
	for (let i = 1; i <= MAX_STREAK_LOOKBACK_DAYS; i++) {
		if (!days.has(today - i * dayMs)) break;
		streak += 1;
	}

	if (streak < MIN_STREAK_DAYS) return null;
	return kind.verbPast
		? `${kind.verbPast} ${streak} dager på rad!`
		: `${streak} dager med ${kind.noun} på rad!`;
}

/** «Elsykkeltur nr. 50 i år!» — bare på runde tall. */
export function yearMilestoneNugget(
	current: NuggetWorkout,
	sameKind: NuggetWorkout[],
	kind: WorkoutActivityKind
): string | null {
	const year = current.timestamp.getFullYear();
	const countThisYear =
		sameKind.filter((w) => w.timestamp.getFullYear() === year && w.timestamp <= current.timestamp).length + 1;

	if (!YEAR_MILESTONES.includes(countThisYear)) return null;
	const noun = kind.noun.charAt(0).toUpperCase() + kind.noun.slice(1);
	return `${noun} nr. ${countThisYear} i år!`;
}

/** «Lengste løpetur noensinne!» */
export function distanceNugget(
	current: NuggetWorkout,
	sameKind: NuggetWorkout[],
	kind: WorkoutActivityKind
): string | null {
	const distance = current.distanceMeters;
	if (distance == null || distance < 1000) return null;

	const withDistance = sameKind.filter((w) => w.distanceMeters != null);
	if (withDistance.length === 0) return null;

	if (withDistance.every((w) => (w.distanceMeters as number) < distance)) {
		return `Lengste ${kind.noun} noensinne!`;
	}

	for (const days of PR_BUCKETS_DAYS) {
		const inBucket = withDistance.filter((w) => withinDays(current.timestamp, w.timestamp, days));
		if (
			inBucket.length >= MIN_SAMPLES_FOR_BUCKET_PR &&
			inBucket.every((w) => (w.distanceMeters as number) < distance)
		) {
			return `Lengste ${kind.noun} på ${days} dager!`;
		}
	}
	return null;
}

/**
 * «Raskeste tempo noensinne!»
 *
 * Bare for løping. På sykkel avgjøres farten av terreng, vind og — på el-sykkel
 * — hvor mye motoren ga, så en tempo-PR sier lite om formen.
 */
export function paceNugget(
	current: NuggetWorkout,
	sameKind: NuggetWorkout[],
	kind: WorkoutActivityKind
): string | null {
	if (kind.key !== 'running') return null;
	const pace = paceSecPerKm(current);
	if (pace == null || (current.distanceMeters ?? 0) < 2000) return null;

	const comparable = sameKind
		.filter((w) => (w.distanceMeters ?? 0) >= 2000)
		.map((w) => ({ w, pace: paceSecPerKm(w) }))
		.filter((row): row is { w: NuggetWorkout; pace: number } => row.pace !== null);
	if (comparable.length === 0) return null;

	if (comparable.every((row) => row.pace > pace)) return 'Raskeste tempo noensinne!';

	for (const days of PR_BUCKETS_DAYS) {
		const inBucket = comparable.filter((row) => withinDays(current.timestamp, row.w.timestamp, days));
		if (inBucket.length >= MIN_SAMPLES_FOR_BUCKET_PR && inBucket.every((row) => row.pace > pace)) {
			return `Raskeste tempo på ${days} dager!`;
		}
	}
	return null;
}

/** «3. løpetur denne uka!» */
export function weeklyCountNugget(
	current: NuggetWorkout,
	sameKind: NuggetWorkout[],
	kind: WorkoutActivityKind
): string | null {
	const weekStart = startOfWeekMondayMs(current.timestamp);
	const weekEnd = weekStart + 7 * 24 * 60 * 60 * 1000;
	const inWeek = sameKind.filter((w) => {
		const t = w.timestamp.getTime();
		return t >= weekStart && t < weekEnd;
	}).length;

	const total = inWeek + 1;
	if (total < 3) return null;
	return `${total}. ${kind.noun} denne uka!`;
}

/** Siste utvei: si noe sant om økta selv, uten historikk. */
export function shapeNugget(current: NuggetWorkout, kind: WorkoutActivityKind): string | null {
	const elevation = current.elevationMeters;
	if (elevation != null && elevation >= 200) {
		return `Mye motbakke — ${Math.round(elevation)} høydemeter!`;
	}

	const minutes = current.durationSeconds != null ? current.durationSeconds / 60 : null;
	const km = current.distanceMeters != null ? current.distanceMeters / 1000 : null;

	if (kind.key === 'running' && km != null && km >= 10) return 'Lang økt — godt jobba!';
	if (minutes != null && minutes >= 60) return 'Lang økt — godt jobba!';
	if (minutes != null && minutes <= 20 && (km == null || km <= 3)) return 'Kort og godt!';
	return null;
}

/**
 * Velger én setning.
 *
 * Rekkefølgen er prioritet, og den er ikke tilfeldig: en rekord slår en
 * milepæl, en milepæl slår en streak, og alt slår en observasjon om økta selv.
 * Det sjeldneste er det mest verdt å si.
 */
export function pickNugget(
	current: NuggetWorkout,
	history: NuggetWorkout[],
	/**
	 * Ferdig PR-tekst fra `recordNuggetText`, når økta satte en distanserekord.
	 *
	 * Sendes inn framfor å regnes her: rekordene hviler på `bestEfforts` i
	 * `canonical_workouts`, som denne rene modulen ikke skal kjenne til. Den står
	 * ØVERST i prioriteringen — en distanserekord er det sjeldneste og mest
	 * konkrete som kan skje på en økt.
	 */
	recordText: string | null = null
): string | null {
	const kind = workoutActivityKind(current.sportType);
	const sameKind = history.filter((w) => workoutActivityKind(w.sportType).key === kind.key);

	const candidates = [
		recordText,
		distanceNugget(current, sameKind, kind),
		paceNugget(current, sameKind, kind),
		yearMilestoneNugget(current, sameKind, kind),
		streakNugget(current, sameKind, kind),
		weeklyCountNugget(current, sameKind, kind),
		shapeNugget(current, kind)
	];

	return candidates.find((c): c is string => Boolean(c)) ?? null;
}
