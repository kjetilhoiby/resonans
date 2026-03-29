import type { MetricId } from './metric-catalog';

export type GoalTrackKind = 'level' | 'change' | 'trajectory';
export type GoalWindow = 'week' | 'month' | 'quarter' | 'year' | 'custom';
export type WidgetWindow = '7d' | '30d' | '365d' | GoalWindow;

type SeasonKey = 'spring' | 'summer' | 'autumn' | 'winter';
type SeasonalProfile = Partial<Record<SeasonKey, number>>;

export interface GoalTrack {
	id: string;
	metricId: MetricId;
	label: string;
	kind: GoalTrackKind;
	window: GoalWindow;
	startDate?: string;
	endDate?: string;
	durationDays?: number;
	targetValue: number;
	unit: string;
	priority?: number;
	metadata?: {
		seasonalProfile?: SeasonalProfile;
		[key: string]: unknown;
	};
}

export interface TrackMatchResult {
	track: GoalTrack;
	score: number;
	reason: string;
}

const WINDOW_WEIGHT: Record<GoalWindow, number> = {
	week: 1,
	month: 2,
	quarter: 3,
	year: 4,
	custom: 2
};

function expectedDays(window: GoalWindow): number {
	if (window === 'week') return 7;
	if (window === 'month') return 30;
	if (window === 'quarter') return 91;
	if (window === 'custom') return 30;
	return 365;
}

function daysForWidgetWindow(window: WidgetWindow): number {
	if (window === '7d') return 7;
	if (window === '30d') return 30;
	if (window === '365d') return 365;
	return expectedDays(window);
}

function normalizeWindow(window: WidgetWindow): GoalWindow {
	if (window === '7d') return 'week';
	if (window === '30d') return 'month';
	if (window === '365d') return 'year';
	return window;
}

function trackDays(track: GoalTrack): number {
	if (typeof track.durationDays === 'number' && track.durationDays > 0) return track.durationDays;
	return expectedDays(track.window);
}

function seasonOfDate(date: Date): SeasonKey {
	const m = date.getMonth();
	if (m >= 2 && m <= 4) return 'spring';
	if (m >= 5 && m <= 7) return 'summer';
	if (m >= 8 && m <= 10) return 'autumn';
	return 'winter';
}

function seasonalFactor(profile: SeasonalProfile | undefined, date: Date): number {
	if (!profile) return 1;
	const season = seasonOfDate(date);
	const selected = profile[season] ?? 1;
	const base =
		((profile.spring ?? 1) + (profile.summer ?? 1) + (profile.autumn ?? 1) + (profile.winter ?? 1)) /
		4;
	if (!Number.isFinite(base) || base <= 0) return 1;
	return selected / base;
}

export function selectGoalTrackForWidget(
	tracks: GoalTrack[],
	metricId: MetricId,
	widgetWindow: WidgetWindow
): TrackMatchResult | null {
	const candidates = tracks.filter((track) => track.metricId === metricId);
	if (!candidates.length) return null;

	const targetWindow = normalizeWindow(widgetWindow);

	let best: TrackMatchResult | null = null;
	for (const track of candidates) {
		const priority = track.priority ?? 0;
		const exactWindowBonus = track.window === targetWindow ? 50 : 0;
		const windowDistancePenalty = Math.abs(WINDOW_WEIGHT[track.window] - WINDOW_WEIGHT[targetWindow]) * 8;
		const trackDuration = trackDays(track);
		const widgetDuration = daysForWidgetWindow(widgetWindow);
		const durationPenalty = Math.min(30, Math.abs(trackDuration - widgetDuration) / 10);
		const distancePenalty = windowDistancePenalty + durationPenalty;
		const score = 100 + exactWindowBonus + priority - distancePenalty;
		const reason = track.window === targetWindow ? 'exact_window_match' : 'nearest_window_match';

		if (!best || score > best.score) {
			best = { track, score, reason };
		}
	}

	return best;
}

export function projectTrackTargetForWindow(track: GoalTrack, widgetWindow: WidgetWindow): number {
	const widgetDays = daysForWidgetWindow(widgetWindow);
	const baseTrackDays = trackDays(track);
	if (!baseTrackDays || track.targetValue === 0) return 0;
	const baseProjection = (track.targetValue / baseTrackDays) * widgetDays;
	const seasonalMultiplier = seasonalFactor(track.metadata?.seasonalProfile, new Date());
	return baseProjection * seasonalMultiplier;
}

export function evaluateProgress(
	actualValue: number,
	track: GoalTrack,
	widgetWindow: WidgetWindow
): { ratio: number; pct: number; projectedTarget: number } {
	const projectedTarget = projectTrackTargetForWindow(track, widgetWindow);
	if (projectedTarget === 0) {
		return { ratio: 0, pct: 0, projectedTarget: 0 };
	}
	const ratio = Math.abs(actualValue) / Math.abs(projectedTarget);
	return {
		ratio,
		pct: Math.max(0, Math.min(100, Math.round(ratio * 100))),
		projectedTarget
	};
}

export function defaultV1GoalTracks(): GoalTrack[] {
	return [
		{
			id: 'run-week',
			metricId: 'running_distance',
			label: 'Løping per uke',
			kind: 'level',
			window: 'week',
			targetValue: 20,
			unit: 'km',
			priority: 100
		},
		{
			id: 'run-quarter',
			metricId: 'running_distance',
			label: 'Løping per kvartal',
			kind: 'level',
			window: 'quarter',
			targetValue: 150,
			unit: 'km',
			priority: 95
		},
		{
			id: 'run-year',
			metricId: 'running_distance',
			label: 'Løping per år',
			kind: 'level',
			window: 'year',
			targetValue: 1000,
			unit: 'km',
			priority: 90
		}
	];
}
