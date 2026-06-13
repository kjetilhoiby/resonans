<script lang="ts">
	import { onMount } from 'svelte';
	import { Button, Textarea } from '$lib/components/ui';

	interface CheckinStatus {
		day: string;
		hasPartner: boolean;
		submitted: boolean;
		partnerSubmitted: boolean;
		revealed: boolean;
		myScore: number | null;
		myNote: string | null;
		partnerScore: number | null;
		partnerNote: string | null;
		followUpRecommended: boolean;
	}

	let status = $state<CheckinStatus | null>(null);
	let selectedScore = $state<number | null>(null);
	let note = $state('');
	let saving = $state(false);
	let errorMessage = $state('');

	onMount(async () => {
		try {
			const res = await fetch('/api/relationship/checkin');
			if (res.ok) {
				status = await res.json();
				selectedScore = status?.myScore ?? null;
				note = status?.myNote ?? '';
			}
		} catch (err) {
			console.error('Failed to load relationship check-in status:', err);
		}
	});

	async function submit() {
		if (!selectedScore || saving) return;
		saving = true;
		errorMessage = '';
		try {
			const res = await fetch('/api/relationship/checkin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ score: selectedScore, note: note || null, day: status?.day })
			});
			const body = await res.json();
			if (res.ok) {
				status = body;
			} else {
				errorMessage = body.error || 'Kunne ikke lagre parsjekk.';
			}
		} catch (err) {
			console.error('Failed to submit relationship check-in:', err);
			errorMessage = 'Kunne ikke lagre parsjekk.';
		} finally {
			saving = false;
		}
	}
</script>

{#if status?.hasPartner}
	<section class="checkin-card">
		<header class="checkin-head">
			<h3>💞 Daglig parsjekk</h3>
			{#if status.submitted && !status.revealed}
				<span class="checkin-badge waiting">Venter på partner</span>
			{:else if status.revealed}
				<span class="checkin-badge revealed">Begge har svart</span>
			{/if}
		</header>

		{#if status.revealed}
			<div class="checkin-result">
				<div class="score-pair">
					<span class="score-chip">Din score: <strong>{status.myScore}</strong></span>
					<span class="score-chip">Partners score: <strong>{status.partnerScore}</strong></span>
				</div>
				{#if status.partnerNote}
					<p class="partner-note">Partnernotat: {status.partnerNote}</p>
				{/if}
				{#if status.followUpRecommended}
					<p class="followup">Forslag: ta en kort prat i kveld mens dette fortsatt er ferskt.</p>
				{/if}
			</div>
		{:else}
			<p class="checkin-help">
				Svar fra 1 til 7 på hvordan dere har det i dag. Svarene vises når begge har sendt inn.
			</p>

			<div class="score-row" role="radiogroup" aria-label="Parsjekk-score fra 1 til 7">
				{#each [1, 2, 3, 4, 5, 6, 7] as score}
					<button
						type="button"
						class="score-option"
						class:selected={selectedScore === score}
						role="radio"
						aria-checked={selectedScore === score}
						aria-label={`Parsjekk score ${score}`}
						data-track="parsjekk:score"
						onclick={() => (selectedScore = score)}
					>
						{score}
					</button>
				{/each}
			</div>

			<Textarea
				rows={2}
				placeholder="Kort notat (valgfritt) — hva var bra eller krevende i dag?"
				ariaLabel="Parsjekk-notat"
				bind:value={note}
			/>

			<div class="checkin-actions">
				<Button type="button" disabled={!selectedScore || saving} onClick={() => void submit()}>
					{saving ? 'Lagrer …' : status.submitted ? 'Oppdater parsjekk' : 'Lagre parsjekk'}
				</Button>
				{#if status.submitted && !status.revealed}
					<span class="submitted-hint">Du har sendt inn for {status.day}.</span>
				{/if}
			</div>

			{#if errorMessage}
				<p class="checkin-error">{errorMessage}</p>
			{/if}
		{/if}
	</section>
{/if}

<style>
	.checkin-card {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
		padding: 0.85rem;
		border: 1px solid var(--card-border, #3a3d4a);
		border-radius: var(--radius-md, 12px);
		background: var(--card-bg, #20232e);
	}

	.checkin-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.checkin-head h3 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--tp-text, #e8e8ef);
	}

	.checkin-badge {
		font-size: 0.72rem;
		border-radius: 999px;
		padding: 0.1rem 0.5rem;
	}

	.checkin-badge.waiting {
		background: var(--tp-accent-bg, #3a3d5a);
		color: var(--tp-accent, #9aa8f7);
	}

	.checkin-badge.revealed {
		background: color-mix(in srgb, #4ade80 18%, transparent);
		color: #4ade80;
	}

	.checkin-help {
		margin: 0;
		font-size: 0.85rem;
		color: var(--tp-text-soft, #aaa);
	}

	.score-row {
		display: flex;
		gap: 0.35rem;
		flex-wrap: wrap;
	}

	.score-option {
		min-width: 2.2rem;
		padding: 0.4rem 0;
		border-radius: 999px;
		border: 1px solid var(--tp-border, #3a3d4a);
		background: none;
		color: var(--tp-text-soft, #aaa);
		font: inherit;
		cursor: pointer;
	}

	.score-option.selected {
		background: var(--tp-accent-bg, #3a3d5a);
		border-color: var(--tp-accent, #7c8ef5);
		color: var(--tp-text, #fff);
	}

	.checkin-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.submitted-hint {
		font-size: 0.8rem;
		color: var(--tp-text-soft, #aaa);
	}

	.checkin-result {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	.score-pair {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.score-chip {
		font-size: 0.85rem;
		padding: 0.3rem 0.6rem;
		border-radius: 999px;
		background: var(--tp-bg-1, #2a2d3a);
		color: var(--tp-text, #e8e8ef);
	}

	.partner-note {
		margin: 0;
		font-size: 0.85rem;
		color: var(--tp-text-soft, #aaa);
		font-style: italic;
	}

	.followup {
		margin: 0;
		font-size: 0.85rem;
		color: #f9d980;
		font-weight: 600;
	}

	.checkin-error {
		margin: 0;
		font-size: 0.85rem;
		color: var(--error-text, #f87171);
	}
</style>
