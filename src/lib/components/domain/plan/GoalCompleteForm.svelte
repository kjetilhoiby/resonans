<!--
  GoalCompleteForm — regnskapet som fylles ut i det et mål markeres som nådd.

  Skjemaet er her framfor i en egen flate fordi det er NÅ brukeren husker prisen.
  Spør vi senere, er «hva kostet det» allerede glattet bort — en oppnåelse huskes
  for gevinsten. Begge felt er valgfrie: et tomt felt er bedre enn et gjettet, og
  en milepæl uten regnskap er fortsatt en milepæl.

  Se docs/changelog/2026-09-19-retningen-som-baerer-prioriteringer.md
-->
<script lang="ts">
	interface Props {
		title: string;
		busy?: boolean;
		error?: string | null;
		onconfirm: (ledger: { frees: string; cost: string }) => void;
		oncancel: () => void;
	}

	let { title, busy = false, error = null, onconfirm, oncancel }: Props = $props();

	let frees = $state('');
	let cost = $state('');
</script>

<div class="complete-form">
	<p class="lead">«{title}» er nådd. Hva endrer det?</p>

	<label class="field">
		<span>Hva frigjør det?</span>
		<textarea
			data-track="maal:milepael-frigjor"
			bind:value={frees}
			rows="2"
			placeholder="F.eks. «mindre belastning fra jobbsøkerprosesser»"
		></textarea>
	</label>

	<label class="field">
		<span>Hva kostet det?</span>
		<textarea
			data-track="maal:milepael-kostet"
			bind:value={cost}
			rows="2"
			placeholder="F.eks. «måneder med søknader, spenning på gammel jobb»"
		></textarea>
	</label>

	<p class="hint">
		Begge kan stå tomme. De leses senere som premisser for hva du kan prioritere — ikke som en
		seiersliste.
	</p>

	{#if error}
		<p class="error">{error}</p>
	{/if}

	<div class="actions">
		<button
			class="btn-complete"
			data-track="maal:milepael-lagre"
			disabled={busy}
			onclick={() => onconfirm({ frees, cost })}
		>
			{busy ? 'Lagrer …' : 'Marker som nådd'}
		</button>
		<button class="btn-secondary" disabled={busy} onclick={() => oncancel()}>Avbryt</button>
	</div>
</div>

<style>
	.complete-form {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.85rem;
		background: var(--card-bg-subtle);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-lg);
	}

	.lead {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.field span {
		font-size: 0.78rem;
		color: var(--text-secondary);
	}

	textarea {
		width: 100%;
		box-sizing: border-box;
		padding: 0.5rem 0.6rem;
		font: inherit;
		font-size: 0.85rem;
		color: var(--text-primary);
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--radius-md);
		resize: vertical;
	}

	.hint {
		margin: 0;
		font-size: 0.75rem;
		line-height: 1.4;
		color: var(--text-tertiary);
	}

	.error {
		margin: 0;
		font-size: 0.8rem;
		color: var(--error-text);
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}

	.actions button:disabled {
		opacity: 0.55;
		cursor: default;
	}
</style>
