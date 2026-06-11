<!--
  GoalEditCard — Inline edit form for an existing goal in ThemeGoalsTab.
  Handles title, description, metric-specific fields, and save/cancel actions.
-->
<script lang="ts">
	import DateInput from '$lib/components/ui/DateInput.svelte';

	interface Goal {
		id: string;
		title: string;
		status: string;
		description?: string | null;
		metadata?: Record<string, unknown>;
	}

	interface Props {
		goal: Goal;
		onSaved?: () => void;
		onCancel?: () => void;
	}

	let { goal, onSaved, onCancel }: Props = $props();

	let editGoalTitle = $state(goal.title);
	let editGoalDesc = $state(goal.description ?? '');
	let editGoalTargetDate = $state('');
	let editGoalStartDate = $state('');
	let editGoalEndDate = $state('');
	let editGoalTargetValue = $state('');
	let editGoalStartValue = $state('');
	let editGoalMetricId = $state('');
	let editGoalSaving = $state(false);
	let editGoalError = $state('');

	// Initialize from goal metadata
	{
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

	async function saveEditedGoal() {
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

			const res = await fetch(`/api/goals/${goal.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updateData)
			});

			if (!res.ok) throw new Error('save_failed');
			onSaved?.();
		} catch {
			editGoalError = 'Klarte ikke lagre endringer.';
		} finally {
			editGoalSaving = false;
		}
	}
</script>

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
				<DateInput bind:value={editGoalStartDate} />
			</label>
			<label class="goal-edit-label">
				Sluttdato
				<DateInput bind:value={editGoalEndDate} />
			</label>
			<label class="goal-edit-label">
				Mål (km)
				<input class="goal-edit-input" type="number" step="0.1" bind:value={editGoalTargetValue} placeholder="150" />
			</label>
		{:else if editGoalMetricId === 'weight_change'}
			<label class="goal-edit-label">
				Startdato
				<DateInput bind:value={editGoalStartDate} />
			</label>
			<label class="goal-edit-label">
				Startvekt (kg)
				<input class="goal-edit-input" type="number" step="0.1" bind:value={editGoalStartValue} placeholder="85" />
			</label>
			<label class="goal-edit-label">
				Måldato
				<DateInput bind:value={editGoalEndDate} />
			</label>
			<label class="goal-edit-label">
				Målvekt (kg)
				<input class="goal-edit-input" type="number" step="0.1" bind:value={editGoalTargetValue} placeholder="78" />
			</label>
		{:else}
			<label class="goal-edit-label">
				Måldag
				<DateInput bind:value={editGoalTargetDate} />
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
				onclick={() => onCancel?.()}
				disabled={editGoalSaving}
			>
				Avbryt
			</button>
		</div>
	</div>
</div>

<style>
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
	.goal-card-editing { padding: 16px; }
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
	.goal-edit-input[type='date']::-webkit-calendar-picker-indicator:hover { opacity: 1; }
	.goal-edit-input:focus { outline: none; border-color: #3c4f9f; }
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
	.goal-edit-textarea:focus { outline: none; border-color: #3c4f9f; }
	.goal-edit-error { margin: 0; color: #ee8c8c; font-size: 0.72rem; }
	.goal-edit-actions { display: flex; gap: 8px; }
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
	.goal-edit-save:disabled { opacity: 0.5; cursor: default; }
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
	.goal-edit-cancel:disabled { opacity: 0.5; cursor: default; }
</style>
