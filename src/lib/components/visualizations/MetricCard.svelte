<script lang="ts">
	/**
	 * MetricCard — smart dispatch layer for the S/M/L visualization framework.
	 *
	 * Give it a metricId, a size (S/M/L), and a VisualizationDataContract.
	 * It looks up the VisualizationSpec, computes status, and renders the right
	 * component for the context — no visualization logic in the caller needed.
	 *
	 * S = frimerke  (number / tight bar / icon)
	 * M = stripe    (horizontal bar with label, fits in a list row)
	 * L = kort      (detail chart with annotations)
	 */

	import type { MetricId } from '$lib/domain/metric-catalog';
	import type { VisualizationDataContract, VisualizationSize } from '$lib/domain/visualization-spec';
	import { getVisualizationSpec } from '$lib/domain/visualization-spec';
	import { computeStatus, statusToTone } from '$lib/domain/visualization-status';

	import AnimatedProgressBar from './AnimatedProgressBar.svelte';
	import TimelineProgressMarker from './TimelineProgressMarker.svelte';
	import TimelineDeltaArrow from './TimelineDeltaArrow.svelte';
	import TargetZoneBar from './TargetZoneBar.svelte';
	import ComparisonTrendChart from './ComparisonTrendChart.svelte';
	import TrajectoryChart from './TrajectoryChart.svelte';
	import type { TrajectoryPoint } from './TrajectoryChart.svelte';
	import type { ComparisonPoint } from './ComparisonTrendChart.svelte';

	interface Props {
		metricId: MetricId;
		size?: VisualizationSize;
		data: VisualizationDataContract;
		/** Optional label shown inside zone/timeline components */
		label?: string;
		formatValue?: (v: number) => string;
		animateOnMount?: boolean;
		/** Override the default bar/marker height */
		height?: number;
		/** Override the track background color */
		trackColor?: string;
	}

	let {
		metricId,
		size = 'M',
		data,
		label,
		formatValue,
		animateOnMount = true,
		height,
		trackColor
	}: Props = $props();

	// -------------------------------------------------------------------------
	// Spec + status
	// -------------------------------------------------------------------------

	const spec = $derived(getVisualizationSpec(metricId));
	const component = $derived(spec.contexts[size].component);
	const useDeltaArrowM = $derived(size === 'M' && spec.thresholdMode === 'trajectory');

	// Auto-compute expectedByNow when not provided but dates + target are available
	const effectiveExpectedByNow = $derived.by((): number | undefined => {
		if (data.expectedByNow !== undefined) return data.expectedByNow;
		if (effectiveTimelinePct === 0) return undefined;
		const tFrac = effectiveTimelinePct / 100;
		if (spec.timeModel === 'accumulated' && data.target !== undefined) {
			return data.target * tFrac;
		}
		if (spec.timeModel === 'trajectory' && data.target !== undefined && data.startValue !== undefined) {
			return data.startValue + (data.target - data.startValue) * tFrac;
		}
		return undefined;
	});

	const status = $derived(
		computeStatus({
			current: data.current,
			direction: spec.direction,
			thresholdMode: spec.thresholdMode,
			tolerancePct: spec.tolerancePct,
			target: data.target,
			targetMin: data.targetMin,
			targetMax: data.targetMax,
			expectedByNow: effectiveExpectedByNow
		})
	);

	// Map to a tone accepted by all components ('muted' → 'accent' for no-data)
	const tone = $derived.by((): 'green' | 'yellow' | 'red' | 'accent' => {
		const t = statusToTone(status);
		return t === 'muted' ? 'accent' : t;
	});

	// -------------------------------------------------------------------------
	// progress_bar: single accumulated/budget pct
	// -------------------------------------------------------------------------

	const progressPct = $derived.by((): number => {
		const c = data.current;
		if (c === null || c === undefined || !data.target) return 0;
		if (spec.semantic === 'higher') return Math.min(100, (c / data.target) * 100);
		if (spec.semantic === 'lower') return Math.min(100, (c / data.target) * 100);
		return 0;
	});

	// -------------------------------------------------------------------------
	// timeline_marker: time elapsed vs. metric progress
	// -------------------------------------------------------------------------

	const now = Date.now();

	const timelinePct = $derived.by((): number => {
		if (!data.startDate || !data.endDate) return 0;
		const start = new Date(data.startDate).getTime();
		const end = new Date(data.endDate).getTime();
		return Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100));
	});

	const effectiveTimelinePct = $derived.by((): number => {
		if (timelinePct > 0) return timelinePct;
		if (
			spec.timeModel === 'accumulated' &&
			data.expectedByNow !== undefined &&
			data.target !== undefined &&
			data.target > 0
		) {
			return Math.max(0, Math.min(100, (data.expectedByNow / data.target) * 100));
		}
		return timelinePct;
	});

	const markerPct = $derived.by((): number => {
		const c = data.current;
		if (c === null || c === undefined) return 0;

		if ((spec.semantic === 'higher' || spec.semantic === 'lower') && data.target !== undefined) {
			if (data.target === 0) return 0;
			return Math.max(0, Math.min(100, (c / data.target) * 100));
		}

		if (spec.semantic === 'target' && data.startValue !== undefined && data.target !== undefined) {
			const start = data.startValue;
			const goal = data.target;
			const range = Math.abs(start - goal);
			if (range === 0) return 100;
			const done = start > goal ? start - c : c - start;
			return Math.max(0, Math.min(100, (done / range) * 100));
		}
		return 0;
	});

	// -------------------------------------------------------------------------
	// target_zone_bar: value + domain + target zone
	// -------------------------------------------------------------------------

	const zoneDomainMin = $derived.by((): number => {
		const c = data.current ?? 0;
		const lower = Math.min(c, data.targetMin ?? c, data.target ?? c);
		return Math.max(0, lower * 0.8);
	});

	const zoneDomainMax = $derived.by((): number => {
		const c = data.current ?? 0;
		const upper = Math.max(c, data.targetMax ?? c, data.target ?? c);
		return upper * 1.2;
	});

	const zoneMode = $derived.by((): 'at_least' | 'at_most' | 'range' => {
		if (spec.thresholdMode === 'at_least') return 'at_least';
		if (spec.thresholdMode === 'at_most') return 'at_most';
		return 'range';
	});

	// -------------------------------------------------------------------------
	// trajectory chart
	// -------------------------------------------------------------------------

	const trajectorySeries = $derived((data.series ?? []) as TrajectoryPoint[]);
	const trajectorySeriesMode = $derived(spec.timeModel === 'accumulated' ? 'incremental' : 'absolute') as 'incremental' | 'absolute';
	const trajectoryShowArea = $derived(spec.semantic === 'higher');

	// -------------------------------------------------------------------------
	// comparison_trend chart
	// -------------------------------------------------------------------------

	const comparisonSeries = $derived((data.comparisonSeries ?? []) as ComparisonPoint[]);

	// -------------------------------------------------------------------------
	// Heights per size (can be overridden by caller)
	// -------------------------------------------------------------------------

	const barHeight = $derived(height ?? (size === 'S' ? 4 : 8));
	const zoneHeight = $derived(height ?? (size === 'S' ? 12 : 18));
</script>

{#if status === 'no_data'}
	<span class="no-data">—</span>
{:else if component === 'progress_bar'}
	{#if useDeltaArrowM}
		<TimelineDeltaArrow
			timelinePct={effectiveTimelinePct}
			progressPct={markerPct}
			height={barHeight}
			trackColor={trackColor}
			title={label}
			{animateOnMount}
		/>
	{:else}
		<AnimatedProgressBar pct={progressPct} {tone} height={barHeight} trackColor={trackColor} {animateOnMount} />
	{/if}
{:else if component === 'timeline_marker'}
	{#if useDeltaArrowM}
		<TimelineDeltaArrow
			timelinePct={effectiveTimelinePct}
			progressPct={markerPct}
			height={barHeight}
			trackColor={trackColor}
			title={label}
			{animateOnMount}
		/>
	{:else}
		<TimelineProgressMarker
			timelinePct={effectiveTimelinePct}
			progressPct={markerPct}
			status={tone}
			height={barHeight}
			trackColor={trackColor}
			title={label}
			{animateOnMount}
		/>
	{/if}
{:else if component === 'target_zone_bar'}
	<TargetZoneBar
		value={data.current ?? 0}
		domainMin={zoneDomainMin}
		domainMax={zoneDomainMax}
		targetMin={data.targetMin ?? data.target ?? null}
		targetMax={data.targetMax ?? data.target ?? null}
		mode={zoneMode}
		height={zoneHeight}
		formatValue={formatValue}
		title={label}
		{animateOnMount}
	/>
{:else if component === 'comparison_trend'}
	<ComparisonTrendChart
		points={comparisonSeries}
		currentValue={data.current ?? 0}
		referenceValue={data.expectedByNow ?? data.current ?? 0}
		currentLabel="Nå"
		referenceLabel="Snitt"
		formatValue={formatValue}
		{animateOnMount}
	/>
{:else if component === 'trajectory'}
	<TrajectoryChart
		points={trajectorySeries}
		startDate={data.startDate ?? ''}
		endDate={data.endDate ?? ''}
		startValue={data.startValue ?? 0}
		targetValue={data.target ?? 0}
		currentValue={data.current ?? 0}
		seriesMode={trajectorySeriesMode}
		showArea={trajectoryShowArea}
		valueFormatter={formatValue}
		{animateOnMount}
	/>
{/if}

<style>
	.no-data {
		opacity: 0.3;
		font-size: 0.85em;
		font-variant-numeric: tabular-nums;
	}
</style>
