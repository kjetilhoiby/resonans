<!--
  HealthGoalCreation — Form for creating running or weight health goals.
  Extracted from ThemeGoalsTab to keep the parent focused on composition.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import type { HealthDashboardData } from '$lib/client/dashboard-cache';

	interface Props {
		themeId: string;
		healthDashboard?: HealthDashboardData | null;
		onGoalCreated?: () => void;
	}

	let { themeId, healthDashboard = null, onGoalCreated }: Props = $props();

	let newHealthGoalType = $state<'running' | 'weight' | null>(null);
	let runningStartDate = $state('');
	let runningEndDate = $state('');
	let runningTargetKm = $state('');
	let weightStartDate = $state('');
	let weightStartValue = $state('');
	let weightTargetDate = $state('');
	let weightTargetValue = $state('');
	let healthGoalSaving = $state(false);
	let healthGoalError = $state('');

	function formatDate(date: Date): string {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getLatestWeight(): string {
		if (!healthDashboard?.recentEvents) return '';
		const weightEvents = healthDashboard.recentEvents
			.filter(e => e.dataType === 'weight')
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		if (weightEvents.length === 0) return '';
		const latestWeight = weightEvents[0].data.weight;
		if (typeof latestWeight === 'number') return String(latestWeight.toFixed(1));
		return '';
	}

	function initWeightGoalDefaults() {
		const today = new Date();
		weightStartDate = formatDate(today);
		weightStartValue = getLatestWeight();
		const target = new Date();
		target.setDate(target.getDate() + 90);
		weightTargetDate = formatDate(target);
	}

	function initRunningGoalDefaults() {
		const today = new Date();
		runningStartDate = formatDate(today);
		const target = new Date();
		target.setDate(target.getDate() + 90);
		runningEndDate = formatDate(target);
	}

	function cancelHealthGoalCreation() {
		newHealthGoalType = null;
		healthGoalError = '';
		runningStartDate = '';
		runningEndDate = '';
		runningTargetKm = '';
		weightStartDate = '';
		weightStartValue = '';
		weightTargetDate = '';
		weightTargetValue = '';
	}

	async function saveNewHealthGoal() {
		if (!newHealthGoalType) return;
		healthGoalSaving = true;
		healthGoalError = '';

		try {
			if (newHealthGoalType === 'running') {
				const targetKm = Number.parseFloat(String(runningTargetKm).replace(',', '.'));
				if (!runningStartDate || !runningEndDate || !Number.isFinite(targetKm)) {
					healthGoalError = 'Fyll ut alle feltene for løpemål.';
					healthGoalSaving = false;
					return;
				}
				const res = await fetch('/api/goals', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						categoryName: 'Helse',
						themeId,
						title: `Løpe ${targetKm} km`,
						description: `Fra ${runningStartDate} til ${runningEndDate}`,
						targetDate: runningEndDate,
						metricId: 'running_distance',
						goalKind: 'level',
						goalWindow: 'custom',
						targetValue: targetKm,
						unit: 'km',
						startDate: runningStartDate,
						endDate: runningEndDate
					})
				});
				if (!res.ok) {
					const errorData = await res.text();
					console.error('Goal creation failed:', res.status, errorData);
					throw new Error(`HTTP ${res.status}: ${errorData}`);
				}
			} else if (newHealthGoalType === 'weight') {
				const startVal = Number.parseFloat(String(weightStartValue).replace(',', '.'));
				const targetVal = Number.parseFloat(String(weightTargetValue).replace(',', '.'));
				if (!weightStartDate || !weightTargetDate || !Number.isFinite(startVal) || !Number.isFinite(targetVal)) {
					healthGoalError = 'Fyll ut alle feltene for vektmål.';
					healthGoalSaving = false;
					return;
				}
				const change = targetVal - startVal;
				const res = await fetch('/api/goals', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						categoryName: 'Helse',
						themeId,
						title: `${change > 0 ? 'Øke' : 'Redusere'} vekt til ${targetVal} kg`,
						description: `Fra ${startVal} kg (${weightStartDate}) til ${targetVal} kg (${weightTargetDate})`,
						targetDate: weightTargetDate,
						metricId: 'weight_change',
						goalKind: 'trajectory',
						goalWindow: 'custom',
						targetValue: change,
						unit: 'kg',
						startDate: weightStartDate,
						startValue: startVal
					})
				});
				if (!res.ok) {
					const errorData = await res.text();
					console.error('Goal creation failed:', res.status, errorData);
					throw new Error(`HTTP ${res.status}: ${errorData}`);
				}
			}

			newHealthGoalType = null;
			runningStartDate = '';
			runningEndDate = '';
			runningTargetKm = '';
			weightStartDate = '';
			weightStartValue = '';
			weightTargetDate = '';
			weightTargetValue = '';
			onGoalCreated?.();
		} catch (err) {
			console.error('Health goal creation error:', err);
			healthGoalError = 'Klarte ikke opprette mål. Prøv igjen.';
		} finally {
			healthGoalSaving = false;
		}
	}
</script>

<div class="goals-create-section">
	<SectionLabel tag="h2">Opprett helsemål</SectionLabel>
	<p class="goals-section-copy">Sett løpemål og vektmål med fleksible tidsrammer.</p>

	{#if !newHealthGoalType}
		<div class="goal-type-selector">
			<button
				class="goal-type-btn"
				type="button"
				onclick={() => { newHealthGoalType = 'running'; initRunningGoalDefaults(); }}
			>
				+ Løpemål
			</button>
			<button
				class="goal-type-btn"
				type="button"
				onclick={() => { newHealthGoalType = 'weight'; initWeightGoalDefaults(); }}
			>
				+ Vektmål
			</button>
		</div>
	{:else if newHealthGoalType === 'running'}
		<div class="goal-control">
			<div class="goal-control-label">Løpemål</div>
			<div class="goal-control-row">
				<label class="goal-control-field">
					Fra dato
					<input class="goal-control-input" type="date" bind:value={runningStartDate} />
				</label>
				<label class="goal-control-field">
					Til dato
					<input class="goal-control-input" type="date" bind:value={runningEndDate} />
				</label>
			</div>
			<label class="goal-control-field">
				Mål (km)
				<input
					class="goal-control-input"
					type="number"
					step="0.5"
					min="0"
					bind:value={runningTargetKm}
					placeholder="100"
				/>
			</label>
			{#if healthGoalError}
				<p class="goal-control-error">{healthGoalError}</p>
			{/if}
			<div class="goal-control-actions">
				<button class="goal-control-save" type="button" onclick={saveNewHealthGoal} disabled={healthGoalSaving}>
					{healthGoalSaving ? 'Oppretter…' : 'Opprett'}
				</button>
				<button class="goal-control-cancel" type="button" onclick={cancelHealthGoalCreation} disabled={healthGoalSaving}>
					Avbryt
				</button>
			</div>
		</div>
	{:else if newHealthGoalType === 'weight'}
		<div class="goal-control">
			<div class="goal-control-label">Vektmål</div>
			<div class="goal-control-row">
				<label class="goal-control-field">
					Startdato
					<input class="goal-control-input" type="date" bind:value={weightStartDate} />
				</label>
				<label class="goal-control-field">
					Startvekt (kg)
					<input class="goal-control-input" type="number" step="0.1" min="0" bind:value={weightStartValue} placeholder="80" />
				</label>
			</div>
			<div class="goal-control-row">
				<label class="goal-control-field">
					Måldato
					<input class="goal-control-input" type="date" bind:value={weightTargetDate} />
				</label>
				<label class="goal-control-field">
					Målvekt (kg)
					<input class="goal-control-input" type="number" step="0.1" min="0" bind:value={weightTargetValue} placeholder="75" />
				</label>
			</div>
			{#if healthGoalError}
				<p class="goal-control-error">{healthGoalError}</p>
			{/if}
			<div class="goal-control-actions">
				<button class="goal-control-save" type="button" onclick={saveNewHealthGoal} disabled={healthGoalSaving}>
					{healthGoalSaving ? 'Oppretter…' : 'Opprett'}
				</button>
				<button class="goal-control-cancel" type="button" onclick={cancelHealthGoalCreation} disabled={healthGoalSaving}>
					Avbryt
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.goals-create-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px;
		background: #141414;
		border: 1px solid #242424;
		border-radius: 14px;
	}
	.goals-section-copy {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #666;
	}
	.goal-control {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.goal-control-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: #9b9b9b;
		margin: 0;
	}
	.goal-control-row {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}
	.goal-control-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.75rem;
		color: #888;
		flex: 1;
		min-width: 140px;
	}
	.goal-control-input {
		width: 100%;
		background: #101010;
		border: 1px solid #2c2c2c;
		border-radius: 10px;
		padding: 8px 10px;
		color: #ddd;
		font: inherit;
		font-size: 0.86rem;
	}
	.goal-control-input[type="date"] {
		padding: 8px 12px;
		cursor: pointer;
		color-scheme: dark;
	}
	.goal-control-input[type="date"]::-webkit-calendar-picker-indicator {
		filter: invert(0.7);
		cursor: pointer;
		opacity: 0.8;
		transition: opacity 0.15s ease;
	}
	.goal-control-input[type="date"]::-webkit-calendar-picker-indicator:hover { opacity: 1; }
	.goal-control-input:focus {
		outline: none;
		border-color: var(--tp-border-strong, hsl(228 28% 34%));
		box-shadow: 0 0 0 2px hsl(var(--theme-hue, 228) 50% 44% / 0.16);
	}
	.goal-control-actions { display: flex; gap: 8px; }
	.goal-control-save {
		background: var(--tp-accent-bg-strong, hsl(228 42% 28%));
		color: var(--tp-text, hsl(228 20% 92%));
		border: 1px solid var(--tp-border-strong, hsl(228 28% 34%));
		border-radius: 10px;
		padding: 8px 16px;
		font: inherit;
		font-size: 0.78rem;
		font-weight: 600;
		cursor: pointer;
	}
	.goal-control-save:disabled { opacity: 0.5; cursor: default; }
	.goal-control-cancel {
		background: #1a1a1a;
		color: #999;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 8px 16px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.goal-control-cancel:disabled { opacity: 0.5; cursor: default; }
	.goal-control-error { margin: 0; color: #ee8c8c; font-size: 0.72rem; }
	.goal-type-selector { display: flex; gap: 12px; }
	.goal-type-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: var(--tp-accent, hsl(228 70% 70%));
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		padding: 10px 18px;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.goal-type-btn:hover {
		background: #242424;
		border-color: var(--tp-border-strong, hsl(228 28% 34%));
	}
</style>
