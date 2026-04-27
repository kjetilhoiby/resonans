import { db } from '$lib/db';
import { sensorEvents } from '$lib/db/schema';
import { describeWorkoutSportType } from '$lib/server/workout-taxonomy';
import { and, eq } from 'drizzle-orm';

export interface WorkoutContextSummary {
	id: string;
	timestamp: string;
	sportType: string;
	title: string;
	distanceMeters: number | null;
	distanceKm: number | null;
	durationSeconds: number | null;
	paceSecondsPerKm: number | null;
	elevationMeters: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	source: string | null;
	sourceName: string | null;
	sourceFormat: string | null;
	chatPrompt: string;
}

export interface WorkoutSplitForContext {
	km: number;
	paceSecPerKm: number | null;
	avgHr: number | null;
	eleGain: number;
	eleLoss: number;
}

export interface CrossSourceHr {
	sourceName: string;
	avgHr: number | null;
	maxHr: number | null;
	minHr: number | null;
}

function normalizeDistanceMeters(distance: unknown): number | null {
	if (typeof distance !== 'number' || !Number.isFinite(distance) || distance <= 0) return null;
	return distance > 80 ? distance : distance * 1000;
}

function normalizeDurationSeconds(duration: unknown): number | null {
	if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) return null;
	return duration;
}

function normalizePaceSecondsPerKm(pace: unknown): number | null {
	if (typeof pace !== 'number' || !Number.isFinite(pace) || pace <= 0) return null;
	return pace;
}

function formatDuration(durationSeconds: number | null): string {
	if (!durationSeconds) return 'ukjent varighet';
	const totalMinutes = Math.round(durationSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	if (hours <= 0) return `${minutes} min`;
	return `${hours} t ${minutes} min`;
}

function formatPace(paceSecondsPerKm: number | null): string {
	if (!paceSecondsPerKm) return 'ukjent tempo';
	const minutes = Math.floor(paceSecondsPerKm / 60);
	const seconds = Math.round(paceSecondsPerKm % 60)
		.toString()
		.padStart(2, '0');
	return `${minutes}:${seconds} /km`;
}

function formatDistance(distanceMeters: number | null): string {
	if (!distanceMeters) return 'ukjent distanse';
	return `${(distanceMeters / 1000).toFixed(2)} km`;
}

function formatWorkoutDate(timestampIso: string): string {
	return new Intl.DateTimeFormat('nb-NO', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(timestampIso));
}

export function buildWorkoutChatPrompt(
	workout: Omit<WorkoutContextSummary, 'chatPrompt'>,
	splits?: WorkoutSplitForContext[],
	crossSourceHr?: CrossSourceHr
): string {
	const parts = [
		`Jeg vil analysere denne økten i detalj under Helse-temaet.`,
		`Økt: ${workout.title}.`,
		`Tidspunkt: ${formatWorkoutDate(workout.timestamp)}.`,
		`Distanse: ${formatDistance(workout.distanceMeters)}.`,
		`Varighet: ${formatDuration(workout.durationSeconds)}.`,
		`Tempo: ${formatPace(workout.paceSecondsPerKm)}.`
	];

	if (workout.elevationMeters != null) {
		parts.push(`Høydemeter: ${Math.round(workout.elevationMeters)} m.`);
	}

	if (workout.avgHeartRate != null) {
		const maxText = workout.maxHeartRate != null ? `, maks ${Math.round(workout.maxHeartRate)}` : '';
		parts.push(`Puls: snitt ${Math.round(workout.avgHeartRate)}${maxText}.`);
	} else if (crossSourceHr?.avgHr != null) {
		const maxText = crossSourceHr.maxHr != null ? `, maks ${crossSourceHr.maxHr}` : '';
		const minText = crossSourceHr.minHr != null ? `, min ${crossSourceHr.minHr}` : '';
		parts.push(`Puls (fra ${crossSourceHr.sourceName}): snitt ${crossSourceHr.avgHr}${maxText}${minText} bpm. GPS-filen mangler pulsmåling.`);
	}

	if (splits && splits.length > 0) {
		const splitLines = splits
			.map((s) => {
				const pace = s.paceSecPerKm != null ? formatPace(s.paceSecPerKm) : '–';
				const hr = s.avgHr != null ? ` @ ${s.avgHr} bpm` : '';
				const ele = s.eleGain > 2 || s.eleLoss > 2
					? ` (${s.eleGain > 2 ? `+${s.eleGain}m` : ''}${s.eleLoss > 2 ? `/-${s.eleLoss}m` : ''})`
					: '';
				return `km ${s.km}: ${pace}${hr}${ele}`;
			})
			.join(', ');
		parts.push(`Kilometer-splits: ${splitLines}.`);
	}

	if (workout.sourceName) {
		parts.push(`Kilde: ${workout.sourceName}.`);
	}

	parts.push('Gi meg en kort vurdering av belastning, fart, puls og hva som er smartest som neste steg.');
	return parts.join(' ');
}

export async function getWorkoutContextForUser(
	userId: string,
	workoutId: string
): Promise<WorkoutContextSummary | null> {
	const workout = await db.query.sensorEvents.findFirst({
		where: and(
			eq(sensorEvents.id, workoutId),
			eq(sensorEvents.userId, userId),
			eq(sensorEvents.dataType, 'workout')
		)
	});

	if (!workout) return null;

	const sportType = typeof workout.data?.sportType === 'string' ? workout.data.sportType : 'workout';
	const distanceMeters = normalizeDistanceMeters(workout.data?.distance);
	const durationSeconds = normalizeDurationSeconds(workout.data?.duration);
	const paceSecondsPerKm = normalizePaceSecondsPerKm(workout.data?.paceSecondsPerKm);
	const summaryBase = {
		id: workout.id,
		timestamp: workout.timestamp.toISOString(),
		sportType,
		title: describeWorkoutSportType(sportType),
		distanceMeters,
		distanceKm: distanceMeters != null ? distanceMeters / 1000 : null,
		durationSeconds,
		paceSecondsPerKm,
		elevationMeters:
			typeof workout.data?.elevation === 'number' && Number.isFinite(workout.data.elevation)
				? workout.data.elevation
				: null,
		avgHeartRate:
			typeof workout.data?.avgHeartRate === 'number' && Number.isFinite(workout.data.avgHeartRate)
				? workout.data.avgHeartRate
				: null,
		maxHeartRate:
			typeof workout.data?.maxHeartRate === 'number' && Number.isFinite(workout.data.maxHeartRate)
				? workout.data.maxHeartRate
				: null,
		source: typeof workout.metadata?.source === 'string' ? workout.metadata.source : null,
		sourceName: typeof workout.metadata?.sourceName === 'string' ? workout.metadata.sourceName : null,
		sourceFormat: typeof workout.metadata?.sourceFormat === 'string' ? workout.metadata.sourceFormat : null
	};

	return {
		...summaryBase,
		chatPrompt: buildWorkoutChatPrompt(summaryBase)
	};
}