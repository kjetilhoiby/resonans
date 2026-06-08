/**
 * health-data.ts — derived data computations, types, and helpers
 * extracted from HealthDashboard to keep the parent lean.
 */

import {
	defaultV1GoalTracks,
	evaluateProgress,
	projectTrackTargetForWindow,
	selectGoalTrackForWidget,
	type GoalTrack,
	type WidgetWindow
} from '$lib/domain/goal-tracks';
import { computeTrainingLoad } from '$lib/util/training-load';

// ── Types ──────────────────────────────────────────────────

export type WindowMode = '7d' | '30d' | '365d' | 'week' | 'month' | 'year' | 'quarter';

export type EffortFamily =
	| 'running'
	| 'cycling'
	| 'ebike'
	| 'strength'
	| 'yoga'
	| 'walking'
	| 'hiking'
	| 'swimming'
	| 'other';

export interface WeeklyEffortMetric {
	total: number;
	byFamily: Partial<Record<EffortFamily, number>>;
	byDay: number[];
	hrCoveragePct: number;
	workoutCount: number;
	baseline?: { p4wAvg: number; delta: number };
}

export interface PeriodMetrics {
	weight?: { avg?: number; min?: number; max?: number; change?: number };
	steps?: { sum?: number; avg?: number; max?: number };
	sleep?: { avg?: number; min?: number; max?: number };
	workouts?: { count?: number; totalDuration?: number; types?: Record<string, number> };
	intenseMinutes?: { sum?: number; avg?: number };
	heartRate?: { avg?: number; min?: number; max?: number };
	sleepHeartRate?: { avg?: number; min?: number; max?: number };
	sleepLag?: number;
	earlyWake?: number;
	weeklyEffort?: WeeklyEffortMetric;
	screenTime?: {
		totalMinutes: number;
		avgPerDayMinutes: number;
		maxDayMinutes: number;
		socialMinutes: number;
		socialAvgPerDayMinutes: number;
		byCategory: Record<string, number>;
		byHour: number[];
		socialByHour: number[];
		dayCount: number;
		hourlyDayCount: number;
	};
}

export interface AggregatePeriod {
	period: string;
	periodKey: string;
	eventCount: number;
	startDate?: string | Date;
	endDate?: string | Date;
	metrics?: PeriodMetrics | null;
}

export interface Goal {
	id: string;
	title: string;
	status: string;
	description?: string | null;
	metadata?: Record<string, unknown>;
}

export interface WorkoutEvidence {
	eventId: string;
	hasTrackPoints: boolean;
	provider: string;
	sensorType: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	avgHeartRate: number | null;
}

export interface WorkoutActivity {
	activityId: string;
	startTime: string;
	sportType: string;
	distanceMeters: number | null;
	durationSeconds: number | null;
	paceSecondsPerKm: number | null;
	elevationMeters: number | null;
	avgHeartRate: number | null;
	maxHeartRate: number | null;
	sources: string[];
	evidence: WorkoutEvidence[];
}

export interface MetricThreshold {
	goal?: number;
	thresholdWarn?: number;
	thresholdSuccess?: number;
}

export interface MetricSettingsMap {
	distance?: MetricThreshold;
	sleep?: MetricThreshold;
	sleepLag?: MetricThreshold;
	steps?: MetricThreshold;
	activeMinutes?: MetricThreshold;
	weight?: MetricThreshold;
}

export interface ThemeWidget {
	id: string;
	title: string;
	unit: string;
	color: string;
	pinned: boolean;
	metricType: string;
	aggregation: string;
	period: string;
	range: string;
	sortOrder: number;
}

export type ProgramSummary = {
	id: string;
	name: string;
	goal: string;
	durationWeeks: number;
	sessionsPerWeek: number;
	status: 'active' | 'paused' | 'completed' | 'archived';
	completedSessions: number;
	totalSessions: number;
};

export type TodaySession = {
	id: string;
	name: string;
	kind: 'strength' | 'run';
	dayNumber: number;
	isTest?: boolean;
} | null;

export interface RecentEvent {
	id: string;
	timestamp: string;
	dataType: string;
	data: Record<string, unknown>;
}

export interface SourceItem {
	id: string;
	name: string;
	provider: string;
	isActive: boolean;
	lastSync: string | null;
}

// ── Pure helpers ────────────────────────────────────────────

export function formatMetric(value: number | undefined, decimals = 1): string {
	if (value === undefined || value === null) return '–';
	return value.toFixed(decimals);
}

export function formatDate(value: string): string {
	return new Intl.DateTimeFormat('nb-NO', {
		day: '2-digit',
		month: '2-digit',
		hour: '2-digit',
		minute: '2-digit'
	}).format(new Date(value));
}

export function formatSigned(value: number | undefined, unit: string, decimals = 1) {
	if (value == null) return '–';
	const sign = value > 0 ? '+' : '';
	return `${sign}${value.toFixed(decimals)} ${unit}`;
}

export function describeWindow(mode: WindowMode): string {
	if (mode === '7d') return 'siste 7 dager';
	if (mode === '30d') return 'siste 30 dager';
	if (mode === '365d') return 'siste 365 dager';
	if (mode === 'week') return 'denne uken';
	if (mode === 'month') return 'denne måneden';
	return 'i år';
}

export function windowStart(mode: WindowMode): Date {
	const now = new Date();
	if (mode === '7d') {
		const d = new Date(now);
		d.setDate(d.getDate() - 6);
		d.setHours(0, 0, 0, 0);
		return d;
	}
	if (mode === '30d') {
		const d = new Date(now);
		d.setDate(d.getDate() - 29);
		d.setHours(0, 0, 0, 0);
		return d;
	}
	if (mode === '365d') {
		const d = new Date(now);
		d.setDate(d.getDate() - 364);
		d.setHours(0, 0, 0, 0);
		return d;
	}
	if (mode === 'week') {
		const d = new Date(now);
		const day = d.getDay();
		const mondayShift = day === 0 ? 6 : day - 1;
		d.setDate(d.getDate() - mondayShift);
		d.setHours(0, 0, 0, 0);
		return d;
	}
	if (mode === 'month') {
		const d = new Date(now.getFullYear(), now.getMonth(), 1);
		d.setHours(0, 0, 0, 0);
		return d;
	}
	const d = new Date(now.getFullYear(), 0, 1);
	d.setHours(0, 0, 0, 0);
	return d;
}

export function daysInWindow(mode: WindowMode): number {
	if (mode === '7d') return 7;
	if (mode === '30d') return 30;
	if (mode === '365d') return 365;
	const now = new Date();
	const start = windowStart(mode);
	const diff = now.getTime() - start.getTime();
	return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1);
}

// ── Event extraction ────────────────────────────────────────

function extractNumber(record: Record<string, unknown>, keys: string[]): number | null {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'number' && Number.isFinite(value)) return value;
	}
	return null;
}

export function extractRunningDistanceKm(event: { dataType: string; data: Record<string, unknown> }): number | null {
	if (event.dataType !== 'workout') return null;
	const sportType = typeof event.data.sportType === 'string' ? event.data.sportType.toLowerCase() : '';
	if (sportType && sportType !== 'running') return null;

	const raw = extractNumber(event.data, ['distance', 'distanceMeters', 'runDistance', 'runningDistance']);
	if (raw == null) return null;
	if (raw > 80) return raw / 1000;
	return raw;
}

function extractSleepHours(event: { dataType: string; data: Record<string, unknown> }): number | null {
	if (event.dataType !== 'sleep') return null;
	const raw = extractNumber(event.data, ['sleepDuration', 'duration']);
	if (raw == null) return null;
	if (raw > 100) return raw / 3600;
	return raw;
}

function extractSteps(event: { dataType: string; data: Record<string, unknown> }): number | null {
	if (event.dataType !== 'activity') return null;
	return extractNumber(event.data, ['steps']);
}

function extractIntenseMinutes(event: { dataType: string; data: Record<string, unknown> }): number | null {
	if (event.dataType !== 'activity') return null;
	const intense = extractNumber(event.data, ['intense']) ?? 0;
	const moderate = extractNumber(event.data, ['moderate']) ?? 0;
	if (intense > 0 || moderate > 0) return (intense + moderate) / 60;
	const minutes = extractNumber(event.data, ['intenseMinutes', 'activeMinutes', 'moderateToVigorousMinutes']);
	if (minutes != null) return minutes;
	const seconds = extractNumber(event.data, ['intenseSeconds']);
	return seconds != null ? seconds / 60 : null;
}

function extractWeight(event: { dataType: string; data: Record<string, unknown> }): number | null {
	if (event.dataType !== 'weight') return null;
	return extractNumber(event.data, ['weight']);
}

// ── Metric computation helpers ──────────────────────────────

export function pctHigherBetter(value: number | undefined, target: number): number {
	if (value == null) return 50;
	return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
}

export function pctLowerBetter(value: number | undefined, targetMax: number): number {
	if (value == null) return 50;
	const ratio = Math.max(0, Math.min(1, value / targetMax));
	return Math.round((1 - ratio) * 100);
}

export function runningColorFromRatio(ratio: number): string {
	if (ratio >= 1) return '#82c882';
	if (ratio >= 0.7) return '#f0b429';
	return '#e07070';
}

export function computeSleepHoursAvg(
	mode: WindowMode,
	events: Array<{ dataType: string; data: Record<string, unknown> }>,
	metrics: PeriodMetrics | null | undefined
): number | undefined {
	if (mode === 'week' || mode === 'month' || mode === 'year') {
		return metrics?.sleep?.avg;
	}
	const values = events
		.map((event) => extractSleepHours(event))
		.filter((value): value is number => value != null);
	if (!values.length) return undefined;
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function computeAvgStepsPerDay(
	mode: WindowMode,
	events: Array<{ dataType: string; data: Record<string, unknown> }>,
	metrics: PeriodMetrics | null | undefined,
	days: number
): number | undefined {
	if (mode === 'week' || mode === 'month' || mode === 'year') return metrics?.steps?.avg;
	const total = events.reduce((sum, event) => sum + (extractSteps(event) ?? 0), 0);
	return total / days;
}

export function computeAvgActiveMinutesPerDay(
	mode: WindowMode,
	events: Array<{ dataType: string; data: Record<string, unknown> }>,
	metrics: PeriodMetrics | null | undefined,
	days: number
): number | undefined {
	if (mode === 'week' || mode === 'month' || mode === 'year') {
		if (typeof metrics?.intenseMinutes?.avg === 'number') return metrics.intenseMinutes.avg;
		if (typeof metrics?.intenseMinutes?.sum === 'number') return metrics.intenseMinutes.sum / days;
		return undefined;
	}
	const total = events.reduce((sum, event) => sum + (extractIntenseMinutes(event) ?? 0), 0);
	return total / days;
}

export function computeWeightDelta(
	mode: WindowMode,
	events: Array<{ timestamp: string; dataType: string; data: Record<string, unknown> }>,
	metrics: PeriodMetrics | null | undefined
): number | undefined {
	if (mode === 'week' || mode === 'month' || mode === 'year') return metrics?.weight?.change;
	const values = events
		.map((event) => ({ ts: event.timestamp, value: extractWeight(event) }))
		.filter((item): item is { ts: string; value: number } => item.value != null)
		.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
	if (values.length < 2) return undefined;
	return values[values.length - 1].value - values[0].value;
}

export function evaluateWeightProgress(actualDelta: number | undefined, projectedTarget: number): number {
	if (actualDelta == null || projectedTarget === 0) return 0;
	if (projectedTarget < 0) {
		const effectiveActual = Math.min(0, actualDelta);
		return Math.abs(effectiveActual) / Math.abs(projectedTarget);
	}
	const effectiveActual = Math.max(0, actualDelta);
	return Math.abs(effectiveActual) / Math.abs(projectedTarget);
}

// ── Format event for CompactRecordList ──────────────────────

export function formatEvent(item: RecentEvent) {
	if (item.dataType === 'weight') {
		const weight = typeof item.data.weight === 'number' ? item.data.weight : null;
		return {
			id: item.id,
			title: 'Vektmåling',
			subtitle: weight != null ? `${weight.toFixed(1)} kg` : 'Måling registrert',
			meta: formatDate(item.timestamp)
		};
	}

	if (item.dataType === 'sleep') {
		const sleepDuration = typeof item.data.sleepDuration === 'number' ? item.data.sleepDuration : null;
		return {
			id: item.id,
			title: 'Søvn',
			subtitle: sleepDuration != null ? `${(sleepDuration / 3600).toFixed(1)} timer` : 'Søvndata registrert',
			meta: formatDate(item.timestamp)
		};
	}

	if (item.dataType === 'activity') {
		const steps = typeof item.data.steps === 'number' ? item.data.steps : null;
		return {
			id: item.id,
			title: 'Aktivitet',
			subtitle: steps != null ? `${steps.toLocaleString('nb-NO')} skritt` : 'Aktivitet registrert',
			meta: formatDate(item.timestamp)
		};
	}

	if (item.dataType === 'workout') {
		const duration = typeof item.data.duration === 'number' ? item.data.duration : null;
		const sportType = typeof item.data.sportType === 'string' ? item.data.sportType : 'Økt';
		return {
			id: item.id,
			title: 'Treningsøkt',
			subtitle: duration != null ? `${sportType} · ${Math.round(duration / 60)} min` : sportType,
			meta: formatDate(item.timestamp)
		};
	}

	return {
		id: item.id,
		title: item.dataType,
		subtitle: 'Hendelse registrert',
		meta: formatDate(item.timestamp)
	};
}

// ── Quarter aggregation ─────────────────────────────────────

export function buildQuarterData(monthly: AggregatePeriod[]): AggregatePeriod[] {
	const byQuarter = new Map<string, AggregatePeriod[]>();
	for (const m of monthly) {
		const [year, monthStr] = m.periodKey.split('M');
		const q = Math.ceil(parseInt(monthStr) / 3);
		const key = `${year}Q${q}`;
		if (!byQuarter.has(key)) byQuarter.set(key, []);
		byQuarter.get(key)!.push(m);
	}
	const quarters: AggregatePeriod[] = [];
	for (const [key, months] of byQuarter) {
		const sleepHRs = months.flatMap((m) => {
			const v = m.metrics?.sleepHeartRate?.avg;
			return v !== undefined ? [v] : [];
		});
		const intenseSum = months.reduce((s, m) => s + (m.metrics?.intenseMinutes?.sum ?? 0), 0);
		const runSum = months.reduce((s, m) => s + (m.metrics?.workouts?.types?.running ?? 0), 0);
		const weightChanges = months.flatMap((m) => {
			const v = m.metrics?.weight?.change;
			return v !== undefined ? [v] : [];
		});
		const sleepAvgs = months.flatMap((m) => {
			const v = m.metrics?.sleep?.avg;
			return v !== undefined ? [v] : [];
		});
		const qMetrics: PeriodMetrics = {
			intenseMinutes: intenseSum > 0 ? { sum: intenseSum } : undefined,
			workouts: runSum > 0 ? { types: { running: runSum } } : undefined,
			weight:
				weightChanges.length > 0
					? { change: weightChanges.reduce((a, b) => a + b, 0) }
					: undefined,
			sleep:
				sleepAvgs.length > 0
					? { avg: sleepAvgs.reduce((a, b) => a + b, 0) / sleepAvgs.length }
					: undefined,
			sleepHeartRate:
				sleepHRs.length > 0
					? { avg: sleepHRs.reduce((a, b) => a + b, 0) / sleepHRs.length }
					: undefined
		};
		const start = months[months.length - 1]?.startDate;
		const end = months[0]?.endDate;
		quarters.push({
			period: 'quarter',
			periodKey: key,
			eventCount: months.reduce((s, m) => s + m.eventCount, 0),
			startDate: start,
			endDate: end,
			metrics: qMetrics
		});
	}
	return quarters.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
}

// ── Effort period aggregation ───────────────────────────────

export function computeEffortPeriodRange(selectedWindow: WindowMode): { start: Date; end: Date; label: string } | null {
	const effortPeriodMode = selectedWindow === '7d' || selectedWindow === 'week' ? 'daily' : 'weekly';
	if (effortPeriodMode === 'daily') return null;

	const now = new Date();
	if (selectedWindow === '30d') {
		const start = new Date(now);
		start.setDate(start.getDate() - 30);
		return { start, end: now, label: 'Siste 30 dager' };
	}
	if (selectedWindow === '365d') {
		const start = new Date(now);
		start.setDate(start.getDate() - 365);
		return { start, end: now, label: 'Siste 365 dager' };
	}
	if (selectedWindow === 'month') {
		const start = new Date(now.getFullYear(), now.getMonth(), 1);
		const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
		const label = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric' }).format(now);
		return { start, end, label };
	}
	if (selectedWindow === 'quarter') {
		const q = Math.floor(now.getMonth() / 3);
		const start = new Date(now.getFullYear(), q * 3, 1);
		const end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
		return { start, end, label: `Q${q + 1} ${now.getFullYear()}` };
	}
	if (selectedWindow === 'year') {
		const start = new Date(now.getFullYear(), 0, 1);
		const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
		return { start, end, label: `${now.getFullYear()}` };
	}
	return null;
}

export function aggregateEffortForPeriod(
	weekly: AggregatePeriod[],
	range: { start: Date; end: Date; label: string }
) {
	const weeksInRange = weekly.filter((w) => {
		if (!w.metrics?.weeklyEffort) return false;
		const wStart = w.startDate ? new Date(w.startDate) : null;
		const wEnd = w.endDate ? new Date(w.endDate) : null;
		if (!wStart || !wEnd) return false;
		return wEnd >= range.start && wStart <= range.end;
	});
	if (weeksInRange.length === 0) return null;

	let total = 0;
	let workoutCount = 0;
	let trimpWeighted = 0;
	const byFamily: Partial<Record<EffortFamily, number>> = {};
	const bars: { label: string; value: number }[] = [];

	for (const w of weeksInRange) {
		const eff = w.metrics!.weeklyEffort!;
		total += eff.total ?? 0;
		workoutCount += eff.workoutCount ?? 0;
		trimpWeighted += (eff.total ?? 0) * ((eff.hrCoveragePct ?? 0) / 100);
		for (const [family, value] of Object.entries(eff.byFamily ?? {})) {
			const v = value ?? 0;
			byFamily[family as EffortFamily] = (byFamily[family as EffortFamily] ?? 0) + v;
		}
		const weekNum = w.periodKey.split('W')[1] ?? '';
		bars.push({
			label: weekNum ? `U${parseInt(weekNum, 10)}` : '',
			value: eff.total ?? 0
		});
	}

	const hrCoveragePct = total > 0 ? Math.round((trimpWeighted / total) * 100) : 0;
	const rangeDays = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86400000));
	const rangeWeeks = Math.max(1, rangeDays / 7);

	const ceilings: (number | null)[] = bars.map((_, i) =>
		i === 0 ? null : bars[i - 1].value > 0 ? bars[i - 1].value * 1.1 : null
	);

	return {
		total: Math.round(total * 10) / 10,
		perWeekAvg: Math.round((total / rangeWeeks) * 10) / 10,
		byFamily,
		bars,
		ceilings,
		hrCoveragePct,
		workoutCount,
		rangeLabel: range.label
	};
}

// ── Goal helpers ────────────────────────────────────────────

export const GOAL_COLORS: Record<string, string> = {
	active: '#7c8ef5',
	paused: '#888',
	completed: '#48b581',
	archived: '#444'
};

export function goalPct(goal: Goal): number {
	if (goal.status === 'completed') return 100;
	if (goal.status === 'paused') return 35;

	const metadata = goal.metadata as any;
	if (!metadata?.startDate || !metadata?.endDate || !metadata?.targetValue) return 0;

	const now = new Date();
	const start = new Date(metadata.startDate);
	const end = new Date(metadata.endDate || metadata.targetDate);

	if (now < start) return 0;
	if (now > end) return 100;

	const totalDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
	const elapsedDays = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
	const expectedProgress = (elapsedDays / totalDays) * 100;

	return Math.min(100, Math.max(0, Math.round(expectedProgress)));
}

export function goalDelta(
	goal: Goal,
	recentEvents: RecentEvent[]
): { value: number; unit: string } | null {
	const metadata = goal.metadata as any;
	if (!metadata?.metricId || !metadata?.targetValue) return null;

	if (metadata.metricId === 'running_distance' && recentEvents) {
		const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date(0);
		const endDate = metadata.endDate ? new Date(metadata.endDate) : new Date();
		const now = new Date();

		const runningEvents = recentEvents.filter((e) => {
			const eventDate = new Date(e.timestamp);
			return e.dataType === 'workout' && eventDate >= startDate && eventDate <= now;
		});

		let totalKm = 0;
		for (const event of runningEvents) {
			const sportType =
				typeof event.data.sportType === 'string' ? event.data.sportType.toLowerCase() : '';
			if (sportType && sportType !== 'running') continue;

			const distance =
				typeof event.data.distance === 'number'
					? event.data.distance
					: typeof event.data.distanceMeters === 'number'
						? event.data.distanceMeters
						: null;

			if (distance !== null) {
				totalKm += distance > 80 ? distance / 1000 : distance;
			}
		}

		const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
		const elapsedDays = Math.min(
			totalDays,
			(now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
		);
		const expectedKm = (elapsedDays / totalDays) * metadata.targetValue;

		const delta = totalKm - expectedKm;
		return { value: delta, unit: 'km' };
	}

	if (metadata.metricId === 'weight_change' && recentEvents) {
		const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date(0);
		const now = new Date();

		const weightEvents = recentEvents
			.filter((e) => e.dataType === 'weight' && new Date(e.timestamp) >= startDate)
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

		if (weightEvents.length === 0) return null;

		const latestWeight =
			typeof weightEvents[0].data.weight === 'number' ? weightEvents[0].data.weight : null;
		const startWeight = metadata.startValue;

		if (latestWeight === null || startWeight === null) return null;

		const actualChange = latestWeight - startWeight;
		const targetChange = metadata.targetValue;

		const totalDays = metadata.endDate
			? (new Date(metadata.endDate).getTime() - new Date(startDate).getTime()) /
				(1000 * 60 * 60 * 24)
			: 90;
		const elapsedDays = Math.min(
			totalDays,
			(now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
		);
		const expectedChange = (elapsedDays / totalDays) * targetChange;

		const delta = actualChange - expectedChange;
		return { value: delta, unit: 'kg' };
	}

	return null;
}

// ── Metric card builder ─────────────────────────────────────

export interface MetricCard {
	id: string;
	metricId?: string;
	label: string;
	value: string;
	subvalue: string;
	color: string;
	pct: number;
	vizData?: Record<string, unknown>;
}

export function buildMetricCards(opts: {
	runningKm: number;
	runningTrackMatch: { track: GoalTrack; score: number; reason: string } | null;
	runningTargetForWindow: number;
	runningPct: number;
	runningRingColor: string;
	sleepHoursAvg: number | undefined;
	sleepGoal: number;
	sleepLagComposite: number | undefined;
	sleepLagMax: number;
	avgStepsPerDay: number | undefined;
	stepsGoal: number;
	stepsReferenceAvg: number | undefined;
	stepsComparisonPoints: Array<{ label: string; current: number; reference: number }>;
	avgActiveMinutesPerDay: number | undefined;
	activeMinutesGoal: number;
	weightDelta: number | undefined;
	weightTrackMatch: { track: GoalTrack; score: number; reason: string } | null;
	weightProgressColor: string;
	weightProgressPct: number;
	weightProjectedTarget: number;
	windowCopy: string;
}): MetricCard[] {
	const {
		runningKm, runningTrackMatch, runningTargetForWindow, runningPct, runningRingColor,
		sleepHoursAvg, sleepGoal, sleepLagComposite, sleepLagMax,
		avgStepsPerDay, stepsGoal, stepsReferenceAvg, stepsComparisonPoints,
		avgActiveMinutesPerDay, activeMinutesGoal,
		weightDelta, weightTrackMatch, weightProgressColor, weightProgressPct, weightProjectedTarget,
		windowCopy
	} = opts;

	return [
		{
			id: 'running_distance',
			label: 'Løping',
			value: runningKm > 0 ? `${runningKm.toFixed(1)} km` : '–',
			subvalue: runningKm > 0
				? runningTrackMatch
					? `${windowCopy}: ${runningKm.toFixed(1)} km · mål ${runningTargetForWindow.toFixed(1)} km`
					: `${windowCopy}: totalt løpt i perioden`
				: `${windowCopy}: ingen løpsdata registrert`,
			color: runningRingColor,
			pct: runningPct
		},
		{
			id: 'sleep_avg_night',
			metricId: 'sleep_avg_night',
			label: 'Søvn per natt',
			value: sleepHoursAvg != null ? `${formatMetric(sleepHoursAvg)} t` : '–',
			subvalue:
				sleepHoursAvg != null
					? `${windowCopy}: snitt timer søvn per natt (mål ${sleepGoal} t)`
					: `${windowCopy}: ingen søvndata registrert`,
			color: '#5fa0a0',
			pct: pctHigherBetter(sleepHoursAvg, sleepGoal),
			vizData: {
				current: sleepHoursAvg ?? null,
				target: sleepGoal
			}
		},
		{
			id: 'sleep_lag',
			label: 'Søvnavvik',
			value: sleepLagComposite != null ? `${formatMetric(sleepLagComposite, 1)} t` : '–',
			subvalue:
				sleepLagComposite != null
					? `${windowCopy}: avvik i døgnrytme (lavere er bedre)`
					: `${windowCopy}: ikke nok data til avviksberegning`,
			color: '#7b9aa8',
			pct: pctLowerBetter(sleepLagComposite, sleepLagMax)
		},
		{
			id: 'steps_avg_day',
			metricId: 'steps_avg_day',
			label: 'Skritt per dag',
			value: avgStepsPerDay != null ? `${formatMetric(avgStepsPerDay, 0)}` : '–',
			subvalue:
				avgStepsPerDay != null
					? `${windowCopy}: dagssnitt (mål ${formatMetric(stepsGoal, 0)})`
					: `${windowCopy}: ingen aktivitetsdata registrert`,
			color: '#82c882',
			pct: pctHigherBetter(avgStepsPerDay, stepsGoal),
			vizData: {
				current: avgStepsPerDay ?? null,
				expectedByNow: stepsReferenceAvg,
				comparisonSeries: stepsComparisonPoints
			}
		},
		{
			id: 'active_minutes_avg_day',
			label: 'Aktive minutter per dag',
			value: avgActiveMinutesPerDay != null ? `${formatMetric(avgActiveMinutesPerDay, 0)} min` : '–',
			subvalue:
				avgActiveMinutesPerDay != null
					? `${windowCopy}: dagssnitt (mål ${activeMinutesGoal} min)`
					: `${windowCopy}: ingen trenings-/aktivitetstid registrert`,
			color: '#f0b429',
			pct: pctHigherBetter(avgActiveMinutesPerDay, activeMinutesGoal)
		},
		{
			id: 'weight_change',
			label: 'Vektendring',
			value: formatSigned(weightDelta, 'kg', 2),
			subvalue: weightTrackMatch
				? `${windowCopy}: ${formatSigned(weightDelta, 'kg', 2)} · mål ${formatSigned(weightProjectedTarget, 'kg', 2)}`
				: `${windowCopy}: pluss/minus i perioden`,
			color: weightTrackMatch ? weightProgressColor : weightDelta == null ? '#7c8ef5' : weightDelta <= 0 ? '#82c882' : '#e07070',
			pct: weightTrackMatch ? weightProgressPct : weightDelta == null ? 50 : pctLowerBetter(Math.abs(weightDelta), 2)
		}
	];
}

// ── Running / weight track builders ─────────────────────────

export function buildRunningTrackSet(weekInput: string, quarterInput: string, yearInput: string): GoalTrack[] {
	const tracks = defaultV1GoalTracks();

	const weekTarget = Number.parseFloat(weekInput.replace(',', '.'));
	if (Number.isFinite(weekTarget) && weekTarget > 0) tracks[0].targetValue = weekTarget;

	const quarterTarget = Number.parseFloat(quarterInput.replace(',', '.'));
	if (Number.isFinite(quarterTarget) && quarterTarget > 0) tracks[1].targetValue = quarterTarget;

	const yearTarget = Number.parseFloat(yearInput.replace(',', '.'));
	if (Number.isFinite(yearTarget) && yearTarget > 0) tracks[2].targetValue = yearTarget;

	return tracks;
}

export function buildWeightTrackSet(shortInput: string, longInput: string): GoalTrack[] {
	const shortTarget = Number.parseFloat(shortInput.replace(',', '.'));
	const longTarget = Number.parseFloat(longInput.replace(',', '.'));

	const shortTrack: GoalTrack = {
		id: 'weight-short',
		metricId: 'weight_change',
		label: 'Vektmål 2 måneder',
		kind: 'change',
		window: 'custom',
		durationDays: 60,
		targetValue: Number.isFinite(shortTarget) ? shortTarget : -3,
		unit: 'kg',
		priority: 100
	};

	const longTrack: GoalTrack = {
		id: 'weight-long',
		metricId: 'weight_change',
		label: 'Vektmål 2 år',
		kind: 'trajectory',
		window: 'custom',
		durationDays: 730,
		targetValue: Number.isFinite(longTarget) ? longTarget : -20,
		unit: 'kg',
		priority: 95
	};

	return [shortTrack, longTrack];
}

export function toWidgetWindow(selectedWindow: WindowMode): WidgetWindow {
	return selectedWindow === '7d'
		? '7d'
		: selectedWindow === '30d'
			? '30d'
			: selectedWindow === '365d'
				? '365d'
				: selectedWindow;
}

export { selectGoalTrackForWidget, evaluateProgress, projectTrackTargetForWindow, computeTrainingLoad };
export type { GoalTrack, WidgetWindow };
