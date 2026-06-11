<!--
  ThemeGoalsTab — Mål-fanen i ThemePage.
  Viser eksisterende mål med redigering, helse-spesifikke målkontroller, og tom-tilstand.
-->
<script lang="ts">
	import GoalRing from '../../ui/GoalRing.svelte';
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import GoalEditCard from './GoalEditCard.svelte';
	import HealthGoalCreation from './HealthGoalCreation.svelte';
	import type { HealthDashboardData } from '$lib/client/dashboard-cache';

	interface Goal {
		id: string;
		title: string;
		status: string;
		description?: string | null;
		metadata?: Record<string, unknown>;
	}

	interface Props {
		goals: Goal[];
		themeId: string;
		activeDashboardKind: string | null;
		healthDashboard?: HealthDashboardData | null;
		onGoalChanged?: () => void;
		onSwitchToChat?: () => void;
	}

	let {
		goals,
		themeId,
		activeDashboardKind,
		healthDashboard = null,
		onGoalChanged,
		onSwitchToChat
	}: Props = $props();

	const GOAL_COLORS: Record<string, string> = {
		active: '#7c8ef5',
		completed: '#5fa0a0',
		paused: '#888',
		abandoned: '#e07070',
	};

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
		return Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
	}

	let editingGoalId = $state<string | null>(null);

	async function archiveGoal(goalId: string) {
		if (!confirm('Er du sikker på at du vil arkivere dette målet?')) return;
		try {
			const res = await fetch(`/api/goals/${goalId}`, { method: 'DELETE' });
			if (!res.ok) throw new Error('delete_failed');
			window.location.reload();
		} catch {
			alert('Klarte ikke arkivere målet. Prøv igjen.');
		}
	}
</script>

<div class="goals-panel">
	{#if goals.length > 0}
		<div class="goals-section">
			<SectionLabel tag="h2">Aktive mål</SectionLabel>
			<div class="goals-grid">
				{#each goals.filter(g => g.status === 'active') as goal}
					{@const pct = goalPct(goal)}
					{@const color = GOAL_COLORS[goal.status] ?? '#7c8ef5'}
					{#if editingGoalId === goal.id}
						<GoalEditCard
							{goal}
							onSaved={() => window.location.reload()}
							onCancel={() => (editingGoalId = null)}
						/>
					{:else}
						<div class="goal-card">
							<div class="goal-ring">
								<GoalRing {pct} {color} r={28} strokeWidth={5} size={80}>
									{#snippet children()}
										<text x="40" y="44" text-anchor="middle" fill={color} font-size="12" font-weight="700">{pct}%</text>
									{/snippet}
								</GoalRing>
							</div>
							<div class="goal-info">
								<span class="goal-title">{goal.title}</span>
								{#if goal.description}<span class="goal-desc">{goal.description}</span>{/if}
								<span class="goal-status" style="color:{color}">{goal.status}</span>
							</div>
							<div class="goal-actions">
								<button class="goal-action-btn goal-edit-btn" type="button" onclick={() => (editingGoalId = goal.id)} aria-label="Rediger mål">✎</button>
								<button class="goal-action-btn goal-delete-btn" type="button" onclick={() => archiveGoal(goal.id)} aria-label="Arkiver mål">🗑</button>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	{#if activeDashboardKind === 'health'}
		<HealthGoalCreation {themeId} {healthDashboard} onGoalCreated={() => window.location.reload()} />
	{/if}

	{#if goals.length === 0 && activeDashboardKind !== 'health'}
		<div class="goals-empty">
			<p>Ingen aktive mål i dette temaet ennå.</p>
			<button class="goals-new-btn" onclick={() => onSwitchToChat?.()}>+ Si til AI at du vil sette et mål</button>
		</div>
	{/if}
</div>

<style>
	.goals-panel { padding: 16px var(--page-px); overflow-y: auto; display: flex; flex-direction: column; gap: 24px; }
	.goals-section { display: flex; flex-direction: column; gap: 12px; }
	.goals-grid { display: flex; flex-direction: column; gap: 10px; }
	.goal-card { background: var(--card-bg-subtle, #141414); border: 1px solid var(--card-border, #242424); border-radius: var(--radius-md, 12px); padding: 14px; display: flex; gap: 14px; align-items: center; position: relative; }
	.goal-ring { flex-shrink: 0; }
	.goal-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
	.goal-title { font-size: 0.9rem; font-weight: 600; color: #ddd; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.goal-desc { font-size: 0.72rem; color: #555; line-height: 1.4; }
	.goal-status { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.07em; }
	.goal-actions { display: flex; gap: 8px; align-items: center; margin-left: auto; }
	.goal-action-btn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid #2a2a2a; background: #0f0f0f; color: #888; font-size: 0.96rem; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.15s ease; }
	.goal-action-btn:hover { background: #1a1a1a; border-color: #3a3a3a; }
	.goal-edit-btn:hover { color: #7c8ef5; border-color: #3c4f9f; }
	.goal-delete-btn:hover { color: #ee8c8c; border-color: #9e4545; }
	.goals-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 48px 20px; color: #444; font-size: 0.85rem; text-align: center; }
	.goals-new-btn { background: #1a1a1a; border: 1px solid #2a2a2a; color: var(--tp-accent, hsl(228 70% 70%)); font: inherit; font-size: 0.8rem; padding: 8px 16px; border-radius: 99px; cursor: pointer; }
</style>
