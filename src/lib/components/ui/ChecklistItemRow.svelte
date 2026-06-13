<script lang="ts">
	import type { Snippet } from 'svelte';
	import { slide } from 'svelte/transition';
	import type { ChecklistItemLike } from '$lib/types/checklist';
	import { formatItemTime, stripTimeFromText, getTravelMode, travelModeIcon, sortByTime, sortByStatus, isLocationItem, locationDisplayName } from '$lib/utils/checklist-group';
	import ChecklistCheckbox from './ChecklistCheckbox.svelte';
	import TaskTitle from './TaskTitle.svelte';

	interface Props {
		item: ChecklistItemLike;
		allItems?: ChecklistItemLike[];
		showTime?: boolean;
		showTravel?: boolean;
		/** Kanonisk rad-stil: full bredde m/ramme (kort-chrome via --card-*-tokens). Default flat/transparent. */
		bordered?: boolean;
		checkboxSize?: 'sm' | 'md';
		animated?: boolean;
		editing?: boolean;
		editText?: string;
		expandedParentIds?: Set<string>;
		ontoggle?: (item: ChecklistItemLike) => void;
		ontextclick?: (item: ChecklistItemLike) => void;
		onlongpress?: (rect: DOMRect, item: ChecklistItemLike) => void;
		oneditcommit?: (item: ChecklistItemLike, newText: string) => void;
		oneditcancel?: () => void;
		onexpand?: (parentId: string) => void;
		onaddchild?: (parentId: string, text: string) => void;
		trailingBadge?: Snippet<[ChecklistItemLike]>;
		trailingAction?: Snippet<[ChecklistItemLike]>;
		editInputRef?: HTMLInputElement | null;
	}

	let {
		item,
		allItems = [],
		showTime = true,
		showTravel = true,
		bordered = false,
		checkboxSize = 'md',
		animated = true,
		editing = false,
		editText = $bindable(''),
		expandedParentIds = new Set<string>(),
		ontoggle,
		ontextclick,
		onlongpress,
		oneditcommit,
		oneditcancel,
		onexpand,
		onaddchild,
		trailingBadge,
		trailingAction,
		editInputRef = $bindable(null),
	}: Props = $props();

	const LONG_PRESS_MS = 600;
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressTriggered = false;
	let editInputEl: HTMLInputElement | undefined = $state();

	$effect(() => {
		editInputRef = editInputEl ?? null;
	});
	let newSubItemText = $state('');

	let hasChildren = $derived(allItems.some(i => i.parentId === item.id));
	let childrenItems = $derived(allItems.filter(i => i.parentId === item.id));
	let completedChildren = $derived(childrenItems.filter(c => c.checked).length);
	let isExpanded = $derived(expandedParentIds.has(item.id));
	let itemTimed = $derived(showTime && item.metadata?.timeHour !== undefined);
	let itemTravel = $derived(showTravel ? getTravelMode(item) : null);
	let itemSkipped = $derived(!!item.skippedAt);
	let itemIsLocation = $derived(isLocationItem(item));
	let cR = 8;
	let cC = $derived(2 * Math.PI * cR);
	let cPct = $derived(childrenItems.length > 0 ? completedChildren / childrenItems.length : 0);

	$effect(() => {
		if (editing && editInputEl) {
			editInputEl.focus();
			editInputEl.select();
		}
	});

	function handlePressStart(e: PointerEvent) {
		if (editing) return;
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

	function handleTextClick() {
		if (editing || longPressTriggered) return;
		if (ontextclick) {
			ontextclick(item);
		} else if (!hasChildren) {
			ontoggle?.(item);
		}
	}

	function handleEditKey(e: KeyboardEvent) {
		if (e.key === 'Enter') oneditcommit?.(item, editText);
		else if (e.key === 'Escape') oneditcancel?.();
	}

	function handleChildPressStart(e: PointerEvent, child: ChecklistItemLike) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		longPressTriggered = false;
		longPressTimer = setTimeout(() => {
			longPressTriggered = true;
			onlongpress?.(rect, child);
		}, LONG_PRESS_MS);
	}

	function handleChildTextClick(child: ChecklistItemLike) {
		if (longPressTriggered) return;
		if (ontextclick) {
			ontextclick(child);
		} else {
			ontoggle?.(child);
		}
	}

	function handleAddChildKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && newSubItemText.trim()) {
			onaddchild?.(item.id, newSubItemText.trim());
			newSubItemText = '';
		}
	}
</script>

<div class="cli-wrapper" class:cli-wrapper-parent={hasChildren}>
	{#if hasChildren}
		<div class="cli-parent-row">
			<button
				type="button"
				class="cli-caret"
				class:cli-caret-expanded={isExpanded}
				onclick={() => onexpand?.(item.id)}
				aria-label={isExpanded ? 'Lukk substeps' : 'Utvid substeps'}
			>▸</button>
			<div
				class="cli-item"
				class:cli-item-card={bordered}
				class:cli-item-checked={item.checked}
				class:cli-item-skipped={itemSkipped}
			>
				<button
					class="cli-text-btn"
					onpointerdown={handlePressStart}
					onpointerup={handlePressEnd}
					onpointercancel={handlePressEnd}
					onpointerleave={handlePressEnd}
					onclick={handleTextClick}
					title="Langtrykk for valg"
				>
					{#if editing}
						<input
							class="cli-edit-input"
							bind:this={editInputEl}
							bind:value={editText}
							onkeydown={handleEditKey}
							onblur={() => oneditcommit?.(item, editText)}
							onclick={(e) => e.stopPropagation()}
							onpointerdown={(e) => e.stopPropagation()}
						/>
					{:else}
						<span class="cli-main">
							{#if itemTimed}
								<span class="cli-time-chip">{formatItemTime(item.metadata!.timeHour!, item.metadata?.timeMinute ?? 0)}</span>
							{/if}
							{#if itemTravel}
								<span class="cli-travel-icon" aria-hidden="true">{travelModeIcon(itemTravel)}</span>
							{/if}
							<span class="cli-text"><TaskTitle title={itemTimed ? stripTimeFromText(item.text) : item.text} /></span>
						</span>
					{/if}
					{#if trailingBadge}{@render trailingBadge(item)}{/if}
				</button>
				<svg class="cli-parent-ring" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
					<circle cx="10" cy="10" r={cR} fill="none" stroke="#2a2a2a" stroke-width="2.5"/>
					<circle cx="10" cy="10" r={cR} fill="none"
						stroke={completedChildren === childrenItems.length ? '#5fa080' : '#7c8ef5'}
						stroke-width="2.5"
						stroke-dasharray="{cPct * cC} {cC}"
						stroke-linecap="round"
						transform="rotate(-90 10 10)"
					/>
				</svg>
			</div>
			{#if trailingAction}{@render trailingAction(item)}{/if}
		</div>
	{:else if itemIsLocation}
		<div class="cli-item cli-location-item">
			<span class="cli-loc-badge">📍 {locationDisplayName(item)}</span>
			{#if trailingAction}{@render trailingAction(item)}{/if}
		</div>
	{:else}
		<div
			class="cli-item"
			class:cli-item-checked={item.checked}
			class:cli-item-skipped={itemSkipped}
		>
			<button
				class="cli-text-btn"
				onpointerdown={handlePressStart}
				onpointerup={handlePressEnd}
				onpointercancel={handlePressEnd}
				onpointerleave={handlePressEnd}
				onclick={handleTextClick}
				title="Langtrykk for valg"
			>
				{#if editing}
					<input
						class="cli-edit-input"
						bind:this={editInputEl}
						bind:value={editText}
						onkeydown={handleEditKey}
						onblur={() => oneditcommit?.(item, editText)}
						onclick={(e) => e.stopPropagation()}
						onpointerdown={(e) => e.stopPropagation()}
					/>
				{:else}
					<span class="cli-main">
						{#if itemTimed}
							<span class="cli-time-chip">{formatItemTime(item.metadata!.timeHour!, item.metadata?.timeMinute ?? 0)}</span>
						{/if}
						{#if itemTravel}
							<span class="cli-travel-icon" aria-hidden="true">{travelModeIcon(itemTravel)}</span>
						{/if}
						<span class="cli-text"><TaskTitle title={itemTimed ? stripTimeFromText(item.text) : item.text} /></span>
					</span>
				{/if}
				{#if trailingBadge}{@render trailingBadge(item)}{/if}
			</button>
			<ChecklistCheckbox
				checked={item.checked}
				skipped={itemSkipped}
				size={checkboxSize}
				{animated}
				onclick={() => ontoggle?.(item)}
			/>
			{#if trailingAction}{@render trailingAction(item)}{/if}
		</div>
	{/if}

	{#if hasChildren && isExpanded}
		<div class="cli-children" transition:slide>
			{#each sortByStatus(sortByTime(childrenItems)) as child (child.id)}
				{@const childSkipped = !!child.skippedAt}
				{@const childTimed = showTime && child.metadata?.timeHour !== undefined}
				<div
					class="cli-child-item"
					class:cli-child-checked={child.checked}
					class:cli-child-skipped={childSkipped}
				>
					<button
						class="cli-child-text-btn"
						onpointerdown={(e) => handleChildPressStart(e, child)}
						onpointerup={handlePressEnd}
						onpointercancel={handlePressEnd}
						onpointerleave={handlePressEnd}
						onclick={() => handleChildTextClick(child)}
					>
						{#if childTimed}
							<span class="cli-time-chip cli-time-chip-small">{formatItemTime(child.metadata!.timeHour!, child.metadata?.timeMinute ?? 0)}</span>
						{/if}
						{#if showTravel && getTravelMode(child)}
							<span class="cli-travel-icon cli-travel-icon-small" aria-hidden="true">{travelModeIcon(getTravelMode(child)!)}</span>
						{/if}
						<span class="cli-child-text"><TaskTitle title={childTimed ? stripTimeFromText(child.text) : child.text} /></span>
					</button>
					<ChecklistCheckbox
						checked={child.checked}
						skipped={childSkipped}
						size="sm"
						{animated}
						onclick={() => ontoggle?.(child)}
					/>
				</div>
			{/each}
			{#if onaddchild}
				<div class="cli-subitem-add-row">
					<input
						class="cli-subitem-add-input"
						type="text"
						placeholder="Legg til deloppgave…"
						bind:value={newSubItemText}
						onkeydown={handleAddChildKey}
					/>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.cli-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.cli-parent-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 0 0 2px;
	}

	.cli-parent-row .cli-item {
		flex: 1;
	}

	.cli-caret {
		width: 20px;
		height: 20px;
		border: none;
		background: transparent;
		color: #7c8ef5;
		font-size: 0.9rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: transform 0.2s;
		padding: 0;
		line-height: 1;
	}

	.cli-caret:hover { color: #9cb0ff; }
	.cli-caret-expanded { transform: rotate(90deg); }

	.cli-parent-ring {
		flex-shrink: 0;
		display: block;
	}

	.cli-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 12px 4px 0;
		width: 100%;
		border-radius: 10px;
		background: transparent;
		transition: background 0.1s;
	}

	.cli-item:hover { background: #161616; }

	/* Kanonisk «full bredde m/ramme»: kort-chrome via --card-*-tokens.
	   Kontekster (ukeplan-gradient, tema-hue) re-skinner automatisk — bytt
	   tokens, ikke komponent. Default (uten .cli-item-card) er flat/transparent. */
	.cli-item-card {
		background: var(--card-bg);
		border: 1px solid var(--card-border);
	}

	.cli-item-card:hover { background: var(--card-bg); }

	.cli-location-item {
		padding: 6px 12px;
	}

	.cli-loc-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: rgba(95, 160, 128, 0.12);
		border: 1px solid rgba(95, 160, 128, 0.3);
		border-radius: 999px;
		padding: 5px 12px 5px 10px;
		font-size: 0.82rem;
		font-weight: 600;
		color: #9fd9bd;
		letter-spacing: -0.01em;
	}

	.cli-text-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		padding: 6px 0 6px 12px;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font: inherit;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.cli-main {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.cli-text {
		font-size: 0.88rem;
		color: #ccc;
		line-height: 1.4;
		transition: color 0.15s, text-decoration 0.15s;
	}

	.cli-item-checked .cli-text {
		color: #444;
		text-decoration: line-through;
	}

	.cli-item-skipped .cli-text {
		color: #5a4040;
		text-decoration: line-through;
		text-decoration-color: #774444;
	}

	.cli-time-chip {
		display: inline-flex;
		align-items: center;
		font-size: 0.7rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: #7c8ef5;
		background: rgba(124, 142, 245, 0.1);
		border: 1px solid rgba(124, 142, 245, 0.25);
		border-radius: 5px;
		padding: 1px 5px;
		flex-shrink: 0;
		white-space: nowrap;
		line-height: 1.4;
		transition: opacity 0.15s;
	}

	.cli-time-chip-small {
		font-size: 0.62rem;
		padding: 0 4px;
	}

	.cli-item-checked .cli-time-chip,
	.cli-item-skipped .cli-time-chip,
	.cli-child-checked .cli-time-chip,
	.cli-child-skipped .cli-time-chip {
		opacity: 0.4;
	}

	.cli-travel-icon {
		font-size: 0.95rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.cli-travel-icon-small {
		font-size: 0.8rem;
	}

	.cli-item-checked .cli-travel-icon,
	.cli-item-skipped .cli-travel-icon,
	.cli-child-checked .cli-travel-icon,
	.cli-child-skipped .cli-travel-icon {
		opacity: 0.4;
	}

	.cli-edit-input {
		flex: 1;
		background: none;
		border: none;
		border-bottom: 1px solid #4a5af0;
		color: #ccc;
		font: inherit;
		font-size: 0.88rem;
		outline: none;
		padding: 0;
		min-width: 0;
	}

	.cli-children {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 0 12px 0 32px;
		background: #0a0a0a;
		border-radius: 0 0 10px 10px;
		margin-bottom: 4px;
	}

	.cli-child-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 0;
		background: transparent;
		color: inherit;
		transition: opacity 0.1s;
		border-bottom: 1px solid #1a1a1a;
	}

	.cli-child-item:last-of-type { border-bottom: none; }
	.cli-child-item:hover { opacity: 0.8; }

	.cli-child-text-btn {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		font: inherit;
		padding: 0;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.cli-child-text {
		font-size: 0.75rem;
		color: #aaa;
		line-height: 1.3;
		flex: 1;
		transition: color 0.1s, text-decoration 0.1s;
	}

	.cli-child-checked .cli-child-text {
		color: #555;
		text-decoration: line-through;
	}

	.cli-child-skipped .cli-child-text {
		color: #5a4040;
		text-decoration: line-through;
		text-decoration-color: #774444;
	}

	.cli-subitem-add-row {
		padding: 6px 0 8px;
		border-top: 1px solid #1e1e1e;
	}

	.cli-subitem-add-input {
		width: 100%;
		background: transparent;
		border: none;
		border-bottom: 1px solid #2a2a2a;
		color: #888;
		padding: 4px 0;
		font: inherit;
		font-size: 0.75rem;
		outline: none;
		transition: border-color 0.12s, color 0.12s;
	}

	.cli-subitem-add-input:focus {
		border-color: #4a5af0;
		color: #ccc;
	}

	.cli-subitem-add-input::placeholder { color: #3a3a3a; }
</style>
