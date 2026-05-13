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

	const TRIGGER_PX = 72;
	const MAX_PX = 120;

	let pullStartY = $state<number | null>(null);
	let pullDistance = $state(0);
	let refreshing = $state(false);

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
		pullDistance = Math.min(MAX_PX, delta * 0.5);
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

<div
	class="pull-refresh-wrap"
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
	ontouchcancel={resetPull}
>
	<div
		class="pull-refresh-indicator"
		class:is-visible={refreshing || pullDistance > 0}
		class:is-armed={pullDistance >= TRIGGER_PX}
	>
		{#if refreshing}
			Oppdaterer ...
		{:else if pullDistance >= TRIGGER_PX}
			Slipp for å oppdatere
		{:else}
			Dra ned for å oppdatere
		{/if}
	</div>
	{@render children()}
</div>

<style>
	.pull-refresh-wrap {
		display: contents;
	}

	.pull-refresh-indicator {
		position: fixed;
		top: calc(max(8px, env(safe-area-inset-top, 0px)));
		left: 50%;
		transform: translateX(-50%);
		font-size: 0.72rem;
		font-weight: 600;
		letter-spacing: 0.01em;
		color: #9ba0b8;
		background: #1a1a1a;
		border: 1px solid #282828;
		border-radius: 999px;
		padding: 6px 10px;
		opacity: 0;
		pointer-events: none;
		z-index: 30;
		transition: opacity 120ms ease;
	}

	.pull-refresh-indicator.is-visible {
		opacity: 1;
	}

	.pull-refresh-indicator.is-armed {
		color: #cfd3e9;
		border-color: #343954;
	}
</style>
