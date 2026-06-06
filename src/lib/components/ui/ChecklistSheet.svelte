<!--
  ChecklistSheet — full-screen overlay som viser sjekklisten.

  Inneholder:
  - Header: emoji + tittel + lukk-knapp
  - Scrollbar liste med checkboxer
  - "Legg til punkt" input
  - Payoff-animasjon når alle punkter er avkrysset
  - Langtrykk (700ms) for nedbrytning av oppgaver
-->
<script lang="ts">
	import { fly, fade, scale, slide } from 'svelte/transition';
	import { elasticOut, cubicOut } from 'svelte/easing';
	import { onMount } from 'svelte';
	import { groupChecklistItems, activityEmoji, sortByStatus, sortByTime, formatItemTime, stripTimeFromText, type GroupedChecklistEntry } from '$lib/utils/checklist-group';
	import WeatherStrip, { type WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BreakdownModal from '$lib/components/ui/BreakdownModal.svelte';
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';
	import MentionAutocomplete from '$lib/components/ui/MentionAutocomplete.svelte';
	import ShareSheet from '$lib/components/domain/share/ShareSheet.svelte';
	import { readCacheEntry, isCacheStale, fetchRawTimeseries, buildPeriods, buildWeekPeriods } from '$lib/utils/weather';

	interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		parentId?: string | null;
		children?: ChecklistItem[];
		skippedAt?: string | null;
		snoozedToDate?: string | null;
		metadata?: { timeHour?: number; timeMinute?: number; [key: string]: unknown } | null;
	}

	interface Checklist {
		id: string;
		title: string;
		emoji: string;
		context: string | null;
		completedAt: string | null;
		items: ChecklistItem[];
	}

	interface Props {
		checklist: Checklist;
		onclose: () => void;
		onDeleted?: () => void;
		onChanged?: () => void;
		onStartChat?: (itemText: string, checklistId: string, itemId: string) => void;
		onNavigateDay?: (dateIso: string) => void;
	}

	let { checklist, onclose, onDeleted, onChanged, onStartChat, onNavigateDay }: Props = $props();

	let items = $state<ChecklistItem[]>([...checklist.items]);
	let newItemText = $state('');
	let newItemInputEl = $state<HTMLInputElement | null>(null);
	let showPayoff = $state(false);
	let payoffDismissed = $state(false);
	let addingItem = $state(false);
	let breakdownItem = $state<ChecklistItem | null>(null);
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressTriggered = $state(false);
	let contextMenuItem = $state<ChecklistItem | null>(null);
	let contextMenuRect = $state<DOMRect | null>(null);
	let expandedParentIds = $state<Set<string>>(new Set());
	let skippedExpanded = $state(false);
	let newSubItemTexts = $state<Record<string, string>>({});
	let editingItemId = $state<string | null>(null);
	let editingText = $state('');
	let editInputEl = $state<HTMLInputElement | null>(null);
	let shareSheetOpen = $state(false);

	$effect(() => {
		if (editingItemId && editInputEl) {
			editInputEl.focus();
			editInputEl.select();
		}
	});

	// Strøkne ("gjør ikke") teller hverken som planlagt eller løst.
	const plannedItems = $derived(items.filter((i) => !i.skippedAt));
	const done = $derived(plannedItems.filter((i) => i.checked).length);
	const total = $derived(plannedItems.length);
	const allDone = $derived(total > 0 && done === total);
	const pct = $derived(total > 0 ? done / total : 0);

	// Top-nivå-punkter delt i tre seksjoner: tidfestede (med tidschip, sortert
	// kronologisk), øvrige (sortert på status), og strøkne (kollapset under "Hoppet over").
	const topLevelItems = $derived(items.filter((i) => !i.parentId));
	const timedGroups = $derived(
		groupChecklistItems(
			sortByStatus(
				sortByTime(topLevelItems.filter((i) => !i.skippedAt && i.metadata?.timeHour !== undefined))
			)
		)
	);
	const untimedGroups = $derived(
		groupChecklistItems(
			sortByStatus(topLevelItems.filter((i) => !i.skippedAt && i.metadata?.timeHour === undefined))
		)
	);
	const skippedItems = $derived(topLevelItems.filter((i) => !!i.skippedAt));
	const skippedGroups = $derived(groupChecklistItems(skippedItems));
	const calendarHref = $derived.by(() => {
		const context = checklist.context;
		if (!context) return '/ukeplan';

		const dayMatch = context.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
		if (dayMatch) {
			const weekKey = encodeURIComponent(dayMatch[1]);
			const dayKey = encodeURIComponent(dayMatch[2]);
			return `/ukeplan?week=${weekKey}&day=${dayKey}`;
		}

		const weekMatch = context.match(/^week:(\d{4}-W\d{2})$/);
		if (weekMatch) {
			const weekKey = encodeURIComponent(weekMatch[1]);
			return `/ukeplan?week=${weekKey}`;
		}

		return '/ukeplan';
	});

	function formatDayLabel(dateIso: string): string {
		const todayIso = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowIso = tomorrow.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		const yesterdayIso = yesterday.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
		if (dateIso === todayIso) return 'I dag';
		if (dateIso === tomorrowIso) return 'I morgen';
		if (dateIso === yesterdayIso) return 'I går';
		return new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })
			.format(new Date(dateIso + 'T12:00:00'));
	}

	const isDayChecklist = $derived.by(() => {
		return !!checklist.context?.match(/^week:\d{4}-W\d{2}:day:\d{4}-\d{2}-\d{2}$/);
	});

	const displayTitle = $derived.by(() => {
		const ctx = checklist.context;
		if (!ctx) return checklist.title;
		const dayMatch = ctx.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
		if (dayMatch) return formatDayLabel(dayMatch[2]);
		const weekMatch = ctx.match(/^week:(\d{4}-W\d{2})$/);
		if (weekMatch) return 'Hele uka';
		return checklist.title;
	});

	function navigateDay(offset: number) {
		const ctx = checklist.context;
		if (!ctx || !onNavigateDay) return;
		const m = ctx.match(/^week:\d{4}-W\d{2}:day:(\d{4}-\d{2}-\d{2})$/);
		if (!m) return;
		const d = new Date(m[1] + 'T12:00:00');
		d.setDate(d.getDate() + offset);
		const year = d.getFullYear();
		const month = String(d.getMonth() + 1).padStart(2, '0');
		const day = String(d.getDate()).padStart(2, '0');
		onNavigateDay(`${year}-${month}-${day}`);
	}

	// Weather for day and week checklists
	const dayContextDate = $derived.by(() => {
		const ctx = checklist.context;
		if (!ctx) return null;
		const m = ctx.match(/^week:(?:\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
		return m ? m[1] : null;
	});
	const weekContextKey = $derived.by(() => {
		const ctx = checklist.context;
		if (!ctx) return null;
		const m = ctx.match(/^week:(\d{4}-W\d{2})$/);
		return m ? m[1] : null;
	});
	let weatherPeriods = $state<WeatherPeriod[] | null>(null);

	onMount(async () => {
		const date = dayContextDate;
		const weekKey = weekContextKey;
		if (!date && !weekKey) return;

		// Try geolocation first, fall back to Oslo
		const getCoords = (): Promise<{ lat: number; lon: number }> =>
			new Promise((resolve) => {
				if (!navigator.geolocation) return resolve({ lat: 59.9139, lon: 10.7522 });
				navigator.geolocation.getCurrentPosition(
					(pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
					() => resolve({ lat: 59.9139, lon: 10.7522 }),
					{ timeout: 4000, maximumAge: 300_000 }
				);
			});
		const { lat, lon } = await getCoords();

		// 1. Show from cache immediately (stale-while-revalidate)
		const cached = readCacheEntry(lat, lon);
		if (cached) {
			weatherPeriods = date
				? buildPeriods(date, cached.timeseries)
				: buildWeekPeriods(weekKey!, cached.timeseries);
		}

		// 2. Revalidate if cache is stale or missing
		if (!cached || isCacheStale(cached)) {
			const freshTs = await fetchRawTimeseries(lat, lon);
			if (freshTs) {
				weatherPeriods = date
					? buildPeriods(date, freshTs)
					: buildWeekPeriods(weekKey!, freshTs);
			}
		}
	});

	// Vis payoff-animasjon én gang når alt er fullført
	$effect(() => {
		if (allDone && !payoffDismissed && !showPayoff) {
			setTimeout(() => { showPayoff = true; }, 400);
		}
	});

	// Langtrykk åpner kontekstmeny (600ms, samme som widgets).
	function handleItemPressStart(event: PointerEvent, item: ChecklistItem) {
		const target = event.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		longPressTriggered = false;
		longPressTimer = setTimeout(() => {
			longPressTriggered = true;
			contextMenuItem = item;
			contextMenuRect = rect;
			longPressTimer = null;
		}, 600);
	}

	function handleItemPressEnd() {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
	}

	async function toggleItem(item: ChecklistItem) {
		if (longPressTimer) {
			clearTimeout(longPressTimer);
			longPressTimer = null;
		}
		// Hvis kontekstmenyen ble åpnet via langtrykk, ikke kryss av samtidig.
		if (longPressTriggered) {
			longPressTriggered = false;
			return;
		}

		const newChecked = !item.checked;
		// Optimistisk oppdatering
		const previousItems = items;
		items = items.map((i) =>
			i.id === item.id ? { ...i, checked: newChecked } : i
		);

		const res = await fetch(`/api/checklists/${checklist.id}/items/${item.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ checked: newChecked })
		});

		if (!res.ok) {
			items = previousItems;
			return;
		}

		onChanged?.();
	}

	async function addItem() {
		const text = newItemText.trim();
		if (!text) return;
		newItemText = '';
		addingItem = true;

		try {
			const res = await fetch(`/api/checklists/${checklist.id}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, sortOrder: items.length })
			});
			if (res.ok) {
				const created = await res.json() as ChecklistItem[];
				items = [...items, ...created];
				onChanged?.();
			}
		} finally {
			addingItem = false;
		}
	}

	async function deleteItem(itemId: string) {
		const previousItems = items;
		items = items.filter((i) => i.id !== itemId && i.parentId !== itemId);
		const res = await fetch(`/api/checklists/${checklist.id}/items/${itemId}`, {
			method: 'DELETE'
		});
		if (!res.ok) {
			items = previousItems;
			return;
		}
		onChanged?.();
	}

	async function setItemSkipped(itemId: string, skipped: boolean) {
		const previousItems = items;
		items = items.map((i) =>
			i.id === itemId
				? { ...i, skippedAt: skipped ? new Date().toISOString() : null, snoozedToDate: skipped ? i.snoozedToDate : null, checked: skipped ? false : i.checked }
				: i
		);
		const res = await fetch(`/api/checklists/${checklist.id}/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ skipped })
		});
		if (!res.ok) {
			items = previousItems;
			return;
		}
		onChanged?.();
	}

	async function snoozeItem(itemId: string, targetDate: string) {
		// Optimistisk markér originalen som skipped + snoozed; kopien lever på et annet sjekkliste
		const previousItems = items;
		items = items.map((i) =>
			i.id === itemId
				? { ...i, skippedAt: new Date().toISOString(), snoozedToDate: targetDate, checked: false }
				: i
		);
		const res = await fetch(`/api/checklists/${checklist.id}/items/${itemId}/snooze`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ targetDate })
		});
		if (!res.ok) {
			items = previousItems;
			return;
		}
		onChanged?.();
	}

	async function handleBreakdownSave(subtasks: string[]) {
		if (!breakdownItem) return;

		try {
			const res = await fetch('/api/breakdown/save', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					parentItemId: breakdownItem.id,
					subtasks,
					breakdownPrompt: breakdownItem.text
				})
			});

			if (!res.ok) throw new Error('Failed to save breakdown');
			const data = (await res.json()) as { success: boolean; subtasks: ChecklistItem[] };

			// Add subtasks to items
			if (data.success) {
				items = [...items, ...data.subtasks];
				breakdownItem = null;
				onChanged?.();
			}
		} catch (err) {
			console.error('Error saving breakdown:', err);
		}
	}

	function toggleParentExpansion(parentId: string) {
		const next = new Set(expandedParentIds);
		if (next.has(parentId)) next.delete(parentId);
		else next.add(parentId);
		expandedParentIds = next;
	}

	async function addSubItem(parentId: string) {
		const text = (newSubItemTexts[parentId] ?? '').trim();
		if (!text) return;
		newSubItemTexts = { ...newSubItemTexts, [parentId]: '' };
		try {
			const res = await fetch(`/api/checklists/${checklist.id}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, sortOrder: items.length, parentId })
			});
			if (res.ok) {
				const created = await res.json() as ChecklistItem[];
				items = [...items, ...created];
				onChanged?.();
			}
		} catch (err) {
			console.error('Error adding subitem:', err);
		}
	}

	function handleAddKey(e: KeyboardEvent) {
		if (e.key === 'Enter') addItem();
	}

	function startEditing(item: ChecklistItem) {
		editingItemId = item.id;
		editingText = item.text;
	}

	function cancelEdit() {
		editingItemId = null;
		editingText = '';
	}

	async function commitEdit() {
		if (!editingItemId) return;
		const itemId = editingItemId;
		const text = editingText.trim();
		editingItemId = null;
		editingText = '';
		if (!text) return;
		items = items.map(i => i.id === itemId ? { ...i, text } : i);
		await fetch(`/api/checklists/${checklist.id}/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text })
		});
		onChanged?.();
	}

	function dismissPayoff() {
		showPayoff = false;
		payoffDismissed = true;
	}

	async function deleteChecklist() {
		await fetch(`/api/checklists/${checklist.id}`, { method: 'DELETE' });
		onDeleted?.();
		onclose();
	}

	// Prosentring SVG
	const R = 40;
	const C = 2 * Math.PI * R;
	const ringDash = $derived(pct * C);
	const ringColor = $derived(allDone ? '#5fa080' : '#7c8ef5');
</script>

<!-- Overlay backdrop -->
<div
	class="cs-backdrop"
	transition:fade={{ duration: 200 }}
	onclick={onclose}
	role="presentation"
></div>

<!-- Sheet -->
<div
	class="cs-sheet"
	transition:fly={{ y: 40, duration: 350, easing: cubicOut }}
	role="dialog"
	aria-modal="true"
>
	<!-- Header -->
	<div class="cs-header">
		<div class="cs-header-left">
			{#if checklist.emoji && checklist.emoji !== '🗓️' && checklist.emoji !== '☑️'}
				<span class="cs-header-emoji">{checklist.emoji}</span>
			{/if}
			<div>
				<h2 class="cs-title">{displayTitle}</h2>
				<p class="cs-subtitle">{done} av {total} fullført</p>
			</div>
		</div>
		{#if weatherPeriods}
			<div class="cs-header-weather">
				<WeatherStrip periods={weatherPeriods} />
			</div>
		{/if}
		<button class="cs-share-btn" onclick={() => (shareSheetOpen = true)} aria-label="Del" title="Del">
			↗
		</button>
		<button class="cs-close-btn" onclick={onclose} aria-label="Lukk"><Icon name="close" size={14} /></button>
	</div>

	<ShareSheet
		resourceType="checklist"
		resourceId={checklist.id}
		resourceTitle={checklist.title}
		open={shareSheetOpen}
		onClose={() => (shareSheetOpen = false)}
	/>

	<!-- Progress bar -->
	<div class="cs-progress-track">
		<div
			class="cs-progress-fill"
			style="width:{pct * 100}%; background:{ringColor}"
		></div>
	</div>

	<!-- Snippet for én gruppe (enten en slot-rad med gjentakelser eller et enkelt punkt). -->
	{#snippet groupRow(group: GroupedChecklistEntry<ChecklistItem>)}
		{#if group.type === 'group'}
			<div class="cs-group-row">
				<span class="cs-group-label">{activityEmoji(group.label) ? activityEmoji(group.label) + ' ' : ''}{group.label}</span>
				<div class="cs-slot-row">
					{#each group.items as item (item.id)}
						{@const hasChildren = items.some(i => i.parentId === item.id)}
						{@const itemSkipped = !!item.skippedAt}
						<button
							type="button"
							class="cs-slot"
							class:cs-slot-checked={item.checked}
							class:cs-slot-skipped={itemSkipped}
							class:cs-slot-parent={hasChildren}
							onpointerdown={(e) => handleItemPressStart(e, item)}
							onpointerup={handleItemPressEnd}
							onpointercancel={handleItemPressEnd}
							onpointerleave={handleItemPressEnd}
							onclick={() => toggleItem(item)}
							title="Langtrykk for valg"
							aria-label={item.checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
						>
							{itemSkipped ? '✕' : item.checked ? '✓' : ''}
							{#if hasChildren && !itemSkipped}
								<span class="cs-slot-indicator">✕</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{:else}
			{@const hasChildren = items.some(i => i.parentId === group.item.id)}
			{@const childrenItems = items.filter(i => i.parentId === group.item.id)}
			{@const completedChildren = childrenItems.filter((c) => c.checked).length}
			{@const isExpanded = expandedParentIds.has(group.item.id)}
			{@const itemTimed = group.item.metadata?.timeHour !== undefined}
			{@const cR = 8}
			{@const cC = 2 * Math.PI * cR}
			{@const cPct = childrenItems.length > 0 ? completedChildren / childrenItems.length : 0}
			<div class="cs-item-wrapper" class:cs-item-wrapper-parent={hasChildren}>
				{#if hasChildren}
					<div class="cs-parent-row">
						<button
							type="button"
							class="cs-parent-caret"
							class:cs-caret-expanded={isExpanded}
							onclick={() => toggleParentExpansion(group.item.id)}
							aria-label={isExpanded ? 'Lukk substeps' : 'Utvid substeps'}
						>
							▸
						</button>
						<button
							class="cs-item"
							class:cs-item-checked={group.item.checked}
							class:cs-item-skipped={!!group.item.skippedAt}
							onpointerdown={(e) => { if (editingItemId === group.item.id) return; handleItemPressStart(e, group.item); }}
							onpointerup={handleItemPressEnd}
							onpointercancel={handleItemPressEnd}
							onpointerleave={handleItemPressEnd}
							onclick={() => { if (editingItemId === group.item.id) return; toggleItem(group.item); }}
							title="Langtrykk for valg"
						>
							{#if editingItemId === group.item.id}
								<input
									class="cs-item-edit-input"
									bind:this={editInputEl}
									bind:value={editingText}
									onkeydown={(e) => { if (e.key === 'Enter') { void commitEdit(); } else if (e.key === 'Escape') cancelEdit(); }}
									onblur={() => void commitEdit()}
									onclick={(e) => e.stopPropagation()}
									onpointerdown={(e) => e.stopPropagation()}
								/>
							{:else}
								<span class="cs-item-main">
									{#if itemTimed}
										<span class="cs-time-chip">{formatItemTime(group.item.metadata!.timeHour!, group.item.metadata?.timeMinute ?? 0)}</span>
									{/if}
									<span class="cs-item-text"><TaskTitle title={itemTimed ? stripTimeFromText(group.item.text) : group.item.text} /></span>
								</span>
							{/if}
							<svg class="cs-parent-circle" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
								<circle cx="10" cy="10" r={cR} fill="none" stroke="#2a2a2a" stroke-width="2.5"/>
								<circle cx="10" cy="10" r={cR} fill="none"
									stroke={completedChildren === childrenItems.length ? '#5fa080' : '#7c8ef5'}
									stroke-width="2.5"
									stroke-dasharray="{cPct * cC} {cC}"
									stroke-linecap="round"
									transform="rotate(-90 10 10)"
								/>
							</svg>
						</button>
					</div>
				{:else}
					{@const itemSkipped = !!group.item.skippedAt}
					<button
						class="cs-item"
						class:cs-item-checked={group.item.checked}
						class:cs-item-skipped={itemSkipped}
						onpointerdown={(e) => { if (editingItemId === group.item.id) return; handleItemPressStart(e, group.item); }}
						onpointerup={handleItemPressEnd}
						onpointercancel={handleItemPressEnd}
						onpointerleave={handleItemPressEnd}
						onclick={() => { if (editingItemId === group.item.id) return; toggleItem(group.item); }}
						title="Langtrykk for valg"
					>
						{#if editingItemId === group.item.id}
							<input
								class="cs-item-edit-input"
								bind:this={editInputEl}
								bind:value={editingText}
								onkeydown={(e) => { if (e.key === 'Enter') { void commitEdit(); } else if (e.key === 'Escape') cancelEdit(); }}
								onblur={() => void commitEdit()}
								onclick={(e) => e.stopPropagation()}
								onpointerdown={(e) => e.stopPropagation()}
							/>
						{:else}
							<span class="cs-item-main">
								{#if itemTimed}
									<span class="cs-time-chip">{formatItemTime(group.item.metadata!.timeHour!, group.item.metadata?.timeMinute ?? 0)}</span>
								{/if}
								<span class="cs-item-text"><TaskTitle title={itemTimed ? stripTimeFromText(group.item.text) : group.item.text} /></span>
							</span>
						{/if}
						<div
							class="cs-checkbox"
							class:cs-checkbox-checked={group.item.checked && !itemSkipped}
							class:cs-checkbox-skipped={itemSkipped}
						>
							{#if itemSkipped}
								<span class="cs-tick cs-tick-skipped" transition:scale={{ duration: 200, easing: elasticOut }}>✕</span>
							{:else if group.item.checked}
								<span class="cs-tick" transition:scale={{ duration: 200, easing: elasticOut }}>✓</span>
							{/if}
						</div>
					</button>
				{/if}
				{#if hasChildren && isExpanded}
					<div class="cs-children" transition:slide>
						{#each sortByStatus(sortByTime(childrenItems)) as child (child.id)}
							{@const childSkipped = !!child.skippedAt}
							{@const childTimed = child.metadata?.timeHour !== undefined}
							<button
								class="cs-child-item"
								class:cs-child-checked={child.checked}
								class:cs-child-skipped={childSkipped}
								onpointerdown={(e) => handleItemPressStart(e, child)}
								onpointerup={handleItemPressEnd}
								onpointercancel={handleItemPressEnd}
								onpointerleave={handleItemPressEnd}
								onclick={() => toggleItem(child)}
							>
								{#if childTimed}
									<span class="cs-time-chip cs-time-chip-small">{formatItemTime(child.metadata!.timeHour!, child.metadata?.timeMinute ?? 0)}</span>
								{/if}
								<span class="cs-child-text"><TaskTitle title={childTimed ? stripTimeFromText(child.text) : child.text} /></span>
								<div
									class="cs-checkbox cs-checkbox-small"
									class:cs-checkbox-checked={child.checked && !childSkipped}
									class:cs-checkbox-skipped={childSkipped}
								>
									{#if childSkipped}
										<span class="cs-tick cs-tick-skipped" transition:scale={{ duration: 200, easing: elasticOut }}>✕</span>
									{:else if child.checked}
										<span class="cs-tick" transition:scale={{ duration: 200, easing: elasticOut }}>✓</span>
									{/if}
								</div>
							</button>
						{/each}
						<div class="cs-subitem-add-row">
							<input
								class="cs-subitem-add-input"
								type="text"
								placeholder="Legg til deloppgave…"
								value={newSubItemTexts[group.item.id] ?? ''}
								oninput={(e) => newSubItemTexts = { ...newSubItemTexts, [group.item.id]: (e.target as HTMLInputElement).value }}
								onkeydown={(e) => { if (e.key === 'Enter') addSubItem(group.item.id); }}
							/>
						</div>
					</div>
				{/if}
			</div>
		{/if}
	{/snippet}

	<!-- Items list -->
	<div class="cs-items">
		<!-- Tidfestede oppgaver øverst, med tidschip -->
		{#each timedGroups as group}
			{@render groupRow(group)}
		{/each}

		<!-- Skillelinje mellom tidfestede og øvrige oppgaver -->
		{#if timedGroups.length > 0 && untimedGroups.length > 0}
			<div class="cs-divider" role="separator"></div>
		{/if}

		<!-- Øvrige oppgaver -->
		{#each untimedGroups as group}
			{@render groupRow(group)}
		{/each}

		<!-- Strøkne oppgaver i kollapset «Hoppet over»-liste -->
		{#if skippedItems.length > 0}
			<div class="cs-skipped-section">
				<button
					type="button"
					class="cs-skipped-header"
					class:cs-skipped-open={skippedExpanded}
					onclick={() => (skippedExpanded = !skippedExpanded)}
					aria-expanded={skippedExpanded}
				>
					<span class="cs-skipped-caret" class:cs-caret-expanded={skippedExpanded}>▸</span>
					<span class="cs-skipped-label">Hoppet over</span>
					<span class="cs-skipped-count">{skippedItems.length}</span>
				</button>
				{#if skippedExpanded}
					<div class="cs-skipped-items" transition:slide>
						{#each skippedGroups as group}
							{@render groupRow(group)}
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Mention autocomplete for inline editing -->
	<MentionAutocomplete
		textareaEl={editInputEl}
		value={editingText}
		onValueChange={(t) => (editingText = t)}
	/>

	<!-- Add item input -->
	<div class="cs-add-row">
		<input
			class="cs-add-input"
			type="text"
			placeholder="Ny oppgave (skriv @ for å nevne en person)"
			bind:this={newItemInputEl}
			bind:value={newItemText}
			onkeydown={handleAddKey}
			disabled={addingItem}
		/>
		<MentionAutocomplete
			textareaEl={newItemInputEl}
			value={newItemText}
			onValueChange={(t) => (newItemText = t)}
			disabled={addingItem}
		/>
		<button
			class="cs-add-btn"
			onclick={addItem}
			disabled={!newItemText.trim() || addingItem}
		><Icon name="plus" size={16} /></button>
	</div>

	<!-- Footer -->
	<div class="cs-footer">
		{#if isDayChecklist && onNavigateDay}
			<div class="cs-day-nav">
				<button class="cs-day-nav-btn" onclick={() => navigateDay(-1)} aria-label="Forrige dag">&lsaquo;</button>
				<a class="cs-calendar-link" href={calendarHref}>Åpne i kalender</a>
				<button class="cs-day-nav-btn" onclick={() => navigateDay(1)} aria-label="Neste dag">&rsaquo;</button>
			</div>
		{:else}
			<a class="cs-calendar-link" href={calendarHref}>Åpne i kalender</a>
		{/if}
		<button class="cs-delete-btn" onclick={deleteChecklist}>Slett liste</button>
	</div>
</div>

<!-- Payoff overlay -->
{#if showPayoff}
	<div
		class="cs-payoff"
		transition:fade={{ duration: 300 }}
		onclick={dismissPayoff}
		role="presentation"
	>
		<div class="cs-payoff-content" transition:scale={{ duration: 500, easing: elasticOut, start: 0.7 }}>
			<!-- Animated ring -->
			<div class="cs-payoff-ring-wrap">
				<svg class="cs-payoff-ring" viewBox="0 0 100 100">
					<circle cx="50" cy="50" r={R} fill="none" stroke="#1a2a1a" stroke-width="8"/>
					<circle
						cx="50" cy="50" r={R}
						fill="none"
						stroke="#5fa080"
						stroke-width="8"
						stroke-dasharray="{C} {C}"
						stroke-linecap="round"
						transform="rotate(-90 50 50)"
						class="cs-payoff-ring-anim"
					/>
				</svg>
				<div class="cs-payoff-ring-inner">
					{#if checklist.emoji && checklist.emoji !== '🗓️' && checklist.emoji !== '☑️'}
						<span class="cs-payoff-emoji">{checklist.emoji}</span>
					{/if}
				</div>
			</div>

			<h3 class="cs-payoff-title">Alt er klart!</h3>
			<p class="cs-payoff-sub">{displayTitle}</p>
			<p class="cs-payoff-cta">Trykk hvor som helst for å lukke</p>
		</div>
	</div>
{/if}

<!-- Kontekstmeny ved langtrykk -->
<TaskContextMenu
	open={contextMenuItem !== null}
	anchor={contextMenuRect}
	itemText={contextMenuItem?.text ?? ''}
	hasChildren={contextMenuItem ? items.some((i) => i.parentId === contextMenuItem!.id) : false}
	isSkipped={!!contextMenuItem?.skippedAt}
	isChecked={!!contextMenuItem?.checked}
	onClose={() => { contextMenuItem = null; contextMenuRect = null; }}
	onEdit={() => { if (contextMenuItem) startEditing(contextMenuItem); }}
	onBreakdown={() => { if (contextMenuItem) breakdownItem = contextMenuItem; }}
	onSnooze={(targetDate) => { if (contextMenuItem) void snoozeItem(contextMenuItem.id, targetDate); }}
	onSkip={() => { if (contextMenuItem) void setItemSkipped(contextMenuItem.id, true); }}
	onUnskip={() => { if (contextMenuItem) void setItemSkipped(contextMenuItem.id, false); }}
	onDelete={() => { if (contextMenuItem) void deleteItem(contextMenuItem.id); }}
	onStartChat={onStartChat ? () => { if (contextMenuItem) onStartChat?.(contextMenuItem.text, checklist.id, contextMenuItem.id); } : undefined}
/>

<!-- Breakdown modal -->
{#if breakdownItem}
	<BreakdownModal
		itemTitle={breakdownItem.text}
		onClose={() => (breakdownItem = null)}
		onSave={handleBreakdownSave}
	/>
{/if}

<style>
	.cs-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0,0,0,0.6);
		z-index: 200;
	}

	.cs-sheet {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		max-height: 90dvh;
		background: #111;
		border-radius: 24px 24px 0 0;
		border-top: 1px solid #222;
		z-index: 201;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		/* Max width centering for tablet/desktop */
		max-width: 520px;
		margin: 0 auto;
	}

	/* ── Header ── */
	.cs-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20px 20px 12px;
		flex-shrink: 0;
	}

	.cs-header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.cs-header-emoji {
		font-size: 1.8rem;
		line-height: 1;
	}

	.cs-title {
		font-size: 1rem;
		font-weight: 700;
		color: #eee;
		margin: 0 0 2px;
		letter-spacing: -0.01em;
	}

	.cs-subtitle {
		font-size: 0.72rem;
		color: #555;
		margin: 0;
	}

	.cs-close-btn {
		width: 32px;
		height: 32px;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #666;
		font-size: 0.75rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: color 0.12s, border-color 0.12s;
	}
	.cs-close-btn:hover { color: #ccc; border-color: #555; }

	.cs-share-btn {
		width: 32px;
		height: 32px;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #888;
		font-size: 1rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		margin-right: 6px;
		transition: color 0.12s, border-color 0.12s;
	}
	.cs-share-btn:hover { color: #ccc; border-color: #555; }

	/* ── Progress bar ── */
	.cs-progress-track {
		height: 3px;
		background: #1e1e1e;
		flex-shrink: 0;
		margin: 0 20px;
		border-radius: 999px;
		overflow: hidden;
	}

	.cs-progress-fill {
		height: 100%;
		border-radius: 999px;
		transition: width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	/* ── Weather strip in header ── */
	.cs-header-weather {
		flex: 1;
		display: flex;
		justify-content: flex-end;
		padding: 0 12px;
		min-width: 0;
	}

	/* ── Items ── */
	.cs-items {
		flex: 1;
		overflow-y: auto;
		padding: 16px 20px 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		-webkit-overflow-scrolling: touch;
	}

	.cs-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-radius: 10px;
		border: none;
		background: transparent;
		cursor: pointer;
		text-align: left;
		transition: background 0.1s;
		font: inherit;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.cs-item:hover { background: #161616; }
	.cs-item:active { background: #1a1a1a; }

	.cs-checkbox {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 2px solid #333;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s, background 0.15s;
	}

	.cs-checkbox-checked {
		border-color: #7c8ef5;
		background: #7c8ef5;
	}

	.cs-item-checked .cs-checkbox.cs-checkbox-checked {
		border-color: #5fa080;
		background: #5fa080;
	}

	.cs-tick {
		color: white;
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1;
	}

	.cs-item-edit-input {
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

	.cs-item-main {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
	}

	.cs-item-text {
		font-size: 0.88rem;
		color: #ccc;
		line-height: 1.4;
		transition: color 0.15s, text-decoration 0.15s;
	}

	/* ── Tidschip for tidfestede oppgaver ── */
	.cs-time-chip {
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

	.cs-time-chip-small {
		font-size: 0.62rem;
		padding: 0 4px;
	}

	.cs-item-checked .cs-time-chip,
	.cs-item-skipped .cs-time-chip,
	.cs-child-checked .cs-time-chip,
	.cs-child-skipped .cs-time-chip {
		opacity: 0.4;
	}

	/* ── Skillelinje mellom tidfestede og øvrige oppgaver ── */
	.cs-divider {
		height: 1px;
		background: #1e1e1e;
		margin: 6px 12px;
		flex-shrink: 0;
	}

	/* ── «Hoppet over»-seksjon ── */
	.cs-skipped-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 4px;
	}

	.cs-skipped-header {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 10px 12px;
		color: #666;
		font: inherit;
		font-size: 0.78rem;
		text-align: left;
		transition: color 0.12s;
	}
	.cs-skipped-header:hover { color: #999; }

	.cs-skipped-caret {
		font-size: 0.8rem;
		color: #555;
		line-height: 1;
		transition: transform 0.2s;
		flex-shrink: 0;
	}
	.cs-skipped-caret.cs-caret-expanded {
		transform: rotate(90deg);
	}

	.cs-skipped-label {
		flex: 1;
	}

	.cs-skipped-count {
		color: #555;
		font-variant-numeric: tabular-nums;
	}

	.cs-skipped-items {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.cs-item-checked .cs-item-text {
		color: #444;
		text-decoration: line-through;
	}

	.cs-item-skipped .cs-item-text {
		color: #5a4040;
		text-decoration: line-through;
		text-decoration-color: #774444;
	}

	.cs-checkbox-skipped {
		border-color: #774444;
		background: #2a1818;
	}

	.cs-tick-skipped {
		color: #e07070;
	}

	.cs-slot-skipped {
		border-color: #774444;
		background: #2a1818;
		color: #e07070;
	}

	.cs-child-skipped .cs-child-text {
		color: #5a4040;
		text-decoration: line-through;
		text-decoration-color: #774444;
	}

	/* ── Grouped repeated items ── */
	.cs-group-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 10px;
	}

	.cs-group-label {
		font-size: 0.88rem;
		color: #ccc;
		flex: 1;
		min-width: 0;
	}

	.cs-slot-row {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}

	.cs-slot {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 2px solid #333;
		background: transparent;
		color: #7c8ef5;
		font-size: 0.8rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s, background 0.15s;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}
	.cs-slot:hover { border-color: #555; }
	.cs-slot.cs-slot-checked {
		border-color: #5fa080;
		background: #5fa080;
		color: #fff;
	}

	/* ── Add row ── */
	.cs-add-row {
		display: flex;
		gap: 8px;
		padding: 12px 20px;
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.cs-add-input {
		flex: 1;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #ccc;
		padding: 9px 12px;
		font: inherit;
		font-size: max(0.85rem, 16px);
		outline: none;
		transition: border-color 0.12s;
	}
	.cs-add-input:focus { border-color: #4a5af0; }
	.cs-add-input::placeholder { color: #444; }

	.cs-add-btn {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #4a5af0;
		border: 1px solid #5a6af8;
		color: white;
		cursor: pointer;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.12s, opacity 0.12s;
	}
	.cs-add-btn:hover:not(:disabled) { background: #3a4adf; }
	.cs-add-btn:disabled { opacity: 0.35; cursor: not-allowed; background: #2a2a2a; border-color: #2a2a2a; }

	/* ── Footer ── */
	.cs-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 20px 20px;
		flex-shrink: 0;
	}

	.cs-calendar-link {
		font-size: 0.74rem;
		color: #8ea0ff;
		text-decoration: none;
		border: 1px solid #2f365f;
		background: #151821;
		padding: 6px 10px;
		border-radius: 8px;
	}

	.cs-calendar-link:hover {
		color: #c7d0ff;
		border-color: #4653a6;
	}

	.cs-day-nav {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.cs-day-nav-btn {
		width: 30px;
		height: 30px;
		border-radius: 8px;
		border: 1px solid #2f365f;
		background: #151821;
		color: #8ea0ff;
		font-size: 1.1rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: color 0.12s, border-color 0.12s;
		padding: 0;
		line-height: 1;
	}

	.cs-day-nav-btn:hover {
		color: #c7d0ff;
		border-color: #4653a6;
	}

	.cs-delete-btn {
		background: transparent;
		border: none;
		color: #555;
		font-size: 0.72rem;
		cursor: pointer;
		padding: 4px 0;
		transition: color 0.12s;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.cs-delete-btn:hover { color: #e07070; }

	/* ── Payoff ── */
	.cs-payoff {
		position: fixed;
		inset: 0;
		background: rgba(0, 10, 0, 0.85);
		z-index: 300;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
	}

	.cs-payoff-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		text-align: center;
		padding: 40px 32px;
	}

	.cs-payoff-ring-wrap {
		position: relative;
		width: 120px;
		height: 120px;
	}

	.cs-payoff-ring {
		width: 100%;
		height: 100%;
		display: block;
	}

	.cs-payoff-ring-anim {
		stroke-dashoffset: 0;
		animation: payoffDraw 0.8s cubic-bezier(0.22, 1, 0.36, 1) forwards;
	}

	@keyframes payoffDraw {
		from { stroke-dasharray: 0 251.33; }
		to { stroke-dasharray: 251.33 0; }
	}

	.cs-payoff-ring-inner {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cs-payoff-emoji {
		font-size: 2.5rem;
		animation: payoffBounce 0.6s 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
	}

	@keyframes payoffBounce {
		from { transform: scale(0.4); opacity: 0; }
		to { transform: scale(1); opacity: 1; }
	}

	.cs-payoff-title {
		font-size: 1.5rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.02em;
		margin: 0;
		animation: payoffFadeUp 0.5s 0.3s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.cs-payoff-sub {
		font-size: 0.85rem;
		color: #888;
		margin: 0;
		animation: payoffFadeUp 0.5s 0.45s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	.cs-payoff-cta {
		font-size: 0.7rem;
		color: #444;
		margin: 8px 0 0;
		animation: payoffFadeUp 0.5s 0.6s cubic-bezier(0.22, 1, 0.36, 1) both;
	}

	@keyframes payoffFadeUp {
		from { opacity: 0; transform: translateY(12px); }
		to { opacity: 1; transform: translateY(0); }
	}

	/* ── Item wrapper and children ── */
	.cs-item-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.cs-children {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 0 12px 0 32px;
		background: #0a0a0a;
		border-radius: 0 0 10px 10px;
		margin-bottom: 4px;
	}

	.cs-child-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 0;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		text-align: left;
		font: inherit;
		transition: opacity 0.1s;
		border-bottom: 1px solid #1a1a1a;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.cs-child-item:last-child {
		border-bottom: none;
	}

	.cs-child-item:hover {
		opacity: 0.8;
	}

	.cs-child-text {
		font-size: 0.75rem;
		color: #aaa;
		line-height: 1.3;
		flex: 1;
		transition: color 0.1s, text-decoration 0.1s;
	}

	.cs-child-checked .cs-child-text {
		color: #555;
		text-decoration: line-through;
	}

	.cs-checkbox-small {
		width: 18px;
		height: 18px;
		border-width: 1.5px;
	}

	/* Parent indicator on slot buttons */
	.cs-slot-parent {
		position: relative;
	}

	.cs-slot-indicator {
		position: absolute;
		font-size: 0.55rem;
		color: #7c8ef5;
		right: -4px;
		top: -6px;
		line-height: 1;
	}

	.cs-slot-parent.cs-slot-checked .cs-slot-indicator {
		color: #5fa080;
	}

	/* Parent UI */
	.cs-item-wrapper-parent {
		border-radius: 0;
	}

	.cs-parent-row {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 0 0 0 2px;
	}

	.cs-parent-row .cs-item {
		flex: 1;
	}

	.cs-parent-caret {
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

	.cs-parent-caret:hover {
		color: #9cb0ff;
	}

	.cs-parent-caret.cs-caret-expanded {
		transform: rotate(90deg);
	}

	.cs-parent-circle {
		flex-shrink: 0;
		display: block;
	}

	.cs-subitem-add-row {
		padding: 6px 0 8px;
		border-top: 1px solid #1e1e1e;
	}

	.cs-subitem-add-input {
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
	.cs-subitem-add-input:focus {
		border-color: #4a5af0;
		color: #ccc;
	}
	.cs-subitem-add-input::placeholder {
		color: #3a3a3a;
	}

</style>
