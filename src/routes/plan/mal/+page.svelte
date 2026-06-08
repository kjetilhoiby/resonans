<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';
	import MetricCard from '$lib/components/visualizations/MetricCard.svelte';
	import TrajectoryChart from '$lib/components/visualizations/TrajectoryChart.svelte';
	type GoalTrackMeta = {
		kind?: string | null;
		window?: string | null;
		targetValue?: number | null;
		unit?: string | null;
		durationDays?: number | null;
	};

	type GoalItem = {
		id: string;
		title: string;
		description: string | null;
		status: string;
		targetDate: Date | null;
		metadata: {
			metricId?: string | null;
			startDate?: string | null;
			endDate?: string | null;
			goalTrack?: GoalTrackMeta | null;
			intentStatus?: 'pending' | 'parsed' | 'failed' | null;
			intentError?: string | null;
			intentEvaluation?: {
				signalType?: string;
				window?: string;
				windowStart?: string;
				windowEnd?: string;
				currentValue?: number;
				targetValue?: number;
				comparator?: string;
				met?: boolean;
				lastEvaluatedAt?: string;
			} | null;
		} | null;
		createdAt: Date;
		category: {
			name: string;
			icon: string | null;
		} | null;
		tasks: Array<{
			id: string;
			title: string;
			frequency: string | null;
			status: string;
			targetValue: number | null;
			unit: string | null;
			progress: Array<{
				id: string;
				value: number | null;
				note: string | null;
				completedAt: Date;
				activity: {
					id: string;
					type: string;
					completedAt: Date;
					duration: number | null;
					note: string | null;
					metadata: any;
					metrics: Array<{
						id: string;
						metricType: string;
						value: string;
						unit: string | null;
					}>;
				} | null;
			}>;
		}>;
	};

	type WeightProgress = {
		startDate: string;
		endDate: string;
		currentWeight: number;
		startWeight: number;
		targetWeight: number;
		points: { date: string; weight: number }[];
		pct: number;
	};

	interface Props {
		data: {
			goals: GoalItem[];
			sensorProgressMap: Record<string, { currentKm: number; targetKm: number; startDate: string; endDate: string; dailyKm: { date: string; km: number }[] }>;
			weightProgressMap: Record<string, WeightProgress>;
		};
	}

	let { data }: Props = $props();

	function calculateTaskProgress(task: GoalItem['tasks'][number]): number {
		if (!task.targetValue || !task.progress || task.progress.length === 0) {
			return task.progress && task.progress.length > 0 ? 100 : 0;
		}

		const totalValue = task.progress.reduce((sum, entry) => sum + (entry.value || 0), 0);
		return Math.min(Math.round((totalValue / task.targetValue) * 100), 100);
	}

	function calculateGoalProgress(goal: GoalItem): number {
		if (goal.tasks.length === 0) return 0;
		const taskProgresses = goal.tasks.map(calculateTaskProgress);
		const avgProgress = taskProgresses.reduce((sum, pct) => sum + pct, 0) / taskProgresses.length;
		return Math.round(avgProgress);
	}

	const METRIC_DEFAULT_UNITS: Record<string, string> = {
		running_distance: 'km',
		weight_change: 'kg',
		sleep_avg_night: 't',
		steps_avg_day: 'skritt',
		active_minutes_avg_day: 'min',
		grocery_spend: 'kr'
	};

	const WINDOW_LABELS: Record<string, string> = {
		'7d': 'i uka',
		week: 'i uka',
		'30d': 'i måneden',
		month: 'i måneden',
		quarter: 'i kvartalet',
		year: 'i året',
		'365d': 'i året'
	};

	function parseDateOnly(iso: string | null | undefined): Date | null {
		if (!iso) return null;
		const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
		if (!m) return null;
		return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
	}

	function isFirstDayOfMonth(date: Date): boolean {
		return date.getDate() === 1;
	}

	function isLastDayOfMonth(date: Date): boolean {
		const next = new Date(date);
		next.setDate(next.getDate() + 1);
		return next.getDate() === 1;
	}

	function formatShortDate(date: Date): string {
		return date.toLocaleDateString('no-NO', { day: 'numeric', month: 'short' });
	}

	function derivePeriodLabel(opts: {
		window: string | null | undefined;
		durationDays: number | null | undefined;
		startDate: string | null | undefined;
		endDate: string | null | undefined;
	}): string {
		const start = parseDateOnly(opts.startDate);
		const end = parseDateOnly(opts.endDate);

		if (start && end) {
			const sameYear = start.getFullYear() === end.getFullYear();

			if (isFirstDayOfMonth(start) && isLastDayOfMonth(end) && sameYear) {
				if (start.getMonth() === end.getMonth()) {
					return `i ${start.toLocaleDateString('no-NO', { month: 'long' })}`;
				}
				if (start.getMonth() === 0 && end.getMonth() === 11) {
					return `i ${start.getFullYear()}`;
				}
				const a = start.toLocaleDateString('no-NO', { month: 'long' });
				const b = end.toLocaleDateString('no-NO', { month: 'long' });
				return `${a}–${b} ${start.getFullYear()}`;
			}

			return `${formatShortDate(start)} – ${formatShortDate(end)}`;
		}

		if (opts.window === 'custom') {
			return opts.durationDays ? `over ${opts.durationDays} dager` : '';
		}
		return opts.window ? WINDOW_LABELS[opts.window] ?? '' : '';
	}

	function formatGoalTrack(goal: GoalItem): string | null {
		const track = goal.metadata?.goalTrack;
		if (!track || typeof track.targetValue !== 'number') return null;

		const metricId = goal.metadata?.metricId ?? '';
		const unit = track.unit || METRIC_DEFAULT_UNITS[metricId] || '';
		const valueStr = unit ? `${track.targetValue} ${unit}` : `${track.targetValue}`;

		const periodStr = derivePeriodLabel({
			window: track.window,
			durationDays: track.durationDays,
			startDate: goal.metadata?.startDate,
			endDate: goal.metadata?.endDate
		});

		return periodStr ? `${valueStr} ${periodStr}` : valueStr;
	}

	function getIntentBadge(goal: GoalItem):
		| { label: string; tone: 'pending' | 'parsed' | 'failed' }
		| null {
		const status = goal.metadata?.intentStatus;
		if (status === 'pending') return { label: 'Tolkes...', tone: 'pending' };
		if (status === 'parsed') return { label: 'Aktiv sporing', tone: 'parsed' };
		if (status === 'failed') return { label: 'Trenger avklaring', tone: 'failed' };
		return null;
	}

	function getIntentEvaluationLabel(goal: GoalItem): string | null {
		const e = goal.metadata?.intentEvaluation;
		if (!e) return null;
		if (typeof e.currentValue !== 'number' || typeof e.targetValue !== 'number') return null;
		if (e.targetValue <= 0) return null;

		const pct = Math.max(0, Math.min(100, Math.round((e.currentValue / e.targetValue) * 100)));
		const metText = e.met ? 'oppnådd' : 'pågår';
		return `${e.currentValue}/${e.targetValue} denne uka (${pct}%) · ${metText}`;
	}

	function getIntentFailureReasonLabel(goal: GoalItem): string | null {
		if (goal.metadata?.intentStatus !== 'failed') return null;
		const reason = goal.metadata?.intentError;
		if (!reason) return null;

		const reasonMap: Record<string, string> = {
			empty_text: 'Ingen tekst å tolke.',
			unsupported_activity: 'Støtter foreløpig bare løpemål i denne flyten.',
			unsupported_period_or_threshold: 'Fant ikke tydelig frekvens som "X ganger per uke".',
			invalid_threshold: 'Kunne ikke lese målverdi for antall per uke.',
			unknown: 'Ukjent parse-feil.'
		};

		return reasonMap[reason] ?? `Tolking feilet (${reason}).`;
	}

	let expandedGoals = $state<Set<string>>(new Set());
	let assessment = $state<string | null>(null);
	let assessmentLoading = $state(false);

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const goalId = params.get('goal');
		if (goalId) {
			expandedGoals = new Set([goalId]);
			requestAnimationFrame(() => {
				document.getElementById(`goal-${goalId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
			});
		}

		void loadAssessment();
	});

	async function loadAssessment() {
		const goalsForAssessment = activeGoals
			.filter((g) => g.status === 'active')
			.map((goal) => buildGoalAssessmentInput(goal));
		if (goalsForAssessment.length === 0) return;

		assessmentLoading = true;
		try {
			const res = await fetch('/api/goals/progress-assessment', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ goals: goalsForAssessment })
			});
			if (!res.ok) return;
			const result = await res.json();
			assessment = typeof result?.assessment === 'string' ? result.assessment : null;
		} catch (error) {
			console.warn('[goals] kunne ikke hente fremdriftsvurdering:', error);
		} finally {
			assessmentLoading = false;
		}
	}

	function buildGoalAssessmentInput(goal: GoalItem) {
		const sensor = data.sensorProgressMap[goal.id];
		const weight = data.weightProgressMap[goal.id];

		let progress: string | undefined;
		let pace: string | undefined;

		if (sensor) {
			const pct = sensor.targetKm > 0
				? Math.min(100, Math.round((sensor.currentKm / sensor.targetKm) * 100))
				: 0;
			progress = `${sensor.currentKm} av ${sensor.targetKm} km (${pct}%)`;
			const estimate = computePaceEstimate({
				startDate: sensor.startDate,
				endDate: sensor.endDate,
				startValue: 0,
				currentValue: sensor.currentKm,
				targetValue: sensor.targetKm,
				unit: 'km',
				formatValue: formatMetricValue
			});
			if (estimate) pace = `${estimate.diffLabel}; ${estimate.estimateLabel}`;
		} else if (weight) {
			progress = `${weight.currentWeight} kg mot mål ${weight.targetWeight} kg (${weight.pct}%)`;
			const estimate = computePaceEstimate({
				startDate: weight.startDate,
				endDate: weight.endDate,
				startValue: weight.startWeight,
				currentValue: weight.currentWeight,
				targetValue: weight.targetWeight,
				unit: 'kg',
				formatValue: formatMetricValue
			});
			if (estimate) pace = `${estimate.diffLabel}; ${estimate.estimateLabel}`;
		} else if (goal.tasks.length > 0) {
			progress = `${calculateGoalProgress(goal)}% av oppgavene`;
		} else if (goal.metadata?.intentEvaluation) {
			const label = getIntentEvaluationLabel(goal);
			if (label) progress = label;
		}

		const endIso = goal.metadata?.endDate
			?? (goal.targetDate ? new Date(goal.targetDate).toISOString().slice(0, 10) : undefined);

		return { title: goal.title, progress, deadline: endIso, pace };
	}

	function toggleGoal(id: string) {
		const next = new Set(expandedGoals);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedGoals = next;
	}

	function formatDate(iso: string | null | undefined): string | null {
		if (!iso) return null;
		return new Date(iso).toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	function clampPct(value: number): number {
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.min(100, Math.round(value)));
	}


	type PaceEstimate = {
		diffLabel: string;
		diffTone: 'ahead' | 'behind' | 'neutral';
		estimateLabel: string;
		estimateTone: 'ahead' | 'behind' | 'neutral';
	};

	function computePaceEstimate(opts: {
		startDate: string;
		endDate: string;
		startValue: number;
		currentValue: number;
		targetValue: number;
		unit: string;
		formatValue: (v: number) => string;
	}): PaceEstimate | null {
		const startMs = new Date(`${opts.startDate}T12:00:00Z`).getTime();
		const endMs = new Date(`${opts.endDate}T12:00:00Z`).getTime();
		const nowMs = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime();
		const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000));
		const daysElapsed = Math.max(0, Math.min(totalDays, Math.round((nowMs - startMs) / 86400000)));
		if (daysElapsed <= 0) return null;

		const totalChange = opts.targetValue - opts.startValue;
		const direction = totalChange === 0 ? 1 : Math.sign(totalChange);

		const expectedAtNow = opts.startValue + (daysElapsed / totalDays) * totalChange;
		const signedDiff = (opts.currentValue - expectedAtNow) * direction;
		const absDiff = Math.abs(signedDiff);

		let diffTone: PaceEstimate['diffTone'];
		let diffLabel: string;
		if (absDiff < 0.5) {
			diffTone = 'neutral';
			diffLabel = 'På skjema';
		} else if (signedDiff > 0) {
			diffTone = 'ahead';
			diffLabel = `${opts.formatValue(absDiff)} ${opts.unit} foran plan`;
		} else {
			diffTone = 'behind';
			diffLabel = `${opts.formatValue(absDiff)} ${opts.unit} bak plan`;
		}

		const ratePerDay = (opts.currentValue - opts.startValue) / daysElapsed;
		const projected = opts.startValue + ratePerDay * totalDays;
		const projectedSignedDiff = (projected - opts.targetValue) * direction;
		const projectedAbsDiff = Math.abs(projected - opts.targetValue);

		let estimateTone: PaceEstimate['estimateTone'];
		let estimateSuffix = '';
		if (projectedAbsDiff < 0.5) {
			estimateTone = 'neutral';
		} else if (projectedSignedDiff > 0) {
			estimateTone = 'ahead';
			estimateSuffix = ` (${opts.formatValue(projectedAbsDiff)} ${opts.unit} over mål)`;
		} else {
			estimateTone = 'behind';
			estimateSuffix = ` (${opts.formatValue(projectedAbsDiff)} ${opts.unit} under mål)`;
		}

		const estimateLabel = `Estimat ved dagens snitt: ~${opts.formatValue(projected)} ${opts.unit}${estimateSuffix}`;

		return { diffLabel, diffTone, estimateLabel, estimateTone };
	}

	function formatMetricValue(value: number): string {
		return `${Math.round(value * 10) / 10}`;
	}

	async function deleteGoal(goalId: string, goalTitle: string) {
		const confirmed = confirm(`Er du sikker på at du vil slette målet "${goalTitle}"? Dette vil også slette alle oppgaver og fremgang knyttet til målet.`);
		if (!confirmed) return;

		try {
			const response = await fetch(`/goals?id=${goalId}`, {
				method: 'DELETE'
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error || 'Kunne ikke slette målet');
			}
			data.goals = data.goals.filter((g) => g.id !== goalId);
			const { [goalId]: _s, ...restSensor } = data.sensorProgressMap;
			data.sensorProgressMap = restSensor;
			const { [goalId]: _w, ...restWeight } = data.weightProgressMap;
			data.weightProgressMap = restWeight;
		} catch (error) {
			alert(`Feil ved sletting: ${error instanceof Error ? error.message : 'Ukjent feil'}`);
		}
	}

	async function archiveGoal(goalId: string) {
		try {
			const response = await fetch(`/api/goals/${goalId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'archived' })
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error || 'Kunne ikke arkivere målet');
			}
			data.goals = data.goals.map((g) => g.id === goalId ? { ...g, status: 'archived' } : g);
			expandedGoals = new Set([...expandedGoals].filter((id) => id !== goalId));
		} catch (error) {
			alert(`Feil ved arkivering: ${error instanceof Error ? error.message : 'Ukjent feil'}`);
		}
	}

	async function unarchiveGoal(goalId: string) {
		try {
			const response = await fetch(`/api/goals/${goalId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ status: 'active' })
			});
			const result = await response.json();
			if (!response.ok) {
				throw new Error(result.error || 'Kunne ikke gjenopprette målet');
			}
			data.goals = data.goals.map((g) => g.id === goalId ? { ...g, status: 'active' } : g);
		} catch (error) {
			alert(`Feil ved gjenoppretting: ${error instanceof Error ? error.message : 'Ukjent feil'}`);
		}
	}

	let archivedExpanded = $state(false);

	const activeGoals = $derived(data.goals.filter((g) => g.status !== 'archived'));
	const archivedGoals = $derived(data.goals.filter((g) => g.status === 'archived'));
</script>

<div class="goals-page-shell">
	{#if assessmentLoading || assessment}
		<p class="progress-assessment" class:loading={assessmentLoading && !assessment}>
			{assessment ?? 'Vurderer fremdriften…'}
		</p>
	{/if}

	<main class="content">
		{#if activeGoals.length === 0 && archivedGoals.length === 0}
			<div class="empty-state">
				<div class="empty-icon"><Icon name="goals" size={48} /></div>
				<p>Ingen mål ennå</p>
				<a href="/" class="btn-primary">Start i chatten</a>
			</div>
		{:else}
			<div class="goals-list">
				{#each activeGoals as goal}
					{@const goalProgress = calculateGoalProgress(goal)}
					{@const goalTrackLabel = formatGoalTrack(goal)}
					{@const intentBadge = getIntentBadge(goal)}
					{@const intentEvaluationLabel = getIntentEvaluationLabel(goal)}
					{@const intentFailureReason = getIntentFailureReasonLabel(goal)}
					{@const isExpanded = expandedGoals.has(goal.id)}
					{@const startDate = formatDate(goal.metadata?.startDate)}
					{@const endDate = formatDate(goal.metadata?.endDate)}
					{@const sensorProgress = data.sensorProgressMap[goal.id]}
					{@const weightProgress = data.weightProgressMap[goal.id]}
					{@const paceEstimate = sensorProgress
						? computePaceEstimate({
								startDate: sensorProgress.startDate,
								endDate: sensorProgress.endDate,
								startValue: 0,
								currentValue: sensorProgress.currentKm,
								targetValue: sensorProgress.targetKm,
								unit: 'km',
								formatValue: formatMetricValue
							})
						: weightProgress
							? computePaceEstimate({
									startDate: weightProgress.startDate,
									endDate: weightProgress.endDate,
									startValue: weightProgress.startWeight,
									currentValue: weightProgress.currentWeight,
									targetValue: weightProgress.targetWeight,
									unit: 'kg',
									formatValue: formatMetricValue
								})
							: null}
					<div id={`goal-${goal.id}`} class="goal-card" class:expanded={isExpanded}>
						<!-- Alltid synlig: sammendrag -->
						<button
							class="goal-summary"
							onclick={() => toggleGoal(goal.id)}
							aria-expanded={isExpanded}
						>
							<div class="goal-summary-left">
								<div class="goal-title-row">
									<h2>{goal.title}</h2>
								</div>
								{#if goal.category}
									<div class="goal-category">{goal.category.icon || '📌'} {goal.category.name}</div>
								{/if}
								<div class="goal-pills">
									{#if goalTrackLabel}
										<div class="goal-track-pill">{goalTrackLabel}</div>
									{/if}
									{#if intentBadge}
										<div class={`goal-intent-pill goal-intent-${intentBadge.tone}`}>{intentBadge.label}</div>
									{/if}
								</div>
								{#if sensorProgress}
									{@const pct = sensorProgress.targetKm > 0 ? Math.min(100, Math.round((sensorProgress.currentKm / sensorProgress.targetKm) * 100)) : 0}
									<div class="sensor-progress">
										<MetricCard
											metricId="running_distance"
											size="M"
											data={{ current: sensorProgress.currentKm, target: sensorProgress.targetKm, startDate: sensorProgress.startDate, endDate: sensorProgress.endDate }}
										/>
										<div class="sensor-progress-label">
											<span class="sensor-current">{sensorProgress.currentKm} km</span>
											<span class="sensor-target">av {sensorProgress.targetKm} km</span>
											<span class="sensor-pct">{pct}%</span>
										</div>
									</div>
								{:else if weightProgress}
									<div class="sensor-progress">
										<MetricCard
											metricId="weight_change"
											size="M"
											data={{ current: weightProgress.currentWeight, target: weightProgress.targetWeight, startDate: weightProgress.startDate, endDate: weightProgress.endDate, startValue: weightProgress.startWeight }}
											formatValue={(v) => `${Math.round(v * 10) / 10} kg`}
										/>
										<div class="sensor-progress-label">
											<span class="sensor-current">{weightProgress.currentWeight} kg</span>
											<span class="sensor-target">mål {weightProgress.targetWeight} kg</span>
											<span class="sensor-pct">{weightProgress.pct}%</span>
										</div>
									</div>
								{:else if goal.tasks.length > 0}
									<div class="progress-section">
										<div class="progress-bar">
											<div class="progress-fill" style={`width: ${goalProgress}%`}></div>
										</div>
										<div class="progress-text">{goalProgress}%</div>
									</div>
								{/if}
							</div>
							<div class="goal-summary-right">
								<span class="chevron" class:open={isExpanded}>›</span>
							</div>
						</button>

						<!-- Ekspandert innhold -->
						{#if isExpanded}
							<div class="goal-details">
								{#if goal.description}
									<p class="goal-description">{goal.description}</p>
								{/if}

								{#if sensorProgress && sensorProgress.dailyKm}
									<div class="goal-chart-bleed">
										<TrajectoryChart
											points={sensorProgress.dailyKm.map((point) => ({ date: point.date, value: point.km }))}
											startDate={sensorProgress.startDate}
											endDate={sensorProgress.endDate}
											startValue={0}
											targetValue={sensorProgress.targetKm}
											currentValue={sensorProgress.currentKm}
											seriesMode="incremental"
											showArea={true}
											paddingMode="none"
											minValue={0}
											maxValue={sensorProgress.targetKm}
											gridValues={[sensorProgress.targetKm, Math.round(sensorProgress.targetKm / 2), 0]}
											valueFormatter={formatMetricValue}
											actualStroke="#f0954a"
											actualFill="rgba(240, 149, 74, 0.15)"
											planStroke="#6b6b6b"
											actualLegend="— Målt"
											planLegend="- - Plan"
											height={220}
										/>
									</div>
								{:else if weightProgress}
									<div class="goal-chart-bleed">
										<TrajectoryChart
											points={weightProgress.points.map((point) => ({ date: point.date, value: point.weight }))}
											startDate={weightProgress.startDate}
											endDate={weightProgress.endDate}
											startValue={weightProgress.startWeight}
											targetValue={weightProgress.targetWeight}
											currentValue={weightProgress.currentWeight}
											seriesMode="absolute"
											showArea={false}
											paddingMode="auto"
											gridValues={[
												Math.round(weightProgress.startWeight * 10) / 10,
												Math.round(((weightProgress.startWeight + weightProgress.targetWeight) / 2) * 10) / 10,
												Math.round(weightProgress.targetWeight * 10) / 10
											]}
											valueFormatter={formatMetricValue}
											actualStroke="#8adf79"
											planStroke="#6b6b6b"
											actualLegend="— Målt vekt"
											planLegend="- - Plan"
											height={220}
										/>
									</div>
								{/if}

								{#if paceEstimate}
									<div class="pace-row">
										<span class={`pace-pill pace-${paceEstimate.diffTone}`}>{paceEstimate.diffLabel}</span>
										<span class={`pace-pill pace-${paceEstimate.estimateTone}`}>{paceEstimate.estimateLabel}</span>
									</div>
								{/if}

								<div class="goal-meta-row">
									{#if startDate && endDate}
										<span class="meta-chip">📅 {startDate} → {endDate}</span>
									{:else if startDate}
										<span class="meta-chip">📅 Fra {startDate}</span>
									{:else if goal.targetDate}
										<span class="meta-chip">🗓️ Frist {goal.targetDate.toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
									{/if}
									{#if goal.tasks.length > 0}
										<span class="meta-chip">📋 {goal.tasks.length} oppgave{goal.tasks.length !== 1 ? 'r' : ''}</span>
									{/if}
									<span class="meta-chip">🕐 {goal.createdAt.toLocaleDateString('no-NO', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
								</div>

								{#if intentEvaluationLabel}
									<div class="goal-intent-evaluation">{intentEvaluationLabel}</div>
								{/if}
								{#if intentFailureReason}
									<div class="goal-intent-failure-reason">{intentFailureReason}</div>
								{/if}

								{#if goal.tasks.length > 0}
									<div class="tasks-section">
										{#each goal.tasks as task}
											{@const taskProgress = calculateTaskProgress(task)}
											<div class="task-card">
												<div class="task-header">
													<div class="task-title"><TaskTitle title={task.title} /></div>
													{#if task.frequency}
														<div class="task-frequency">{task.frequency}</div>
													{/if}
												</div>

												{#if task.targetValue}
													<div class="task-meta">Mål: {task.targetValue} {task.unit || ''}</div>
												{/if}

												{#if task.progress && task.progress.length > 0}
													<div class="task-progress">
														<div class="task-progress-bar">
															<div class="task-progress-fill" style={`width: ${taskProgress}%`}></div>
														</div>
														<div class="task-progress-label">{taskProgress}%</div>
													</div>

													<div class="activity-summary">
														<div class="activity-count">🔥 {task.progress.length}x</div>
														<div class="recent-activities">
															{#each task.progress.slice(0, 3) as entry}
																<span class="activity-dot" title={entry.completedAt.toLocaleDateString('no-NO')}>•</span>
															{/each}
														</div>
													</div>
												{/if}
											</div>
										{/each}
									</div>
								{/if}

								<div class="goal-actions">
									<button
										class="btn-archive"
										onclick={() => archiveGoal(goal.id)}
									>
										Arkiver
									</button>
									<button
										class="btn-danger"
										onclick={() => deleteGoal(goal.id, goal.title)}
									>
										Slett mål
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			{#if archivedGoals.length > 0}
				<div class="archived-section">
					<button class="archived-toggle" onclick={() => (archivedExpanded = !archivedExpanded)}>
						<span class="archived-toggle-label">Arkiverte mål ({archivedGoals.length})</span>
						<span class="chevron" class:open={archivedExpanded}>›</span>
					</button>
					{#if archivedExpanded}
						<div class="goals-list archived-list">
							{#each archivedGoals as goal}
								{@const isExpanded = expandedGoals.has(goal.id)}
								<div id={`goal-${goal.id}`} class="goal-card goal-card-archived" class:expanded={isExpanded}>
									<button
										class="goal-summary"
										onclick={() => toggleGoal(goal.id)}
										aria-expanded={isExpanded}
									>
										<div class="goal-summary-left">
											<div class="goal-title-row">
												<h2 class="archived-title">{goal.title}</h2>
											</div>
											{#if goal.category}
												<div class="goal-category">{goal.category.icon || '📌'} {goal.category.name}</div>
											{/if}
										</div>
										<div class="goal-summary-right">
											<span class="chevron" class:open={isExpanded}>›</span>
										</div>
									</button>
									{#if isExpanded}
										<div class="goal-details">
											{#if goal.description}
												<p class="goal-description">{goal.description}</p>
											{/if}
											<div class="goal-actions">
												<button class="btn-restore" onclick={() => unarchiveGoal(goal.id)}>
													Gjenopprett
												</button>
												<button class="btn-danger" onclick={() => deleteGoal(goal.id, goal.title)}>
													Slett mål
												</button>
											</div>
										</div>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</main>
</div>

<style>
	.goals-page-shell {
		color: var(--text-secondary);
		font-family: 'Inter', system-ui, sans-serif;
	}

	.progress-assessment {
		max-width: 800px;
		margin: 0 auto;
		padding: 0 0.5rem;
		font-size: 0.95rem;
		line-height: 1.55;
		color: var(--text-primary);
	}

	.progress-assessment.loading {
		color: var(--text-muted);
		font-style: italic;
	}

	.content {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem 0;
		width: 100%;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: var(--bg-input);
		border-radius: var(--radius-lg);
		border: 1px solid var(--border-color);
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.empty-state p {
		color: var(--text-tertiary);
		margin-bottom: 2rem;
	}

	.goals-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.goal-card {
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-lg);
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.goal-card:hover {
		border-color: var(--border-color);
	}

	.goal-card.expanded {
		border-color: var(--border-color);
	}

	.goal-summary {
		width: 100%;
		background: none;
		border: none;
		padding: 1.25rem 1.5rem;
		cursor: pointer;
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		text-align: left;
		color: inherit;
	}

	.goal-summary:hover {
		background: rgba(255, 255, 255, 0.02);
	}

	.goal-summary-left {
		flex: 1;
		min-width: 0;
	}

	.goal-summary-right {
		display: flex;
		align-items: center;
		padding-top: 0.25rem;
		flex-shrink: 0;
	}

	.chevron {
		font-size: 1.4rem;
		color: var(--text-muted);
		line-height: 1;
		transition: transform 0.2s ease;
		display: inline-block;
		transform: rotate(0deg);
	}

	.chevron.open {
		transform: rotate(90deg);
		color: var(--accent-light);
	}

	.goal-details {
		padding: 0 1.5rem 1.5rem;
		border-top: 1px solid var(--border-subtle);
	}

	.goal-chart-bleed {
		margin: 0.75rem -1.5rem 0.25rem;
	}

	.goal-chart-bleed :global(.chart-legend) {
		padding: 0 1.5rem;
	}

	.pace-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 0.5rem 0 1rem;
	}

	.pace-pill {
		display: inline-flex;
		align-items: center;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 500;
		border: 1px solid transparent;
	}

	.pace-ahead {
		background: rgba(138, 223, 121, 0.1);
		border-color: rgba(138, 223, 121, 0.25);
		color: #8adf79;
	}

	.pace-behind {
		background: rgba(240, 149, 74, 0.1);
		border-color: rgba(240, 149, 74, 0.25);
		color: #f0954a;
	}

	.pace-neutral {
		background: var(--border-subtle);
		border-color: var(--border-color);
		color: var(--text-secondary);
	}

	.goal-description {
		font-size: 0.9rem;
		color: var(--text-tertiary);
		line-height: 1.6;
		margin: 1rem 0 0.75rem;
	}

	.goal-meta-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.meta-chip {
		display: inline-flex;
		align-items: center;
		padding: 0.3rem 0.65rem;
		border-radius: 999px;
		background: var(--border-subtle);
		border: 1px solid var(--border-color);
		font-size: 0.78rem;
		color: var(--text-tertiary);
	}

	.goal-pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 0.45rem;
	}

	.goal-actions {
		margin-top: 1.25rem;
		display: flex;
		justify-content: flex-end;
	}

	.goal-header {
		margin-bottom: 1.25rem;
	}

	.goal-title-row {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 0.5rem;
	}

	.goal-card h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
		flex: 1;
	}

	.goal-category {
		font-size: 0.85rem;
		color: var(--text-tertiary);
	}

	.goal-track-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		background: rgba(124, 142, 245, 0.12);
		border: 1px solid rgba(124, 142, 245, 0.28);
		color: #b9c3ff;
		font-size: 0.76rem;
		margin-top: 0.45rem;
	}

	.goal-intent-pill {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		font-size: 0.74rem;
		margin-top: 0.45rem;
	}

	.goal-intent-pending {
		background: rgba(255, 187, 72, 0.14);
		border: 1px solid rgba(255, 187, 72, 0.35);
		color: #ffd48c;
	}

	.goal-intent-parsed {
		background: rgba(95, 212, 161, 0.14);
		border: 1px solid rgba(95, 212, 161, 0.36);
		color: #9ef1c9;
	}

	.goal-intent-failed {
		background: rgba(255, 117, 117, 0.14);
		border: 1px solid rgba(255, 117, 117, 0.34);
		color: #ffb6b6;
	}

	.goal-intent-evaluation {
		margin-top: 0.45rem;
		font-size: 0.78rem;
		color: #8eb6ff;
	}

	.goal-intent-failure-reason {
		margin-top: 0.4rem;
		font-size: 0.76rem;
		color: #ff9b9b;
	}

	.sensor-progress {
		margin-top: 0.75rem;
	}

	.sensor-progress :global(.viz-progress-track),
	.sensor-progress :global(.viz-marker-track) {
		margin-bottom: 0.35rem;
	}

	.sensor-progress-label {
		display: flex;
		align-items: baseline;
		gap: 0.35rem;
	}

	.sensor-current {
		font-size: 1rem;
		font-weight: 700;
		color: #f5a97f;
	}

	.sensor-target {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.sensor-pct {
		margin-left: auto;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--text-tertiary);
	}

	.progress-section {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.progress-bar {
		flex: 1;
		height: 8px;
		background: var(--border-color);
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #667eea 0%, #764ba2 100%);
		transition: width 0.3s ease;
	}

	.progress-text {
		font-size: 1.25rem;
		font-weight: 600;
		color: var(--text-primary);
		min-width: 60px;
		text-align: right;
	}

	.meta-info {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin-bottom: 1rem;
	}

	.tasks-section {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.task-card {
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: var(--radius-md);
		padding: 1rem;
	}

	.task-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.task-title {
		color: var(--text-secondary);
		font-weight: 500;
		font-size: 0.95rem;
	}

	.task-frequency {
		font-size: 0.75rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.task-meta {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		margin-bottom: 0.75rem;
	}

	.task-progress {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin: 0.75rem 0;
	}

	.task-progress-bar {
		flex: 1;
		height: 6px;
		background: var(--border-color);
		border-radius: 3px;
		overflow: hidden;
	}

	.task-progress-fill {
		height: 100%;
		background: var(--accent-light);
		transition: width 0.3s ease;
	}

	.task-progress-label {
		font-size: 0.85rem;
		color: var(--text-tertiary);
		font-weight: 600;
		min-width: 45px;
		text-align: right;
	}

	.activity-summary {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-top: 0.75rem;
		padding-top: 0.75rem;
		border-top: 1px solid var(--border-subtle);
	}

	.activity-count {
		font-size: 0.85rem;
		color: var(--text-secondary);
		font-weight: 600;
	}

	.recent-activities {
		display: flex;
		gap: 0.25rem;
	}

	.activity-dot {
		width: 8px;
		height: 8px;
		background: var(--accent-light);
		border-radius: 50%;
		display: inline-block;
	}

	.archived-section {
		margin-top: 2rem;
	}

	.archived-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 0;
		background: none;
		border: none;
		border-top: 1px solid var(--border-color);
		cursor: pointer;
		color: inherit;
		text-align: left;
	}

	.archived-toggle-label {
		font-size: 0.85rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.archived-toggle .chevron {
		color: var(--text-muted);
	}

	.archived-list {
		margin-top: 0.75rem;
	}

	.goal-card-archived {
		opacity: 0.65;
	}

	.goal-card-archived:hover {
		opacity: 0.85;
	}

	.archived-title {
		color: var(--text-tertiary) !important;
	}
</style>
