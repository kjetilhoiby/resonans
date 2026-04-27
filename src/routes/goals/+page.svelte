<script lang="ts">
	import { onMount } from 'svelte';
	import { AppPage, PageHeader } from '$lib/components/ui';
	import Icon from '$lib/components/ui/Icon.svelte';
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

	function formatGoalTrack(goal: GoalItem): string | null {
		const track = goal.metadata?.goalTrack;
		if (!track || typeof track.targetValue !== 'number') return null;

		const unit = track.unit ? ` ${track.unit}` : '';
		if (track.window === 'custom' && track.durationDays) {
			return `${goal.metadata?.metricId || 'metric'} · ${track.targetValue}${unit} / ${track.durationDays} dager`;
		}

		return `${goal.metadata?.metricId || 'metric'} · ${track.targetValue}${unit} / ${track.window || 'periode'}`;
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

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const goalId = params.get('goal');
		if (!goalId) return;

		expandedGoals = new Set([goalId]);
		requestAnimationFrame(() => {
			document.getElementById(`goal-${goalId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
		});
	});

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


	function getRunningRequiredLegend(sensorProgress: NonNullable<Props['data']['sensorProgressMap'][string]>): string | null {
		const endMs = new Date(`${sensorProgress.endDate}T12:00:00Z`).getTime();
		const nowMs = new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime();
		const daysLeft = Math.ceil((endMs - nowMs) / 86400000);
		const kmLeft = Math.max(0, sensorProgress.targetKm - sensorProgress.currentKm);
		if (daysLeft <= 0) return null;
		const requiredPerDay = Math.round((kmLeft / daysLeft) * 10) / 10;
		return `··· Nødvendig snitt: ${requiredPerDay} km/dag (${daysLeft} dager igjen)`;
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
			// Remove from local state instead of full reload
			data.goals = data.goals.filter((g) => g.id !== goalId);
			// Also update sensorProgressMap and weightProgressMap
			const { [goalId]: _s, ...restSensor } = data.sensorProgressMap;
			data.sensorProgressMap = restSensor;
			const { [goalId]: _w, ...restWeight } = data.weightProgressMap;
			data.weightProgressMap = restWeight;
		} catch (error) {
			alert(`Feil ved sletting: ${error instanceof Error ? error.message : 'Ukjent feil'}`);
		}
	}
</script>

<AppPage width="full" theme="dark" className="goals-page">
	<PageHeader title="Mål" titleHref="/" titleLabel="Gå til forsiden">
		{#snippet actions()}
			<div class="header-actions">
				<a href="/" class="btn-icon" title="Chat"><Icon name="chat" size={20} /></a>
				<a href="/settings" class="btn-icon" title="Innstillinger"><Icon name="settings" size={20} /></a>
			</div>
		{/snippet}
	</PageHeader>

	<div class="header-stats">
		<div class="stat-card">
			<div class="stat-value">{data.goals.filter((goal) => goal.status === 'active').length}</div>
			<div class="stat-label">Aktive mål</div>
		</div>
	</div>

	<main class="content">
		{#if data.goals.length === 0}
			<div class="empty-state">
				<div class="empty-icon"><Icon name="goals" size={48} /></div>
				<p>Ingen mål ennå</p>
				<a href="/" class="btn-primary">Start i chatten</a>
			</div>
		{:else}
			<div class="goals-list">
				{#each data.goals as goal}
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
					{@const runningRequiredLegend = sensorProgress ? getRunningRequiredLegend(sensorProgress) : null}
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
										planStroke="#3a3a3a"
										requiredStroke="#6ea8fe"
										actualLegend="— Faktisk"
										planLegend="- - Plan"
										requiredLegend={runningRequiredLegend}
									/>
								{:else if weightProgress}
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
										planStroke="#3a3a3a"
										requiredStroke="#6ea8fe"
										actualLegend="— Faktisk vekt"
										planLegend="- - Plan"
										requiredLegend="··· Nødvendig bane"
									/>
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
													<div class="task-title">{task.title}</div>
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
		{/if}
	</main>
</AppPage>

<style>
	:global(.goals-page) {
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
	}

	.header-actions {
		display: flex;
		gap: 0.5rem;
	}

	.header-stats {
		display: flex;
		gap: 1rem;
	}

	.stat-card {
		background: #1a1a1a;
		padding: 1rem 1.5rem;
		border-radius: 12px;
		border: 1px solid #242424;
	}

	.stat-value {
		display: block;
		font-size: 2rem;
		font-weight: 700;
		color: #e8e8e8;
		margin-bottom: 0.25rem;
	}

	.stat-label {
		font-size: 0.85rem;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.content {
		max-width: 800px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	.empty-state {
		text-align: center;
		padding: 4rem 2rem;
		background: #1a1a1a;
		border-radius: 16px;
		border: 1px solid #242424;
	}

	.empty-icon {
		font-size: 4rem;
		margin-bottom: 1rem;
	}

	.empty-state p {
		color: #888;
		margin-bottom: 2rem;
	}

	.goals-list {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.goal-card {
		background: #141414;
		border: 1px solid #242424;
		border-radius: 16px;
		overflow: hidden;
		transition: border-color 0.2s;
	}

	.goal-card:hover {
		border-color: #2e2e2e;
	}

	.goal-card.expanded {
		border-color: #333;
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
		color: #444;
		line-height: 1;
		transition: transform 0.2s ease;
		display: inline-block;
		transform: rotate(0deg);
	}

	.chevron.open {
		transform: rotate(90deg);
		color: #7c8ef5;
	}

	.goal-details {
		padding: 0 1.5rem 1.5rem;
		border-top: 1px solid #1e1e1e;
	}

	.goal-description {
		font-size: 0.9rem;
		color: #999;
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
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		font-size: 0.78rem;
		color: #888;
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

	.btn-danger {
		padding: 0.4rem 0.9rem;
		border-radius: 8px;
		border: 1px solid rgba(255, 100, 100, 0.3);
		background: rgba(255, 100, 100, 0.08);
		color: #ff9b9b;
		font-size: 0.8rem;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-danger:hover {
		background: rgba(255, 100, 100, 0.15);
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
		color: #e8e8e8;
		flex: 1;
	}

	.goal-category {
		font-size: 0.85rem;
		color: #888;
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
		color: #666;
	}

	.sensor-pct {
		margin-left: auto;
		font-size: 0.85rem;
		font-weight: 600;
		color: #888;
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
		background: #222;
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
		color: #e8e8e8;
		min-width: 60px;
		text-align: right;
	}

	.meta-info {
		font-size: 0.85rem;
		color: #888;
		margin-bottom: 1rem;
	}

	.tasks-section {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.task-card {
		background: #1a1a1a;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 1rem;
	}

	.task-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.task-title {
		color: #ddd;
		font-weight: 500;
		font-size: 0.95rem;
	}

	.task-frequency {
		font-size: 0.75rem;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.task-meta {
		font-size: 0.85rem;
		color: #888;
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
		background: #222;
		border-radius: 3px;
		overflow: hidden;
	}

	.task-progress-fill {
		height: 100%;
		background: #7c8ef5;
		transition: width 0.3s ease;
	}

	.task-progress-label {
		font-size: 0.85rem;
		color: #888;
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
		border-top: 1px solid #1e1e1e;
	}

	.activity-count {
		font-size: 0.85rem;
		color: #ddd;
		font-weight: 600;
	}

	.recent-activities {
		display: flex;
		gap: 0.25rem;
	}

	.activity-dot {
		width: 8px;
		height: 8px;
		background: #7c8ef5;
		border-radius: 50%;
		display: inline-block;
	}
</style>
