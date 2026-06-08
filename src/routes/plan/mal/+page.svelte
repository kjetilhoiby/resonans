<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import GoalDetailCard from '$lib/components/domain/plan/GoalDetailCard.svelte';
	import {
		calculateGoalProgress,
		getIntentEvaluationLabel,
		computePaceEstimate,
		formatMetricValue
	} from '$lib/components/domain/plan/helpers.js';
	import type { GoalItem, SensorProgress, WeightProgress } from '$lib/components/domain/plan/types.js';

	interface Props {
		data: {
			goals: GoalItem[];
			sensorProgressMap: Record<string, SensorProgress>;
			weightProgressMap: Record<string, WeightProgress>;
		};
	}

	let { data }: Props = $props();

	let expandedGoals = $state<Set<string>>(new Set());
	let assessment = $state<string | null>(null);
	let assessmentLoading = $state(false);
	let archivedExpanded = $state(false);

	const activeGoals = $derived(data.goals.filter((g) => g.status !== 'archived'));
	const archivedGoals = $derived(data.goals.filter((g) => g.status === 'archived'));

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
					<GoalDetailCard
						{goal}
						sensorProgress={data.sensorProgressMap[goal.id]}
						weightProgress={data.weightProgressMap[goal.id]}
						expanded={expandedGoals.has(goal.id)}
						onToggle={() => toggleGoal(goal.id)}
						onArchive={archiveGoal}
						onDelete={deleteGoal}
					/>
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

	/* Archived section — lightweight cards rendered inline */
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
