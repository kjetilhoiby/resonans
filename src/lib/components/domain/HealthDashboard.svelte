<script lang="ts">
	import { onMount } from 'svelte';
	import {
		defaultV1GoalTracks,
		evaluateProgress,
		projectTrackTargetForWindow,
		selectGoalTrackForWidget,
		type GoalTrack,
		type WidgetWindow
	} from '$lib/domain/goal-tracks';
	import CompactRecordList from '../ui/CompactRecordList.svelte';
	import GoalRing from '../ui/GoalRing.svelte';
	import PeriodPills from '../ui/PeriodPills.svelte';
	import DynamicWidget from '../composed/DynamicWidget.svelte';
	import ScreenTimeCard from '../composed/ScreenTimeCard.svelte';
	import { computeTrainingLoad } from '$lib/util/training-load';
	import HealthActivityList from './health/HealthActivityList.svelte';
	import HealthEffortSection from './health/HealthEffortSection.svelte';
	import HealthMetricGrid from './health/HealthMetricGrid.svelte';

	type WindowMode = '7d' | '30d' | '365d' | 'week' | 'month' | 'year' | 'quarter';

	type EffortFamily =
		| 'running'
		| 'cycling'
		| 'ebike'
		| 'strength'
		| 'yoga'
		| 'walking'
		| 'hiking'
		| 'swimming'
		| 'other';

	interface WeeklyEffortMetric {
		total: number;
		byFamily: Partial<Record<EffortFamily, number>>;
		byDay: number[];
		hrCoveragePct: number;
		workoutCount: number;
		baseline?: { p4wAvg: number; delta: number };
	}

	interface PeriodMetrics {
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

	interface AggregatePeriod {
		period: string;
		periodKey: string;
		eventCount: number;
		startDate?: string | Date;
		endDate?: string | Date;
		metrics?: PeriodMetrics | null;
	}

	interface Goal {
		id: string;
		title: string;
		status: string;
		description?: string | null;
		metadata?: Record<string, unknown>;
	}

	interface WorkoutEvidence {
		eventId: string;
		hasTrackPoints: boolean;
		provider: string;
		sensorType: string;
		distanceMeters: number | null;
		durationSeconds: number | null;
		avgHeartRate: number | null;
	}

	interface WorkoutActivity {
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

	interface MetricThreshold {
		goal?: number;
		thresholdWarn?: number;
		thresholdSuccess?: number;
	}

	interface MetricSettingsMap {
		distance?: MetricThreshold;
		sleep?: MetricThreshold;
		sleepLag?: MetricThreshold;
		steps?: MetricThreshold;
		activeMinutes?: MetricThreshold;
		weight?: MetricThreshold;
	}

	interface ThemeWidget {
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

	interface Props {
		weekly: AggregatePeriod[];
		monthly: AggregatePeriod[];
		yearly: AggregatePeriod[];
		dailyEffort?: Array<{ date: string; effort: number }>;
		sources?: Array<{ id: string; name: string; provider: string; isActive: boolean; lastSync: string | null }>;
		recentEvents?: Array<{ id: string; timestamp: string; dataType: string; data: Record<string, unknown> }>;
		tooling?: {
			querySensorDataTool: boolean;
			tables: { sensorEvents: string; sensorAggregates: string };
			weightEventCount: number;
			weightAggregateCount: number;
			healthSensorsCount: number;
		};
		embedded?: boolean;
		goals?: Goal[];
		activities?: WorkoutActivity[];
		metricSettings?: MetricSettingsMap;
		themeId?: string;
	}

	let { weekly, monthly, yearly, dailyEffort = [], sources = [], recentEvents = [], tooling, embedded = false, goals = [], activities = [], metricSettings = {}, themeId }: Props = $props();

	// Skjermtid: de to nyeste ukene med skjermtid-data (for snitt + endring fra forrige uke).
	const screenWeeks = $derived(
		[...weekly]
			.filter((w) => w.metrics?.screenTime)
			.sort((a, b) => (a.periodKey < b.periodKey ? 1 : -1))
	);
	const thisWeekScreen = $derived(screenWeeks[0]?.metrics?.screenTime ?? null);
	const prevWeekScreen = $derived(screenWeeks[1]?.metrics?.screenTime ?? null);

	let themeWidgets = $state<ThemeWidget[]>([]);
	let themeWidgetsLoading = $state(true);

	type ProgramSummary = {
		id: string;
		name: string;
		goal: string;
		durationWeeks: number;
		sessionsPerWeek: number;
		status: 'active' | 'paused' | 'completed' | 'archived';
		completedSessions: number;
		totalSessions: number;
	};
	type TodaySession = {
		id: string;
		name: string;
		kind: 'strength' | 'run';
		dayNumber: number;
		isTest?: boolean;
	} | null;
	let activeProgram = $state<ProgramSummary | null>(null);
	let todaySession = $state<TodaySession>(null);
	let programWidgetLoading = $state(true);

	onMount(async () => {
		try {
			const res = await fetch('/api/apps/programs');
			if (!res.ok) {
				programWidgetLoading = false;
				return;
			}
			const body = (await res.json()) as { programs?: ProgramSummary[] };
			const active = body.programs?.find((p) => p.status === 'active') ?? null;
			activeProgram = active;
			if (active) {
				const todayRes = await fetch(`/api/apps/programs/${active.id}/today`);
				if (todayRes.ok) {
					const todayBody = await todayRes.json();
					todaySession = todayBody.session ?? null;
				}
			}
		} catch {
			// Stille feil — widget skjules
		} finally {
			programWidgetLoading = false;
		}
	});

	let selectedWindow = $state<WindowMode>('30d');
	let runningGoalWeekInput = $state('20');
	let runningGoalQuarterInput = $state('150');
	let runningGoalYearInput = $state('1000');
	let weightGoalShortInput = $state('-3');
	let weightGoalLongInput = $state('-20');
	let showEventDetails = $state(false);

	const aggregatePeriod = $derived<'week' | 'month' | 'year'>(
		selectedWindow === '30d' || selectedWindow === 'month' || selectedWindow === 'quarter' ? 'month' :
		selectedWindow === '365d' || selectedWindow === 'year' ? 'year' :
		'week'
	);

	// Mapping fra HealthDashboard-vinduet til widget-API'ets range-streng.
	// Holder seg på rullende vinduer for korte perioder og kalender-vinduer for uke/måned/år.
	const widgetRange = $derived<string>(
		selectedWindow === '7d' ? 'last7'
		: selectedWindow === '30d' ? 'last30'
		: selectedWindow === '365d' ? 'last365'
		: selectedWindow === 'week' ? 'current_week'
		: selectedWindow === 'month' ? 'current_month'
		: selectedWindow === 'quarter' ? 'last90'
		: 'current_year'
	);

	const quarterData = $derived.by<AggregatePeriod[]>(() => {
		const quarters: AggregatePeriod[] = [];
		const byQuarter = new Map<string, AggregatePeriod[]>();
		for (const m of monthly) {
			const [year, monthStr] = m.periodKey.split('M');
			const q = Math.ceil(parseInt(monthStr) / 3);
			const key = `${year}Q${q}`;
			if (!byQuarter.has(key)) byQuarter.set(key, []);
			byQuarter.get(key)!.push(m);
		}
		for (const [key, months] of byQuarter) {
			const sleepHRs = months.flatMap(m => {
				const v = m.metrics?.sleepHeartRate?.avg;
				return v !== undefined ? [v] : [];
			});
			const intenseSum = months.reduce((s, m) => s + (m.metrics?.intenseMinutes?.sum ?? 0), 0);
			const runSum = months.reduce((s, m) => s + (m.metrics?.workouts?.types?.running ?? 0), 0);
			const weightChanges = months.flatMap(m => {
				const v = m.metrics?.weight?.change;
				return v !== undefined ? [v] : [];
			});
			const sleepAvgs = months.flatMap(m => {
				const v = m.metrics?.sleep?.avg;
				return v !== undefined ? [v] : [];
			});
			const qMetrics: PeriodMetrics = {
				intenseMinutes: intenseSum > 0 ? { sum: intenseSum } : undefined,
				workouts: runSum > 0 ? { types: { running: runSum } } : undefined,
				weight: weightChanges.length > 0 ? { change: weightChanges.reduce((a, b) => a + b, 0) } : undefined,
				sleep: sleepAvgs.length > 0 ? { avg: sleepAvgs.reduce((a, b) => a + b, 0) / sleepAvgs.length } : undefined,
				sleepHeartRate: sleepHRs.length > 0 ? { avg: sleepHRs.reduce((a, b) => a + b, 0) / sleepHRs.length } : undefined
			};
			const start = months[months.length - 1]?.startDate;
			const end = months[0]?.endDate;
			quarters.push({ period: 'quarter', periodKey: key, eventCount: months.reduce((s, m) => s + m.eventCount, 0), startDate: start, endDate: end, metrics: qMetrics });
		}
		return quarters.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
	});

	const periodData = $derived(
		selectedWindow === 'quarter' ? quarterData :
		aggregatePeriod === 'week' ? weekly : aggregatePeriod === 'month' ? monthly : yearly
	);
	const lastPeriod = $derived(periodData.length ? periodData[periodData.length - 1] : null);
	const lastMetrics = $derived(lastPeriod?.metrics ?? null);

	const trainingLoadSeries = $derived(computeTrainingLoad(dailyEffort));

	const latestWeekWithEffort = $derived(
		[...weekly].reverse().find((w) => w.metrics?.weeklyEffort) ?? null
	);
	const latestWeeklyEffort = $derived(latestWeekWithEffort?.metrics?.weeklyEffort ?? null);
	const latestWeekLabel = $derived.by(() => {
		if (!latestWeekWithEffort) return undefined;
		const start = latestWeekWithEffort.startDate ? new Date(latestWeekWithEffort.startDate) : null;
		const end = latestWeekWithEffort.endDate ? new Date(latestWeekWithEffort.endDate) : null;
		if (!start || !end) return latestWeekWithEffort.periodKey;
		const fmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' });
		return `${fmt.format(start)}–${fmt.format(end)}`;
	});

	const effortPeriodMode = $derived<'daily' | 'weekly'>(
		selectedWindow === '7d' || selectedWindow === 'week' ? 'daily' : 'weekly'
	);

	const effortPeriodRange = $derived.by(() => {
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
	});

	const periodEffortAggregate = $derived.by(() => {
		const range = effortPeriodRange;
		if (!range) return null;
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
	});


	const GOAL_COLORS: Record<string, string> = {
		active: '#7c8ef5',
		paused: '#888',
		completed: '#48b581',
		archived: '#444'
	};

	let editingGoalId = $state<string | null>(null);
	let deletingGoalId = $state<string | null>(null);

	function goalPct(goal: Goal): number {
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
	
	function goalDelta(goal: Goal): { value: number; unit: string } | null {
		const metadata = goal.metadata as any;
		if (!metadata?.metricId || !metadata?.targetValue) return null;
		
		if (metadata.metricId === 'running_distance' && recentEvents) {
			const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date(0);
			const endDate = metadata.endDate ? new Date(metadata.endDate) : new Date();
			const now = new Date();
			
			const runningEvents = recentEvents.filter(e => {
				const eventDate = new Date(e.timestamp);
				return e.dataType === 'workout' && 
				       eventDate >= startDate && 
				       eventDate <= now;
			});
			
			let totalKm = 0;
			for (const event of runningEvents) {
				const sportType = typeof event.data.sportType === 'string' ? event.data.sportType.toLowerCase() : '';
				if (sportType && sportType !== 'running') continue;
				
				const distance = typeof event.data.distance === 'number' ? event.data.distance : 
				                 typeof event.data.distanceMeters === 'number' ? event.data.distanceMeters : null;
				
				if (distance !== null) {
					totalKm += distance > 80 ? distance / 1000 : distance;
				}
			}
			
			const totalDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
			const elapsedDays = Math.min(totalDays, (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
			const expectedKm = (elapsedDays / totalDays) * metadata.targetValue;
			
			const delta = totalKm - expectedKm;
			return { value: delta, unit: 'km' };
		}
		
		if (metadata.metricId === 'weight_change' && recentEvents) {
			const startDate = metadata.startDate ? new Date(metadata.startDate) : new Date(0);
			const now = new Date();
			
			const weightEvents = recentEvents
				.filter(e => e.dataType === 'weight' && new Date(e.timestamp) >= startDate)
				.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
			
			if (weightEvents.length === 0) return null;
			
			const latestWeight = typeof weightEvents[0].data.weight === 'number' ? weightEvents[0].data.weight : null;
			const startWeight = metadata.startValue;
			
			if (latestWeight === null || startWeight === null) return null;
			
			const actualChange = latestWeight - startWeight;
			const targetChange = metadata.targetValue;
			
			const totalDays = metadata.endDate ? 
				(new Date(metadata.endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24) : 90;
			const elapsedDays = Math.min(totalDays, (now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
			const expectedChange = (elapsedDays / totalDays) * targetChange;
			
			const delta = actualChange - expectedChange;
			return { value: delta, unit: 'kg' };
		}
		
		return null;
	}

	async function deleteGoal(goalId: string) {
		try {
			const response = await fetch(`/api/goals/${goalId}`, {
				method: 'DELETE'
			});
			if (!response.ok) throw new Error('Failed to delete goal');
			window.location.reload();
		} catch (err) {
			console.error('Error deleting goal:', err);
		}
	}

	function formatMetric(value: number | undefined, decimals = 1): string {
		if (value === undefined || value === null) return '–';
		return value.toFixed(decimals);
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat('nb-NO', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(value));
	}

	function formatEvent(item: { id: string; timestamp: string; dataType: string; data: Record<string, unknown> }) {
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

	function windowStart(mode: WindowMode): Date {
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

	function daysInWindow(mode: WindowMode): number {
		if (mode === '7d') return 7;
		if (mode === '30d') return 30;
		if (mode === '365d') return 365;
		const now = new Date();
		const start = windowStart(mode);
		const diff = now.getTime() - start.getTime();
		return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)) + 1);
	}

	function extractNumber(record: Record<string, unknown>, keys: string[]): number | null {
		for (const key of keys) {
			const value = record[key];
			if (typeof value === 'number' && Number.isFinite(value)) return value;
		}
		return null;
	}

	function extractRunningDistanceKm(event: { dataType: string; data: Record<string, unknown> }): number | null {
		if (event.dataType !== 'workout') return null;
		const sportType = typeof event.data.sportType === 'string' ? event.data.sportType.toLowerCase() : '';
		if (sportType && sportType !== 'running') return null;

		const raw = extractNumber(event.data, ['distance', 'distanceMeters', 'runDistance', 'runningDistance']);
		if (raw == null) return null;
		if (raw > 80) return raw / 1000; // meters -> km
		return raw; // already km
	}

	function extractSleepHours(event: { dataType: string; data: Record<string, unknown> }): number | null {
		if (event.dataType !== 'sleep') return null;
		const raw = extractNumber(event.data, ['sleepDuration', 'duration']);
		if (raw == null) return null;
		if (raw > 100) return raw / 3600; // seconds -> hours
		return raw;
	}

	function extractSteps(event: { dataType: string; data: Record<string, unknown> }): number | null {
		if (event.dataType !== 'activity') return null;
		return extractNumber(event.data, ['steps']);
	}

	function extractIntenseMinutes(event: { dataType: string; data: Record<string, unknown> }): number | null {
		if (event.dataType !== 'activity') return null;
		// Withings stores intense and moderate in seconds — convert to minutes
		const intense = extractNumber(event.data, ['intense']) ?? 0;
		const moderate = extractNumber(event.data, ['moderate']) ?? 0;
		if (intense > 0 || moderate > 0) return (intense + moderate) / 60;
		// Fallback: pre-converted field names from other sources
		const minutes = extractNumber(event.data, ['intenseMinutes', 'activeMinutes', 'moderateToVigorousMinutes']);
		if (minutes != null) return minutes;
		const seconds = extractNumber(event.data, ['intenseSeconds']);
		return seconds != null ? seconds / 60 : null;
	}

	function extractWeight(event: { dataType: string; data: Record<string, unknown> }): number | null {
		if (event.dataType !== 'weight') return null;
		return extractNumber(event.data, ['weight']);
	}

	function pctHigherBetter(value: number | undefined, target: number): number {
		if (value == null) return 50;
		return Math.max(0, Math.min(100, Math.round((value / target) * 100)));
	}

	function pctLowerBetter(value: number | undefined, targetMax: number): number {
		if (value == null) return 50;
		const ratio = Math.max(0, Math.min(1, value / targetMax));
		return Math.round((1 - ratio) * 100);
	}

	function runningColorFromRatio(ratio: number): string {
		if (ratio >= 1) return '#82c882';
		if (ratio >= 0.7) return '#f0b429';
		return '#e07070';
	}

	function computeSleepHoursAvg(
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

	function computeAvgStepsPerDay(
		mode: WindowMode,
		events: Array<{ dataType: string; data: Record<string, unknown> }>,
		metrics: PeriodMetrics | null | undefined,
		days: number
	): number | undefined {
		if (mode === 'week' || mode === 'month' || mode === 'year') return metrics?.steps?.avg;
		const total = events.reduce((sum, event) => sum + (extractSteps(event) ?? 0), 0);
		return total / days;
	}

	function computeAvgActiveMinutesPerDay(
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

	function computeWeightDelta(
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

	const windowStartDate = $derived(windowStart(selectedWindow));
	const filteredEvents = $derived(
		recentEvents.filter((event) => new Date(event.timestamp) >= windowStartDate)
	);
	const selectedDays = $derived(daysInWindow(selectedWindow));

	const runningKm = $derived(
		filteredEvents.reduce((sum, event) => sum + (extractRunningDistanceKm(event) ?? 0), 0)
	);

	const runningTrackSet = $derived((() => {
		const tracks = defaultV1GoalTracks();

		const weekTarget = Number.parseFloat(runningGoalWeekInput.replace(',', '.'));
		if (Number.isFinite(weekTarget) && weekTarget > 0) tracks[0].targetValue = weekTarget;

		const quarterTarget = Number.parseFloat(runningGoalQuarterInput.replace(',', '.'));
		if (Number.isFinite(quarterTarget) && quarterTarget > 0) tracks[1].targetValue = quarterTarget;

		const yearTarget = Number.parseFloat(runningGoalYearInput.replace(',', '.'));
		if (Number.isFinite(yearTarget) && yearTarget > 0) tracks[2].targetValue = yearTarget;

		return tracks;
	})());

	const runningWidgetWindow = $derived<WidgetWindow>(
		selectedWindow === '7d'
			? '7d'
			: selectedWindow === '30d'
				? '30d'
				: selectedWindow === '365d'
					? '365d'
					: selectedWindow
	);

	const runningTrackMatch = $derived(
		selectGoalTrackForWidget(runningTrackSet, 'running_distance', runningWidgetWindow)
	);
	const runningProgress = $derived(
		runningTrackMatch
			? evaluateProgress(runningKm, runningTrackMatch.track, runningWidgetWindow)
			: { ratio: 0, pct: 0, projectedTarget: 0 }
	);
	const runningTargetForWindow = $derived(runningProgress.projectedTarget);
	const runningProgressRatio = $derived(runningProgress.ratio);
	const runningPct = $derived(runningProgress.pct);
	const runningRingColor = $derived(runningColorFromRatio(runningProgressRatio));

	const weightTrackSet = $derived((() => {
		const shortTarget = Number.parseFloat(weightGoalShortInput.replace(',', '.'));
		const longTarget = Number.parseFloat(weightGoalLongInput.replace(',', '.'));

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
	})());

	const weightTrackMatch = $derived(
		selectGoalTrackForWidget(weightTrackSet, 'weight_change', runningWidgetWindow)
	);
	const weightProjectedTarget = $derived(
		weightTrackMatch ? projectTrackTargetForWindow(weightTrackMatch.track, runningWidgetWindow) : 0
	);
	const weightDelta = $derived(computeWeightDelta(selectedWindow, filteredEvents, lastMetrics));

	function evaluateWeightProgress(actualDelta: number | undefined, projectedTarget: number): number {
		if (actualDelta == null || projectedTarget === 0) return 0;
		if (projectedTarget < 0) {
			// For vektnedgangsmål teller kun negativ endring som framgang
			const effectiveActual = Math.min(0, actualDelta);
			return Math.abs(effectiveActual) / Math.abs(projectedTarget);
		}
		const effectiveActual = Math.max(0, actualDelta);
		return Math.abs(effectiveActual) / Math.abs(projectedTarget);
	}

	const weightProgressRatio = $derived(evaluateWeightProgress(weightDelta, weightProjectedTarget));
	const weightProgressPct = $derived(Math.max(0, Math.min(100, Math.round(weightProgressRatio * 100))));
	const weightProgressColor = $derived(
		weightProgressRatio >= 1 ? '#82c882' : weightProgressRatio >= 0.7 ? '#f0b429' : '#e07070'
	);

	const sleepHoursAvg = $derived(computeSleepHoursAvg(selectedWindow, filteredEvents, lastMetrics));

	const sleepLagComposite = $derived((() => {
		const lag = typeof lastMetrics?.sleepLag === 'number' ? lastMetrics.sleepLag : null;
		const early = typeof lastMetrics?.earlyWake === 'number' ? lastMetrics.earlyWake : null;
		if (lag != null && early != null) return lag + early;
		if (lag != null) return lag;
		if (early != null) return early;
		return undefined;
	})());

	const avgStepsPerDay = $derived(computeAvgStepsPerDay(selectedWindow, filteredEvents, lastMetrics, selectedDays));

	const stepsComparisonPoints = $derived.by(() => {
		const points = periodData
			.map((period, index) => {
				const current = period.metrics?.steps?.avg;
				if (typeof current !== 'number') return null;
				const label = period.periodKey || String(index + 1);
				return { label, current };
			})
			.filter((point): point is { label: string; current: number } => point != null)
			.slice(-8);

		if (points.length === 0) return [];
		const reference = points.reduce((sum, point) => sum + point.current, 0) / points.length;
		return points.map((point) => ({
			label: point.label,
			current: point.current,
			reference
		}));
	});

	const stepsReferenceAvg = $derived.by(() => {
		if (stepsComparisonPoints.length === 0) return undefined;
		return stepsComparisonPoints.reduce((sum, point) => sum + point.reference, 0) / stepsComparisonPoints.length;
	});

	const avgActiveMinutesPerDay = $derived(
		computeAvgActiveMinutesPerDay(selectedWindow, filteredEvents, lastMetrics, selectedDays)
	);

	function formatSigned(value: number | undefined, unit: string, decimals = 1) {
		if (value == null) return '–';
		const sign = value > 0 ? '+' : '';
		return `${sign}${value.toFixed(decimals)} ${unit}`;
	}

	function describeWindow(mode: WindowMode): string {
		if (mode === '7d') return 'siste 7 dager';
		if (mode === '30d') return 'siste 30 dager';
		if (mode === '365d') return 'siste 365 dager';
		if (mode === 'week') return 'denne uken';
		if (mode === 'month') return 'denne måneden';
		return 'i år';
	}

	const windowCopy = $derived(describeWindow(selectedWindow));

	const sleepGoal = $derived(metricSettings.sleep?.goal ?? 7.5);
	const sleepLagMax = $derived(metricSettings.sleepLag?.goal ?? 8);
	const stepsGoal = $derived(metricSettings.steps?.goal ?? 8000);
	const activeMinutesGoal = $derived(metricSettings.activeMinutes?.goal ?? 30);

	const metricCards = $derived([
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
			metricId: 'sleep_avg_night' as const,
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
			metricId: 'steps_avg_day' as const,
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
	]);

	const sourceItems = $derived(
		sources.map((source) => ({
			id: source.id,
			title: source.name,
			subtitle: source.provider,
			meta: source.lastSync ? `Synket ${formatDate(source.lastSync)}` : 'Aldri synket',
			amount: source.isActive ? 'Aktiv' : 'Inaktiv',
			amountTone: source.isActive ? ('positive' as const) : ('neutral' as const)
		}))
	);

	const eventItems = $derived(recentEvents.slice(0, 24).map((item) => formatEvent(item)));

	onMount(() => {
		void loadGoalTracks();
		void loadThemeWidgets();
	});

	async function loadThemeWidgets() {
		if (!themeId) {
			themeWidgetsLoading = false;
			return;
		}
		try {
			const res = await fetch(`/api/tema/${themeId}/widgets`);
			if (res.ok) {
				themeWidgets = await res.json();
			}
		} catch {
			// stille feil
		} finally {
			themeWidgetsLoading = false;
		}
	}

	async function removeThemeWidget(id: string) {
		const previous = themeWidgets;
		themeWidgets = themeWidgets.filter((w) => w.id !== id);
		try {
			const res = await fetch(`/api/user-widgets/${id}`, { method: 'DELETE' });
			if (!res.ok && res.status !== 204) {
				themeWidgets = previous;
			}
		} catch {
			themeWidgets = previous;
		}
	}

	async function loadGoalTracks() {
		try {
			const [runningRes, weightRes] = await Promise.all([
				fetch('/api/goal-tracks/running_distance'),
				fetch('/api/goal-tracks/weight_change')
			]);

			if (runningRes.ok) {
				const runningJson = (await runningRes.json()) as { tracks?: GoalTrack[] };
				const tracks = runningJson.tracks ?? [];
				const weekTrack = tracks.find((t) => t.id === 'run-week');
				const quarterTrack = tracks.find((t) => t.id === 'run-quarter');
				const yearTrack = tracks.find((t) => t.id === 'run-year');
				if (weekTrack?.targetValue) runningGoalWeekInput = String(weekTrack.targetValue);
				if (quarterTrack?.targetValue) runningGoalQuarterInput = String(quarterTrack.targetValue);
				if (yearTrack?.targetValue) runningGoalYearInput = String(yearTrack.targetValue);
			}

			if (weightRes.ok) {
				const weightJson = (await weightRes.json()) as { tracks?: GoalTrack[] };
				const tracks = weightJson.tracks ?? [];
				const shortTrack = tracks.find((t) => t.id === 'weight-short');
				const longTrack = tracks.find((t) => t.id === 'weight-long');
				if (shortTrack?.targetValue) weightGoalShortInput = String(shortTrack.targetValue);
				if (longTrack?.targetValue) weightGoalLongInput = String(longTrack.targetValue);
			}
		} catch {
			// stille feil, defaults brukes
		}
	}
</script>

<div class:hd-embedded={embedded} class="health-dashboard">
	{#if !embedded}
		<div class="hd-header">
			<h1 class="hd-title">Helse</h1>
			<p class="hd-copy">Vekt, løp, aktive minutter og søvn samlet i ett bilde.</p>
		</div>
	{/if}

	{#if !programWidgetLoading}
		<aside class="hd-program-card">
			{#if activeProgram}
				<a class="hd-program-link" href="/treningsprogram/{activeProgram.id}">
					<div class="hd-program-main">
						<span class="hd-program-label">Aktivt program</span>
						<h2 class="hd-program-name">{activeProgram.name}</h2>
						<p class="hd-program-meta">
							{activeProgram.completedSessions} / {activeProgram.totalSessions} fullført ·
							{activeProgram.durationWeeks} uker
						</p>
					</div>
					{#if todaySession}
						<div class="hd-program-today">
							<span class="hd-today-label">I dag</span>
							<span class="hd-today-name">
								{todaySession.name}
								{#if todaySession.isTest}<em class="hd-test-tag">TEST</em>{/if}
							</span>
						</div>
					{:else}
						<div class="hd-program-today">
							<span class="hd-today-label">I dag</span>
							<span class="hd-today-name hd-rest">Hviledag</span>
						</div>
					{/if}
				</a>
			{:else}
				<a class="hd-program-empty" href="/treningsprogram/ny">
					<div>
						<span class="hd-program-label">Treningsprogram</span>
						<p>Lag et hybridprogram bygget på dine faktiske PR-er og volum.</p>
					</div>
					<span class="hd-program-cta">Lag program →</span>
				</a>
			{/if}
		</aside>
	{/if}

	{#if thisWeekScreen}
		<a class="hd-screentime-link" href="/skjermtid" aria-label="Åpne skjermtid">
			<div class="hd-screentime-head">
				<span class="hd-screentime-label">Skjermtid · siste uke</span>
				<span class="hd-screentime-more">Se mer →</span>
			</div>
			<ScreenTimeCard thisWeek={thisWeekScreen} prevWeek={prevWeekScreen} compact />
		</a>
	{:else}
		<a class="hd-screentime-empty" href="/skjermtid" aria-label="Kom i gang med skjermtid">
			<span class="hd-screentime-empty-icon">📱</span>
			<span class="hd-screentime-empty-copy">
				<span class="hd-screentime-empty-title">Følg skjermtid og scrolling</span>
				<span class="hd-screentime-empty-text">Last opp et iPhone Skjermtid-skjermbilde for å komme i gang.</span>
			</span>
			<span class="hd-screentime-more">→</span>
		</a>
	{/if}

	<div class="hd-pills" role="tablist" aria-label="Helseperioder">
		<PeriodPills
			options={['7d', '30d', '365d', 'Uke', 'Måned', 'Kvartal', 'År']}
			value={selectedWindow === '7d' ? '7d' : selectedWindow === '30d' ? '30d' : selectedWindow === '365d' ? '365d' : selectedWindow === 'week' ? 'Uke' : selectedWindow === 'month' ? 'Måned' : selectedWindow === 'quarter' ? 'Kvartal' : 'År'}
			onchange={(value) => {
				selectedWindow =
					value === '7d' ? '7d' :
					value === '30d' ? '30d' :
					value === '365d' ? '365d' :
					value === 'Uke' ? 'week' :
					value === 'Måned' ? 'month' :
					value === 'Kvartal' ? 'quarter' :
					'year';
			}}
		/>
	</div>

	<HealthEffortSection
		{effortPeriodMode}
		{latestWeeklyEffort}
		{latestWeekLabel}
		{periodEffortAggregate}
		{trainingLoadSeries}
	/>

	{#if tooling}
		<div class="hd-tooling-card">
			<div class="hd-table-head">
				<h2 class="hd-table-title">Datatilgang og tool-sjekk</h2>
				<p class="hd-table-copy">
					query_sensor_data: {tooling.querySensorDataTool ? 'aktiv' : 'mangler'} · {tooling.tables.sensorEvents}: {tooling.weightEventCount} vektmålinger · {tooling.tables.sensorAggregates}: {tooling.weightAggregateCount} perioder med vekt
				</p>
			</div>
		</div>
	{/if}

	{#if themeId}
		<div class="hd-widget-card">
			<div class="hd-widget-grid">
				{#if themeWidgetsLoading && themeWidgets.length === 0}
					{#each Array.from({ length: 4 }) as _}
						<div class="hd-widget-skeleton" aria-hidden="true"></div>
					{/each}
				{:else}
					{#each themeWidgets as widget (widget.id)}
						<DynamicWidget
							widgetId={widget.id}
							title={widget.title}
							unit={widget.unit}
							color={widget.color}
							pinned={widget.pinned}
							range={widgetRange}
							onunpin={() => removeThemeWidget(widget.id)}
						/>
					{/each}
				{/if}
			</div>
		</div>
	{/if}

	{#if periodData.length === 0}
		<div class="hd-empty">
			<p>Ingen data tilgjengelig ennå.</p>
			<p class="hd-empty-sub">Koble til eller synkroniser Withings for å fylle Helse-dashbordet.</p>
		</div>
	{:else}
		<HealthMetricGrid {periodData} {weekly} />

		{#if goals.length > 0}
			<div class="hd-goals-section">
				<h2 class="hd-section-title">Aktive mål</h2>
				<div class="hd-goals-grid">
					{#each goals.filter(g => g.status === 'active') as goal}
						{@const pct = goalPct(goal)}
						{@const color = GOAL_COLORS[goal.status] ?? '#7c8ef5'}
						{@const delta = goalDelta(goal)}
						<div class="hd-goal-card-new">
							<div class="hd-goal-ring">
								<GoalRing {pct} {color} r={28} strokeWidth={5} size={80}>
									{#snippet children()}
										{#if delta}
											<text
												x="40"
												y="40"
												text-anchor="middle"
												fill={delta.value >= 0 ? '#48b581' : '#ee8c8c'}
												font-size="14"
												font-weight="700"
											>{delta.value >= 0 ? '+' : ''}{delta.value.toFixed(1)}</text>
											<text
												x="40"
												y="52"
												text-anchor="middle"
												fill={delta.value >= 0 ? '#48b581' : '#ee8c8c'}
												font-size="9"
												font-weight="600"
											>{delta.unit}</text>
										{:else}
											<text
												x="40"
												y="44"
												text-anchor="middle"
												fill={color}
												font-size="12"
												font-weight="700"
											>{pct}%</text>
										{/if}
									{/snippet}
								</GoalRing>
							</div>
							<div class="hd-goal-info">
								<span class="hd-goal-title-new">{goal.title}</span>
								{#if goal.description}
									<span class="hd-goal-desc-new">{goal.description}</span>
								{/if}
							</div>
							<div class="hd-goal-actions">
								<a href="/tema/helse?tab=mål" class="hd-goal-edit-btn">Rediger</a>
								<button
									class="hd-goal-delete-btn"
									onclick={() => {
										if (confirm(`Sikker på at du vil arkivere målet "${goal.title}"?`)) {
											void deleteGoal(goal.id);
										}
									}}
								>Slett</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Aktivitetsliste -->
		{#if activities.length > 0}
			<HealthActivityList {activities} />
		{/if}

		<!-- Kilder -->
		<div class="hd-sources-section">
			<CompactRecordList title="Kilder" items={sourceItems} emptyText="Ingen aktive helsekilder ennå." />
		</div>

		<!-- Kollapset hendelsesdetaljer -->
		<details class="hd-events-details" bind:open={showEventDetails}>
			<summary class="hd-events-summary">
				<span class="hd-events-title">Hendelsesdetaljer</span>
				<span class="hd-events-count">({eventItems.length} hendelser)</span>
			</summary>
			<div class="hd-events-content">
				<CompactRecordList title="" items={eventItems} emptyText="Ingen hendelser registrert ennå." />
			</div>
		</details>
	{/if}
</div>

<style>
	.health-dashboard {
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.hd-screentime-link {
		display: block;
		text-decoration: none;
		color: inherit;
	}
	.hd-screentime-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 6px;
	}
	.hd-screentime-label {
		font-size: 0.8rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
	}
	.hd-screentime-more {
		font-size: 0.8rem;
		color: var(--accent-primary, #4aa8ff);
	}
	.hd-screentime-empty {
		display: flex;
		align-items: center;
		gap: 12px;
		text-decoration: none;
		color: var(--text-primary, #fff);
		background: var(--bg-secondary, #161616);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: 16px;
		padding: 14px 16px;
	}
	.hd-screentime-empty-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}
	.hd-screentime-empty-copy {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.hd-screentime-empty-title {
		font-size: 0.92rem;
		font-weight: 600;
	}
	.hd-screentime-empty-text {
		font-size: 0.8rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
	}

	.hd-embedded {
		padding-top: 4px;
	}

	.hd-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.hd-program-card {
		display: block;
		background: linear-gradient(140deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.01));
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 14px;
		overflow: hidden;
		transition: border-color 120ms ease;
	}
	.hd-program-card:hover {
		border-color: rgba(255, 255, 255, 0.2);
	}
	.hd-program-link,
	.hd-program-empty {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 16px 20px;
		text-decoration: none;
		color: inherit;
	}
	.hd-program-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.hd-program-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}
	.hd-program-name {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: #eee;
	}
	.hd-program-meta {
		margin: 2px 0 0;
		font-size: 12px;
		color: #888;
	}
	.hd-program-today {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		text-align: right;
	}
	.hd-today-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}
	.hd-today-name {
		font-size: 14px;
		font-weight: 500;
		color: #eee;
		display: flex;
		gap: 8px;
		align-items: baseline;
	}
	.hd-today-name.hd-rest {
		color: #777;
		font-style: italic;
	}
	.hd-test-tag {
		font-size: 9px;
		padding: 1px 6px;
		border-radius: 999px;
		background: rgba(110, 168, 254, 0.2);
		color: #6ea8fe;
		font-style: normal;
		letter-spacing: 0.06em;
	}
	.hd-program-empty p {
		margin: 4px 0 0;
		font-size: 13px;
		color: #aaa;
		max-width: 320px;
	}
	.hd-program-cta {
		font-size: 13px;
		color: #6ea8fe;
		font-weight: 500;
		flex-shrink: 0;
	}

	.hd-title {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #eee;
	}

	.hd-copy,
	.hd-table-copy,
	.hd-empty-sub {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.5;
		color: #777;
	}

	.hd-goals-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		background: #141414;
		border-radius: 18px;
	}

	.hd-section-title {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 600;
		color: #ccc;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.hd-goals-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 12px;
	}

	.hd-goal-card-new {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 14px;
		background: #0d0d0d;
		border-radius: 12px;
	}

	.hd-goal-ring {
		flex-shrink: 0;
	}

	.hd-goal-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}

	.hd-goal-title-new {
		font-size: 0.95rem;
		font-weight: 600;
		color: #eee;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hd-goal-desc-new {
		font-size: 0.82rem;
		line-height: 1.4;
		color: #888;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.hd-goal-actions {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex-shrink: 0;
	}

	.hd-goal-edit-btn,
	.hd-goal-delete-btn {
		padding: 6px 12px;
		font-size: 0.8rem;
		font-weight: 500;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #bbb;
		cursor: pointer;
		transition: all 0.15s ease;
		text-decoration: none;
		text-align: center;
	}

	.hd-goal-edit-btn:hover {
		background: #232323;
		border-color: #3a3a3a;
		color: #eee;
	}

	.hd-goal-delete-btn {
		color: #ee8c8c;
	}

	.hd-goal-delete-btn:hover {
		background: #2a1a1a;
		border-color: #3a2020;
		color: #ff9999;
	}

	.hd-pills {
		display: inline-flex;
	}

	.hd-empty,
	.hd-widget-card,
	.hd-tooling-card {
		background: #141414;
		border-radius: 18px;
	}

	.hd-widget-card {
		padding: 16px 12px;
	}

	.hd-tooling-card {
		padding: 14px 16px;
	}

	.hd-empty {
		padding: 28px 20px;
		text-align: center;
		color: #aaa;
	}

	.hd-widget-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
		gap: 12px;
		justify-items: center;
		padding: 4px 0 8px;
	}

	.hd-widget-skeleton {
		width: 90px;
		height: 106px;
		border-radius: 14px;
		background: linear-gradient(120deg, #1c1c1c 0%, #232323 50%, #1c1c1c 100%);
		background-size: 200% 100%;
		animation: hd-skeleton-shimmer 1.4s ease-in-out infinite;
	}

	@keyframes hd-skeleton-shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	.hd-table-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: #e7e7e7;
	}

	.hd-table-head {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	@media (max-width: 640px) {
		.hd-title {
			font-size: 1.32rem;
		}

		.hd-table-title {
			font-size: 0.94rem;
		}

		.hd-copy,
		.hd-table-copy,
		.hd-empty-sub {
			font-size: 0.84rem;
		}
	}

	.hd-sources-section {
		margin-top: 12px;
	}

	.hd-events-details {
		background: #141414;
		border-radius: 18px;
		margin-top: 12px;
		padding: 0;
	}

	.hd-events-summary {
		cursor: pointer;
		padding: 16px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		list-style: none;
		user-select: none;
	}

	.hd-events-summary::-webkit-details-marker {
		display: none;
	}

	.hd-events-summary::marker {
		display: none;
	}

	.hd-events-title {
		font-size: 0.88rem;
		font-weight: 700;
		color: #e7e7e7;
	}

	.hd-events-count {
		font-size: 0.74rem;
		color: #777;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 3px 10px;
	}

	.hd-events-content {
		padding: 0 16px 16px 16px;
	}

</style>
