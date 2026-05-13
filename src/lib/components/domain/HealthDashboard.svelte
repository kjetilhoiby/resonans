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
	import GpxMap from '../charts/GpxMap.svelte';
	import TrackProfileChart from '../charts/TrackProfileChart.svelte';
	import KmSplitsTable from '../charts/KmSplitsTable.svelte';
	import HrDistributionBar from '../charts/HrDistributionBar.svelte';
	import DynamicWidget from '../composed/DynamicWidget.svelte';
	import WeeklyEffortCard from '../composed/WeeklyEffortCard.svelte';
	import { hasElevation, hasHeartRate } from '$lib/utils/track-stats';
	import {
		buildPaceBaseline,
		compareActivityToBaseline,
		formatPaceDelta
	} from '$lib/utils/activity-history';

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

	let { weekly, monthly, yearly, sources = [], recentEvents = [], tooling, embedded = false, goals = [], activities = [], metricSettings = {}, themeId }: Props = $props();

	let themeWidgets = $state<ThemeWidget[]>([]);
	let themeWidgetsLoading = $state(true);

	let selectedWindow = $state<WindowMode>('30d');
	let periodTableFilter = $state<'siste5' | 'i_ar' | 'siste_ar' | 'alt'>('siste5');
	let runningGoalWeekInput = $state('20');
	let runningGoalQuarterInput = $state('150');
	let runningGoalYearInput = $state('1000');
	let weightGoalShortInput = $state('-3');
	let weightGoalLongInput = $state('-20');
	let showEventDetails = $state(false);

	// Activity map state
	interface TrackPoint { lat: number; lon: number; ele?: number | null; hr?: number | null; time?: string | null; }
	let mapEventId = $state<string | null>(null);
	let mapPoints = $state<TrackPoint[]>([]);
	let mapLoading = $state(false);

	// Activity card expand state
	let expandedActivityIds = $state<Set<string>>(new Set());
	let activitySportFilter = $state<string | null>(null);
	let activityVisibleCount = $state(10);

	async function toggleActivity(activityId: string, trackEventId: string | null = null) {
		const next = new Set(expandedActivityIds);
		if (next.has(activityId)) {
			next.delete(activityId);
			expandedActivityIds = next;
			return;
		}
		next.add(activityId);
		expandedActivityIds = next;
		if (trackEventId && mapEventId !== trackEventId) {
			await openMap(trackEventId);
		}
	}

	async function openMap(eventId: string) {
		mapEventId = eventId;
		mapPoints = [];
		mapLoading = true;
		try {
			const res = await fetch(`/api/activities/${eventId}/track`);
			if (res.ok) {
				const json = await res.json() as { trackPoints?: TrackPoint[] };
				mapPoints = json.trackPoints ?? [];
			}
		} catch { /* stille feil */ }
		mapLoading = false;
	}

	const availableSportTypes = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const act of activities) {
			const t = act.sportType.toLowerCase();
			counts.set(t, (counts.get(t) ?? 0) + 1);
		}
		return [...counts.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([type]) => type);
	});

	const filteredActivities = $derived(
		activitySportFilter
			? activities.filter(a => a.sportType.toLowerCase() === activitySportFilter)
			: activities
	);

	const aggregatePeriod = $derived<'week' | 'month' | 'year'>(
		selectedWindow === 'month' || selectedWindow === 'quarter' ? 'month' : selectedWindow === 'year' ? 'year' : 'week'
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

		return {
			total: Math.round(total * 10) / 10,
			byFamily,
			bars,
			hrCoveragePct,
			workoutCount,
			rangeLabel: range.label
		};
	});

	function periodYear(periodKey: string): number {
		return parseInt(periodKey.split(/[WMQY]/)[0]);
	}

	const visiblePeriods = $derived.by(() => {
		const reversed = [...periodData].reverse();
		const now = new Date();
		const thisYear = now.getFullYear();
		if (periodTableFilter === 'siste5') return reversed.slice(0, 5);
		if (periodTableFilter === 'i_ar') return reversed.filter(p => periodYear(p.periodKey) === thisYear);
		if (periodTableFilter === 'siste_ar') return reversed.filter(p => periodYear(p.periodKey) === thisYear - 1);
		return reversed;
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

	function formatPeriodKey(key: string, period: string): string {
		if (period === 'week') {
			const [, week] = key.split('W');
			return `Uke ${week}`;
		}
		if (period === 'month') {
			const [year, month] = key.split('M');
			const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
			return `${monthNames[parseInt(month) - 1] ?? month} ${year}`;
		}
		if (period === 'quarter') {
			const [year, q] = key.split('Q');
			return `Q${q} ${year}`;
		}
		return key;
	}

	function formatMetric(value: number | undefined, decimals = 1): string {
		if (value === undefined || value === null) return '–';
		return value.toFixed(decimals);
	}

	function formatWeightChange(change: number | undefined): string {
		if (change == null) return '–';
		const sign = change > 0 ? '+' : '';
		return `${sign}${change.toFixed(1)}`;
	}

	function daysInPeriod(p: { startDate?: string | Date; endDate?: string | Date }): number {
		if (!p.startDate || !p.endDate) return 1;
		const ms = new Date(p.endDate).getTime() - new Date(p.startDate).getTime();
		return Math.max(1, Math.round(ms / 86400000) + 1);
	}

	const METRIC_PALETTE = {
		bad: [200, 110, 110] as const,
		mid: [190, 155, 95] as const,
		good: [120, 175, 130] as const,
		none: [70, 70, 75] as const
	};

	type ColorStop = readonly [value: number, rgb: readonly [number, number, number]];

	function interpolateStops(value: number, stops: readonly ColorStop[]): string {
		if (value <= stops[0][0]) return rgb(stops[0][1]);
		for (let i = 1; i < stops.length; i++) {
			const [v1, c1] = stops[i - 1];
			const [v2, c2] = stops[i];
			if (value <= v2) {
				const t = v2 === v1 ? 0 : (value - v1) / (v2 - v1);
				return rgb([
					Math.round(c1[0] + (c2[0] - c1[0]) * t),
					Math.round(c1[1] + (c2[1] - c1[1]) * t),
					Math.round(c1[2] + (c2[2] - c1[2]) * t)
				]);
			}
		}
		return rgb(stops[stops.length - 1][1]);
	}

	function rgb([r, g, b]: readonly [number, number, number]): string {
		return `rgb(${r}, ${g}, ${b})`;
	}

	const NONE_COLOR = rgb(METRIC_PALETTE.none);

	const WEIGHT_STOPS: readonly ColorStop[] = [
		[-1.5, METRIC_PALETTE.good],
		[-0.3, METRIC_PALETTE.good],
		[0.1, METRIC_PALETTE.mid],
		[0.8, METRIC_PALETTE.bad]
	];
	const RUNNING_STOPS: readonly ColorStop[] = [
		[0, METRIC_PALETTE.bad],
		[8, METRIC_PALETTE.mid],
		[20, METRIC_PALETTE.good],
		[35, METRIC_PALETTE.good]
	];
	const ACTIVE_STOPS: readonly ColorStop[] = [
		[0, METRIC_PALETTE.bad],
		[20, METRIC_PALETTE.mid],
		[45, METRIC_PALETTE.good],
		[75, METRIC_PALETTE.good]
	];
	const SLEEP_STOPS: readonly ColorStop[] = [
		[4, METRIC_PALETTE.bad],
		[6, METRIC_PALETTE.mid],
		[7, METRIC_PALETTE.good],
		[9, METRIC_PALETTE.good],
		[10.5, METRIC_PALETTE.mid]
	];
	const HR_STOPS: readonly ColorStop[] = [
		[48, METRIC_PALETTE.good],
		[58, METRIC_PALETTE.good],
		[65, METRIC_PALETTE.mid],
		[75, METRIC_PALETTE.bad]
	];

	function weightColor(change: number | undefined): string {
		return change == null ? NONE_COLOR : interpolateStops(change, WEIGHT_STOPS);
	}
	function runningColor(km: number | undefined): string {
		return km == null || km <= 0 ? NONE_COLOR : interpolateStops(km, RUNNING_STOPS);
	}
	function activeColor(perDay: number | undefined): string {
		return perDay == null ? NONE_COLOR : interpolateStops(perDay, ACTIVE_STOPS);
	}
	function sleepColor(hours: number | undefined): string {
		return hours == null ? NONE_COLOR : interpolateStops(hours, SLEEP_STOPS);
	}
	function heartRateColor(bpm: number | undefined): string {
		return bpm == null ? NONE_COLOR : interpolateStops(bpm, HR_STOPS);
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat('nb-NO', {
			day: '2-digit',
			month: '2-digit',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(value));
	}

	function formatActivityDate(value: string): string {
		const date = new Date(value);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffH = Math.floor(diffMs / 3600000);
		const diffD = Math.floor(diffMs / 86400000);
		if (diffH < 1) return 'akkurat nå';
		if (diffH < 24) return `${diffH} t siden`;
		if (diffD === 1) return 'i går';
		return new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
	}

	function formatDuration(seconds: number | null): string {
		if (!seconds) return '–';
		const m = Math.round(seconds / 60);
		if (m < 60) return `${m} min`;
		const h = Math.floor(m / 60);
		const rem = m % 60;
		return rem === 0 ? `${h} t` : `${h} t ${rem} min`;
	}

	function formatPace(secondsPerKm: number | null): string {
		if (!secondsPerKm) return '';
		const m = Math.floor(secondsPerKm / 60);
		const s = Math.round(secondsPerKm % 60);
		return `${m}:${String(s).padStart(2, '0')} /km`;
	}

	const SPORT_ICONS: Record<string, string> = {
		running: '🏃',
		cycling: '🚴',
		e_bike: '🚴',
		walking: '🚶',
		hiking: '🥾',
		swimming: '🏊',
		trail: '🏔️',
		trail_running: '🏔️',
		yoga: '🧘‍♂️',
		tennis: '🎾',
		volleyball: '🏐',
		badminton: '🏸',
		basketball: '🏀'
	};

	function sportIcon(sportType: string): string {
		return SPORT_ICONS[sportType.toLowerCase()] ?? '💪';
	}

	function sportLabel(sportType: string): string {
		const labels: Record<string, string> = {
			running: 'Løping',
			cycling: 'Sykling',
			e_bike: 'Elsykkel',
			walking: 'Gåtur',
			hiking: 'Turgåing',
			swimming: 'Svømming',
			trail: 'Terrengløp',
			trail_running: 'Terrengløp',
			yoga: 'Yoga'
		};
		return labels[sportType.toLowerCase()] ?? sportType.charAt(0).toUpperCase() + sportType.slice(1);
	}

	// Treningstyper der distanse ikke er meningsfull
	const DISTANCE_LESS_SPORTS = new Set(['yoga', 'strength_training', 'pilates']);

	function providerLabel(provider: string, sensorType: string): string {
		if (provider === 'dropbox' || sensorType === 'workout_files') return 'Dropbox (GPX/TCX)';
		if (provider === 'withings') return 'Withings';
		if (provider === 'ai_assistant' || sensorType === 'manual_log') return 'Manuell';
		if (provider === 'strava') return 'Strava';
		return provider.charAt(0).toUpperCase() + provider.slice(1);
	}

	function sourceDiscrepancies(evidence: WorkoutEvidence[]): string[] {
		const withDist = evidence.filter(e => e.distanceMeters !== null);
		const withHr = evidence.filter(e => e.avgHeartRate !== null);
		const lines: string[] = [];
		if (withDist.length > 1) {
			lines.push(withDist.map(e => `${providerLabel(e.provider, e.sensorType)}: ${((e.distanceMeters ?? 0) / 1000).toFixed(1)} km`).join(' · '));
		}
		if (withHr.length > 1) {
			lines.push(withHr.map(e => `${providerLabel(e.provider, e.sensorType)}: ♥ ${e.avgHeartRate} bpm`).join(' · '));
		}
		return lines;
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

	{#if effortPeriodMode === 'daily' && latestWeeklyEffort}
		<div class="hd-effort">
			<WeeklyEffortCard
				total={latestWeeklyEffort.total}
				byFamily={latestWeeklyEffort.byFamily}
				byDay={latestWeeklyEffort.byDay}
				hrCoveragePct={latestWeeklyEffort.hrCoveragePct}
				workoutCount={latestWeeklyEffort.workoutCount}
				baseline={latestWeeklyEffort.baseline}
				weekLabel={latestWeekLabel}
			/>
		</div>
	{:else if effortPeriodMode === 'weekly' && periodEffortAggregate}
		<div class="hd-effort">
			<WeeklyEffortCard
				total={periodEffortAggregate.total}
				byFamily={periodEffortAggregate.byFamily}
				bars={periodEffortAggregate.bars}
				hrCoveragePct={periodEffortAggregate.hrCoveragePct}
				workoutCount={periodEffortAggregate.workoutCount}
				weekLabel={periodEffortAggregate.rangeLabel}
			/>
		</div>
	{/if}

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
		<div class="hd-table-card">
			<div class="hd-table-head">
				<h2 class="hd-table-title">Perioder</h2>
				<div class="hd-period-filters">
					{#each [['siste5', 'Siste 5'], ['i_ar', 'I år'], ['siste_ar', 'Siste år'], ['alt', 'Alt']] as [val, label]}
						<button
							class="hd-period-filter-btn"
							class:hd-period-filter-btn--active={periodTableFilter === val}
							onclick={() => { periodTableFilter = val as typeof periodTableFilter; }}
						>{label}</button>
					{/each}
				</div>
			</div>
			<div class="hd-table-wrap">
				<table class="hd-table">
					<thead>
						<tr>
							<th>Periode</th>
							<th title="Vektendring i perioden">⚖️</th>
							<th title="Kilometer løpt">🏃</th>
							<th title="Aktive minutter (snitt per dag)">⚡</th>
							<th title="Søvn (snitt per natt)">🌙</th>
							<th title="Sovepuls (snitt)">💓</th>
						</tr>
					</thead>
					<tbody>
						{#each visiblePeriods as period}
							{@const days = daysInPeriod(period)}
							{@const activeSum = period.metrics?.intenseMinutes?.sum}
							{@const weightChange = period.metrics?.weight?.change}
							{@const runningKm = (period.metrics?.workouts?.types?.running ?? 0) > 0 ? (period.metrics!.workouts!.types!.running as number) : undefined}
							{@const activePerDay = activeSum != null ? Math.round(activeSum / days) : undefined}
							{@const sleepHours = period.metrics?.sleep?.avg}
							{@const hr = period.metrics?.sleepHeartRate?.avg}
							<tr>
								<td>{formatPeriodKey(period.periodKey, period.period)}</td>
								<td><span class="hd-metric-pill" style="--pill-color: {weightColor(weightChange)}">{formatWeightChange(weightChange)}</span></td>
								<td><span class="hd-metric-pill" style="--pill-color: {runningColor(runningKm)}">{runningKm != null ? runningKm.toFixed(1) : '–'}</span></td>
								<td><span class="hd-metric-pill" style="--pill-color: {activeColor(activePerDay)}">{activePerDay ?? '–'}</span></td>
								<td><span class="hd-metric-pill" style="--pill-color: {sleepColor(sleepHours)}">{formatMetric(sleepHours)}</span></td>
								<td><span class="hd-metric-pill" style="--pill-color: {heartRateColor(hr)}">{formatMetric(hr, 0)}</span></td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>

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
			<div class="hd-activities-section">
				<div class="hd-activities-header">
					<h2 class="hd-section-title">Treningsøkter</h2>
					{#if availableSportTypes.length > 1}
						<div class="hd-sport-filters">
							<button
								class="hd-sport-chip"
								class:hd-sport-chip--active={activitySportFilter === null}
								onclick={() => { activitySportFilter = null; activityVisibleCount = 10; }}
							>Alle</button>
							{#each availableSportTypes as type}
								<button
									class="hd-sport-chip"
									class:hd-sport-chip--active={activitySportFilter === type}
									onclick={() => { activitySportFilter = type; activityVisibleCount = 10; }}
								>{sportIcon(type)} {sportLabel(type)}</button>
							{/each}
						</div>
					{/if}
				</div>
				<div class="hd-activity-list">
					{#each filteredActivities.slice(0, activityVisibleCount) as act}
						{@const trackEventId = act.evidence.find(e => e.hasTrackPoints)?.eventId ?? null}
						{@const discrepancies = sourceDiscrepancies(act.evidence)}
						{@const isExpanded = expandedActivityIds.has(act.activityId)}
						{@const noDistance = DISTANCE_LESS_SPORTS.has(act.sportType.toLowerCase())}
						{@const compactSuffix = (() => {
							const parts: string[] = [];
							if (act.distanceMeters && !noDistance) parts.push(`${(act.distanceMeters / 1000).toFixed(1)} km`);
							if (act.durationSeconds) parts.push(formatDuration(act.durationSeconds));
							return parts.join(' · ');
						})()}
						<div class="hd-activity-card" class:hd-activity-card-expanded={isExpanded}>
							<button
								class="hd-activity-row"
								onclick={() => toggleActivity(act.activityId, trackEventId)}
								aria-expanded={isExpanded}
							>
								<div class="hd-activity-icon">{sportIcon(act.sportType)}</div>
								<div class="hd-activity-info">
									<span class="hd-activity-label">
										{sportLabel(act.sportType)}
										<span class="hd-activity-time">· {formatActivityDate(act.startTime)}</span>
										{#if compactSuffix}<span class="hd-activity-compact-suffix">· {compactSuffix}</span>{/if}
									</span>
								</div>
								<span class="hd-activity-chevron" class:hd-activity-chevron-open={isExpanded}>›</span>
							</button>

							{#if isExpanded}
								{@const baseline = act.paceSecondsPerKm
									? buildPaceBaseline(activities, act.sportType, act.activityId)
									: null}
								{@const comparison = baseline
									? compareActivityToBaseline(act.paceSecondsPerKm, baseline)
									: null}
								{@const showMapData = mapEventId === trackEventId && mapPoints.length > 0}
								<div class="hd-activity-details">
									<div class="hd-stats">
										{#if act.distanceMeters && !noDistance}
											<div class="hd-stat">
												<span class="hd-stat-label">Distanse</span>
												<span class="hd-stat-value">{(act.distanceMeters / 1000).toFixed(2)} km</span>
											</div>
										{/if}
										{#if act.durationSeconds}
											<div class="hd-stat">
												<span class="hd-stat-label">Varighet</span>
												<span class="hd-stat-value">{formatDuration(act.durationSeconds)}</span>
											</div>
										{/if}
										{#if act.paceSecondsPerKm && !noDistance}
											<div class="hd-stat">
												<span class="hd-stat-label">Tempo</span>
												<span class="hd-stat-value">{formatPace(act.paceSecondsPerKm)}</span>
											</div>
										{/if}
										{#if act.avgHeartRate}
											<div class="hd-stat">
												<span class="hd-stat-label">♥ snitt</span>
												<span class="hd-stat-value">{Math.round(act.avgHeartRate)}<span class="hd-stat-unit"> bpm</span></span>
											</div>
										{/if}
										{#if act.elevationMeters && act.elevationMeters > 0}
											<div class="hd-stat">
												<span class="hd-stat-label">Stigning</span>
												<span class="hd-stat-value">{Math.round(act.elevationMeters)}<span class="hd-stat-unit"> m</span></span>
											</div>
										{/if}
									</div>

									{#if comparison && baseline}
										<div class="hd-comparison" class:hd-comparison-faster={comparison.isFaster}>
											<span class="hd-comparison-icon">{comparison.isFaster ? '▼' : '▲'}</span>
											<span class="hd-comparison-text">
												{formatPaceDelta(comparison.deltaSecondsPerKm)}/km vs snitt siste {baseline.weeksBack} uker
											</span>
											<span class="hd-comparison-meta">n={baseline.sampleCount}</span>
										</div>
									{/if}

									{#if trackEventId}
										<div class="hd-map-panel">
											{#if mapLoading && mapEventId === trackEventId}
												<div class="hd-map-loading">Laster kart…</div>
											{:else if showMapData}
												<GpxMap points={mapPoints} height={220} />
											{/if}
										</div>

										{#if showMapData}
											<TrackProfileChart points={mapPoints} kind="speed" height={90} />
											{#if hasElevation(mapPoints)}
												<TrackProfileChart points={mapPoints} kind="elevation" height={70} />
											{/if}
											<KmSplitsTable points={mapPoints} />
											{#if hasHeartRate(mapPoints)}
												<HrDistributionBar points={mapPoints} />
											{/if}
										{/if}
									{/if}

									<a class="hd-detail-link" href="/aktivitet/{act.activityId}">Åpne fullstendig →</a>

									{#if act.evidence.length > 0 || discrepancies.length > 0}
										<details class="hd-sources-detail">
											<summary>Kilder og avvik</summary>
											<div class="hd-sources-content">
												{#if act.evidence.length > 0}
													<div class="hd-activity-sources">
														{#each act.evidence as ev}
															<span class="hd-source-chip" class:hd-source-chip-track={ev.hasTrackPoints}>
																{providerLabel(ev.provider, ev.sensorType)}
																{#if ev.distanceMeters !== null && !noDistance}{(ev.distanceMeters / 1000).toFixed(1)} km{/if}
																{#if ev.durationSeconds !== null}· {formatDuration(ev.durationSeconds)}{/if}
																{#if ev.avgHeartRate !== null}· ♥ {ev.avgHeartRate}{/if}
															</span>
														{/each}
													</div>
												{/if}
												{#if discrepancies.length > 0}
													<span class="hd-activity-discrepancy">⚠ {discrepancies.join(' | ')}</span>
												{/if}
											</div>
										</details>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
				{#if filteredActivities.length > activityVisibleCount}
					<button
						class="hd-show-more-btn"
						onclick={() => { activityVisibleCount += 25; }}
					>Vis flere ({filteredActivities.length - activityVisibleCount} gjenstår)</button>
				{/if}
				{#if activityVisibleCount > 10}
					<div class="hd-show-less-sticky">
						<button
							class="hd-show-less-btn"
							onclick={() => { activityVisibleCount = 10; }}
						>Vis færre ↑</button>
					</div>
				{/if}
			</div>
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

	.hd-embedded {
		padding-top: 4px;
	}

	.hd-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
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
	.hd-table-card,
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

	.hd-table-card {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.hd-table-head {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.hd-period-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.hd-period-filter-btn {
		padding: 4px 12px;
		font-size: 0.76rem;
		font-weight: 500;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #888;
		cursor: pointer;
		transition: all 0.12s;
	}

	.hd-period-filter-btn:hover {
		background: #222;
		color: #ccc;
	}

	.hd-period-filter-btn--active {
		background: #1e2040;
		border-color: #3a4080;
		color: #aab4f5;
	}

	.hd-table-wrap {
		overflow-x: auto;
	}

	.hd-table {
		width: 100%;
		border-collapse: collapse;
	}

	.hd-table th,
	.hd-table td {
		text-align: center;
		padding: 10px 4px;
		border-top: 1px solid #202020;
		font-size: 0.8rem;
	}

	.hd-table th:first-child,
	.hd-table td:first-child {
		text-align: left;
		white-space: nowrap;
		padding-right: 8px;
	}

	.hd-table th {
		border-top: none;
		color: #666;
		font-size: 0.9rem;
		font-weight: 500;
	}

	.hd-table td {
		color: #ccc;
		white-space: nowrap;
	}

	.hd-table td:first-child {
		color: #888;
		font-size: 0.78rem;
	}

	.hd-metric-pill {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 44px;
		height: 30px;
		padding: 0 8px;
		border-radius: 999px;
		border: 1px solid color-mix(in srgb, var(--pill-color, #3a3a3a) 70%, transparent);
		color: #d8d8d8;
		font-size: 0.78rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		background: color-mix(in srgb, var(--pill-color, #3a3a3a) 10%, transparent);
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

	/* Activity list */
	.hd-activities-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px;
		background: #141414;
		border-radius: 18px;
	}

	.hd-activities-header {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.hd-sport-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.hd-sport-chip {
		padding: 4px 10px;
		font-size: 0.76rem;
		font-weight: 500;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #888;
		cursor: pointer;
		transition: all 0.12s;
	}

	.hd-sport-chip:hover {
		background: #222;
		color: #ccc;
	}

	.hd-sport-chip--active {
		background: #1e2040;
		border-color: #3a4080;
		color: #aab4f5;
	}

	.hd-show-more-btn {
		align-self: center;
		padding: 7px 20px;
		font-size: 0.8rem;
		font-weight: 500;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #888;
		cursor: pointer;
		transition: all 0.12s;
	}

	.hd-show-more-btn:hover {
		background: #222;
		color: #ccc;
		border-color: #3a3a3a;
	}

	.hd-show-less-sticky {
		position: sticky;
		bottom: 1rem;
		align-self: center;
		pointer-events: none;
	}

	.hd-show-less-btn {
		pointer-events: auto;
		padding: 7px 20px;
		font-size: 0.8rem;
		font-weight: 500;
		border-radius: 10px;
		border: 1px solid #3a3a3a;
		background: #111;
		color: #999;
		cursor: pointer;
		transition: all 0.12s;
		box-shadow: 0 2px 12px #000a;
	}

	.hd-show-less-btn:hover {
		background: #1a1a1a;
		color: #ccc;
		border-color: #505050;
	}

	.hd-activity-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.hd-activity-card {
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid transparent;
		transition: border-color 0.15s;
	}

	.hd-activity-card-expanded {
		border-color: #252525;
	}

	.hd-activity-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 8px;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		color: inherit;
		text-align: left;
		border-radius: 10px;
		transition: background 0.12s;
	}

	.hd-activity-row:hover {
		background: #1a1a1a;
	}

	.hd-activity-icon {
		font-size: 1.3rem;
		flex-shrink: 0;
		width: 32px;
		text-align: center;
	}

	.hd-activity-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.hd-activity-label {
		font-size: 0.88rem;
		font-weight: 500;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.hd-activity-time {
		font-weight: 400;
		color: #666;
	}

	.hd-activity-compact-suffix {
		font-weight: 400;
		color: #555;
	}

	.hd-activity-chevron {
		font-size: 1.2rem;
		color: #444;
		line-height: 1;
		transition: transform 0.2s ease;
		display: inline-block;
		flex-shrink: 0;
	}

	.hd-activity-chevron-open {
		transform: rotate(90deg);
		color: #7c8ef5;
	}

	.hd-activity-details {
		padding: 6px 8px 12px 52px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.hd-stats {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(85px, 1fr));
		gap: 8px;
	}

	.hd-stat {
		background: #161922;
		border-radius: 8px;
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.hd-stat-label {
		font-size: 0.62rem;
		color: #777;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.hd-stat-value {
		font-size: 0.95rem;
		font-weight: 600;
		color: #e8e8e8;
		font-variant-numeric: tabular-nums;
	}

	.hd-stat-unit {
		font-size: 0.7rem;
		font-weight: 400;
		color: #888;
	}

	.hd-comparison {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		align-self: flex-start;
		font-size: 0.75rem;
		padding: 4px 10px;
		border-radius: 999px;
		background: rgba(251, 146, 60, 0.1);
		color: #fb923c;
		border: 1px solid rgba(251, 146, 60, 0.25);
	}

	.hd-comparison-faster {
		background: rgba(52, 211, 153, 0.1);
		color: #34d399;
		border-color: rgba(52, 211, 153, 0.25);
	}

	.hd-comparison-icon {
		font-size: 0.65rem;
		line-height: 1;
	}

	.hd-comparison-text {
		font-variant-numeric: tabular-nums;
		font-weight: 500;
	}

	.hd-comparison-meta {
		font-size: 0.65rem;
		opacity: 0.7;
		font-variant-numeric: tabular-nums;
	}

	.hd-activity-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.hd-source-chip {
		font-size: 0.7rem;
		color: #777;
		background: #1a1a1a;
		border: 1px solid #252525;
		border-radius: 6px;
		padding: 2px 7px;
		white-space: nowrap;
	}

	.hd-source-chip-track {
		border-color: #2a3a55;
		color: #6a9edd;
	}

	.hd-activity-discrepancy {
		font-size: 0.7rem;
		color: #c8a84b;
		display: block;
	}

	.hd-detail-link {
		font-size: 0.78rem;
		color: #6a8eed;
		text-decoration: none;
		transition: color 0.12s;
		align-self: flex-start;
	}

	.hd-detail-link:hover {
		color: #8aa8ff;
	}

	.hd-map-panel {
		border-radius: 12px;
		overflow: hidden;
	}

	.hd-map-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 220px;
		color: #555;
		font-size: 0.85rem;
		background: #0d1117;
		border-radius: 12px;
	}

	.hd-sources-detail {
		font-size: 0.75rem;
		color: #666;
		border-top: 1px solid #1a1f2a;
		padding-top: 8px;
	}

	.hd-sources-detail summary {
		cursor: pointer;
		color: #555;
		user-select: none;
		padding: 2px 0;
	}

	.hd-sources-detail summary:hover {
		color: #888;
	}

	.hd-sources-detail[open] summary {
		color: #888;
		margin-bottom: 6px;
	}

	.hd-sources-content {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
</style>
