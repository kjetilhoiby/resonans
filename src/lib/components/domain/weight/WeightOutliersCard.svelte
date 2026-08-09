<!--
  WeightOutliersCard — veiinger som ikke kan stemme, med en vei ut.

  ## Hvorfor kortet finnes

  10. august 2018 lå det en måling på ~40 kg i en historikk som ellers ligger rundt
  100. Vekta målte noe, bare ikke brukeren — et barn på vekta, en bag, en sensorglipp.
  Den var synlig i grafen med én gang, men umulig å gjøre noe med: én rad blant 1 200,
  og resten av flaten leser dagsverdier uten id-er.

  ## Hvorfor det ikke bare filtreres bort

  En måling vi skjuler for grafen er fortsatt med i snitt, milepæler, energibalanse og
  målprogresjon — da sier flaten og regnestykkene ulike ting, og det er verre enn å
  vise den. Og en terskel som skjuler data skjuler før eller siden noe ekte. Vi peker,
  brukeren bestemmer.

  ## Hvorfor kortet forsvinner når det er stille

  Motsatt av milepælkortet, og med vilje: her er tomhet den normale tilstanden, ikke
  en beskjed. Et permanent «ingen mistenkelige målinger» ville vært støy på hver
  eneste visning av flaten. Kortet dukker opp når det har noe å si.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { describeOutlier, type WeightOutlier } from '$lib/domain/health/weight-outliers';

	interface Props {
		/** Kalles etter en vellykket sletting, så flaten kan hente på nytt. */
		onDeleted?: () => void;
	}

	let { onDeleted }: Props = $props();

	let outliers = $state<WeightOutlier[]>([]);
	let loaded = $state(false);
	let confirmingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let error = $state<string | null>(null);

	async function load() {
		try {
			const res = await fetch('/api/helse/vekt/maalinger');
			if (!res.ok) {
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			const body = await res.json();
			outliers = body.maalinger ?? [];
			error = null;
		} catch (err) {
			// Meldingen skal vises, ikke svelges — en tom catch gjør en prod-feil uløselig.
			error = err instanceof Error ? err.message : 'Kunne ikke hente målingene';
		} finally {
			loaded = true;
		}
	}

	async function remove(outlier: WeightOutlier) {
		deletingId = outlier.id;
		try {
			const res = await fetch(`/api/helse/vekt/maalinger/${outlier.id}`, { method: 'DELETE' });
			if (!res.ok) {
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			outliers = outliers.filter((o) => o.id !== outlier.id);
			error = null;
			confirmingId = null;
			onDeleted?.();
		} catch (err) {
			error = err instanceof Error ? err.message : 'Kunne ikke slette målingen';
		} finally {
			deletingId = null;
		}
	}

	function formatKg(value: number): string {
		return value.toFixed(1).replace('.', ',');
	}

	$effect(() => {
		load();
	});
</script>

{#if loaded && (outliers.length > 0 || error)}
	<section class="outliers">
		<SectionLabel tag="h2">Mistenkelige målinger</SectionLabel>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		{#if outliers.length > 0}
			<p class="intro">
				Disse avviker så mye fra målingene rundt seg at vekta trolig målte noe annet enn deg.
				De er ikke skjult noe sted — de teller i snitt, milepæler og energibalanse til de
				slettes.
			</p>

			<ul>
				{#each outliers as outlier (outlier.id)}
					<li>
						<div class="row">
							<div class="what">
								<span class="value">{formatKg(outlier.weightKg)} kg</span>
								<span class="date">{outlier.date}</span>
								{#if outlier.source}
									<span class="source">{outlier.source}</span>
								{/if}
							</div>

							{#if confirmingId === outlier.id}
								<div class="confirm">
									<button
										class="danger"
										data-track="vekt-mistenkelige:bekreft-slett"
										disabled={deletingId === outlier.id}
										onclick={() => remove(outlier)}
									>
										{deletingId === outlier.id ? 'Sletter …' : 'Slett'}
									</button>
									<button
										data-track="vekt-mistenkelige:avbryt"
										onclick={() => (confirmingId = null)}
									>
										Avbryt
									</button>
								</div>
							{:else}
								<button
									data-track="vekt-mistenkelige:slett"
									onclick={() => (confirmingId = outlier.id)}
								>
									Slett
								</button>
							{/if}
						</div>

						<p class="why">{describeOutlier(outlier)}</p>
					</li>
				{/each}
			</ul>

			<p class="note">
				Slett målingen i kilden også (Withings eller Apple Helse), ellers kan den komme
				tilbake ved en full synk eller en ny backfill.
			</p>
		{/if}
	</section>
{/if}

<style>
	.outliers {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.what {
		display: flex;
		align-items: baseline;
		gap: 8px;
		flex-wrap: wrap;
	}

	.value {
		font-size: 0.95rem;
		font-weight: 600;
		color: #eee;
	}

	.date {
		font-size: 0.78rem;
		color: #999;
	}

	.source {
		padding: 1px 6px;
		border-radius: 999px;
		background: #202020;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #7d7d7d;
	}

	.confirm {
		display: flex;
		gap: 6px;
	}

	button {
		padding: 5px 12px;
		border: 1px solid #2e2e2e;
		border-radius: 999px;
		background: #1b1b1b;
		font-size: 0.75rem;
		color: #ccc;
		cursor: pointer;
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}

	button.danger {
		border-color: #6b2020;
		background: #2a1414;
		color: #e88;
	}

	.intro,
	.note,
	.why {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}

	.error {
		margin: 0;
		font-size: 0.75rem;
		color: #e88;
	}
</style>
