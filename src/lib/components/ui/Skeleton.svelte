<script lang="ts">
	interface Props {
		variant?: 'line' | 'pill' | 'card' | 'circle';
		width?: string;
		height?: string;
		radius?: string;
	}

	let {
		variant = 'line',
		width,
		height,
		radius
	}: Props = $props();

	const defaults = {
		line:   { w: '100%', h: '12px', r: '6px' },
		pill:   { w: '100px', h: '32px', r: '999px' },
		card:   { w: '100%', h: '60px', r: '14px' },
		circle: { w: '48px', h: '48px', r: '50%' },
	};

	const d = defaults[variant];
</script>

<div
	class="skeleton"
	style:width={width ?? d.w}
	style:height={height ?? d.h}
	style:border-radius={radius ?? d.r}
></div>

<style>
	.skeleton {
		background: linear-gradient(90deg, #1e1e1e 25%, #2a2a2a 50%, #1e1e1e 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
		flex-shrink: 0;
	}

	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}
</style>
