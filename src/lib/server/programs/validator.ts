import {
	PROGRAM_LIMITS,
	STRENGTH_EXERCISE_NAMES,
	getStrengthExercise,
	isRunType
} from './constants';
import type {
	PlannedExerciseDTO,
	PlannedRunDTO,
	PlannedRunIntervalDTO,
	ProgramDTO,
	ProgramSessionDTO,
	ProgramWeekDTO
} from './types';

export class ProgramValidationError extends Error {
	readonly issues: string[];
	constructor(issues: string[]) {
		super(`Program validation failed: ${issues.join('; ')}`);
		this.name = 'ProgramValidationError';
		this.issues = issues;
	}
}

/**
 * Validerer og normaliserer LLM-output. Kaster ProgramValidationError ved
 * brudd på hard-constraints (ulovlig øvelsesnavn, ulovlig runType, ute av grenser).
 * Logiske ting den LLM ofte trår feil på (manglende sets, feil dayNumber,
 * mode-mismatch) blir normalisert i stillhet med fornuftige defaults.
 */
export function validateAndNormalizeProgram(
	raw: unknown,
	context: {
		expectedDurationWeeks?: number;
		expectedSessionsPerWeek?: number;
		includeStrength: boolean;
		includeRunning: boolean;
	}
): ProgramDTO {
	const issues: string[] = [];

	if (!raw || typeof raw !== 'object') {
		throw new ProgramValidationError(['LLM-svar er ikke et objekt']);
	}
	const r = raw as Record<string, unknown>;

	const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : 'Hybridprogram';
	const goal = typeof r.goal === 'string' ? r.goal.trim() : '';
	if (!goal) issues.push('Mangler "goal"');

	const durationWeeks = clampInt(
		r.durationWeeks,
		PROGRAM_LIMITS.minDurationWeeks,
		PROGRAM_LIMITS.maxDurationWeeks,
		context.expectedDurationWeeks ?? 8
	);

	const sessionsPerWeek = clampInt(
		r.sessionsPerWeek,
		PROGRAM_LIMITS.minSessionsPerWeek,
		PROGRAM_LIMITS.maxSessionsPerWeek,
		context.expectedSessionsPerWeek ?? 3
	);

	const rawWeeks = Array.isArray(r.weeks) ? r.weeks : [];
	if (rawWeeks.length === 0) {
		throw new ProgramValidationError(['LLM returnerte ingen weeks']);
	}

	const weeks: ProgramWeekDTO[] = [];
	const seenWeekNumbers = new Set<number>();

	for (let i = 0; i < rawWeeks.length; i++) {
		const rawWeek = rawWeeks[i] as Record<string, unknown>;
		const weekNumber = clampInt(rawWeek?.weekNumber, 1, durationWeeks, i + 1);
		if (seenWeekNumbers.has(weekNumber)) {
			issues.push(`Duplikat weekNumber=${weekNumber}`);
			continue;
		}
		seenWeekNumbers.add(weekNumber);
		const deload = Boolean(rawWeek?.deload);
		const rawSessions = Array.isArray(rawWeek?.sessions) ? (rawWeek.sessions as unknown[]) : [];

		const sessions: ProgramSessionDTO[] = [];
		const seenDayNumbers = new Set<number>();
		let strengthCount = 0;

		for (let j = 0; j < rawSessions.length; j++) {
			const rs = rawSessions[j] as Record<string, unknown>;
			const kind = rs?.kind === 'run' ? 'run' : rs?.kind === 'strength' ? 'strength' : null;
			if (!kind) {
				issues.push(`Ukjent session.kind i uke ${weekNumber}, økt ${j + 1}`);
				continue;
			}
			if (kind === 'strength' && !context.includeStrength) {
				issues.push(`Styrkeøkt i uke ${weekNumber}, men includeStrength=false`);
				continue;
			}
			if (kind === 'run' && !context.includeRunning) {
				issues.push(`Løpsøkt i uke ${weekNumber}, men includeRunning=false`);
				continue;
			}

			if (kind === 'strength') {
				strengthCount++;
				if (strengthCount > PROGRAM_LIMITS.maxStrengthSessionsPerWeek) {
					issues.push(
						`For mange styrkeøkter i uke ${weekNumber} (maks ${PROGRAM_LIMITS.maxStrengthSessionsPerWeek})`
					);
					continue;
				}
			}

			const dayNumber = clampInt(rs?.dayNumber, 1, 7, ((j % 7) + 1));
			if (seenDayNumbers.has(dayNumber)) {
				issues.push(`Duplikat dayNumber=${dayNumber} i uke ${weekNumber}`);
				continue;
			}
			seenDayNumbers.add(dayNumber);

			const sessionName = typeof rs?.name === 'string' && rs.name.trim()
				? rs.name.trim()
				: kind === 'strength' ? 'Styrke' : 'Løp';

			const restSeconds = typeof rs?.restSeconds === 'number' ? clampInt(rs.restSeconds, 0, 600, 60) : undefined;

			const session: ProgramSessionDTO = {
				weekNumber,
				dayNumber,
				kind,
				name: sessionName,
				restSeconds,
				notes: typeof rs?.notes === 'string' ? rs.notes.trim() || undefined : undefined
			};

			if (kind === 'strength') {
				session.plannedExercises = validateExercises(
					rs?.plannedExercises,
					weekNumber,
					dayNumber,
					issues
				);
				if (session.plannedExercises.length === 0) {
					issues.push(`Styrkeøkt uke ${weekNumber} dag ${dayNumber} har ingen gyldige øvelser`);
					continue;
				}
			} else {
				const run = validateRun(rs?.plannedRun, weekNumber, dayNumber, issues);
				if (!run) {
					issues.push(`Løpsøkt uke ${weekNumber} dag ${dayNumber} mangler gyldig plannedRun`);
					continue;
				}
				session.plannedRun = run;
			}

			sessions.push(session);
		}

		if (sessions.length === 0) {
			issues.push(`Uke ${weekNumber} har ingen gyldige økter`);
			continue;
		}

		sessions.sort((a, b) => a.dayNumber - b.dayNumber);
		weeks.push({
			weekNumber,
			deload,
			notes: typeof rawWeek?.notes === 'string' ? (rawWeek.notes as string).trim() || undefined : undefined,
			sessions
		});
	}

	if (weeks.length === 0) {
		throw new ProgramValidationError(['Ingen gyldige uker etter validering', ...issues]);
	}

	weeks.sort((a, b) => a.weekNumber - b.weekNumber);

	const today = new Date().toISOString().slice(0, 10);
	const startDate = typeof r.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.startDate)
		? r.startDate
		: today;

	return {
		name,
		goal,
		durationWeeks,
		sessionsPerWeek,
		status: 'active',
		includeStrength: context.includeStrength,
		includeRunning: context.includeRunning,
		startDate,
		weeks
	};
}

function validateExercises(
	raw: unknown,
	weekNumber: number,
	dayNumber: number,
	issues: string[]
): PlannedExerciseDTO[] {
	if (!Array.isArray(raw)) return [];
	const exercises: PlannedExerciseDTO[] = [];
	for (let i = 0; i < raw.length && exercises.length < PROGRAM_LIMITS.maxExercisesPerSession; i++) {
		const re = raw[i] as Record<string, unknown>;
		const exerciseName = typeof re?.exerciseName === 'string' ? re.exerciseName : null;
		if (!exerciseName || !STRENGTH_EXERCISE_NAMES.includes(exerciseName)) {
			issues.push(
				`Ulovlig exerciseName "${exerciseName}" i uke ${weekNumber} dag ${dayNumber} — kun ${STRENGTH_EXERCISE_NAMES.join(', ')} tillatt`
			);
			continue;
		}
		const spec = getStrengthExercise(exerciseName);
		if (!spec) continue;

		const sets = clampInt(re?.sets, 1, PROGRAM_LIMITS.maxSetsPerExercise, spec.defaults.sets);

		const exercise: PlannedExerciseDTO = {
			order: exercises.length + 1,
			exerciseName,
			sets
		};

		if (spec.mode === 'reps') {
			exercise.repsTarget = clampInt(
				re?.repsTarget,
				1,
				PROGRAM_LIMITS.maxRepsTarget,
				spec.defaults.repsTarget ?? 8
			);
			if (spec.allowsWeight && typeof re?.weightHint === 'string' && re.weightHint.trim()) {
				exercise.weightHint = re.weightHint.trim();
			}
		} else {
			exercise.durationSecondsTarget = clampInt(
				re?.durationSecondsTarget,
				1,
				PROGRAM_LIMITS.maxDurationSecondsTarget,
				spec.defaults.durationSecondsTarget ?? 30
			);
		}

		if (typeof re?.notes === 'string' && re.notes.trim()) {
			exercise.notes = re.notes.trim();
		}

		exercises.push(exercise);
	}
	return exercises;
}

function validateRun(
	raw: unknown,
	weekNumber: number,
	dayNumber: number,
	issues: string[]
): PlannedRunDTO | null {
	if (!raw || typeof raw !== 'object') return null;
	const r = raw as Record<string, unknown>;
	if (!isRunType(r.runType)) {
		issues.push(`Ulovlig runType "${r.runType}" i uke ${weekNumber} dag ${dayNumber}`);
		return null;
	}

	const run: PlannedRunDTO = { runType: r.runType };

	if (typeof r.targetDistanceMeters === 'number' && r.targetDistanceMeters > 0) {
		run.targetDistanceMeters = Math.round(r.targetDistanceMeters);
	}
	if (typeof r.targetDurationSeconds === 'number' && r.targetDurationSeconds > 0) {
		run.targetDurationSeconds = Math.round(r.targetDurationSeconds);
	}

	if (run.runType === 'intervals') {
		const rawIntervals = Array.isArray(r.intervals) ? r.intervals : [];
		const intervals: PlannedRunIntervalDTO[] = [];
		for (const ri of rawIntervals) {
			const x = ri as Record<string, unknown>;
			const reps = clampInt(x?.reps, 1, 30, 5);
			const restSeconds = clampInt(x?.restSeconds, 0, 600, 90);
			const interval: PlannedRunIntervalDTO = { reps, restSeconds };
			if (typeof x?.distanceMeters === 'number' && x.distanceMeters > 0) {
				interval.distanceMeters = Math.round(x.distanceMeters);
			}
			if (typeof x?.durationSeconds === 'number' && x.durationSeconds > 0) {
				interval.durationSeconds = Math.round(x.durationSeconds);
			}
			if (!interval.distanceMeters && !interval.durationSeconds) continue;
			intervals.push(interval);
		}
		if (intervals.length === 0) {
			issues.push(`Intervaller uke ${weekNumber} dag ${dayNumber} mangler gyldige intervaller`);
			return null;
		}
		run.intervals = intervals;
	}

	if (typeof r.warmupSeconds === 'number' && r.warmupSeconds > 0) {
		run.warmupSeconds = Math.round(r.warmupSeconds);
	}
	if (typeof r.cooldownSeconds === 'number' && r.cooldownSeconds > 0) {
		run.cooldownSeconds = Math.round(r.cooldownSeconds);
	}
	if (typeof r.paceHintSecPerKm === 'number' && r.paceHintSecPerKm > 0) {
		run.paceHintSecPerKm = Math.round(r.paceHintSecPerKm);
	}
	if (typeof r.hrZoneHint === 'string' && r.hrZoneHint.trim()) {
		run.hrZoneHint = r.hrZoneHint.trim();
	}
	if (typeof r.notes === 'string' && r.notes.trim()) {
		run.notes = r.notes.trim();
	}

	// Easy/tempo/long uten mål er useless
	if (run.runType !== 'intervals' && !run.targetDistanceMeters && !run.targetDurationSeconds) {
		issues.push(`${run.runType}-økt uke ${weekNumber} dag ${dayNumber} mangler distance/duration`);
		return null;
	}

	return run;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
	const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
	if (!Number.isFinite(n)) return Math.max(min, Math.min(max, fallback));
	return Math.max(min, Math.min(max, Math.round(n)));
}
