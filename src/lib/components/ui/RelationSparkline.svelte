<!--
  RelationSparkline — to-linje sparkline klippet til en sirkel.

  Beregnet for parforhold/relasjonsdata: to personers scoring over tid.
  Verdier på 1–5-skala, 7 datapunkter (siste 7 registreringer).

  Props:
    dataA     array av tall (1–5), person A
    dataB     array av tall (1–5), person B
    colorA    default '#d4829a'
    colorB    default '#7cb5c0'
    labelA    default 'Person A'
    labelB    default 'Person B'
    size      wrapper-diameter i px, default 80
    showLegend  vis navnelabels under (default false, brukes på dashbord)
-->
<script lang="ts">
	interface Props {
		dataA: number[];
		dataB: number[];
		colorA?: string;
		colorB?: string;
		labelA?: string;
		labelB?: string;
		size?: number;
		showLegend?: boolean;
	}

	let {
		dataA,
		dataB,
		colorA = '#d4829a',
		colorB = '#7cb5c0',
		labelA = 'Person A',
		labelB = 'Person B',
		size = 80,
		showLegend = false,
	}: Props = $props();

	// Viewer coords: 0 0 64 64, margin 2px each side → useable x: 2–62
	// y: topp = verdi 5, bunn = verdi 1.
	// Mapp 1–5 til y 58–6 (invertert SVG-y)
	function toY(v: number): number {
		return 58 - ((Math.min(Math.max(v, 1), 5) - 1) / 4) * 52;
	}

	const n = $derived(Math.max(dataA.length, dataB.length));
	const xStep = $derived(n > 1 ? 60 / (n - 1) : 30);
	const endX = $derived(2 + (n - 1) * xStep);

	const ptsA = $derived(
		dataA.map((v, i) => `${(2 + i * xStep).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
	);
	const ptsB = $derived(
		dataB.map((v, i) => `${(2 + i * xStep).toFixed(1)},${toY(v).toFixed(1)}`).join(' ')
	);

	const lastA = $derived(dataA[dataA.length - 1]);
	const lastB = $derived(dataB[dataB.length - 1]);
</script>

<div class="rel-wrap">
	<div class="rel-circ" style="width:{size}px;height:{size}px">
		<svg viewBox="0 0 64 64" aria-hidden="true" style="width:100%;height:100%;display:block">
			<!-- subtile gridlinjer (verdi 2, 3, 4) -->
			{#each [6 + 52*3/4, 6 + 52*2/4, 6 + 52*1/4] as gy}
				<line x1="0" y1={gy.toFixed(1)} x2="64" y2={gy.toFixed(1)} stroke="#1e1e1e" stroke-width="0.5"/>
			{/each}
			<!-- fyllareal -->
			<polygon
				points="2,64 {ptsA} {endX.toFixed(1)},64"
				fill={colorA} fill-opacity="0.12"
			/>
			<polygon
				points="2,64 {ptsB} {endX.toFixed(1)},64"
				fill={colorB} fill-opacity="0.12"
			/>
			<!-- linje A -->
			<polyline
				points={ptsA}
				fill="none" stroke={colorA} stroke-width="1.5"
				stroke-linecap="round" stroke-linejoin="round"
			/>
			<!-- linje B -->
			<polyline
				points={ptsB}
				fill="none" stroke={colorB} stroke-width="1.5"
				stroke-linecap="round" stroke-linejoin="round"
			/>
		</svg>
	</div>
	<div class="rel-vals">
		<span style="color:{colorA}">● {lastA}</span>
		<span style="color:{colorB}">● {lastB}</span>
	</div>
	{#if showLegend}
		<div class="rel-legend">
			<span style="color:{colorA}">{labelA}</span>
			<span style="color:{colorB}">{labelB}</span>
		</div>
	{/if}
</div>

<style>
	.rel-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}

	.rel-circ {
		border-radius: 50%;
		overflow: hidden;
		background: #0f0f0f;
		border: 1.5px solid #2a2a2a;
		flex-shrink: 0;
	}

	.rel-vals {
		display: flex;
		gap: 10px;
		font-size: 0.7rem;
		font-weight: 700;
	}

	.rel-legend {
		display: flex;
		gap: 12px;
		font-size: 0.56rem;
		color: #555;
	}
</style>
