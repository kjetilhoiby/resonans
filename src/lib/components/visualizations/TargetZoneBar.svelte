<script lang="ts">
	import { onMount } from 'svelte';

	export type TargetZoneMode = 'at_least' | 'at_most' | 'range';

	interface Props {
		value: number;
		domainMin: number;
		domainMax: number;
		targetMin?: number | null;
		targetMax?: number | null;
		mode?: TargetZoneMode;
		trackColor?: string;
		zoneFill?: string;
		zoneStroke?: string;
		markerColor?: string;
		height?: number;
		animateOnMount?: boolean;
		formatValue?: (value: number) => string;
		title?: string;
	}

	let {
		value,
		domainMin,
		domainMax,
		targetMin = null,
		targetMax = null,
		mode = 'range',
		trackColor = '#ece9e3',
		zoneFill = 'repeating-linear-gradient(-45deg, rgba(108, 180, 124, 0.08) 0 6px, rgba(108, 180, 124, 0.22) 6px 12px)',
		zoneStroke = '#4f9b64',
		markerColor = '#111111',
		height = 18,
		animateOnMount = true,
		formatValue = (input: number) => `${Math.round(input * 10) / 10}`,
		title
	}: Props = $props();

	let mounted = $state(!animateOnMount);
	let displayValuePct = $state(0);

	function clamp(valueToClamp: number, min: number, max: number): number {
		return Math.max(min, Math.min(max, valueToClamp));
	}

	function toPct(rawValue: number): number {
		const span = Math.max(0.0001, domainMax - domainMin);
		return clamp(((rawValue - domainMin) / span) * 100, 0, 100);
	}

	const zone = $derived.by(() => {
		if (mode === 'at_least') {
			const start = toPct(targetMin ?? domainMin);
			return { start, end: 100 };
		}

		if (mode === 'at_most') {
			const end = toPct(targetMax ?? targetMin ?? domainMax);
			return { start: 0, end };
		}

		const start = toPct(targetMin ?? domainMin);
		const end = toPct(targetMax ?? domainMax);
		return { start: Math.min(start, end), end: Math.max(start, end) };
	});

	const indicator = $derived.by(() => ({
		pct: toPct(value),
		label: formatValue(value),
		startLabel: targetMin != null ? formatValue(targetMin) : null,
		endLabel: targetMax != null ? formatValue(targetMax) : null,
		singleLabel:
			mode !== 'range' ? formatValue((targetMin ?? targetMax ?? domainMin)) : null
	}));

	onMount(() => {
		if (!animateOnMount) return;
		requestAnimationFrame(() => {
			mounted = true;
			displayValuePct = indicator.pct;
		});
	});

	$effect(() => {
		if (!mounted) return;
		displayValuePct = indicator.pct;
	});
</script>

<div class="zone-bar" title={title}>
	<div class="zone-track" style={`height:${height}px; background:${trackColor};`}>
		<div
			class={`zone-highlight ${mounted ? 'mounted' : ''}`}
			style={`left:${zone.start}%; width:${Math.max(0, zone.end - zone.start)}%; background:${zoneFill}; border-color:${zoneStroke};`}
		></div>
		{#if zone.start > 0}
			<div class="zone-boundary" style={`left:${zone.start}%; background:${zoneStroke};`}></div>
		{/if}
		{#if zone.end < 100}
			<div class="zone-boundary" style={`left:${zone.end}%; background:${zoneStroke};`}></div>
		{/if}
		<div class={`zone-marker ${mounted ? 'mounted' : ''}`} style={`left: calc(${displayValuePct}% - 10px); color:${markerColor};`}>▼</div>
	</div>

	<div class="zone-labels">
		{#if mode === 'range'}
			{#if indicator.startLabel}<span class="zone-target-label" style={`left: calc(${zone.start}% - 12px); color:${zoneStroke};`}>{indicator.startLabel}</span>{/if}
			{#if indicator.endLabel}<span class="zone-target-label" style={`left: calc(${zone.end}% - 12px); color:${zoneStroke};`}>{indicator.endLabel}</span>{/if}
		{:else if indicator.singleLabel}
			<span class="zone-target-label" style={`left: calc(${mode === 'at_least' ? zone.start : zone.end}% - 12px); color:${zoneStroke};`}>{indicator.singleLabel}</span>
		{/if}
	</div>
</div>

<style>
	.zone-bar {
		position: relative;
		width: 100%;
	}

	.zone-track {
		position: relative;
		border-radius: 999px;
		overflow: visible;
	}

	.zone-highlight {
		position: absolute;
		top: 0;
		height: 100%;
		border-top: 1px solid transparent;
		border-bottom: 1px solid transparent;
		opacity: 0;
		transition: opacity 0.7s ease;
	}

	.zone-highlight.mounted {
		opacity: 1;
	}

	.zone-boundary {
		position: absolute;
		top: -10px;
		width: 4px;
		height: calc(100% + 20px);
		border-radius: 999px;
	}

	.zone-marker {
		position: absolute;
		top: -24px;
		font-size: 1.1rem;
		line-height: 1;
		opacity: 0;
		transform: translateY(-4px);
		transition: left 0.7s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.35s ease, transform 0.35s ease;
	}

	.zone-marker.mounted {
		opacity: 1;
		transform: translateY(0);
	}

	.zone-labels {
		position: relative;
		height: 34px;
		margin-top: 8px;
	}

	.zone-target-label {
		position: absolute;
		font-size: 0.95rem;
		font-weight: 700;
		white-space: nowrap;
	}
</style>