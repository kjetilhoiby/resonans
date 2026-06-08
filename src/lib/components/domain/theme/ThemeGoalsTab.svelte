<!--
  ThemeGoalsTab — Mål-fanen i ThemePage.
  Viser eksisterende mål med redigering, helse-spesifikke målkontroller, og tom-tilstand.
-->
<script lang="ts">
	import GoalRing from '../../ui/GoalRing.svelte';
	import type { HealthDashboardData } from '$lib/client/dashboard-cache';

	/* ── Types ──────────────────────────────────────────── */
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
		/** Called after a goal is saved/created/archived so parent can reload */
		onGoalChanged?: () => void;
		/** Switch to chat tab */
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

	/* ── Constants ──────────────────────────────────────── */
	const GOAL_COLORS: Record<string, string> = {
		active: '#7c8ef5',
		completed: '#5fa0a0',
		paused: '#888',
		abandoned: '#e07070',
	};

	/* ── Goal helpers ──────────────────────────────────── */
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

	/* ── Edit-mål tilstand ─────────────────────────────── */
	let editingGoalId = $state<string | null>(null);
	let editGoalTitle = $state('');
	let editGoalDesc = $state('');
	let editGoalTargetDate = $state('');
	let editGoalStartDate = $state('');
	let editGoalEndDate = $state('');
	let editGoalTargetValue = $state('');
	let editGoalStartValue = $state('');
	let editGoalMetricId = $state('');
	let editGoalSaving = $state(false);
	let editGoalError = $state('');

	function startEditGoal(goal: Goal) {
		editingGoalId = goal.id;
		editGoalTitle = goal.title;
		editGoalDesc = goal.description ?? '';

		const metadata = goal.metadata as any;
		editGoalMetricId = metadata?.metricId ?? '';
		editGoalStartDate = metadata?.startDate ?? '';
		editGoalEndDate = metadata?.endDate ?? '';
		editGoalTargetValue = metadata?.targetValue?.toString() ?? '';
		editGoalStartValue = metadata?.startValue?.toString() ?? '';

		if (metadata?.targetDate) {
			editGoalTargetDate = metadata.targetDate;
		} else if (metadata?.endDate) {
			editGoalTargetDate = metadata.endDate;
		} else {
			editGoalTargetDate = '';
		}
	}

	function cancelEditGoal() {
		editingGoalId = null;
		editGoalTitle = '';
		editGoalDesc = '';
		editGoalTargetDate = '';
		editGoalStartDate = '';
		editGoalEndDate = '';
		editGoalTargetValue = '';
		editGoalStartValue = '';
		editGoalMetricId = '';
		editGoalError = '';
	}

	async function saveEditedGoal() {
		if (!editingGoalId) return;

		editGoalSaving = true;
		editGoalError = '';

		try {
			const updateData: any = {
				title: editGoalTitle,
				description: editGoalDesc || null,
				targetDate: editGoalTargetDate || null
			};

			if (editGoalMetricId === 'running_distance') {
				const targetKm = Number.parseFloat(String(editGoalTargetValue).replace(',', '.'));
				if (editGoalStartDate && editGoalEndDate && Number.isFinite(targetKm)) {
					updateData.metadata = {
						metricId: 'running_distance',
						goalKind: 'level',
						goalWindow: 'custom',
						targetValue: targetKm,
						unit: 'km',
						startDate: editGoalStartDate,
						endDate: editGoalEndDate
					};
					updateData.targetDate = editGoalEndDate;
				}
			} else if (editGoalMetricId === 'weight_change') {
				const startVal = Number.parseFloat(String(editGoalStartValue).replace(',', '.'));
				const targetVal = Number.parseFloat(String(editGoalTargetValue).replace(',', '.'));
				if (editGoalStartDate && editGoalEndDate && Number.isFinite(startVal) && Number.isFinite(targetVal)) {
					const change = targetVal - startVal;
					updateData.metadata = {
						metricId: 'weight_change',
						goalKind: 'trajectory',
						goalWindow: 'custom',
						targetValue: change,
						unit: 'kg',
						startDate: editGoalStartDate,
						endDate: editGoalEndDate,
						startValue: startVal
					};
					updateData.targetDate = editGoalEndDate;
				}
			}

			const res = await fetch(`/api/goals/${editingGoalId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updateData)
			});

			if (!res.ok) throw new Error('save_failed');

			window.location.reload();
		} catch {
			editGoalError = 'Klarte ikke lagre endringer.';
		} finally {
			editGoalSaving = false;
		}
	}

	async function archiveGoal(goalId: string) {
		if (!confirm('Er du sikker på at du vil arkivere dette målet?')) return;

		try {
			const res = await fetch(`/api/goals/${goalId}`, {
				method: 'DELETE'
			});

			if (!res.ok) throw new Error('delete_failed');

			window.location.reload();
		} catch {
			alert('Klarte ikke arkivere målet. Prøv igjen.');
		}
	}

	/* ── Nye helse-mål ─────────────────────────────────── */
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
		if (typeof latestWeight === 'number') {
			return String(latestWeight.toFixed(1));
		}

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

			window.location.reload();
		} catch (err) {
			console.error('Health goal creation error:', err);
			healthGoalError = 'Klarte ikke opprette mål. Prøv igjen.';
		} finally {
			healthGoalSaving = false;
		}
	}
</script>

<div class="goals-panel">
	<!-- Eksisterende mål -->
	{#if goals.length > 0}
		<div class="goals-section">
			<h2 class="goals-section-title">Aktive mål</h2>
			<div class="goals-grid">
				{#each goals.filter(g => g.status === 'active') as goal}
					{@const pct = goalPct(goal)}
					{@const color = GOAL_COLORS[goal.status] ?? '#7c8ef5'}
					{#if editingGoalId === goal.id}
						<div class="goal-card goal-card-editing">
							<div class="goal-edit-form">
								<label class="goal-edit-label">
									Tittel
									<input
										class="goal-edit-input"
										type="text"
										bind:value={editGoalTitle}
										placeholder="Måltittel"
									/>
								</label>
								<label class="goal-edit-label">
									Beskrivelse
									<textarea
										class="goal-edit-textarea"
										bind:value={editGoalDesc}
										placeholder="Detaljer om målet"
										rows="3"
									></textarea>
								</label>

								{#if editGoalMetricId === 'running_distance'}
									<label class="goal-edit-label">
										Startdato
										<input
											class="goal-edit-input"
											type="date"
											bind:value={editGoalStartDate}
										/>
									</label>
									<label class="goal-edit-label">
										Sluttdato
										<input
											class="goal-edit-input"
											type="date"
											bind:value={editGoalEndDate}
										/>
									</label>
									<label class="goal-edit-label">
										Mål (km)
										<input
											class="goal-edit-input"
											type="number"
											step="0.1"
											bind:value={editGoalTargetValue}
											placeholder="150"
										/>
									</label>
								{:else if editGoalMetricId === 'weight_change'}
									<label class="goal-edit-label">
										Startdato
										<input
											class="goal-edit-input"
											type="date"
											bind:value={editGoalStartDate}
										/>
									</label>
									<label class="goal-edit-label">
										Startvekt (kg)
										<input
											class="goal-edit-input"
											type="number"
											step="0.1"
											bind:value={editGoalStartValue}
											placeholder="85"
										/>
									</label>
									<label class="goal-edit-label">
										Måldato
										<input
											class="goal-edit-input"
											type="date"
											bind:value={editGoalEndDate}
										/>
									</label>
									<label class="goal-edit-label">
										Målvekt (kg)
										<input
											class="goal-edit-input"
											type="number"
											step="0.1"
											bind:value={editGoalTargetValue}
											placeholder="78"
										/>
									</label>
								{:else}
									<label class="goal-edit-label">
										Måldag
										<input
											class="goal-edit-input"
											type="date"
											bind:value={editGoalTargetDate}
										/>
									</label>
								{/if}

								{#if editGoalError}
									<p class="goal-edit-error">{editGoalError}</p>
								{/if}
								<div class="goal-edit-actions">
									<button
										class="goal-edit-save"
										type="button"
										onclick={saveEditedGoal}
										disabled={editGoalSaving}
									>
										{editGoalSaving ? 'Lagrer…' : 'Lagre'}
									</button>
									<button
										class="goal-edit-cancel"
										type="button"
										onclick={cancelEditGoal}
										disabled={editGoalSaving}
									>
										Avbryt
									</button>
								</div>
							</div>
						</div>
					{:else}
						<div class="goal-card">
							<div class="goal-ring">
								<GoalRing {pct} {color} r={28} strokeWidth={5} size={80}>
									{#snippet children()}
										<text
											x="40"
											y="44"
											text-anchor="middle"
											fill={color}
											font-size="12"
											font-weight="700"
										>{pct}%</text>
									{/snippet}
								</GoalRing>
							</div>
							<div class="goal-info">
								<span class="goal-title">{goal.title}</span>
								{#if goal.description}
									<span class="goal-desc">{goal.description}</span>
								{/if}
								<span
									class="goal-status"
									style="color:{color}"
								>{goal.status}</span>
							</div>
							<div class="goal-actions">
								<button
									class="goal-action-btn goal-edit-btn"
									type="button"
									onclick={() => startEditGoal(goal)}
									aria-label="Rediger mål"
								>
									✎
								</button>
								<button
									class="goal-action-btn goal-delete-btn"
									type="button"
									onclick={() => archiveGoal(goal.id)}
									aria-label="Arkiver mål"
								>
									🗑
								</button>
							</div>
						</div>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	<!-- Helse-spesifikke målkontroller -->
	{#if activeDashboardKind === 'health'}
		<div class="goals-create-section">
			<h2 class="goals-section-title">Opprett helsemål</h2>
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
							<input
								class="goal-control-input"
								type="date"
								bind:value={runningStartDate}
							/>
						</label>
						<label class="goal-control-field">
							Til dato
							<input
								class="goal-control-input"
								type="date"
								bind:value={runningEndDate}
							/>
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
						<button
							class="goal-control-save"
							type="button"
							onclick={saveNewHealthGoal}
							disabled={healthGoalSaving}
						>
							{healthGoalSaving ? 'Oppretter…' : 'Opprett'}
						</button>
						<button
							class="goal-control-cancel"
							type="button"
							onclick={cancelHealthGoalCreation}
							disabled={healthGoalSaving}
						>
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
							<input
								class="goal-control-input"
								type="date"
								bind:value={weightStartDate}
							/>
						</label>
						<label class="goal-control-field">
							Startvekt (kg)
							<input
								class="goal-control-input"
								type="number"
								step="0.1"
								min="0"
								bind:value={weightStartValue}
								placeholder="80"
							/>
						</label>
					</div>
					<div class="goal-control-row">
						<label class="goal-control-field">
							Måldato
							<input
								class="goal-control-input"
								type="date"
								bind:value={weightTargetDate}
							/>
						</label>
						<label class="goal-control-field">
							Målvekt (kg)
							<input
								class="goal-control-input"
								type="number"
								step="0.1"
								min="0"
								bind:value={weightTargetValue}
								placeholder="75"
							/>
						</label>
					</div>
					{#if healthGoalError}
						<p class="goal-control-error">{healthGoalError}</p>
					{/if}
					<div class="goal-control-actions">
						<button
							class="goal-control-save"
							type="button"
							onclick={saveNewHealthGoal}
							disabled={healthGoalSaving}
						>
							{healthGoalSaving ? 'Oppretter…' : 'Opprett'}
						</button>
						<button
							class="goal-control-cancel"
							type="button"
							onclick={cancelHealthGoalCreation}
							disabled={healthGoalSaving}
						>
							Avbryt
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}

	{#if goals.length === 0 && activeDashboardKind !== 'health'}
		<div class="goals-empty">
			<p>Ingen aktive mål i dette temaet ennå.</p>
			<button
				class="goals-new-btn"
				onclick={() => onSwitchToChat?.()}
			>
				+ Si til AI at du vil sette et mål
			</button>
		</div>
	{/if}
</div>

<style>
	.goals-panel {
		padding: 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.goals-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.goals-section-title {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
		color: #e8e8e8;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.goals-section-copy {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #666;
	}

	.goals-grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.goal-card {
		background: #141414;
		border: 1px solid #242424;
		border-radius: 14px;
		padding: 14px;
		display: flex;
		gap: 14px;
		align-items: center;
		position: relative;
	}

	.goal-card-editing {
		padding: 16px;
	}

	.goal-ring {
		flex-shrink: 0;
	}

	.goal-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}

	.goal-title {
		font-size: 0.9rem;
		font-weight: 600;
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.goal-desc {
		font-size: 0.72rem;
		color: #555;
		line-height: 1.4;
	}

	.goal-status {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.goal-actions {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-left: auto;
	}

	.goal-action-btn {
		width: 32px;
		height: 32px;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #888;
		font-size: 0.96rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: all 0.15s ease;
	}

	.goal-action-btn:hover {
		background: #1a1a1a;
		border-color: #3a3a3a;
	}

	.goal-edit-btn:hover {
		color: #7c8ef5;
		border-color: #3c4f9f;
	}

	.goal-delete-btn:hover {
		color: #ee8c8c;
		border-color: #9e4545;
	}

	.goal-edit-form {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.goal-edit-label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 0.78rem;
		color: #9b9b9b;
	}

	.goal-edit-input {
		background: #101010;
		border: 1px solid #2c2c2c;
		border-radius: 10px;
		padding: 8px 10px;
		color: #ddd;
		font: inherit;
		font-size: 0.86rem;
	}

	.goal-edit-input[type='date'] {
		padding: 8px 12px;
		cursor: pointer;
		color-scheme: dark;
	}

	.goal-edit-input[type='date']::-webkit-calendar-picker-indicator {
		filter: invert(0.7);
		cursor: pointer;
		opacity: 0.8;
		transition: opacity 0.15s ease;
	}

	.goal-edit-input[type='date']::-webkit-calendar-picker-indicator:hover {
		opacity: 1;
	}

	.goal-edit-input:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.goal-edit-textarea {
		background: #101010;
		border: 1px solid #2c2c2c;
		border-radius: 10px;
		padding: 8px 10px;
		color: #ddd;
		font: inherit;
		font-size: 0.86rem;
		resize: vertical;
	}

	.goal-edit-textarea:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.goal-edit-error {
		margin: 0;
		color: #ee8c8c;
		font-size: 0.72rem;
	}

	.goal-edit-actions {
		display: flex;
		gap: 8px;
	}

	.goal-edit-save {
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

	.goal-edit-save:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.goal-edit-cancel {
		background: #1a1a1a;
		color: #999;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 8px 16px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	.goal-edit-cancel:disabled {
		opacity: 0.5;
		cursor: default;
	}

	/* ── Opprett helsemål ── */
	.goals-create-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 16px;
		background: #141414;
		border: 1px solid #242424;
		border-radius: 14px;
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

	.goal-control-input[type="date"]::-webkit-calendar-picker-indicator:hover {
		opacity: 1;
	}

	.goal-control-input:focus {
		outline: none;
		border-color: var(--tp-border-strong, hsl(228 28% 34%));
		box-shadow: 0 0 0 2px hsl(var(--theme-hue, 228) 50% 44% / 0.16);
	}

	.goal-control-actions {
		display: flex;
		gap: 8px;
	}

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

	.goal-control-save:disabled {
		opacity: 0.5;
		cursor: default;
	}

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

	.goal-control-cancel:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.goal-control-error {
		margin: 0;
		color: #ee8c8c;
		font-size: 0.72rem;
	}

	.goal-type-selector {
		display: flex;
		gap: 12px;
	}

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

	.goals-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 20px;
		color: #444;
		font-size: 0.85rem;
		text-align: center;
	}

	.goals-new-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: var(--tp-accent, hsl(228 70% 70%));
		font: inherit;
		font-size: 0.8rem;
		padding: 8px 16px;
		border-radius: 99px;
		cursor: pointer;
	}
</style>
