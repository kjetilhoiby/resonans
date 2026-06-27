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
	import { slide } from 'svelte/transition';
	import { groupChecklistItems, sortByStatus, sortByTime, isLocationItem, locationDisplayName, parseLocationPrefix, parseTravelPrefix, type GroupedChecklistEntry } from '$lib/utils/checklist-group';
	import BottomSheet from './BottomSheet.svelte';
	import { checklistSheetApi, type ChecklistSheetApi } from './checklist-sheet-api';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BreakdownModal from '$lib/components/ui/BreakdownModal.svelte';
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import MentionAutocomplete from '$lib/components/ui/MentionAutocomplete.svelte';
	import ShareSheet from '$lib/components/domain/share/ShareSheet.svelte';
	import LocationPickerModal from '$lib/components/ui/LocationPickerModal.svelte';
	import type { ChecklistItemLike } from '$lib/types/checklist';
	import ChecklistItemRow from '$lib/components/ui/ChecklistItemRow.svelte';
	import ChecklistGroupRow from '$lib/components/ui/ChecklistGroupRow.svelte';
	import RoutineGroupRow from '$lib/components/ui/RoutineGroupRow.svelte';
	import type { WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';
	import { isCacheStale, buildPeriods, buildWeekPeriods } from '$lib/utils/weather';
	import type { GeoCandidate } from '$lib/utils/geocode';

	import {
		buildCalendarHref,
		isDayContext,
		isTodayDayContext,
		extractDayDate,
		extractWeekKey,
		computeDisplayTitle,
		computeOffsetDate,
		RING_RADIUS,
		RING_CIRCUMFERENCE
	} from './checklist-sheet-helpers';
	import ChecklistSheetHeader from './ChecklistSheetHeader.svelte';
	import ChecklistSheetFooter from './ChecklistSheetFooter.svelte';
	import ChecklistPayoff from './ChecklistPayoff.svelte';

	interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		parentId?: string | null;
		children?: ChecklistItem[];
		skippedAt?: string | null;
		snoozedToDate?: string | null;
		metadata?: {
			timeHour?: number;
			timeMinute?: number;
			kind?: 'location' | 'travel' | string;
			locationName?: string;
			travelMode?: 'drive' | 'boat' | 'flight';
			destination?: string;
			lat?: number;
			lon?: number;
			geoLabel?: string;
			[key: string]: unknown;
		} | null;
	}

	interface Checklist {
		id: string;
		title: string;
		emoji: string;
		context: string | null;
		completedAt: string | null;
		items: ChecklistItem[];
	}

	interface RoutineData {
		checklistId: string;
		title: string;
		emoji: string;
		slot: string;
		items: Array<{ id: string; text: string; checked: boolean; sortOrder: number; estimateMinutes: number | null }>;
	}

	interface Props {
		checklist: Checklist;
		routines?: RoutineData[];
		onclose: () => void;
		onDeleted?: () => void;
		onChanged?: () => void;
		onStartChat?: (itemText: string, checklistId: string, itemId: string) => void;
		onNavigateDay?: (dateIso: string) => void;
		/** Nettverks-/enhets-IO — injiseres som mock på /design. Default: ekte API. */
		api?: ChecklistSheetApi;
	}

	let { checklist, routines = [], onclose, onDeleted, onChanged, onStartChat, onNavigateDay, api = checklistSheetApi }: Props = $props();

	let items = $state<ChecklistItem[]>([...checklist.items]);
	let backingId = $state(checklist.id);
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
	let activeEditInputRef = $state<HTMLInputElement | null>(null);
	let shareSheetOpen = $state(false);
	let routineItems = $state<RoutineData[]>([...routines]);
	let expandedRoutineIds = $state<Set<string>>(new Set());

	// Rutiner gjelder dagens dag. Vis dem bare i dagens dagsliste — ikke i ukelista
	// (week:…) eller andre dagers lister, der todaysRoutines ville vært feil.
	const showRoutines = $derived(isTodayDayContext(checklist.context));
	const morningRoutines = $derived(showRoutines ? routineItems.filter(r => r.slot === 'morning') : []);
	const otherRoutines = $derived(showRoutines ? routineItems.filter(r => r.slot !== 'morning') : []);

	function toggleRoutineExpansion(id: string) {
		const next = new Set(expandedRoutineIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		expandedRoutineIds = next;
	}

	async function handleRoutineToggle(checklistId: string, itemId: string, newChecked: boolean) {
		routineItems = routineItems.map(r =>
			r.checklistId === checklistId
				? { ...r, items: r.items.map(i => i.id === itemId ? { ...i, checked: newChecked } : i) }
				: r
		);
		const ok = await api.patchItem(checklistId, itemId, { checked: newChecked });
		if (!ok) {
			routineItems = routineItems.map(r =>
				r.checklistId === checklistId
					? { ...r, items: r.items.map(i => i.id === itemId ? { ...i, checked: !newChecked } : i) }
					: r
			);
		}
	}

	// Re-sync local state when checklist prop changes (day navigation)
	let loadedKey = $state(checklist.context ?? checklist.id);
	$effect(() => {
		const key = checklist.context ?? checklist.id;
		if (key === loadedKey) return;
		loadedKey = key;
		backingId = checklist.id;
		items = [...checklist.items];
		newItemText = '';
		showPayoff = false;
		payoffDismissed = false;
		editingItemId = null;
		editingText = '';
		expandedParentIds = new Set();
		expandedRoutineIds = new Set();
		routineItems = [...routines];
		skippedExpanded = false;
		newSubItemTexts = {};
		pendingPlace = null;
	});

	$effect(() => {
		if (editingItemId && editInputEl) {
			editInputEl.focus();
			editInputEl.select();
		}
	});

	// Derived counts — location items are context, not tasks
	const plannedItems = $derived(items.filter((i) => !i.skippedAt && !isLocationItem(i)));
	const done = $derived(plannedItems.filter((i) => i.checked).length);
	const total = $derived(plannedItems.length);
	const allDone = $derived(total > 0 && done === total);
	const pct = $derived(total > 0 ? done / total : 0);

	const topLevelItems = $derived(items.filter((i) => !i.parentId));
	const locationItems = $derived(topLevelItems.filter((i) => isLocationItem(i)));
	const listItems = $derived(topLevelItems.filter((i) => !isLocationItem(i)));

	// Timed groups (chronological, no reordering on check)
	const timedGroups = $derived(
		groupChecklistItems(
			sortByTime(listItems.filter((i) => !i.skippedAt && i.metadata?.timeHour !== undefined))
		)
	);

	// Untimed items with debounced reorder
	const untimedItems = $derived(
		listItems.filter((i) => !i.skippedAt && i.metadata?.timeHour === undefined)
	);
	let untimedOrderIds = $state<string[]>([]);
	let untimedOrderTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		const currentIds = untimedItems.map((i) => i.id);
		const knownSet = new Set(untimedOrderIds);
		const sameSet =
			currentIds.length === untimedOrderIds.length && currentIds.every((id) => knownSet.has(id));
		if (!sameSet) {
			if (untimedOrderTimer) { clearTimeout(untimedOrderTimer); untimedOrderTimer = null; }
			untimedOrderIds = sortByStatus(untimedItems).map((i) => i.id);
			return;
		}
		const desired = sortByStatus(untimedItems).map((i) => i.id);
		if (desired.join(',') === untimedOrderIds.join(',')) return;
		if (untimedOrderTimer) clearTimeout(untimedOrderTimer);
		untimedOrderTimer = setTimeout(() => {
			untimedOrderIds = sortByStatus(untimedItems).map((i) => i.id);
			untimedOrderTimer = null;
		}, 1000);
	});

	$effect(() => () => { if (untimedOrderTimer) clearTimeout(untimedOrderTimer); });

	const untimedGroups = $derived.by(() => {
		const byId = new Map(untimedItems.map((i) => [i.id, i]));
		const ordered: ChecklistItem[] = [];
		for (const id of untimedOrderIds) {
			const item = byId.get(id);
			if (item) ordered.push(item);
		}
		const known = new Set(untimedOrderIds);
		for (const item of untimedItems) if (!known.has(item.id)) ordered.push(item);
		return groupChecklistItems(ordered);
	});
	const skippedItems = $derived(listItems.filter((i) => !!i.skippedAt));
	const skippedGroups = $derived(groupChecklistItems(skippedItems));

	// Primary location drives weather
	const primaryLocation = $derived(locationItems[0] ?? null);
	const primaryLocationKey = $derived(
		primaryLocation
			? primaryLocation.metadata?.lat != null
				? `${primaryLocation.metadata.lat},${primaryLocation.metadata.lon}`
				: locationDisplayName(primaryLocation)
			: null
	);

	// Derived display values from helpers
	const calendarHref = $derived(buildCalendarHref(checklist.context));
	const isDayChecklist = $derived(isDayContext(checklist.context));
	const displayTitle = $derived(computeDisplayTitle(checklist.context, checklist.title));
	const dayContextDate = $derived(extractDayDate(checklist.context));
	const weekContextKey = $derived(extractWeekKey(checklist.context));
	const showEmoji = $derived(checklist.emoji && checklist.emoji !== '🗓️' && checklist.emoji !== '☑️');
	const payoffEmoji = $derived(showEmoji ? checklist.emoji : '');

	function navigateDay(offset: number) {
		const target = computeOffsetDate(checklist.context, offset);
		if (target && onNavigateDay) onNavigateDay(target);
	}

	// Weather
	let weatherPeriods = $state<WeatherPeriod[] | null>(null);
	let weatherCoordsKey = '';

	async function loadWeather(lat: number, lon: number) {
		const date = dayContextDate;
		const weekKey = weekContextKey;
		if (!date && !weekKey) return;

		const cached = api.readWeatherCache(lat, lon);
		if (cached) {
			weatherPeriods = date
				? buildPeriods(date, cached.timeseries)
				: buildWeekPeriods(weekKey!, cached.timeseries);
		}
		if (!cached || isCacheStale(cached)) {
			const freshTs = await api.fetchWeatherTimeseries(lat, lon);
			if (freshTs) {
				weatherPeriods = date
					? buildPeriods(date, freshTs)
					: buildWeekPeriods(weekKey!, freshTs);
			}
		}
	}

	$effect(() => {
		const loc = primaryLocation;
		const key = primaryLocationKey;
		if (!dayContextDate && !weekContextKey) return;
		const effectiveKey = key ?? '__device__';
		if (effectiveKey === weatherCoordsKey) return;
		weatherCoordsKey = effectiveKey;
		void (async () => {
			let coords: { lat: number; lon: number } | null = null;
			if (loc?.metadata?.lat != null && loc?.metadata?.lon != null) {
				coords = { lat: loc.metadata.lat, lon: loc.metadata.lon };
			} else if (loc) {
				const near = await api.getDeviceCoords();
				coords = await api.geocodePlace(locationDisplayName(loc), near);
			}
			if (!coords) coords = await api.getDeviceCoords();
			await loadWeather(coords.lat, coords.lon);
		})();
	});

	// Show payoff animation once when all done
	$effect(() => {
		if (allDone && !payoffDismissed && !showPayoff) {
			setTimeout(() => { showPayoff = true; }, 400);
		}
	});

	const ringColor = $derived(allDone ? '#5fa080' : '#7c8ef5');

	// ── Long press / context menu ────────────────────────────────────
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
		if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
	}

	// ── Item operations ──────────────────────────────────────────────
	async function toggleItem(item: ChecklistItem) {
		if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
		if (longPressTriggered) { longPressTriggered = false; return; }

		const newChecked = !item.checked;
		const previousItems = items;
		items = items.map((i) => i.id === item.id ? { ...i, checked: newChecked } : i);
		const ok = await api.patchItem(backingId, item.id, { checked: newChecked });
		if (!ok) { items = previousItems; return; }
		onChanged?.();
	}

	async function ensureBackingId(): Promise<string | null> {
		if (backingId) return backingId;
		const created = await api.createChecklist({
			title: checklist.title,
			emoji: checklist.emoji,
			context: checklist.context ?? undefined
		});
		if (!created) return null;
		backingId = created.id;
		onChanged?.();
		return created.id;
	}

	async function createItem(text: string, coords?: { lat: number; lon: number; label?: string }) {
		const id = await ensureBackingId();
		if (!id) return;
		const created = (await api.createItems(id, { text, sortOrder: items.length, coords })) as ChecklistItem[] | null;
		if (created) {
			items = [...items, ...created];
			onChanged?.();
		}
	}

	async function addItem() {
		const text = newItemText.trim();
		if (!text) return;

		const loc = parseLocationPrefix(text);
		const travel = loc ? null : parseTravelPrefix(text);
		const placeName = loc?.name ?? travel?.destination ?? null;

		newItemText = '';
		addingItem = true;
		try {
			if (placeName) {
				const near = await api.getDeviceCoords();
				const resolution = await api.resolvePlace(placeName, near);
				if (resolution.status === 'ambiguous') {
					pendingPlace = { text, placeName, candidates: resolution.candidates };
					return;
				}
				const coords =
					resolution.status === 'confident'
						? { lat: resolution.candidate.lat, lon: resolution.candidate.lon, label: resolution.candidate.label }
						: undefined;
				await createItem(text, coords);
			} else {
				await createItem(text);
			}
		} finally {
			addingItem = false;
		}
	}

	let pendingPlace = $state<{ text: string; placeName: string; candidates: GeoCandidate[] } | null>(null);

	async function confirmPlace(candidate: GeoCandidate) {
		const pending = pendingPlace;
		pendingPlace = null;
		if (!pending) return;
		addingItem = true;
		try {
			await createItem(pending.text, { lat: candidate.lat, lon: candidate.lon, label: candidate.label });
		} finally { addingItem = false; }
	}

	async function keepPlaceAsTyped() {
		const pending = pendingPlace;
		pendingPlace = null;
		if (!pending) return;
		addingItem = true;
		try { await createItem(pending.text); }
		finally { addingItem = false; }
	}

	async function deleteItem(itemId: string) {
		const previousItems = items;
		items = items.filter((i) => i.id !== itemId && i.parentId !== itemId);
		const ok = await api.deleteItem(backingId, itemId);
		if (!ok) { items = previousItems; return; }
		onChanged?.();
	}

	async function setItemSkipped(itemId: string, skipped: boolean) {
		const previousItems = items;
		items = items.map((i) =>
			i.id === itemId
				? { ...i, skippedAt: skipped ? new Date().toISOString() : null, snoozedToDate: skipped ? i.snoozedToDate : null, checked: skipped ? false : i.checked }
				: i
		);
		const ok = await api.patchItem(backingId, itemId, { skipped });
		if (!ok) { items = previousItems; return; }
		onChanged?.();
	}

	async function snoozeItem(itemId: string, targetDate: string) {
		const previousItems = items;
		items = items.map((i) =>
			i.id === itemId
				? { ...i, skippedAt: new Date().toISOString(), snoozedToDate: targetDate, checked: false }
				: i
		);
		const ok = await api.snoozeItem(backingId, itemId, targetDate);
		if (!ok) { items = previousItems; return; }
		onChanged?.();
	}

	async function handleBreakdownSave(subtasks: string[]) {
		if (!breakdownItem) return;
		const created = (await api.saveBreakdown({
			parentItemId: breakdownItem.id,
			subtasks,
			breakdownPrompt: breakdownItem.text
		})) as ChecklistItem[] | null;
		if (created) {
			items = [...items, ...created];
			breakdownItem = null;
			onChanged?.();
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
			const created = await api.addItems(backingId, text, items.length, parentId) as ChecklistItem[] | null;
			if (created) { items = [...items, ...created]; onChanged?.(); }
		} catch (err) { console.error('Error adding subitem:', err); }
	}

	function handleAddKey(e: KeyboardEvent) { if (e.key === 'Enter') addItem(); }

	function startEditing(item: ChecklistItem) {
		editingItemId = item.id;
		editingText = item.text;
	}

	function cancelEdit() { editingItemId = null; editingText = ''; }

	async function commitEdit() {
		if (!editingItemId) return;
		const itemId = editingItemId;
		const text = editingText.trim();
		editingItemId = null;
		editingText = '';
		if (!text) return;
		items = items.map(i => i.id === itemId ? { ...i, text } : i);
		await api.patchItem(backingId, itemId, { text });
		onChanged?.();
	}

	function handleItemLongpress(rect: DOMRect, item: ChecklistItemLike) {
		contextMenuItem = item as ChecklistItem;
		contextMenuRect = rect;
	}

	function handleItemToggle(item: ChecklistItemLike) { toggleItem(item as ChecklistItem); }

	function handleEditCommit(_item: ChecklistItemLike, newText: string) {
		editingText = newText;
		void commitEdit();
	}

	function handleAddChild(parentId: string, text: string) {
		newSubItemTexts = { ...newSubItemTexts, [parentId]: text };
		void addSubItem(parentId);
	}

	$effect(() => { editInputEl = activeEditInputRef; });

	function dismissPayoff() { showPayoff = false; payoffDismissed = true; }

	async function deleteChecklist() {
		if (backingId) await api.deleteChecklist(backingId);
		onDeleted?.();
		onclose();
	}
</script>

<!-- Snippet for one group -->
{#snippet renderGroup(group: GroupedChecklistEntry<ChecklistItem>)}
	{#if group.type === 'group'}
		<ChecklistGroupRow
			label={group.label}
			items={group.items}
			allItems={items}
			ontoggle={handleItemToggle}
			onlongpress={handleItemLongpress}
		/>
	{:else}
		<ChecklistItemRow
			item={group.item}
			allItems={items}
			{expandedParentIds}
			editing={editingItemId === group.item.id}
			bind:editText={editingText}
			bind:editInputRef={activeEditInputRef}
			ontoggle={handleItemToggle}
			onlongpress={handleItemLongpress}
			oneditcommit={handleEditCommit}
			oneditcancel={cancelEdit}
			onexpand={toggleParentExpansion}
			onaddchild={handleAddChild}
		/>
	{/if}
{/snippet}

<BottomSheet {onclose} ariaLabel={displayTitle}>
	<!-- Header + Progress -->
	<ChecklistSheetHeader
		emoji={showEmoji ? checklist.emoji : ''}
		{displayTitle}
		{done}
		{total}
		{pct}
		{ringColor}
		{weatherPeriods}
		{onclose}
		onshare={() => (shareSheetOpen = true)}
	/>

	<ShareSheet
		resourceType="checklist"
		resourceId={backingId}
		resourceTitle={checklist.title}
		open={shareSheetOpen}
		onClose={() => (shareSheetOpen = false)}
	/>

	<!-- Location context banner -->
	{#if locationItems.length > 0}
		<div class="cs-location-bar">
			{#each locationItems as loc (loc.id)}
				<button
					type="button"
					class="cs-location-chip"
					onpointerdown={(e) => handleItemPressStart(e, loc)}
					onpointerup={handleItemPressEnd}
					onpointercancel={handleItemPressEnd}
					onpointerleave={handleItemPressEnd}
					onclick={(e) => e.preventDefault()}
					title="Sted for dagen — langtrykk for valg"
				>
					<span class="cs-location-pin">📍</span>
					<span class="cs-location-name">{loc.metadata?.geoLabel ?? locationDisplayName(loc)}</span>
				</button>
			{/each}
		</div>
	{/if}

	<!-- Items list -->
	<div class="cs-items">
		{#each morningRoutines as routine (routine.checklistId)}
			<RoutineGroupRow
				{routine}
				expanded={expandedRoutineIds.has(routine.checklistId)}
				ontoggleexpand={() => toggleRoutineExpansion(routine.checklistId)}
				ontoggleitem={handleRoutineToggle}
			/>
		{/each}

		{#each timedGroups as group}
			{@render renderGroup(group)}
		{/each}

		{#if timedGroups.length > 0 && untimedGroups.length > 0}
			<div class="cs-divider" role="separator"></div>
		{/if}

		{#each untimedGroups as group}
			{@render renderGroup(group)}
		{/each}

		{#each otherRoutines as routine (routine.checklistId)}
			<RoutineGroupRow
				{routine}
				expanded={expandedRoutineIds.has(routine.checklistId)}
				ontoggleexpand={() => toggleRoutineExpansion(routine.checklistId)}
				ontoggleitem={handleRoutineToggle}
			/>
		{/each}

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
							{@render renderGroup(group)}
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Mention autocomplete for inline editing -->
	<MentionAutocomplete
		textareaEl={activeEditInputRef}
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
	<ChecklistSheetFooter
		{isDayChecklist}
		{calendarHref}
		hasNavigateDay={!!onNavigateDay}
		onNavigatePrev={() => navigateDay(-1)}
		onNavigateNext={() => navigateDay(1)}
		onDelete={deleteChecklist}
	/>
</BottomSheet>

<!-- Payoff overlay -->
{#if showPayoff}
	<ChecklistPayoff
		emoji={payoffEmoji}
		{displayTitle}
		ondismiss={dismissPayoff}
	/>
{/if}

<!-- Context menu (long press) -->
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
	onStartChat={onStartChat ? () => { if (contextMenuItem) onStartChat?.(contextMenuItem.text, backingId, contextMenuItem.id); } : undefined}
/>

<!-- Breakdown modal -->
{#if breakdownItem}
	<BreakdownModal
		itemTitle={breakdownItem.text}
		onClose={() => (breakdownItem = null)}
		onSave={handleBreakdownSave}
	/>
{/if}

<!-- Location picker for ambiguous geocoding -->
{#if pendingPlace}
	<LocationPickerModal
		placeName={pendingPlace.placeName}
		candidates={pendingPlace.candidates}
		onPick={confirmPlace}
		onKeepAsTyped={keepPlaceAsTyped}
		onClose={keepPlaceAsTyped}
	/>
{/if}

<style>
	/* Location context banner */
	.cs-location-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 10px 20px 0;
		flex-shrink: 0;
	}

	.cs-location-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: rgba(95, 160, 128, 0.12);
		border: 1px solid rgba(95, 160, 128, 0.3);
		border-radius: 999px;
		padding: 5px 12px 5px 10px;
		cursor: pointer;
		font: inherit;
		color: #9fd9bd;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		transition: border-color 0.12s, background 0.12s;
	}
	.cs-location-chip:hover {
		border-color: rgba(95, 160, 128, 0.55);
		background: rgba(95, 160, 128, 0.18);
	}

	.cs-location-pin { font-size: 0.85rem; line-height: 1; }
	.cs-location-name { font-size: 0.82rem; font-weight: 600; letter-spacing: -0.01em; }

	/* Items list */
	.cs-items {
		flex: 1;
		overflow-y: auto;
		padding: 16px 20px 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		-webkit-overflow-scrolling: touch;
	}

	.cs-divider {
		height: 1px;
		background: #1e1e1e;
		margin: 6px 12px;
		flex-shrink: 0;
	}

	/* Skipped section */
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
	.cs-skipped-caret.cs-caret-expanded { transform: rotate(90deg); }

	.cs-skipped-label { flex: 1; }
	.cs-skipped-count { color: #555; font-variant-numeric: tabular-nums; }

	.cs-skipped-items {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	/* Add row */
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
</style>
