<!--
  SensorPane — full-skjerm overlay for én sensor-kategori.
  Vises når bruker trykker på en WidgetCircle.

  Props:
    sensor      sensor-data objekt
    onclose     lukker panelet
-->
<script lang="ts">
	import GoalRing from '../ui/GoalRing.svelte';
	import PeriodPills from '../ui/PeriodPills.svelte';
	import RelationSparkline from '../ui/RelationSparkline.svelte';

	interface SensorData {
		label: string;
		val: string;
		unit: string;
		color: string;
		delta?: string;
		pct?: number;
		/** Kun for relasjon-typen */
		isRelation?: boolean;
		sparkA?: number[];
		sparkB?: number[];
	}

	interface Props {
		sensor: SensorData;
		onclose?: () => void;
	}

	let { sensor, onclose }: Props = $props();

	const periods = ['uke', 'måned', 'kvartal'];
	let period = $state('uke');

	// Mock-data per periode (erstattes av ekte API-kall i Fase 4)
	const mockPct: Record<string, number> = {
		uke: sensor.pct ?? 68,
		måned: 54,
		kvartal: 42,
	};

	let displayPct = $derived(mockPct[period] ?? 68);

	// Swipe-to-close logikk
	let startY = 0;
	let dragging = false;
	let dragY = $state(0);

	function onTouchStart(e: TouchEvent) {
		startY = e.touches[0].clientY;
		dragging = true;
	}

	function onTouchMove(e: TouchEvent) {
		if (!dragging) return;
		const dy = e.touches[0].clientY - startY;
		if (dy > 0) dragY = dy;
	}

	function onTouchEnd() {
		dragging = false;
		if (dragY > 80) {
			onclose?.();
		}
		dragY = 0;
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="sensor-pane"
	style="transform: translateY({dragY}px)"
	role="dialog"
	aria-modal="true"
	aria-label="{sensor.label} dashboard"
	ontouchstart={onTouchStart}
	ontouchmove={onTouchMove}
	ontouchend={onTouchEnd}
>
	<!-- Drag-indikator -->
	<div class="drag-handle"></div>

	<!-- Header -->
	<div class="pane-header">
		<span class="pane-title" style="color:{sensor.color}">{sensor.label}</span>
		<button class="pane-close" onclick={() => onclose?.()} aria-label="Lukk">✕</button>
	</div>

	{#if sensor.isRelation}
		<!-- Relasjon-visning: sparkline i sirkel -->
		<div class="relation-center">
			<RelationSparkline
				dataA={sensor.sparkA ?? [3, 4, 3, 4, 5, 4, 4]}
				dataB={sensor.sparkB ?? [2, 3, 3, 4, 3, 3, 4]}
				size={180}
				showLegend={true}
				labelA="Deg"
				labelB="Partner"
			/>
		</div>

		<div class="metric-row">
			<div class="metric-card">
				<span class="metric-val" style="color:{sensor.color}">{sensor.val}</span>
				<span class="metric-unit">{sensor.unit}</span>
				<span class="metric-label">Snitt denne uka</span>
			</div>
		</div>
	{:else}
		<!-- Standard sensor-visning: GoalRing -->
		<div class="ring-center">
			<GoalRing pct={displayPct} color={sensor.color} r={58} strokeWidth={7} size={160}>
				{#snippet children()}
					<text x="80" y="74" text-anchor="middle" fill={sensor.color} font-size="22" font-weight="700">
						{sensor.val}
					</text>
					<text x="80" y="92" text-anchor="middle" fill="#666" font-size="11">
						{sensor.unit}
					</text>
				{/snippet}
			</GoalRing>
		</div>

		{#if sensor.delta}
			<div class="delta-badge" style="color:{sensor.color}">
				{sensor.delta} vs forrige uke
			</div>
		{/if}

		<div class="metric-row">
			<div class="metric-card">
				<span class="metric-val" style="color:{sensor.color}">{displayPct}%</span>
				<span class="metric-label">Av målpace</span>
			</div>
			<div class="metric-card">
				<span class="metric-val" style="color:#7c8ef5">{sensor.val}</span>
				<span class="metric-unit">{sensor.unit}</span>
				<span class="metric-label">Nå</span>
			</div>
		</div>
	{/if}

	<div class="period-bar">
		<PeriodPills options={periods} value={period} onchange={(v) => (period = v)} />
	</div>
</div>

<!-- Backdrop -->
<button class="backdrop" onclick={() => onclose?.()} aria-label="Lukk overlay" tabindex="-1"></button>

<style>
	.sensor-pane {
		position: fixed;
		inset: auto 0 0;
		z-index: 100;
		background: #121212;
		border-top: 1px solid #2a2a2a;
		border-radius: 20px 20px 0 0;
		padding: 12px 20px 40px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 20px;
		max-height: 85dvh;
		transition: transform 0.05s linear;
	}

	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 99;
		background: rgba(0, 0, 0, 0.6);
		border: none;
		cursor: pointer;
	}

	.drag-handle {
		width: 36px;
		height: 4px;
		border-radius: 2px;
		background: #333;
		flex-shrink: 0;
	}

	.pane-header {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.pane-title {
		font-size: 1.1rem;
		font-weight: 700;
		letter-spacing: -0.02em;
	}

	.pane-close {
		background: none;
		border: none;
		color: #555;
		font-size: 1rem;
		cursor: pointer;
		padding: 4px 8px;
	}
	.pane-close:hover {
		color: #aaa;
	}

	.ring-center {
		display: flex;
		justify-content: center;
		padding: 8px 0;
	}

	.relation-center {
		display: flex;
		justify-content: center;
		padding: 8px 0;
	}

	.delta-badge {
		font-size: 0.8rem;
		font-weight: 600;
		opacity: 0.8;
	}

	.metric-row {
		display: flex;
		gap: 12px;
		width: 100%;
		justify-content: center;
	}

	.metric-card {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 20px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		min-width: 100px;
	}

	.metric-val {
		font-size: 1.4rem;
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.03em;
	}

	.metric-unit {
		font-size: 0.65rem;
		color: #555;
	}

	.metric-label {
		font-size: 0.65rem;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-top: 2px;
	}

	.period-bar {
		width: 100%;
		display: flex;
		justify-content: center;
	}
</style>
