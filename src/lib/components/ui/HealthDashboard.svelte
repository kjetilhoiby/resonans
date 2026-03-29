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

	interface Props {
		weekly: AggregatePeriod[];
		monthly: AggregatePeriod[];
		yearly: AggregatePeriod[];
		sources?: Array<{ id: string; name: string; provider: string; isActive: boolean; lastSync: string | null }>;
		recentEvents?: Array<{ id: string; timestamp: string; dataType: string; data: Record<string, unknown> }>;
		embedded?: boolean;
	}

	let { weekly, monthly, yearly, sources = [], recentEvents = [], embedded = false }: Props = $props();

	let selectedWindow = $state<WindowMode>('30d');
	let runningGoalWeekInput = $state('20');
	let runningGoalQuarterInput = $state('150');
	let runningGoalYearInput = $state('1000');
	let runningGoalSaving = $state(false);
	let runningGoalError = $state('');
	let weightGoalShortInput = $state('-3');
	let weightGoalLongInput = $state('-20');
	let weightSeasonSpringInput = $state('1.4');
	let weightSeasonSummerInput = $state('1.2');
	let weightSeasonAutumnInput = $state('0.3');
	let weightSeasonWinterInput = $state('0.1');
	let weightGoalSaving = $state(false);
	let weightGoalError = $state('');

	const aggregatePeriod = $derived<'week' | 'month' | 'year'>(
		selectedWindow === 'month' ? 'month' : selectedWindow === 'year' ? 'year' : 'week'
	);
	const periodData = $derived(
		aggregatePeriod === 'week' ? weekly : aggregatePeriod === 'month' ? monthly : yearly
	);
	const lastPeriod = $derived(periodData.length ? periodData[periodData.length - 1] : null);
	const lastMetrics = $derived(lastPeriod?.metrics ?? null);

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
		const spring = Number.parseFloat(weightSeasonSpringInput.replace(',', '.'));
		const summer = Number.parseFloat(weightSeasonSummerInput.replace(',', '.'));
		const autumn = Number.parseFloat(weightSeasonAutumnInput.replace(',', '.'));
		const winter = Number.parseFloat(weightSeasonWinterInput.replace(',', '.'));

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
			priority: 95,
			metadata: {
				seasonalProfile: {
					spring: Number.isFinite(spring) ? spring : 1.4,
					summer: Number.isFinite(summer) ? summer : 1.2,
					autumn: Number.isFinite(autumn) ? autumn : 0.3,
					winter: Number.isFinite(winter) ? winter : 0.1
				}
			}
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

	const metricCards = $derived([
		{
			label: 'Akkumulert løpedistanse',
			value: runningKm > 0 ? `${runningKm.toFixed(1)} km` : '–',
			subvalue: runningTrackMatch
				? `${runningTrackMatch.track.label} · mål ${runningTargetForWindow.toFixed(1)} km`
				: 'mål ikke satt',
			color: runningRingColor,
			pct: runningPct
		},
		{
			label: 'Snitt søvn / natt',
			value: sleepHoursAvg != null ? `${formatMetric(sleepHoursAvg)} t` : '–',
			subvalue: 'søvnmengde per natt',
			color: '#5fa0a0',
			pct: pctHigherBetter(sleepHoursAvg, 7.5)
		},
		{
			label: 'Søvnlag',
			value: sleepLagComposite != null ? formatMetric(sleepLagComposite, 1) : '–',
			subvalue: '22-00 manglende + 06-08 søvn',
			color: '#7b9aa8',
			pct: pctLowerBetter(sleepLagComposite, 8)
		},
		{
			label: 'Snitt skritt / dag',
			value: avgStepsPerDay != null ? `${formatMetric(avgStepsPerDay, 0)}` : '–',
			subvalue: 'skritt per dag',
			color: '#82c882',
			pct: pctHigherBetter(avgStepsPerDay, 8000)
		},
		{
			label: 'Snitt aktive min / dag',
			value: avgActiveMinutesPerDay != null ? `${formatMetric(avgActiveMinutesPerDay, 0)}` : '–',
			subvalue: 'aktive minutter per dag',
			color: '#f0b429',
			pct: pctHigherBetter(avgActiveMinutesPerDay, 30)
		},
		{
			label: 'Endring i vekt',
			value: formatSigned(weightDelta, 'kg', 2),
			subvalue: weightTrackMatch
				? `${weightTrackMatch.track.label} · mål ${formatSigned(weightProjectedTarget, 'kg', 2)}`
				: 'pluss/minus i valgt periode',
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
				const seasonal = longTrack?.metadata?.seasonalProfile;
				if (seasonal?.spring) weightSeasonSpringInput = String(seasonal.spring);
				if (seasonal?.summer) weightSeasonSummerInput = String(seasonal.summer);
				if (seasonal?.autumn) weightSeasonAutumnInput = String(seasonal.autumn);
				if (seasonal?.winter) weightSeasonWinterInput = String(seasonal.winter);
			}
		} catch {
			// stille feil, defaults brukes
		}
	}

	async function saveRunningGoal() {
		const week = Number.parseFloat(runningGoalWeekInput.replace(',', '.'));
		const quarter = Number.parseFloat(runningGoalQuarterInput.replace(',', '.'));
		const year = Number.parseFloat(runningGoalYearInput.replace(',', '.'));

		if (!Number.isFinite(week) || week <= 0 || !Number.isFinite(quarter) || quarter <= 0 || !Number.isFinite(year) || year <= 0) {
			runningGoalError = 'Skriv gyldige mål over 0 for uke, kvartal og år.';
			return;
		}
		if (week * 52 > year * 1.25) {
			runningGoalError = 'Ukesmålet ser uforholdsmessig høyt ut mot årsmålet. Juster tallene litt.';
			return;
		}

		runningGoalSaving = true;
		runningGoalError = '';

		try {
			const payload: GoalTrack[] = [
				{ id: 'run-week', metricId: 'running_distance', label: 'Løping per uke', kind: 'level', window: 'week', targetValue: week, unit: 'km', priority: 100 },
				{ id: 'run-quarter', metricId: 'running_distance', label: 'Løping per kvartal', kind: 'level', window: 'quarter', targetValue: quarter, unit: 'km', priority: 95 },
				{ id: 'run-year', metricId: 'running_distance', label: 'Løping per år', kind: 'level', window: 'year', targetValue: year, unit: 'km', priority: 90 }
			];
			const res = await fetch('/api/goal-tracks/running_distance', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tracks: payload })
			});
			if (!res.ok) throw new Error('save_failed');
			runningGoalWeekInput = week.toString();
			runningGoalQuarterInput = quarter.toString();
			runningGoalYearInput = year.toString();
		} catch {
			runningGoalError = 'Klarte ikke lagre mål akkurat nå.';
		} finally {
			runningGoalSaving = false;
		}
	}

	async function saveWeightGoal() {
		const shortTarget = Number.parseFloat(weightGoalShortInput.replace(',', '.'));
		const longTarget = Number.parseFloat(weightGoalLongInput.replace(',', '.'));
		const spring = Number.parseFloat(weightSeasonSpringInput.replace(',', '.'));
		const summer = Number.parseFloat(weightSeasonSummerInput.replace(',', '.'));
		const autumn = Number.parseFloat(weightSeasonAutumnInput.replace(',', '.'));
		const winter = Number.parseFloat(weightSeasonWinterInput.replace(',', '.'));

		if (!Number.isFinite(shortTarget) || !Number.isFinite(longTarget)) {
			weightGoalError = 'Skriv gyldige vekttall for begge mål.';
			return;
		}
		if (!Number.isFinite(spring) || !Number.isFinite(summer) || !Number.isFinite(autumn) || !Number.isFinite(winter)) {
			weightGoalError = 'Sesongvekter må være gyldige tall.';
			return;
		}

		weightGoalSaving = true;
		weightGoalError = '';
		try {
			const payload: GoalTrack[] = [
				{
					id: 'weight-short',
					metricId: 'weight_change',
					label: 'Vektmål 2 måneder',
					kind: 'change',
					window: 'custom',
					durationDays: 60,
					targetValue: shortTarget,
					unit: 'kg',
					priority: 100
				},
				{
					id: 'weight-long',
					metricId: 'weight_change',
					label: 'Vektmål 2 år',
					kind: 'trajectory',
					window: 'custom',
					durationDays: 730,
					targetValue: longTarget,
					unit: 'kg',
					priority: 95,
					metadata: {
						seasonalProfile: { spring, summer, autumn, winter }
					}
				}
			];

			const res = await fetch('/api/goal-tracks/weight_change', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ tracks: payload })
			});
			if (!res.ok) throw new Error('save_failed');
		} catch {
			weightGoalError = 'Klarte ikke lagre vektmål akkurat nå.';
		} finally {
			weightGoalSaving = false;
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

	<div class="hd-goal-inline">
		<label class="hd-goal-label" for="running-goal-week">Løpemål (uke / kvartal / år)</label>
		<div class="hd-goal-controls">
			<input
				id="running-goal-week"
				class="hd-goal-input"
				type="number"
				step="0.5"
				min="1"
				bind:value={runningGoalWeekInput}
			/>
			<input
				class="hd-goal-input"
				type="number"
				step="1"
				min="1"
				bind:value={runningGoalQuarterInput}
			/>
			<input
				class="hd-goal-input"
				type="number"
				step="1"
				min="1"
				bind:value={runningGoalYearInput}
			/>
			<button class="hd-goal-save" type="button" onclick={saveRunningGoal} disabled={runningGoalSaving}>
				{runningGoalSaving ? 'Lagrer…' : 'Lagre'}
			</button>
		</div>
		{#if runningGoalError}
			<p class="hd-goal-error">{runningGoalError}</p>
		{/if}
	</div>

	<div class="hd-goal-inline">
		<label class="hd-goal-label" for="weight-goal-short">Vektmål (2 mnd / 2 år + sesongprofil)</label>
		<div class="hd-goal-controls">
			<input
				id="weight-goal-short"
				class="hd-goal-input"
				type="number"
				step="0.1"
				bind:value={weightGoalShortInput}
			/>
			<input
				class="hd-goal-input"
				type="number"
				step="0.1"
				bind:value={weightGoalLongInput}
			/>
			<input class="hd-goal-input hd-goal-input-mini" type="number" step="0.1" bind:value={weightSeasonSpringInput} title="Vår" />
			<input class="hd-goal-input hd-goal-input-mini" type="number" step="0.1" bind:value={weightSeasonSummerInput} title="Sommer" />
			<input class="hd-goal-input hd-goal-input-mini" type="number" step="0.1" bind:value={weightSeasonAutumnInput} title="Høst" />
			<input class="hd-goal-input hd-goal-input-mini" type="number" step="0.1" bind:value={weightSeasonWinterInput} title="Vinter" />
			<button class="hd-goal-save" type="button" onclick={saveWeightGoal} disabled={weightGoalSaving}>
				{weightGoalSaving ? 'Lagrer…' : 'Lagre'}
			</button>
		</div>
		{#if weightGoalError}
			<p class="hd-goal-error">{weightGoalError}</p>
		{/if}
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

		<div class="hd-list-grid">
			<CompactRecordList title="Kilder" items={sourceItems} emptyText="Ingen aktive helsekilder ennå." />
			<CompactRecordList title="Nylige helsehendelser" items={eventItems} emptyText="Ingen hendelser registrert ennå." />
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

	.hd-pills {
		display: inline-flex;
	}

	.hd-goal-inline {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid #232323;
		background: #141414;
		border-radius: 14px;
	}

	.hd-goal-label {
		font-size: 0.78rem;
		color: #9b9b9b;
	}

	.hd-goal-controls {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.hd-goal-input {
		width: 92px;
		background: #101010;
		border: 1px solid #2c2c2c;
		border-radius: 10px;
		padding: 8px 10px;
		color: #ddd;
		font: inherit;
		font-size: 0.86rem;
	}

	.hd-goal-input-mini {
		width: 64px;
	}

	.hd-goal-input:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.hd-goal-save {
		background: #293560;
		color: #d5defe;
		border: 1px solid #3a4a85;
		border-radius: 10px;
		padding: 8px 12px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}

	.hd-goal-save:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.hd-goal-error {
		margin: 0;
		font-size: 0.76rem;
		color: #e07070;
	}

	.hd-empty,
	.hd-table-card,
	.hd-card {
		background: #141414;
		border: 1px solid #232323;
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

	.hd-list-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 12px;
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

	@media (min-width: 920px) {
		.hd-list-grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>