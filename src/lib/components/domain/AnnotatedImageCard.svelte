<script lang="ts">
	import type { PhotoAnnotationResult } from '$lib/ai/tools/annotate-photo';

	interface Props {
		imageUrl: string;
		annotation: PhotoAnnotationResult;
	}

	let { imageUrl, annotation }: Props = $props();

	const SCALE = 1000;

	function sx(value: number) {
		return value * SCALE;
	}
</script>

<div class="annot-card">
	<div class="annot-image-wrap">
		<img src={imageUrl} alt="Annotert fotoanalyse" class="annot-image" loading="lazy" />
		<svg class="annot-layer" viewBox={`0 0 ${SCALE} ${SCALE}`} preserveAspectRatio="none" aria-hidden="true">
			{#each annotation.overlays as overlay}
				{#if overlay.kind === 'line'}
					<line
						x1={sx(overlay.start.x)}
						y1={sx(overlay.start.y)}
						x2={sx(overlay.end.x)}
						y2={sx(overlay.end.y)}
						stroke={overlay.color ?? '#6ee7b7'}
						stroke-width="5"
						stroke-linecap="round"
						stroke-dasharray="14 10"
					/>
				{:else if overlay.kind === 'rectangle'}
					<rect
						x={sx(overlay.x)}
						y={sx(overlay.y)}
						width={sx(overlay.width)}
						height={sx(overlay.height)}
						fill="transparent"
						stroke={overlay.color ?? '#6ee7b7'}
						stroke-width="5"
						rx="10"
					/>
				{:else if overlay.kind === 'circle'}
					<circle
						cx={sx(overlay.cx)}
						cy={sx(overlay.cy)}
						r={sx(overlay.r)}
						fill="transparent"
						stroke={overlay.color ?? '#6ee7b7'}
						stroke-width="5"
					/>
				{:else if overlay.kind === 'polygon'}
					<polygon
						points={overlay.points.map((point) => `${sx(point.x)},${sx(point.y)}`).join(' ')}
						fill="rgba(110, 231, 183, 0.12)"
						stroke={overlay.color ?? '#6ee7b7'}
						stroke-width="4"
					/>
				{:else if overlay.kind === 'label'}
					<text
						x={sx(overlay.x)}
						y={sx(overlay.y)}
						fill={overlay.color ?? '#6ee7b7'}
						font-size="28"
						font-weight="700"
					>
						{overlay.text}
					</text>
				{/if}
			{/each}
		</svg>
	</div>
	<p class="annot-summary">{annotation.summary}</p>
</div>

<style>
	.annot-card {
		margin-top: 10px;
		max-width: 460px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.annot-image-wrap {
		position: relative;
		border-radius: 12px;
		overflow: hidden;
		border: 1px solid #2f2f2f;
	}

	.annot-image {
		display: block;
		width: 100%;
		height: auto;
	}

	.annot-layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
	}

	.annot-summary {
		margin: 0;
		font-size: 0.8rem;
		color: #b8b8b8;
		line-height: 1.45;
	}
</style>
