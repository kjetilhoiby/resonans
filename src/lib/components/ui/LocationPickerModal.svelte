<!--
  LocationPickerModal — vises kun når et stedsnavn er tvetydig (flere plausible
  treff). Lar brukeren velge riktig sted, eller beholde teksten uten å pinne
  koordinat. Entydige navn (f.eks. «Dublin») når aldri hit.
-->
<script lang="ts">
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { GeoCandidate } from '$lib/utils/geocode';

	interface Props {
		placeName: string;
		candidates: GeoCandidate[];
		onPick: (candidate: GeoCandidate) => void;
		onKeepAsTyped: () => void;
		onClose: () => void;
	}

	let { placeName, candidates, onPick, onKeepAsTyped, onClose }: Props = $props();
</script>

<div class="lp-backdrop" transition:fade={{ duration: 150 }} onclick={onClose} role="presentation"></div>

<div
	class="lp-sheet"
	transition:fly={{ y: 30, duration: 280, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
	aria-label="Velg sted"
>
	<h2 class="lp-title">Hvilken «{placeName}»?</h2>
	<p class="lp-sub">Flere steder matcher. Velg riktig så vi bruker riktig vær og posisjon.</p>

	<div class="lp-list">
		{#each candidates as c (c.lat + ',' + c.lon)}
			<button type="button" class="lp-option" onclick={() => onPick(c)}>
				<span class="lp-pin">📍</span>
				<span class="lp-option-main">
					<span class="lp-option-label">{c.label}</span>
					{#if c.distanceKm !== null}
						<span class="lp-option-dist">{c.distanceKm} km unna</span>
					{/if}
				</span>
			</button>
		{/each}
	</div>

	<button type="button" class="lp-keep" onclick={onKeepAsTyped}>
		Behold «{placeName}» uten å koble til kart
	</button>
</div>

<style>
	.lp-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		z-index: 320;
	}
	.lp-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 321;
		background: #141414;
		border-radius: 20px 20px 0 0;
		border-top: 1px solid #262626;
		padding: 22px 20px calc(20px + env(safe-area-inset-bottom));
		max-width: 520px;
		margin: 0 auto;
	}
	.lp-title {
		font-size: 1.05rem;
		font-weight: 700;
		color: #eee;
		margin: 0 0 4px;
		letter-spacing: -0.01em;
	}
	.lp-sub {
		font-size: 0.8rem;
		color: #777;
		margin: 0 0 16px;
	}
	.lp-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lp-option {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		text-align: left;
		background: #1c1c1c;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
		cursor: pointer;
		font: inherit;
		transition: border-color 0.12s, background 0.12s;
	}
	.lp-option:hover {
		border-color: #4a5af0;
		background: #1f2030;
	}
	.lp-pin {
		font-size: 1rem;
		line-height: 1;
		flex-shrink: 0;
	}
	.lp-option-main {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.lp-option-label {
		font-size: 0.9rem;
		color: #ddd;
		font-weight: 600;
	}
	.lp-option-dist {
		font-size: 0.74rem;
		color: #6f7cd0;
		font-variant-numeric: tabular-nums;
	}
	.lp-keep {
		display: block;
		width: 100%;
		margin-top: 14px;
		background: transparent;
		border: none;
		color: #666;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		padding: 8px;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.lp-keep:hover {
		color: #aaa;
	}
</style>
