/**
 * Fremdriften på løpe- og vektmål, delt av `/plan/mal` og hjemskjermens brev
 * (`$lib/server/home-letter.ts`).
 *
 * Utvelgelsen lå inline i `/plan/mal` (`+page.server.ts`): hvilke mål som er
 * løpemål, hvilket vindu de dekker, og hvor målverdien står. Et brev som valgte
 * selv ville fått sin egen tolkning av «startdato mangler» og «målverdien står i
 * delta-feltet», og da sier brevet et annet tall enn målsiden for samme mål.
 */

import { readGoalTargetValue } from '$lib/domain/goal-tracks';
import {
	getRunningSummaryForRange,
	readWeightProgress,
	type RunningSummary,
	type WeightProgress
} from '$lib/server/goal-progress';

export interface TrajectoryGoal {
	id: string;
	metadata: unknown;
	createdAt: Date;
	targetDate: Date | null;
}

export type RunningProgress = RunningSummary & { targetKm: number };

export function isRunningGoal(goal: TrajectoryGoal): boolean {
	const meta = goal.metadata as { metricId?: unknown; startDate?: unknown; goalTrack?: unknown } | null;
	return meta?.metricId === 'running_distance' && Boolean(meta?.startDate || meta?.goalTrack);
}

export function isWeightGoal(goal: TrajectoryGoal): boolean {
	const meta = goal.metadata as { metricId?: unknown } | null;
	return meta?.metricId === 'weight_change' && readGoalTargetValue(goal.metadata) !== null;
}

export async function loadRunningProgress(userId: string, goal: TrajectoryGoal): Promise<RunningProgress> {
	const meta = goal.metadata as { startDate?: string; endDate?: string; goalTrack?: { targetValue?: number } } | null;
	const startDate = meta?.startDate ? new Date(meta.startDate) : new Date(goal.createdAt);
	const endDate = meta?.endDate ? new Date(meta.endDate) : new Date();
	const targetKm: number = meta?.goalTrack?.targetValue ?? 0;
	const summary = await getRunningSummaryForRange(userId, startDate, endDate);
	return { ...summary, targetKm };
}

/**
 * NB: `startValue` er IKKE et krav. Mål opprettet uten baseline (chatten kunne
 * ikke sende den før 23. august 2026) ble ellers filtrert bort i det stille;
 * `readWeightProgress` faller tilbake på første måling i vinduet.
 */
export async function loadWeightGoalProgress(userId: string, goal: TrajectoryGoal): Promise<WeightProgress | null> {
	const targetValue = readGoalTargetValue(goal.metadata);
	if (targetValue === null) return null;
	const meta = goal.metadata as { startDate?: string; endDate?: string; startValue?: unknown } | null;
	const startDate = meta?.startDate ? new Date(meta.startDate) : new Date(goal.createdAt);
	const endDate = meta?.endDate ? new Date(meta.endDate) : goal.targetDate ? new Date(goal.targetDate) : new Date();
	return readWeightProgress(userId, {
		startDate,
		endDate,
		startWeight: typeof meta?.startValue === 'number' ? meta.startValue : null,
		targetValue
	});
}
