<script lang="ts">
	import type { Snippet } from 'svelte';
	import { invalidateAll } from '$app/navigation';

	interface Props {
		onRefresh?: () => Promise<void> | void;
		disabled?: boolean;
		excludeSelectors?: string;
		triggerZoneHeight?: number;
		children: Snippet;
	}

	let {
		onRefresh,
		disabled = false,
		excludeSelectors = '',
		triggerZoneHeight = 140,
		children
	}: Props = $props();

	const TRIGGER_PX = 64;
	const MAX_PX = 110;
	const HOLD_PX = 52;

	let pullStartY = $state<number | null>(null);
	let pullDistance = $state(0);
	let refreshing = $state(false);

	const dragging = $derived(pullStartY !== null && pullDistance > 0);
	const armed = $derived(pullDistance >= TRIGGER_PX);
	const offset = $derived(refreshing ? HOLD_PX : pullDistance);

	function atDocumentTop() {
		if (typeof window === 'undefined') return true;
		return window.scrollY <= 0;
	}

	function shouldHandlePullStart(event: TouchEvent) {
		if (disabled || refreshing) return false;
		if (!atDocumentTop()) return false;
		const touch = event.touches[0];
		if (!touch || touch.clientY > triggerZoneHeight) return false;
		if (excludeSelectors) {
			const target = event.target as Element | null;
			if (target?.closest(excludeSelectors)) return false;
		}
		return true;
	}

	function handleTouchStart(event: TouchEvent) {
		if (!shouldHandlePullStart(event)) {
			pullStartY = null;
			pullDistance = 0;
			return;
		}
		pullStartY = event.touches[0]?.clientY ?? null;
	}

	function handleTouchMove(event: TouchEvent) {
		if (pullStartY === null || refreshing) return;
		const touchY = event.touches[0]?.clientY ?? pullStartY;
		const delta = Math.max(0, touchY - pullStartY);
		// Resistance: nesten 1:1 i starten, tiltagende motstand mot MAX_PX.
		pullDistance = MAX_PX * (1 - Math.exp(-delta / (MAX_PX * 1.4)));
	}

	function resetPull() {
		pullStartY = null;
		pullDistance = 0;
	}

	async function triggerRefresh() {
		if (refreshing) return;
		refreshing = true;
		try {
			await Promise.allSettled([
				Promise.resolve().then(() => onRefresh?.()),
				invalidateAll()
			]);
		} finally {
			refreshing = false;
		}
	}

	function handleTouchEnd() {
		if (pullDistance >= TRIGGER_PX && !refreshing) {
			void triggerRefresh();
		}
		resetPull();
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="ptr-wrap"
	class:is-dragging={dragging}
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
	ontouchcancel={resetPull}
>
	<div class="ptr-backdrop" style:height={`${offset}px`} aria-hidden="true">
		<div class="ptr-icon" class:is-armed={armed} class:is-refreshing={refreshing}>
			{#if refreshing}
				<div class="ptr-spinner"></div>
			{:else}
				<svg class="ptr-arrow" viewBox="0 0 24 24" width="20" height="20">
					<path
						d="M12 5v14m0 0l-6-6m6 6l6-6"
						stroke="currentColor"
						stroke-width="2"
						fill="none"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			{/if}
		</div>
	</div>
	<div class="ptr-content" style:transform={`translate3d(0, ${offset}px, 0)`}>
		{@render children()}
	</div>
</div>

<style>
	.ptr-wrap {
		position: relative;
		width: 100%;
	}

	.ptr-backdrop {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		background: linear-gradient(180deg, #1d2240 0%, #141528 100%);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		overflow: hidden;
		pointer-events: none;
		z-index: 25;
		transition: height 320ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.ptr-wrap.is-dragging .ptr-backdrop {
		transition: none;
	}

	.ptr-content {
		width: 100%;
		transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
		will-change: transform;
	}

	.ptr-wrap.is-dragging .ptr-content {
		transition: none;
	}

	.ptr-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		margin-bottom: 10px;
		color: #a5b4fc;
		transition: color 160ms ease;
	}

	.ptr-icon.is-armed {
		color: #e0e7ff;
	}

	.ptr-arrow {
		transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	.ptr-icon.is-armed .ptr-arrow {
		transform: rotate(180deg);
	}

	.ptr-spinner {
		width: 18px;
		height: 18px;
		border: 2px solid currentColor;
		border-top-color: transparent;
		border-radius: 50%;
		animation: ptr-spin 0.85s linear infinite;
	}

	@keyframes ptr-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
