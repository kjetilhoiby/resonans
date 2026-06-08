<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import type { MonthGoal } from './types';
	import {
		GOAL_TYPE_CONFIG,
		goalTypeEmoji,
		isAutoTracked,
		goalReached,
		formatGoalProgress,
		goalTrackingLabel
	} from './types';

	interface Props {
		goals: MonthGoal[];
		onaddgoal: (goal: { title: string; goalType: MonthGoal['goalType']; targetValue: number; unit: string }) => void;
		onupdateprogress: (goalId: string, delta: number) => void;
		ondeletegoal: (goalId: string) => void;
	}

	let { goals, onaddgoal, onupdateprogress, ondeletegoal }: Props = $props();

	let showAddGoalForm = $state(false);
	let newGoalType = $state<MonthGoal['goalType']>('running_distance');
	let newGoalTitle = $state('');
	let newGoalTarget = $state('');
	let newGoalUnit = $state('');
	let addGoalTitleInput = $state<HTMLInputElement | null>(null);

	async function openAddGoalForm() {
		showAddGoalForm = true;
		newGoalTitle = '';
		newGoalTarget = '';
		newGoalUnit = GOAL_TYPE_CONFIG[newGoalType].unitPlaceholder;
		await tick();
		addGoalTitleInput?.focus();
	}

	function selectGoalType(type: MonthGoal['goalType']) {
		newGoalType = type;
		newGoalUnit = GOAL_TYPE_CONFIG[type].unitPlaceholder;
		if (type === 'weight_kg') newGoalTarget = '';
	}

	function submitAddGoal() {
		const title = newGoalTitle.trim();
		if (!title) return;
		const targetVal = Number(newGoalTarget);
		if (!Number.isFinite(targetVal) || targetVal <= 0) return;
		const unit = newGoalUnit.trim();

		onaddgoal({ title, goalType: newGoalType, targetValue: targetVal, unit });
		showAddGoalForm = false;
		newGoalTitle = '';
		newGoalTarget = '';
	}

	function handleAddGoalKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAddGoal(); }
		if (e.key === 'Escape') { showAddGoalForm = false; }
	}
</script>

<section class="mp-card mp-goals-month-card">
	<div class="mp-card-head">
		<h2>Månedsmål</h2>
		<button type="button" class="mp-goal-add-btn" onclick={() => void openAddGoalForm()} aria-label="Legg til mål">
			<span>+</span> Legg til mål
		</button>
	</div>

	{#if goals.length > 0}
		<ul class="mp-month-goals-list">
			{#each goals as goal (goal.id)}
				<li class="mp-month-goal-row">
					<span class="mp-month-goal-emoji">{goalTypeEmoji(goal.trackingMetric)}</span>
					<div class="mp-month-goal-main">
						<span class="mp-month-goal-title">{goal.title}</span>
						<span class="mp-month-goal-sub">{goalTrackingLabel(goal)}</span>
					</div>
					<div class="mp-month-goal-progress">
						<span class="mp-month-goal-count" class:reached={goalReached(goal)}>
							{formatGoalProgress(goal)}
						</span>
						{#if !isAutoTracked(goal)}
							<button type="button" class="mp-goal-stepper" onclick={() => onupdateprogress(goal.id, -1)} aria-label="Minus">&minus;</button>
							<button type="button" class="mp-goal-stepper mp-goal-stepper--plus" onclick={() => onupdateprogress(goal.id, 1)} aria-label="Pluss">+</button>
						{/if}
					</div>
					<button type="button" class="mp-goal-delete" onclick={() => ondeletegoal(goal.id)} aria-label="Slett mål">&times;</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if showAddGoalForm}
		<div class="mp-add-goal-form">
			<p class="mp-goal-flow-hint">Velg måltype. Løping, yoga og vekt blir koblet til registreringer automatisk.</p>
			<div class="mp-goal-type-pills">
				{#each Object.entries(GOAL_TYPE_CONFIG) as [type, cfg]}
					<button
						type="button"
						class="mp-type-pill"
						class:active={newGoalType === type}
						onclick={() => selectGoalType(type as MonthGoal['goalType'])}
					>{cfg.emoji} {cfg.label}</button>
				{/each}
			</div>
			<div class="mp-add-goal-fields">
				<input
					bind:this={addGoalTitleInput}
					bind:value={newGoalTitle}
					class="mp-input"
					type="text"
					placeholder={GOAL_TYPE_CONFIG[newGoalType].placeholder}
					onkeydown={handleAddGoalKeydown}
				/>
				<div class="mp-goal-target-row">
					<input
						bind:value={newGoalTarget}
						class="mp-input mp-input--narrow"
						type="number"
						min="0.1"
						step={newGoalType === 'weight_kg' || newGoalType === 'running_distance' ? '0.1' : '1'}
						placeholder={newGoalType === 'weight_kg' ? 'Målvekt' : 'Målverdi'}
						onkeydown={handleAddGoalKeydown}
					/>
					<input
						bind:value={newGoalUnit}
						class="mp-input"
						type="text"
						placeholder={GOAL_TYPE_CONFIG[newGoalType].unitPlaceholder}
						onkeydown={handleAddGoalKeydown}
					/>
				</div>
				{#if GOAL_TYPE_CONFIG[newGoalType].tracked}
					<p class="mp-goal-hint">Progresjon beregnes automatisk fra registreringene dine.</p>
				{:else}
					<p class="mp-goal-hint">Dette målet kan du telle manuelt inntil vi kobler registreringstype.</p>
				{/if}
				<div class="mp-add-goal-actions">
					<button type="button" class="mp-btn-primary" onclick={submitAddGoal}>Legg til</button>
					<button type="button" class="mp-btn-ghost" onclick={() => (showAddGoalForm = false)}>Avbryt</button>
				</div>
			</div>
		</div>
	{:else if goals.length === 0}
		<p class="mp-goals-empty">Ingen månedsmål ennå. Legg til et mål med knappen over.</p>
	{/if}
</section>

<style>
	.mp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.mp-card-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mp-card h2 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-primary);
		flex: 1;
	}

	.mp-goal-add-btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 10px;
		border-radius: var(--radius-sm);
		border: 1px solid #252840;
		background: #0e1022;
		color: var(--accent-light);
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}
	.mp-goal-add-btn:hover { background: #141830; border-color: #3a4adf; }

	.mp-month-goals-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mp-month-goal-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px;
		border-radius: var(--radius-sm);
		transition: background 0.1s;
	}
	.mp-month-goal-row:hover { background: #0b0d18; }

	.mp-month-goal-emoji {
		font-size: 1rem;
		flex-shrink: 0;
		width: 22px;
		text-align: center;
	}

	.mp-month-goal-title {
		font-size: 0.9rem;
		color: #c8cfe8;
		line-height: 1.3;
	}

	.mp-month-goal-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.mp-month-goal-sub {
		font-size: 0.7rem;
		color: #565f7a;
		line-height: 1.25;
	}

	.mp-month-goal-progress {
		display: flex;
		align-items: center;
		gap: 5px;
		flex-shrink: 0;
	}

	.mp-month-goal-count {
		font-size: 0.78rem;
		color: #60687e;
		min-width: 60px;
		text-align: right;
		transition: color 0.2s;
	}
	.mp-month-goal-count.reached { color: #5fa080; }

	.mp-goal-stepper {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		border: 1px solid #1e2030;
		background: #0c0e18;
		color: #70788f;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: background 0.1s, color 0.1s, border-color 0.1s;
	}
	.mp-goal-stepper:hover { background: #12162a; color: #bac6f9; border-color: #3a4adf; }
	.mp-goal-stepper--plus { color: var(--accent-light); }
	.mp-goal-stepper--plus:hover { color: #fff; }

	.mp-goal-delete {
		background: none;
		border: none;
		color: var(--border-color);
		font-size: 1.1rem;
		cursor: pointer;
		padding: 2px 4px;
		border-radius: 4px;
		line-height: 1;
		flex-shrink: 0;
		transition: color 0.12s;
	}
	.mp-goal-delete:hover { color: var(--error-text); }

	.mp-add-goal-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 2px 0;
	}

	.mp-goal-flow-hint {
		margin: 0;
		font-size: 0.76rem;
		color: #70788f;
		line-height: 1.35;
	}

	.mp-goal-type-pills {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.mp-type-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 28px;
		padding: 0 10px;
		border-radius: 999px;
		border: 1px solid #1e2030;
		background: #0c0e18;
		color: #70788f;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.mp-type-pill:hover { background: #101326; color: #bac6f9; }
	.mp-type-pill.active {
		background: #141830;
		border-color: var(--accent-light);
		color: #bac6f9;
	}

	.mp-add-goal-fields {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.mp-goal-target-row {
		display: flex;
		gap: 7px;
	}

	.mp-input {
		flex: 1;
		background: #0a0c14;
		border: 1px solid #1a1d2a;
		border-radius: 9px;
		color: var(--text-secondary);
		padding: 8px 11px;
		font: inherit;
		font-size: max(0.88rem, 16px);
		outline: none;
		transition: border-color 0.12s;
	}
	.mp-input:focus { border-color: #3a4adf; }
	.mp-input::placeholder { color: #3a3f52; }

	.mp-input--narrow {
		width: 80px;
		flex-shrink: 0;
	}

	.mp-add-goal-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.mp-goal-hint {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.35;
		color: #5c6684;
	}

	.mp-btn-primary {
		height: 34px;
		padding: 0 16px;
		border-radius: 9px;
		border: none;
		background: #3a4adf;
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 650;
		cursor: pointer;
		transition: background 0.12s;
	}
	.mp-btn-primary:hover { background: #4d5ef0; }

	.mp-btn-ghost {
		height: 34px;
		padding: 0 14px;
		border-radius: 9px;
		border: 1px solid #1e2030;
		background: transparent;
		color: #70788f;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		transition: color 0.12s, border-color 0.12s;
	}
	.mp-btn-ghost:hover { color: #bac6f9; border-color: #3a4adf; }

	.mp-goals-empty {
		font-size: 0.82rem;
		color: #3a3f52;
		margin: 0;
		padding: 4px 2px;
	}
</style>
