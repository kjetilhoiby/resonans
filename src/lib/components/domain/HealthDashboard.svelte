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
	import GpxMapSvg from '../charts/GpxMapSvg.svelte';
	import MetricCard from '$lib/components/visualizations/MetricCard.svelte';

	type WindowMode = '7d' | '30d' | '365d' | 'week' | 'month' | 'year';

	interface PeriodMetrics {
		weight?: { avg?: number; min?: number; max?: number; change?: number };
		steps?: { sum?: number; avg?: number; max?: number };
		sleep?: { avg?: number; min?: number; max?: number };
		workouts?: { count?: number; totalDuration?: number; types?: Record<string, number> };
		intenseMinutes?: { sum?: number; avg?: number };
		sleepLag?: number;
		earlyWake?: number;
	}

	interface AggregatePeriod {
		period: string;
		periodKey: string;
		eventCount: number;
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
	}

	let { weekly, monthly, yearly, sources = [], recentEvents = [], tooling, embedded = false, goals = [], activities = [] }: Props = $props();

	let selectedWindow = $state<WindowMode>('30d');
	let runningGoalWeekInput = $state('20');
	let runningGoalQuarterInput = $state('150');
	let runningGoalYearInput = $state('1000');
	let weightGoalShortInput = $state('-3');
	let weightGoalLongInput = $state('-20');
	let showEventDetails = $state(false);
	let weightChartLoading = $state(false);
	let weightChartError = $state<string | null>(null);
	let rangeStartDate = $state(new Date(Date.now() - 1000 * 60 * 60 * 24 * 90).toISOString().slice(0, 10));
	let rangeEndDate = $state(new Date().toISOString().slice(0, 10));
	let comparisonWindow = $state<WindowMode>('30d');
	let goalStartDate = $state(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 10));
	let goalEndDate = $state(new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString().slice(0, 10));
	let goalTargetWeightInput = $state('78.0');
	let goalStartWeightInput = $state('');

	interface SeriesPoint {
		x: number;
		weight: number;
		timestamp?: string;
	}

	interface WeightRangePayload {
		mode: 'range';
		x: { min: number; max: number };
		y: { min: number; max: number };
		points: SeriesPoint[];
		range: { start: string; end: string; label: string };
		diagnostics: { source: string; eventCount: number };
	}

	interface WeightComparisonSeries {
		label: string;
		isCurrent: boolean;
		start: string;
		end: string;
		points: SeriesPoint[];
	}

	interface WeightGoalOverlay {
		startDate: string;
		endDate: string;
		startWeight: number;
		targetWeight: number;
		latestWeight: number | null;
		targetDeltaKg: number;
		desired: SeriesPoint[];
		forecast: {
			paceKgPerDay: number | null;
			projectedEndWeight: number | null;
			points: SeriesPoint[];
		};
	}

	interface WeightComparisonPayload {
		mode: 'comparison';
		window: WindowMode;
		x: { min: number; max: number };
		y: { min: number; max: number };
		series: WeightComparisonSeries[];
		goal: WeightGoalOverlay | null;
		diagnostics: {
			source: string;
			totalPoints: number;
			periods: Array<{ label: string; points: number }>;
		};
	}

	let weightRangeData = $state<WeightRangePayload | null>(null);
	let weightComparisonData = $state<WeightComparisonPayload | null>(null);

	// Activity map state
	interface TrackPoint { lat: number; lon: number; ele?: number | null; hr?: number | null; time?: string | null; }
	let mapEventId = $state<string | null>(null);
	let mapPoints = $state<TrackPoint[]>([]);
	let mapLoading = $state(false);

	async function openMap(eventId: string) {
		if (mapEventId === eventId) { mapEventId = null; mapPoints = []; return; }
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

	const aggregatePeriod = $derived<'week' | 'month' | 'year'>(
		selectedWindow === 'month' ? 'month' : selectedWindow === 'year' ? 'year' : 'week'
	);
	const periodData = $derived(
		aggregatePeriod === 'week' ? weekly : aggregatePeriod === 'month' ? monthly : yearly
	);
	const lastPeriod = $derived(periodData.length ? periodData[periodData.length - 1] : null);
	const lastMetrics = $derived(lastPeriod?.metrics ?? null);

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
			const [year, week] = key.split('W');
			return `Uke ${week}, ${year}`;
		}
		if (period === 'month') {
			const [year, month] = key.split('M');
			const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Des'];
			return `${monthNames[parseInt(month) - 1] ?? month} ${year}`;
		}
		return key;
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

	function formatActivityDate(value: string): string {
		return new Intl.DateTimeFormat('nb-NO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		}).format(new Date(value));
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
		walking: '🚶',
		hiking: '🥾',
		swimming: '🏊',
		trail: '🏔️',
		trail_running: '🏔️',
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
			walking: 'Gåtur',
			hiking: 'Turgåing',
			swimming: 'Svømming',
			trail: 'Terrengløp',
			trail_running: 'Terrengløp'
		};
		return labels[sportType.toLowerCase()] ?? sportType.charAt(0).toUpperCase() + sportType.slice(1);
	}

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
					? `${windowCopy}: snitt timer søvn per natt (mål 7.5 t)`
					: `${windowCopy}: ingen søvndata registrert`,
			color: '#5fa0a0',
			pct: pctHigherBetter(sleepHoursAvg, 7.5),
			vizData: {
				current: sleepHoursAvg ?? null,
				target: 7.5
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
			pct: pctLowerBetter(sleepLagComposite, 8)
		},
		{
			id: 'steps_avg_day',
			metricId: 'steps_avg_day' as const,
			label: 'Skritt per dag',
			value: avgStepsPerDay != null ? `${formatMetric(avgStepsPerDay, 0)}` : '–',
			subvalue:
				avgStepsPerDay != null
					? `${windowCopy}: dagssnitt (mål 8 000)`
					: `${windowCopy}: ingen aktivitetsdata registrert`,
			color: '#82c882',
			pct: pctHigherBetter(avgStepsPerDay, 8000),
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
					? `${windowCopy}: dagssnitt (mål 30 min)`
					: `${windowCopy}: ingen trenings-/aktivitetstid registrert`,
			color: '#f0b429',
			pct: pctHigherBetter(avgActiveMinutesPerDay, 30)
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

	function mapWeightY(weight: number, yMin: number, yMax: number, height: number): number {
		if (yMax <= yMin) return height / 2;
		const normalized = (weight - yMin) / (yMax - yMin);
		return Math.max(0, Math.min(height, height - normalized * height));
	}

	function buildLinePath(
		points: SeriesPoint[],
		xMax: number,
		yMin: number,
		yMax: number,
		width: number,
		height: number
	): string {
		if (points.length === 0) return '';
		const safeXMax = Math.max(1, xMax);
		return points
			.map((point, index) => {
				const x = (point.x / safeXMax) * width;
				const y = mapWeightY(point.weight, yMin, yMax, height);
				return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
			})
			.join(' ');
	}

	function labelForWindow(window: WindowMode): string {
		if (window === '7d') return 'Siste 7 dager';
		if (window === '30d') return 'Siste 30 dager';
		if (window === '365d') return 'Siste 365 dager';
		if (window === 'week') return 'Inneværende uke';
		if (window === 'month') return 'Inneværende måned';
		return 'Inneværende år';
	}

	async function fetchWeightRange() {
		weightChartLoading = true;
		weightChartError = null;
		try {
			const params = new URLSearchParams({
				mode: 'range',
				startDate: rangeStartDate,
				endDate: rangeEndDate
			});

			const response = await fetch(`/api/health/weight-series?${params.toString()}`);
			if (!response.ok) throw new Error('Kunne ikke hente range-data');
			const payload = (await response.json()) as WeightRangePayload;
			weightRangeData = payload;
		} catch (error) {
			weightChartError = error instanceof Error ? error.message : 'Ukjent feil';
		} finally {
			weightChartLoading = false;
		}
	}

	async function fetchWeightComparison() {
		weightChartLoading = true;
		weightChartError = null;

		try {
			const params = new URLSearchParams({
				mode: 'comparison',
				window: comparisonWindow,
				comparisonPeriods: '4',
				goalStartDate,
				goalEndDate,
				targetWeight: goalTargetWeightInput
			});

			if (goalStartWeightInput.trim().length) {
				params.set('startWeight', goalStartWeightInput);
			}

			const activeWeightGoal = goals.find((goal) => {
				const metadata = goal.metadata as Record<string, unknown> | undefined;
				return metadata?.metricId === 'weight_change' && goal.status === 'active';
			});
			if (activeWeightGoal) {
				params.set('goalId', activeWeightGoal.id);
			}

			const response = await fetch(`/api/health/weight-series?${params.toString()}`);
			if (!response.ok) throw new Error('Kunne ikke hente sammenlikningsdata');
			const payload = (await response.json()) as WeightComparisonPayload;
			weightComparisonData = payload;

			if (!goalStartWeightInput.trim().length && payload.goal?.startWeight != null) {
				goalStartWeightInput = payload.goal.startWeight.toFixed(1);
			}
		} catch (error) {
			weightChartError = error instanceof Error ? error.message : 'Ukjent feil';
		} finally {
			weightChartLoading = false;
		}
	}

	onMount(() => {
		void loadGoalTracks();
		void fetchWeightComparison();
	});

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
			options={['7d', '30d', '365d', 'Uke', 'Måned', 'År']}
			value={selectedWindow === '7d' ? '7d' : selectedWindow === '30d' ? '30d' : selectedWindow === '365d' ? '365d' : selectedWindow === 'week' ? 'Uke' : selectedWindow === 'month' ? 'Måned' : 'År'}
			onchange={(value) => {
				selectedWindow =
					value === '7d' ? '7d' :
					value === '30d' ? '30d' :
					value === '365d' ? '365d' :
					value === 'Uke' ? 'week' :
					value === 'Måned' ? 'month' :
					'year';
			}}
		/>
	</div>

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

	{#if periodData.length === 0}
		<div class="hd-empty">
			<p>Ingen data tilgjengelig ennå.</p>
			<p class="hd-empty-sub">Koble til eller synkroniser Withings for å fylle Helse-dashbordet.</p>
		</div>
	{:else}
		<div class="hd-grid">
			{#each metricCards as card}
				<div class="hd-card">
					<div class="hd-card-ring">
						<GoalRing pct={card.pct} color={card.color} size={88} strokeWidth={6}>
							{#snippet children()}
								<text x="44" y="42" text-anchor="middle" fill={card.color} font-size="15" font-weight="700">{card.value}</text>
							{/snippet}
						</GoalRing>
					</div>
					<div class="hd-card-copy">
						<p class="hd-card-label">{card.label}</p>
						<p class="hd-card-sub">{card.subvalue}</p>
						{#if card.metricId === 'sleep_avg_night' && card.vizData}
							<div class="hd-card-viz">
								<MetricCard
									metricId="sleep_avg_night"
									size="M"
									data={card.vizData}
									height={6}
								/>
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		{#if stepsComparisonPoints.length > 1}
			<div class="hd-table-card hd-steps-trend-card">
				<div class="hd-table-head">
					<h2 class="hd-table-title">Skritttrend: nå vs snitt</h2>
					<p class="hd-table-copy">Sammenligner siste perioder med referansesnitt for valgt vindu.</p>
				</div>
				<MetricCard
					metricId="steps_avg_day"
					size="L"
					data={{ current: avgStepsPerDay ?? null, expectedByNow: stepsReferenceAvg, comparisonSeries: stepsComparisonPoints }}
					formatValue={(v) => `${formatMetric(v, 0)}`}
				/>
			</div>
		{/if}

		<div class="hd-weight-panels">
			<div class="hd-weight-card">
				<div class="hd-table-head">
					<h2 class="hd-table-title">Vektgraf fra dato til dato</h2>
					<p class="hd-table-copy">Velg start og slutt, se utvikling med kuttet y-akse.</p>
				</div>
				<div class="hd-range-controls">
					<label class="hd-field">
						<span>Start</span>
						<input type="date" bind:value={rangeStartDate} />
					</label>
					<label class="hd-field">
						<span>Slutt</span>
						<input type="date" bind:value={rangeEndDate} />
					</label>
					<button class="btn-secondary" type="button" onclick={() => void fetchWeightRange()}>
						Oppdater graf
					</button>
				</div>

				{#if weightRangeData}
					{@const width = 960}
					{@const height = 260}
					{@const path = buildLinePath(
						weightRangeData.points,
						weightRangeData.x.max,
						weightRangeData.y.min,
						weightRangeData.y.max,
						width,
						height
					)}
					<div class="hd-chart-shell">
						<svg viewBox={`0 0 ${width} ${height}`} class="hd-chart" role="img" aria-label="Vektgraf for valgt datointervall">
							<rect x="0" y="0" width={width} height={height} fill="#0f0f0f" rx="12" />
							{#if path}
								<path d={path} stroke="#7c8ef5" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" />
							{/if}
						</svg>
					</div>
					<p class="hd-chart-meta">
						{weightRangeData.range.label} · {weightRangeData.points.length} målinger · y-akse {weightRangeData.y.min.toFixed(1)} til {weightRangeData.y.max.toFixed(1)} kg
					</p>
				{/if}
			</div>

			<div class="hd-weight-card">
				<div class="hd-table-head">
					<h2 class="hd-table-title">Periodesammenlikning + mål + prognose</h2>
					<p class="hd-table-copy">Inneværende periode utheves, eldre perioder er grået ut.</p>
				</div>

				<div class="hd-range-controls hd-range-controls--dense">
					<label class="hd-field">
						<span>Periode</span>
						<select bind:value={comparisonWindow}>
							<option value="7d">Siste 7 dager</option>
							<option value="30d">Siste 30 dager</option>
							<option value="365d">Siste 365 dager</option>
							<option value="week">Inneværende uke</option>
							<option value="month">Inneværende måned</option>
							<option value="year">Inneværende år</option>
						</select>
					</label>
					<label class="hd-field">
						<span>Mål start</span>
						<input type="date" bind:value={goalStartDate} />
					</label>
					<label class="hd-field">
						<span>Mål slutt</span>
						<input type="date" bind:value={goalEndDate} />
					</label>
					<label class="hd-field">
						<span>Startvekt</span>
						<input type="text" bind:value={goalStartWeightInput} placeholder="f.eks 85.2" />
					</label>
					<label class="hd-field">
						<span>Målvekt</span>
						<input type="text" bind:value={goalTargetWeightInput} placeholder="f.eks 78.0" />
					</label>
					<button class="btn-secondary" type="button" onclick={() => void fetchWeightComparison()}>
						Beregn
					</button>
				</div>

				{#if weightComparisonData}
					{@const width = 960}
					{@const height = 280}
					<div class="hd-chart-shell">
						<svg viewBox={`0 0 ${width} ${height}`} class="hd-chart" role="img" aria-label="Sammenlikning av vektperioder med mål og prognose">
							<rect x="0" y="0" width={width} height={height} fill="#0f0f0f" rx="12" />
							{#each weightComparisonData.series as series}
								{@const seriesPath = buildLinePath(
									series.points,
									weightComparisonData.x.max,
									weightComparisonData.y.min,
									weightComparisonData.y.max,
									width,
									height
								)}
								{#if seriesPath}
									<path
										d={seriesPath}
										stroke={series.isCurrent ? '#89a0ff' : '#555'}
										stroke-width={series.isCurrent ? 3 : 2}
										stroke-opacity={series.isCurrent ? 1 : 0.55}
										fill="none"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								{/if}
							{/each}

							{#if weightComparisonData.goal?.desired?.length}
								{@const desiredPath = buildLinePath(
									weightComparisonData.goal.desired,
									weightComparisonData.x.max,
									weightComparisonData.y.min,
									weightComparisonData.y.max,
									width,
									height
								)}
								<path d={desiredPath} stroke="#77d39a" stroke-width="2" stroke-dasharray="7 6" fill="none" />
							{/if}

							{#if weightComparisonData.goal?.forecast?.points?.length}
								{@const forecastPath = buildLinePath(
									weightComparisonData.goal.forecast.points,
									weightComparisonData.x.max,
									weightComparisonData.y.min,
									weightComparisonData.y.max,
									width,
									height
								)}
								<path d={forecastPath} stroke="#f0b429" stroke-width="2" stroke-dasharray="4 5" fill="none" />
							{/if}
						</svg>
					</div>
					<p class="hd-chart-meta">
						{labelForWindow(weightComparisonData.window)} · x-akse 0-{weightComparisonData.x.max} · y-akse {weightComparisonData.y.min.toFixed(1)} til {weightComparisonData.y.max.toFixed(1)} kg
					</p>
					{#if weightComparisonData.goal}
						<p class="hd-chart-meta hd-chart-meta--goal">
							Målbane: {weightComparisonData.goal.startWeight.toFixed(1)} → {weightComparisonData.goal.targetWeight.toFixed(1)} kg. 
							Prognose ved nåværende fart: {weightComparisonData.goal.forecast.projectedEndWeight != null ? `${weightComparisonData.goal.forecast.projectedEndWeight.toFixed(1)} kg` : 'for lite data'}.
						</p>
					{/if}
				{/if}
			</div>

		</div>

		{#if weightChartLoading}
			<p class="hd-inline-status">Laster vektgrafer…</p>
		{/if}
		{#if weightChartError}
			<p class="hd-inline-error">{weightChartError}</p>
		{/if}

		<div class="hd-table-card">
			<div class="hd-table-head">
				<h2 class="hd-table-title">Perioder</h2>
				<p class="hd-table-copy">Aggregatoversikt per periode (grunnlag for raske kort og tabeller).</p>
			</div>
			<div class="hd-table-wrap">
				<table class="hd-table">
					<thead>
						<tr>
							<th>Periode</th>
							<th>Vekt</th>
							<th>Løp</th>
							<th>Aktive min</th>
							<th>Søvn</th>
							<th>Events</th>
						</tr>
					</thead>
					<tbody>
						{#each periodData as period}
							<tr>
								<td>{formatPeriodKey(period.periodKey, period.period)}</td>
								<td>{formatMetric(period.metrics?.weight?.avg)} kg</td>
								<td>{period.metrics?.workouts?.types?.running ?? 0}</td>
								<td>{formatMetric(period.metrics?.intenseMinutes?.sum, 0)}</td>
								<td>{formatMetric(period.metrics?.sleep?.avg)} t</td>
								<td>{period.eventCount}</td>
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
				<h2 class="hd-section-title">Treningsøkter</h2>
				<div class="hd-activity-list">
					{#each activities.slice(0, 20) as act}
						{@const trackEventId = act.evidence.find(e => e.hasTrackPoints)?.eventId ?? null}
						{@const discrepancies = sourceDiscrepancies(act.evidence)}
						<a class="hd-activity-row" href="/aktivitet/{act.activityId}">
							<div class="hd-activity-icon">{sportIcon(act.sportType)}</div>
							<div class="hd-activity-info">
								<span class="hd-activity-label">{sportLabel(act.sportType)}</span>
								<span class="hd-activity-meta">
									{formatActivityDate(act.startTime)}
									{#if act.distanceMeters}· {(act.distanceMeters / 1000).toFixed(1)} km{/if}
									{#if act.durationSeconds}· {formatDuration(act.durationSeconds)}{/if}
									{#if act.avgHeartRate}· ♥ {act.avgHeartRate} bpm{/if}
									{#if act.paceSecondsPerKm && act.sportType === 'running'}· {formatPace(act.paceSecondsPerKm)}{/if}
								</span>
								{#if act.evidence.length > 0}
									<span class="hd-activity-sources">
										{#each act.evidence as ev}
											<span class="hd-source-chip" class:hd-source-chip-track={ev.hasTrackPoints}>
												{providerLabel(ev.provider, ev.sensorType)}
												{#if ev.distanceMeters !== null}{(ev.distanceMeters / 1000).toFixed(1)} km{/if}
												{#if ev.durationSeconds !== null}· {formatDuration(ev.durationSeconds)}{/if}
												{#if ev.avgHeartRate !== null}· ♥ {ev.avgHeartRate}{/if}
											</span>
										{/each}
									</span>
								{/if}
								{#if discrepancies.length > 0}
									<span class="hd-activity-discrepancy">⚠ {discrepancies.join(' | ')}</span>
								{/if}
							</div>
							{#if trackEventId}
								<button
									class="hd-map-btn"
									class:hd-map-btn-active={mapEventId === trackEventId}
									onclick={(e) => { e.preventDefault(); openMap(trackEventId); }}
									title="Vis kart"
								>
									{mapLoading && mapEventId === trackEventId ? '…' : '🗺️'}
								</button>
							{/if}
						</a>
						{#if mapEventId === trackEventId}
							<div class="hd-map-panel">
								{#if mapLoading}
									<div class="hd-map-loading">Laster kart…</div>
								{:else}
									<GpxMapSvg points={mapPoints} />
								{/if}
							</div>
						{/if}
					{/each}
				</div>
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
	.hd-card,
	.hd-tooling-card {
		background: #141414;
		border-radius: 18px;
	}

	.hd-tooling-card {
		padding: 14px 16px;
	}

	.hd-empty {
		padding: 28px 20px;
		text-align: center;
		color: #aaa;
	}

	.hd-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
		gap: 12px;
	}

	.hd-card {
		padding: 14px 12px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		text-align: center;
	}

	.hd-card-copy {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.hd-card-label,
	.hd-table-title {
		margin: 0;
		font-size: 0.88rem;
		font-weight: 700;
		color: #e7e7e7;
	}

	.hd-card-sub {
		margin: 0;
		font-size: 0.74rem;
		color: #777;
	}

	.hd-card-viz {
		margin-top: 8px;
		width: 100%;
	}

	.hd-steps-trend-card {
		margin-top: 12px;
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
		gap: 4px;
	}

	.hd-table-wrap {
		overflow-x: auto;
	}

	.hd-table {
		width: 100%;
		border-collapse: collapse;
		min-width: 620px;
	}

	.hd-table th,
	.hd-table td {
		text-align: left;
		padding: 12px 10px;
		border-top: 1px solid #202020;
		font-size: 0.8rem;
	}

	.hd-table th {
		border-top: none;
		color: #666;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.hd-table td {
		color: #ccc;
	}

	.hd-weight-panels {
		display: grid;
		gap: 12px;
	}

	.hd-weight-card {
		background: #141414;
		border-radius: 18px;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.hd-range-controls {
		display: grid;
		gap: 10px;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		align-items: end;
	}

	.hd-range-controls--dense {
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
	}

	.hd-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.78rem;
		color: #8d8d8d;
	}

	.hd-field input,
	.hd-field select {
		height: 36px;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #101010;
		color: #e5e5e5;
		padding: 0 10px;
	}

	.hd-chart-shell {
		width: 100%;
		overflow: hidden;
		border-radius: 12px;
		border: 1px solid #222;
	}

	.hd-chart {
		display: block;
		width: 100%;
		height: auto;
		background: #0f0f0f;
	}

	.hd-chart-meta {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.45;
		color: #8a8a8a;
	}

	.hd-chart-meta--goal {
		color: #b4b4b4;
	}


	.hd-inline-status,
	.hd-inline-error {
		margin: 0;
		font-size: 0.8rem;
		line-height: 1.4;
	}

	.hd-inline-status {
		color: #8d8d8d;
	}

	.hd-inline-error {
		color: #d88e8e;
	}

	@media (max-width: 640px) {
		.hd-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}

		.hd-range-controls,
		.hd-range-controls--dense {
			grid-template-columns: 1fr;
		}

		.hd-title {
			font-size: 1.32rem;
		}

		.hd-card-label,
		.hd-table-title {
			font-size: 0.94rem;
		}

		.hd-card-sub,
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

	.hd-activity-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.hd-activity-row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 8px;
		border-radius: 10px;
		transition: background 0.12s;
		text-decoration: none;
		color: inherit;
		cursor: pointer;
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
		font-size: 0.9rem;
		font-weight: 600;
		color: #ddd;
	}

	.hd-activity-meta {
		font-size: 0.78rem;
		color: #888;
	}

	.hd-activity-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 3px;
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
		margin-top: 2px;
		display: block;
	}

	.hd-map-btn {
		flex-shrink: 0;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 6px 10px;
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		transition: all 0.12s;
		color: #bbb;
	}

	.hd-map-btn:hover {
		background: #282828;
		border-color: #3a3a3a;
	}

	.hd-map-btn-active {
		background: #1a2040;
		border-color: #4a9eff;
	}

	.hd-map-panel {
		margin: 4px 0 8px 44px;
		border-radius: 10px;
		overflow: hidden;
	}

	.hd-map-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 120px;
		color: #555;
		font-size: 0.85rem;
		background: #0d1117;
		border-radius: 10px;
	}
</style>
