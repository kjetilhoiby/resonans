<script lang="ts">
	import RadialSectorChart, { type SectorDef } from '$lib/components/visualizations/RadialSectorChart.svelte';
	import { IMPORTANCE_MAX, MATCH_MAX, LIVSKOMPASS_DIMENSIONS, type LivskompassScores } from '$lib/domains/livskompass/dimensions';

	interface Props {
		scores: LivskompassScores;
		size?: number;
		showLabels?: boolean;
		labelRadiusFraction?: number;
		innerRadiusFraction?: number;
		gapDeg?: number;
		centerLabel?: string;
		centerSublabel?: string;
		animateOnMount?: boolean;
	}

	let {
		scores,
		size = 300,
		showLabels = true,
		labelRadiusFraction = 0.82,
		innerRadiusFraction = 0.34,
		gapDeg = 3,
		centerLabel,
		centerSublabel,
		animateOnMount = true
	}: Props = $props();

	// Fylt ark = ukas samsvar, svak bakgrunnsark i samme vinkel = hvor viktig det er.
	const sectors = $derived<SectorDef[]>(
		LIVSKOMPASS_DIMENSIONS.map((d) => {
			const score = scores[d.id];
			const match = score?.match ?? 3;
			const importance = score?.importance ?? d.defaultImportance;
			return {
				radius: match / MATCH_MAX,
				color: d.color,
				opacity: 0.92,
				bgRadius: importance / IMPORTANCE_MAX,
				bgColor: `${d.color}33`,
				label: showLabels ? d.short : undefined
			};
		})
	);
</script>

<RadialSectorChart
	{sectors}
	totalSlots={LIVSKOMPASS_DIMENSIONS.length}
	{size}
	{gapDeg}
	{innerRadiusFraction}
	labelRadiusFraction={showLabels ? labelRadiusFraction : undefined}
	{showLabels}
	{animateOnMount}
	{centerLabel}
	{centerSublabel}
/>
