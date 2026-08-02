<!--
  HealthSubthemeStrip — én flis per undertema av Helse, med ett tall hver.

  Svarer på «hvor står hver gren» uten å rendre fem dashboards. Undertemaer som
  ikke er opprettet ennå vises dempet, men er fortsatt klikkbare: det er der man
  kobler kilden.

  Ren view — tallvalg, terskler og toner bygges i
  $lib/domain/health/subtheme-tiles og er testet der.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import type { SubthemeTile } from '$lib/domain/health/subtheme-tiles';

	interface Props {
		tiles: SubthemeTile[];
		/** Kalles for undertemaer som ikke finnes ennå. */
		onActivate?: (name: string) => void;
		activating?: string | null;
	}

	let { tiles, onActivate, activating = null }: Props = $props();
</script>

<section class="subtheme-strip">
	<SectionLabel tag="h2">Undertemaer</SectionLabel>
	<div class="strip-grid">
		{#each tiles as tile (tile.name)}
			{#if tile.themeId}
				<a
					class="tile"
					class:is-empty={tile.empty}
					data-tone={tile.tone}
					href={`/tema/${tile.themeId}`}
					data-track="helse-undertema:apne"
				>
					<span class="tile-emoji" aria-hidden="true">{tile.emoji}</span>
					<span class="tile-name">{tile.name}</span>
					{#if tile.empty}
						<span class="tile-empty">Ingen data</span>
					{:else}
						<span class="tile-value">{tile.value}</span>
						{#if tile.unit}<span class="tile-unit">{tile.unit}</span>{/if}
						{#if tile.delta}<span class="tile-delta">{tile.delta}</span>{/if}
					{/if}
				</a>
			{:else}
				<button
					type="button"
					class="tile is-inactive"
					onclick={() => onActivate?.(tile.name)}
					disabled={activating === tile.name}
					data-track="helse-undertema:aktiver"
				>
					<span class="tile-emoji" aria-hidden="true">{tile.emoji}</span>
					<span class="tile-name">{tile.name}</span>
					<span class="tile-empty">
						{activating === tile.name ? 'Aktiverer …' : 'Aktiver'}
					</span>
				</button>
			{/if}
		{/each}
	</div>
</section>

<style>
	.subtheme-strip {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* Scroll-snap på smale skjermer, grid når det er plass — samme mønster som
	   tema-pageren på hjemskjermen. */
	.strip-grid {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: minmax(112px, 1fr);
		gap: 8px;
		overflow-x: auto;
		scroll-snap-type: x proximity;
		padding-bottom: 4px;
		scrollbar-width: none;
	}

	.strip-grid::-webkit-scrollbar {
		display: none;
	}

	@media (min-width: 640px) {
		.strip-grid {
			grid-auto-flow: row;
			grid-template-columns: repeat(5, 1fr);
			overflow-x: visible;
		}
	}

	.tile {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px;
		min-width: 0;
		scroll-snap-align: start;
		background: var(--card-bg-subtle, #141414);
		border: 1px solid transparent;
		border-left: 3px solid var(--tile-tone, transparent);
		border-radius: var(--card-radius, 16px);
		text-align: left;
		text-decoration: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	.tile[data-tone='positiv'] { --tile-tone: #82c882; }
	.tile[data-tone='varsel'] { --tile-tone: #f0b429; }

	.tile.is-empty,
	.tile.is-inactive {
		opacity: 0.55;
	}

	.tile:disabled {
		cursor: progress;
	}

	.tile-emoji {
		font-size: 1.05rem;
		line-height: 1.2;
	}

	.tile-name {
		font-size: 0.74rem;
		color: #888;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tile-value {
		font-size: 1.15rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #eee;
	}

	.tile-unit,
	.tile-delta,
	.tile-empty {
		font-size: 0.7rem;
		color: #777;
	}

	.tile-delta {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
