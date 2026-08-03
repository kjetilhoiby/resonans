<!--
  MacroSplitBar — hvor energien kom fra, som andel.

  Gram side om side er ikke sammenlignbare: fett har 9 kcal per gram mot 4 for de
  to andre. På dagen dette ble bygget for hadde fett FÆRREST gram av de tre og
  FLEST kalorier — det er nettopp den innsikten talltilene ikke kunne gi.

  Formen er valgt, ikke funnet: del-av-helhet med tre kategorier er en liggende
  stablet stolpe. Ikke et kakediagram, og ikke tre måleere.

  Fargene er de tre første slottene fra den validerte kategoriske paletten, og de
  tildeles i fast rekkefølge — protein, karbo, fett — slik at et segment beholder
  fargen når et annet blir null. Validert mot #141414: verste nabopar ΔE 9,4
  (deutan), 26,5 (normalt syn), alle over 3:1 mot flaten.

  Identiteten ligger aldri i fargen alene: hvert segment er direkte merket, og
  legenden under gjentar gram og kcal. Tekst bruker tekst-tokens, ikke seriefargen.
-->
<script lang="ts">
	import { formatShare, type MacroSplit } from '$lib/domain/nutrition/macro-split';

	interface Props {
		split: MacroSplit | null;
		/** Overskrift over stolpen. Utelates når kortet alt har en. */
		heading?: string;
	}

	let { split, heading = 'Energi fra makroer' }: Props = $props();

	/** Fast tildeling. Rekkefølgen er palettens slot-rekkefølge, ikke rangering. */
	const COLORS: Record<string, string> = {
		protein: '#3987e5',
		carbs: '#d95926',
		fat: '#199e70'
	};

	function nb(value: number, decimals = 0): string {
		return value.toLocaleString('nb-NO', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		});
	}

	/** Segmenter med null andel tas ut — et 0px-segment er bare et hull. */
	const visible = $derived((split?.slices ?? []).filter((s) => s.share > 0));

	/** Andelen må over dette for at teksten skal få plass inne i segmentet. */
	const LABEL_FITS_ABOVE = 0.12;
</script>

{#if split && visible.length > 0}
	<figure class="macro-split">
		<figcaption>{heading}</figcaption>

		<div
			class="bar"
			role="img"
			aria-label={visible
				.map((s) => `${s.label} ${formatShare(s.share)}, ${nb(s.grams, 1)} gram`)
				.join('. ')}
		>
			{#each visible as slice (slice.key)}
				<div
					class="segment"
					style="flex-grow: {slice.share}; background: {COLORS[slice.key]}"
					title="{slice.label}: {nb(slice.grams, 1)} g · {nb(slice.kcal)} kcal · {formatShare(slice.share)}"
				>
					{#if slice.share >= LABEL_FITS_ABOVE}
						<span class="segment-label">{formatShare(slice.share)}</span>
					{/if}
				</div>
			{/each}
		</div>

		<ul class="legend">
			{#each split.slices as slice (slice.key)}
				<li>
					<span class="swatch" style="background: {COLORS[slice.key]}"></span>
					<span class="legend-label">{slice.label}</span>
					<span class="legend-value">{nb(slice.grams, 1)} g</span>
					<span class="legend-kcal">{nb(slice.kcal)} kcal</span>
				</li>
			{/each}
		</ul>

		{#if split.worthMentioning}
			<p class="note">
				Makroene forklarer {nb(split.macroKcal)} av {nb(split.loggedKcal)} kcal. Differansen
				kommer av at fiber og alkohol regnes ulikt, og at makroene er anslag hver for seg.
			</p>
		{/if}
	</figure>
{/if}

<style>
	.macro-split {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
	}

	figcaption {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary, #777);
	}

	.bar {
		display: flex;
		/* 2px i flatefargen skiller segmentene — samme bredde hele veien. */
		gap: 2px;
		height: 20px;
		border-radius: 4px;
		overflow: hidden;
	}

	.segment {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: 2px;
		/* Ytterendene runder; skillene mellom segmentene er rette. */
		border-radius: 0;
	}

	.segment:first-child {
		border-start-start-radius: 4px;
		border-end-start-radius: 4px;
	}

	.segment:last-child {
		border-start-end-radius: 4px;
		border-end-end-radius: 4px;
	}

	.segment-label {
		font-size: 0.66rem;
		font-weight: 600;
		/* Inne i et farget felt er dette unntaket fra «tekst bruker tekst-tokens». */
		color: #fff;
		white-space: nowrap;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
	}

	.swatch {
		width: 8px;
		height: 8px;
		border-radius: 2px;
		flex-shrink: 0;
	}

	.legend-label {
		color: var(--text-secondary, #aaa);
	}

	.legend-value {
		color: var(--text-primary, #eee);
		font-variant-numeric: tabular-nums;
	}

	.legend-kcal {
		color: var(--text-tertiary, #777);
		font-variant-numeric: tabular-nums;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--text-tertiary, #777);
	}
</style>
