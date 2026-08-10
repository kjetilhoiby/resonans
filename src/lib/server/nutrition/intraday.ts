/**
 * Dagens kumulative kurver, hentet på ett sted.
 *
 * Tre kallsteder trenger nøyaktig samme tall: flaten tegner kurvene, sultskalaen lagrer
 * gapet slik det var i det øyeblikket, og nudgen sammenligner gapet med brukerens
 * terskel. Ville de tre regnet hver for seg, kunne en nudge fyrt på et gap flaten aldri
 * viste — og da er den umulig å etterprøve.
 */

import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts, sensorEvents } from '$lib/db/schema';
import { listIntake } from '$lib/server/nutrition/intake-log';
import { osloDateKey } from '$lib/domain/nutrition/day-summary';
import {
	buildIntradayEnergy,
	osloMinuteOfDay,
	type IntradayEnergy,
	type IntradayWorkout
} from '$lib/domain/nutrition/intraday-energy';
import {
	basalMetabolicRate,
	estimateWorkoutKcal,
	DESK_JOB_FACTOR
} from '$lib/domain/health/energy-expenditure';
import { ageFromBirthYear, readBodyProfile } from '$lib/server/health/body-profile';

/** Minutter etter midnatt Oslo for et tidspunkt. */
function osloMinuteFor(at: Date): number {
	return osloMinuteOfDay(at);
}

/**
 * Kurvene for i dag. Null når kroppsprofilen mangler — uten hvilestoffskifte finnes
 * ingen forbrukskurve, og vi gjetter ikke på kroppshøyde.
 */
export async function loadIntradayEnergy(
	userId: string,
	now: Date = new Date()
): Promise<IntradayEnergy | null> {
	const today = osloDateKey(now);
	const dayStart = new Date(`${today}T00:00:00.000Z`);

	const [entries, profile, weightRow, workoutRows] = await Promise.all([
		listIntake(userId, { since: new Date(now.getTime() - 36 * 60 * 60 * 1000) }),
		readBodyProfile(userId),
		db.query.sensorEvents.findFirst({
			columns: { data: true },
			where: and(eq(sensorEvents.userId, userId), eq(sensorEvents.dataType, 'weight')),
			orderBy: [desc(sensorEvents.timestamp)]
		}),
		db.query.canonicalWorkouts.findMany({
			columns: { startTime: true, sportType: true, durationSeconds: true, movingSeconds: true, distanceMeters: true },
			where: and(
				eq(canonicalWorkouts.userId, userId),
				gte(canonicalWorkouts.startTime, new Date(dayStart.getTime() - 12 * 60 * 60 * 1000)),
				lte(canonicalWorkouts.startTime, new Date(dayStart.getTime() + 36 * 60 * 60 * 1000))
			)
		})
	]);

	const weightValue = (weightRow?.data as { weight?: unknown } | null)?.weight;
	const weightKg =
		typeof weightValue === 'number' && Number.isFinite(weightValue) ? weightValue : null;

	const basalKcal = basalMetabolicRate({
		weightKg: weightKg ?? undefined,
		heightCm: profile.heightCm ?? undefined,
		ageYears: ageFromBirthYear(profile.birthYear) ?? undefined,
		sex: profile.sex ?? undefined
	});
	if (basalKcal === null || weightKg === null) return null;

	const baselineKcal = Math.round(basalKcal * (profile.deskJobFactor ?? DESK_JOB_FACTOR));

	const meals = entries
		.filter((entry) => osloDateKey(entry.timestamp) === today)
		.map((entry) => ({
			minute: osloMinuteFor(new Date(entry.timestamp)),
			kcal: entry.macros.kcal
		}));

	const workouts: IntradayWorkout[] = workoutRows
		.filter((row) => osloDateKey(row.startTime) === today)
		.flatMap((row) => {
			// Blokken i grafen tegnes like lang som den varigheten forbruket ble
			// regnet på — ellers ville en glemt sporing lagt en to timer bred, nesten
			// flat blokk over ettermiddagen.
			const durationSeconds = row.movingSeconds
				? Number(row.movingSeconds)
				: row.durationSeconds
					? Number(row.durationSeconds)
					: null;
			const estimate = estimateWorkoutKcal(
				{
					sportType: row.sportType,
					durationSeconds: row.durationSeconds ? Number(row.durationSeconds) : null,
					movingSeconds: row.movingSeconds ? Number(row.movingSeconds) : null,
					distanceMeters: row.distanceMeters ? Number(row.distanceMeters) : null
				},
				weightKg
			);
			if (!estimate || !durationSeconds) return [];
			return [
				{
					startMinute: osloMinuteFor(row.startTime),
					durationMinutes: Math.max(1, Math.round(durationSeconds / 60)),
					kcal: estimate.kcal
				}
			];
		});

	return buildIntradayEnergy({
		nowMinute: osloMinuteOfDay(now),
		basalKcal,
		baselineKcal,
		meals,
		workouts
	});
}
