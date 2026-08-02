/**
 * health-data.ts — derived data computations, types, and helpers
 * extracted from HealthDashboard to keep the parent lean.
 */

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

export { computeTrainingLoad };
