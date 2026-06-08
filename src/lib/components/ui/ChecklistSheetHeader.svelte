<script lang="ts">
	import WeatherStrip, { type WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		emoji: string;
		displayTitle: string;
		done: number;
		total: number;
		pct: number;
		ringColor: string;
		weatherPeriods: WeatherPeriod[] | null;
		onclose: () => void;
		onshare: () => void;
	}

	let { emoji, displayTitle, done, total, pct, ringColor, weatherPeriods, onclose, onshare }: Props = $props();
</script>

<div class="cs-header">
	<div class="cs-header-left">
		{#if emoji}
			<span class="cs-header-emoji">{emoji}</span>
		{/if}
		<div>
			<h2 class="cs-title">{displayTitle}</h2>
			<p class="cs-subtitle">{done} av {total} fullført</p>
		</div>
	</div>
	{#if weatherPeriods}
		<div class="cs-header-weather">
			<WeatherStrip periods={weatherPeriods} />
		</div>
	{/if}
	<button class="cs-share-btn" onclick={onshare} aria-label="Del" title="Del">
		↗
	</button>
	<button class="cs-close-btn" onclick={onclose} aria-label="Lukk"><Icon name="close" size={14} /></button>
</div>

<!-- Progress bar -->
<div class="cs-progress-track">
	<div
		class="cs-progress-fill"
		style="width:{pct * 100}%; background:{ringColor}"
	></div>
</div>

<style>
	.cs-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 20px 12px;
		flex-shrink: 0;
	}

	.cs-header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.cs-header-emoji {
		font-size: 1.8rem;
		line-height: 1;
	}

	.cs-title {
		font-size: 1rem;
		font-weight: 700;
		color: #eee;
		margin: 0 0 2px;
		letter-spacing: -0.01em;
	}

	.cs-subtitle {
		font-size: 0.72rem;
		color: #555;
		margin: 0;
	}

	.cs-close-btn {
		width: 32px;
		height: 32px;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #666;
		font-size: 0.75rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: color 0.12s, border-color 0.12s;
	}
	.cs-close-btn:hover { color: #ccc; border-color: #555; }

	.cs-share-btn {
		width: 32px;
		height: 32px;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #888;
		font-size: 1rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-right: 6px;
		transition: color 0.12s, border-color 0.12s;
	}
	.cs-share-btn:hover { color: #ccc; border-color: #555; }

	.cs-header-weather {
		flex: 1;
		display: flex;
		justify-content: flex-end;
		padding: 0 12px;
		min-width: 0;
	}

	.cs-progress-track {
		height: 3px;
		background: #1e1e1e;
		flex-shrink: 0;
		margin: 0 20px;
		border-radius: 999px;
		overflow: hidden;
	}

	.cs-progress-fill {
		height: 100%;
		border-radius: 999px;
		transition: width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
</style>
