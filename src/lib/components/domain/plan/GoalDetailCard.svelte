<!--
  GoalDetailCard — Viser et enkelt mål med sammendrag (alltid synlig),
  sensor-/vektfremdrift, og ekspanderbar detaljvisning med oppgaver,
  trajektori-graf, metadata og handlinger.

  Props:
    goal               mål-objekt
    sensorProgress     løpedistanse-data (valgfritt)
    weightProgress     vektdata (valgfritt)
    expanded           om detaljene er utfoldet
    onToggle           kalt ved klikk for å folde ut/inn
    onArchive          kalt med goalId ved arkivering
    onDelete           kalt med goalId og title ved sletting
-->
<script lang="ts">
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';
	import MetricCard from '$lib/components/visualizations/MetricCard.svelte';
	import GoalTrajectorySection from './GoalTrajectorySection.svelte';
	import {
		calculateTaskProgress,
		calculateGoalProgress,
		formatGoalTrack,
		getIntentBadge,
		getIntentEvaluationLabel,
		getIntentFailureReasonLabel,
		formatDate,
		formatMetricValue
	} from './helpers.js';
	import type { GoalItem, SensorProgress, WeightProgress } from './types.js';

	interface Props {
		goal: GoalItem;
		sensorProgress?: SensorProgress | null;
		weightProgress?: WeightProgress | null;
		expanded?: boolean;
		onToggle?: () => void;
		onArchive?: (goalId: string) => void;
		onDelete?: (goalId: string, title: string) => void;
	}

	let {
		goal,
		sensorProgress = null,
		weightProgress = null,
		expanded = false,
		onToggle,
		onArchive,
		onDelete
	}: Props = $props();

	const goalProgress = $derived(calculateGoalProgress(goal));
	const goalTrackLabel = $derived(formatGoalTrack(goal));
	const intentBadge = $derived(getIntentBadge(goal));
	const intentEvaluationLabel = $derived(getIntentEvaluationLabel(goal));
	const intentFailureReason = $derived(getIntentFailureReasonLabel(goal));
	const startDate = $derived(formatDate(goal.metadata?.startDate));
	const endDate = $derived(formatDate(goal.metadata?.endDate));
</script>

<div id={`goal-${goal.id}`} class="goal-card" class:expanded>
	<!-- Alltid synlig: sammendrag -->
	<button
		class="goal-summary"
		onclick={() => onToggle?.()}
		aria-expanded={expanded}
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
			<span class="chevron" class:open={expanded}>›</span>
		</div>
	</button>

	<!-- Ekspandert innhold -->
	{#if expanded}
		<div class="goal-details">
			{#if goal.description}
				<p class="goal-description">{goal.description}</p>
			{/if}

			<GoalTrajectorySection {sensorProgress} {weightProgress} />

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
					onclick={() => onArchive?.(goal.id)}
				>
					Arkiver
				</button>
				<button
					class="btn-danger"
					onclick={() => onDelete?.(goal.id, goal.title)}
				>
					Slett mål
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
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
</style>
