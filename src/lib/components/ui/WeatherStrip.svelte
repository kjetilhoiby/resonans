<!--
  WeatherStrip — kompakt væroversikt for én dag, fordelt på perioder.
  Viser nedbør (blå bunnlinje), symbol og temperatur for 1–5 perioder.

  Props:
    periods – natt / morgen / ettermiddag / kveld med emoji, temp, precip
-->
<script lang="ts">
	export interface WeatherPeriod {
		key: string;     // 'natt' | 'morgen' | 'ettermiddag' | 'kveld' | ISO date (week-mode)
		label: string;   // tekst for tooltip / dag-label
		emoji: string;   // vær-emoji
		temp: number;    // °C
		precip: number;  // mm nebør
		isPast?: boolean; // true for dager som har gått (vises som tom placeholder)
	}

	interface Props {
		periods: WeatherPeriod[];
	}

	let { periods }: Props = $props();

	// Blå intensitet: 0.1 mm → svak, 5 mm → full
	function rainOpacity(mm: number): number {
		return Math.min(0.25 + (mm / 5) * 0.75, 1);
	}
</script>

<div class="ws">
	{#each periods as p (p.key)}
		<div
			class="ws-col"
			class:ws-past={p.isPast}
			title="{p.isPast ? p.label : `${p.label}: ${p.temp}°  ${p.precip > 0 ? p.precip + ' mm' : 'tørt'}`}"
		>
			{#if !p.isPast}
				<span class="ws-icon">{p.emoji}</span>
				<span class="ws-temp">{p.temp}°</span>
				{#if p.precip > 0.05}
					<div
						class="ws-rain"
						style="opacity: {rainOpacity(p.precip)}"
					></div>
				{/if}
			{:else}
				<span class="ws-past-dot"></span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.ws {
		display: flex;
		flex-direction: row;
		gap: 2px;
		border-radius: 7px;
		overflow: visible;
	}

	.ws-col {
		width: 30px;
		height: 36px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 5px;
		position: relative;
		cursor: default;
		transition: background 0.15s;
	}

	.ws-col:hover {
		background: rgba(255, 255, 255, 0.09);
	}

	.ws-past {
		background: transparent;
		border: 1px dashed rgba(255, 255, 255, 0.10);
		pointer-events: none;
	}

	.ws-past-dot {
		width: 3px;
		height: 3px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.15);
	}

	.ws-icon {
		font-size: 0.78rem;
		line-height: 1;
	}

	.ws-temp {
		font-size: 0.54rem;
		font-weight: 700;
		color: #999;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	/* Blå nedbørsindikator langs bunnen */
	.ws-rain {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: #5b9bd8;
		border-radius: 0;
	}
</style>
