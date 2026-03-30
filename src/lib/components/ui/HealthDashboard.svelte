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
	import CompactRecordList from './CompactRecordList.svelte';
	import GoalRing from './GoalRing.svelte';
	import PeriodPills from './PeriodPills.svelte';

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

	interface Props {
		weekly: AggregatePeriod[];
		monthly: AggregatePeriod[];
		yearly: AggregatePeriod[];
		sources?: Array<{ id: string; name: string; provider: string; isActive: boolean; lastSync: string | null }>;
		recentEvents?: Array<{ id: string; timestamp: string; dataType: string; data: Record<string, unknown> }>;
		embedded?: boolean;
		goals?: Goal[];
	}

	let { weekly, monthly, yearly, sources = [], recentEvents = [], embedded = false, goals = [] }: Props = $props();

	let selectedWindow = $state<WindowMode>('30d');
	let runningGoalWeekInput = $state('20');
	let runningGoalQuarterInput = $state('150');
	let runningGoalYearInput = $state('1000');
	let weightGoalShortInput = $state('-3');
	let weightGoalLongInput = $state('-20');
	let showEventDetails = $state(false);

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
			label: 'Søvn per natt',
			value: sleepHoursAvg != null ? `${formatMetric(sleepHoursAvg)} t` : '–',
			subvalue:
				sleepHoursAvg != null
					? `${windowCopy}: snitt timer søvn per natt (mål 7.5 t)`
					: `${windowCopy}: ingen søvndata registrert`,
			color: '#5fa0a0',
			pct: pctHigherBetter(sleepHoursAvg, 7.5)
		},
		{
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
			label: 'Skritt per dag',
			value: avgStepsPerDay != null ? `${formatMetric(avgStepsPerDay, 0)}` : '–',
			subvalue:
				avgStepsPerDay != null
					? `${windowCopy}: dagssnitt (mål 8 000)`
					: `${windowCopy}: ingen aktivitetsdata registrert`,
			color: '#82c882',
			pct: pctHigherBetter(avgStepsPerDay, 8000)
		},
		{
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
					</div>
				</div>
			{/each}
		</div>

		<div class="hd-table-card">
			<div class="hd-table-head">
				<h2 class="hd-table-title">Perioder</h2>
				<p class="hd-table-copy">Ingen nye grafer her ennå. Sammenligningsgraf legges i design før den brukes i appen.</p>
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
	.hd-card {
		background: #141414;
		border-radius: 18px;
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

	@media (max-width: 640px) {
		.hd-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
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
</style>
