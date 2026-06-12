<!--
  Tema-knapp-grid for hjemskjermen.
  Ren presentasjonskomponent: 3-kolonne grid med kompakte tema-knapper (v3).
  Trukket ut fra HomeThemeZone — markup og CSS uendret.
-->
<script lang="ts">
	import { getThemeHueStyle } from '$lib/domain/theme-hues';

	export interface ThemeButtonItem {
		id: string;
		name: string;
		emoji: string;
	}

	interface Props {
		themes: ThemeButtonItem[];
		onSelect: (theme: ThemeButtonItem) => void;
	}

	let { themes, onSelect }: Props = $props();
</script>

<div class="tema-v3-grid">
	{#each themes as theme}
		<button class="tema-btn-v3" style={getThemeHueStyle(theme.name)} onclick={() => onSelect(theme)}>
			<span class="tema-btn-v3-icon">{theme.emoji}</span>
			<span class="tema-btn-v3-label">{theme.name}</span>
		</button>
	{/each}
</div>

<style>
	/* ── Tema v3: 3-kolonne grid med kompakte knapper ── */
	.tema-v3-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}

	.tema-btn-v3 {
		--theme-hue: 228;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: hsl(var(--theme-hue) 19% 11%);
		border: none;
		border-radius: 14px;
		padding: 8px 6px;
		cursor: pointer;
		transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
		font: inherit;
		color: #ddd;
	}

	.tema-btn-v3:hover {
		background: hsl(var(--theme-hue) 22% 14%);
		box-shadow: 0 8px 20px hsl(var(--theme-hue) 55% 18% / 0.2);
		transform: translateY(-1px);
	}

	.tema-btn-v3-icon {
		font-size: 1.15rem;
		line-height: 1;
		filter: drop-shadow(0 2px 8px hsl(var(--theme-hue) 70% 18% / 0.25));
	}

	.tema-btn-v3-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: hsl(var(--theme-hue) 22% 80%);
		opacity: 0.8;
	}
</style>
