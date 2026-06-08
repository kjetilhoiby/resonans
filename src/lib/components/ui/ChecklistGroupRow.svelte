<script lang="ts">
	import type { ChecklistItemLike } from '$lib/types/checklist';
	import { activityEmoji } from '$lib/utils/checklist-group';
	import ChecklistCheckbox from './ChecklistCheckbox.svelte';

	interface Props {
		label: string;
		items: ChecklistItemLike[];
		allItems?: ChecklistItemLike[];
		slotSize?: 'sm' | 'md';
		animated?: boolean;
		ontoggle?: (item: ChecklistItemLike) => void;
		onlongpress?: (rect: DOMRect, item: ChecklistItemLike) => void;
	}

	let {
		label,
		items,
		allItems,
		slotSize = 'md',
		animated = true,
		ontoggle,
		onlongpress,
	}: Props = $props();

	const LONG_PRESS_MS = 600;
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressTriggered = false;

	function handlePressStart(e: PointerEvent, item: ChecklistItemLike) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		longPressTriggered = false;
		longPressTimer = setTimeout(() => {
			longPressTriggered = true;
			onlongpress?.(rect, item);
		}, LONG_PRESS_MS);
	}

	function handlePressEnd() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	function handleSlotClick(item: ChecklistItemLike) {
		if (longPressTriggered) return;
		ontoggle?.(item);
	}
</script>

<div class="clg-row">
	<span class="clg-label">
		{#if activityEmoji(label)}{activityEmoji(label)}{' '}{/if}{label}
	</span>
	<div class="clg-slots">
		{#each items as item (item.id)}
			{@const hasChildren = allItems ? allItems.some(i => i.parentId === item.id) : false}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="clg-slot-wrap"
				class:clg-slot-parent={hasChildren}
				class:clg-slot-checked={item.checked}
				onpointerdown={(e) => handlePressStart(e, item)}
				onpointerup={handlePressEnd}
				onpointercancel={handlePressEnd}
				onpointerleave={handlePressEnd}
			>
				<ChecklistCheckbox
					checked={item.checked}
					skipped={!!item.skippedAt}
					size={slotSize}
					{animated}
					onclick={() => handleSlotClick(item)}
				/>
				{#if hasChildren && !item.skippedAt}
					<span class="clg-indicator">✕</span>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.clg-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 10px;
	}

	.clg-label {
		font-size: 0.88rem;
		color: #ccc;
		flex: 1;
		min-width: 0;
	}

	.clg-slots {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}

	.clg-slot-wrap {
		position: relative;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.clg-indicator {
		position: absolute;
		font-size: 0.55rem;
		color: #7c8ef5;
		right: -4px;
		top: -6px;
		line-height: 1;
	}

	.clg-slot-parent.clg-slot-checked .clg-indicator {
		color: #5fa080;
	}
</style>
