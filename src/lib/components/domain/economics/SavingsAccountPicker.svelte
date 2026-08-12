<script lang="ts">
	/**
	 * Hvilke kontoer som regnes som buffer.
	 *
	 * **Retting der du ser tallet** — samme prinsipp som kategoriretting i fase 4. Velgeren
	 * står på sparekontoflaten, ikke i et innstillingsark, fordi det er her man oppdager at
	 * en konto er med som ikke skulle være det. Se
	 * `docs/changelog/2026-08-12-velge-bufferkontoer.md`.
	 *
	 * Tre ting kortet gjør bevisst:
	 *
	 * 1. **Viser ALLE kontoer**, også dem som er ute. Uten dem kan man bare trekke fra, og en
	 *    konto heuristikken ikke fanget kunne aldri legges til.
	 * 2. **Sier hvorfor** hver konto er inne eller ute. «Navnet matcher et barn» er en annen
	 *    beskjed enn «navnet ser ikke ut som en sparekonto», og de to inviterer til ulik
	 *    handling.
	 * 3. **Skiller «automatisk» fra et valg.** `auto` er standard, så en ny konto virker uten
	 *    at noen må huske den. Et eksplisitt valg står selv om heuristikken endres.
	 */
	import SectionCard from '$lib/components/ui/SectionCard.svelte';
	import { saveSavingsRole, type SavingsRole } from '$lib/client/savings-account-role';

	type Candidate = {
		accountId: string;
		accountName: string | null;
		accountType: string | null;
		balance: number;
		isBuffer: boolean;
		role: SavingsRole;
		basis: string;
		autoWouldInclude: boolean;
		reason: string;
	};

	interface Props {
		candidates: Candidate[];
		/** Kalles etter en lagret endring, så flaten kan regne bufferen på nytt. */
		onChanged: () => void;
	}

	let { candidates, onChanged }: Props = $props();

	let saving = $state<string | null>(null);
	let error = $state<string | null>(null);

	function formatNOK(amount: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(amount);
	}

	/**
	 * Trykket bytter mellom «med» og «utenfor» — og går tilbake til `auto` når valget
	 * likevel er det heuristikken ville sagt.
	 *
	 * Grunnen: et lagret valg som er identisk med standarden er en usynlig lås. Endres
	 * heuristikken senere, ville den kontoen ikke fulgt med, uten at noe sa fra.
	 */
	function nextRole(candidate: Candidate): SavingsRole {
		const wantBuffer = !candidate.isBuffer;
		if (wantBuffer === candidate.autoWouldInclude) return 'auto';
		return wantBuffer ? 'buffer' : 'ignore';
	}

	async function toggle(candidate: Candidate) {
		saving = candidate.accountId;
		error = null;
		try {
			await saveSavingsRole(candidate.accountId, nextRole(candidate));
			onChanged();
		} catch (err) {
			// Meldingen VISES. Et stille avslag ville sett ut som at valget ble lagret.
			error = err instanceof Error ? err.message : 'Kunne ikke lagre valget';
		} finally {
			saving = null;
		}
	}
</script>

<SectionCard>
	<div class="sp-head">
		<h3>Hva regnes som buffer</h3>
		<p>
			Trykk på en konto for å ta den med eller holde den utenfor. Uten et valg avgjør
			kontonavnet, og barnas kontoer er utenfor som standard.
		</p>
	</div>

	{#if error}
		<p class="sp-error" role="alert">{error}</p>
	{/if}

	{#if candidates.length === 0}
		<p class="sp-empty">
			Ingen kontoer med saldo funnet. Koble til SpareBank1 for å se dem her.
		</p>
	{:else}
		<ul class="sp-list">
			{#each candidates as candidate (candidate.accountId)}
				<li>
					<button
						type="button"
						class="sp-row"
						class:is-buffer={candidate.isBuffer}
						disabled={saving === candidate.accountId}
						aria-pressed={candidate.isBuffer}
						data-track="sparing-kontoer:veksle"
						onclick={() => toggle(candidate)}
					>
						<span class="sp-mark" aria-hidden="true">{candidate.isBuffer ? '✓' : ''}</span>
						<span class="sp-body">
							<span class="sp-name">
								{candidate.accountName ?? candidate.accountId}
								{#if candidate.role !== 'auto'}
									<!-- Et eksplisitt valg skal være synlig, ellers ser det ut som heuristikken. -->
									<span class="sp-chip">valgt</span>
								{/if}
							</span>
							<span class="sp-reason">{candidate.reason}</span>
						</span>
						<span class="sp-amount">{formatNOK(candidate.balance)}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</SectionCard>

<style>
	.sp-head h3 {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text-primary, #ececf5);
	}
	.sp-head p {
		margin: 0.3rem 0 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: var(--text-secondary, #8f909f);
	}
	.sp-error {
		margin: 0.7rem 0 0;
		font-size: 0.8rem;
		line-height: 1.5;
		color: #f87171;
	}
	.sp-empty {
		margin: 0.7rem 0 0;
		font-size: 0.8rem;
		color: var(--text-secondary, #8f909f);
	}
	.sp-list {
		list-style: none;
		margin: 0.7rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.sp-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.6rem 0.7rem;
		border-radius: 10px;
		background: var(--bg-card, #141414);
		border: 1px solid var(--border-color, #232323);
		font: inherit;
		text-align: left;
		color: var(--text-secondary, #aaa);
		cursor: pointer;
	}
	.sp-row.is-buffer {
		border-color: rgba(110, 231, 183, 0.4);
	}
	.sp-row:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.sp-mark {
		flex-shrink: 0;
		width: 1.15rem;
		height: 1.15rem;
		border-radius: 5px;
		border: 1px solid var(--border-color, #333);
		display: grid;
		place-items: center;
		font-size: 0.75rem;
		color: #6ee7b7;
	}
	.sp-row.is-buffer .sp-mark {
		border-color: rgba(110, 231, 183, 0.55);
	}
	.sp-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.sp-name {
		font-size: 0.85rem;
		color: var(--text-primary, #ececf5);
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-wrap: wrap;
	}
	.sp-chip {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 0.1rem 0.32rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-secondary, #9a9aa8);
	}
	.sp-reason {
		font-size: 0.74rem;
		line-height: 1.45;
		color: var(--text-secondary, #8f909f);
	}
	.sp-amount {
		flex-shrink: 0;
		font-size: 0.82rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary, #ececf5);
	}
</style>
