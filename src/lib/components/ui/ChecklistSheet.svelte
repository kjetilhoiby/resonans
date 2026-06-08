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
	import { groupChecklistItems, activityEmoji, sortByStatus, sortByTime, formatItemTime, stripTimeFromText, isLocationItem, locationDisplayName, getTravelMode, travelModeIcon, parseLocationPrefix, parseTravelPrefix, type GroupedChecklistEntry } from '$lib/utils/checklist-group';
	import { patchItem, deleteItem as apiDeleteItem, addItems } from '$lib/utils/checklist-api';
	import WeatherStrip, { type WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BreakdownModal from '$lib/components/ui/BreakdownModal.svelte';
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import MentionAutocomplete from '$lib/components/ui/MentionAutocomplete.svelte';
	import ShareSheet from '$lib/components/domain/share/ShareSheet.svelte';
	import LocationPickerModal from '$lib/components/ui/LocationPickerModal.svelte';
	import type { ChecklistItemLike } from '$lib/types/checklist';
	import ChecklistItemRow from '$lib/components/ui/ChecklistItemRow.svelte';
	import ChecklistGroupRow from '$lib/components/ui/ChecklistGroupRow.svelte';
	import { readCacheEntry, isCacheStale, fetchRawTimeseries, buildPeriods, buildWeekPeriods } from '$lib/utils/weather';
	import { resolvePlace, geocodePlace, type GeoCandidate } from '$lib/utils/geocode';

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
	// Faktisk DB-id. For en tom dag (virtuell sjekkliste) er `checklist.id` ''
	// inntil første punkt legges til — da opprettes lista og `backingId` settes.
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

	// Når `checklist`-propen byttes (dag-navigasjon prev/neste) må vi re-synce
	// den lokale `items`-staten og nullstille forbigående UI. Uten dette beholdt
	// arket forrige dags oppgaver selv om tittelen viste riktig dag. Vi nøkler på
	// context (unik per dag) fordi tomme dager deler den samme tomme id-en ''.
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

	// Strøkne ("gjør ikke") og sted-kontekst («Sted: X») teller hverken som
	// planlagt eller løst — sted-punkt er dag-kontekst, ikke en avkryssbar rad.
	const plannedItems = $derived(items.filter((i) => !i.skippedAt && !isLocationItem(i)));
	const done = $derived(plannedItems.filter((i) => i.checked).length);
	const total = $derived(plannedItems.length);
	const allDone = $derived(total > 0 && done === total);
	const pct = $derived(total > 0 ? done / total : 0);

	// Sted-punkter vises som dag-kontekst (banner øverst), ikke som liste-rader.
	const topLevelItems = $derived(items.filter((i) => !i.parentId));
	const locationItems = $derived(topLevelItems.filter((i) => isLocationItem(i)));
	const listItems = $derived(topLevelItems.filter((i) => !isLocationItem(i)));

	// Resten delt i tre seksjoner: tidfestede (kun kronologisk — avkryssede
	// blir stående der de er, så listen ikke hopper når noe gjøres), øvrige
	// (sortert på status, med debounce på omsorteringen), og strøkne.
	const timedGroups = $derived(
		groupChecklistItems(
			sortByTime(listItems.filter((i) => !i.skippedAt && i.metadata?.timeHour !== undefined))
		)
	);

	// Utidfestede punkter sorteres på status (åpne → avkryssede), men selve
	// omsorteringen debounces ~1s: når man krysser av flere på rad skal ikke
	// radene hoppe nedover umiddelbart. Vi debouncer *rekkefølgen* (en liste av
	// ids), ikke punktene — så avkryssingen vises live, men posisjonen følger
	// den utsatte rekkefølgen.
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
		// Endret sett (lagt til / fjernet punkt) → oppdater rekkefølgen med en gang.
		if (!sameSet) {
			if (untimedOrderTimer) {
				clearTimeout(untimedOrderTimer);
				untimedOrderTimer = null;
			}
			untimedOrderIds = sortByStatus(untimedItems).map((i) => i.id);
			return;
		}
		// Samme sett, men status kan ha endret rekkefølgen → debounce omsorteringen.
		const desired = sortByStatus(untimedItems).map((i) => i.id);
		if (desired.join(',') === untimedOrderIds.join(',')) return; // allerede riktig
		if (untimedOrderTimer) clearTimeout(untimedOrderTimer);
		untimedOrderTimer = setTimeout(() => {
			untimedOrderIds = sortByStatus(untimedItems).map((i) => i.id);
			untimedOrderTimer = null;
		}, 1000);
	});

	$effect(() => () => {
		if (untimedOrderTimer) clearTimeout(untimedOrderTimer);
	});

	const untimedGroups = $derived.by(() => {
		const byId = new Map(untimedItems.map((i) => [i.id, i]));
		const ordered: ChecklistItem[] = [];
		for (const id of untimedOrderIds) {
			const item = byId.get(id);
			if (item) ordered.push(item);
		}
		// Sikkerhetsnett: punkter som ikke er i rekkefølgen ennå legges bakerst.
		const known = new Set(untimedOrderIds);
		for (const item of untimedItems) if (!known.has(item.id)) ordered.push(item);
		return groupChecklistItems(ordered);
	});
	const skippedItems = $derived(listItems.filter((i) => !!i.skippedAt));
	const skippedGroups = $derived(groupChecklistItems(skippedItems));

	// Primært sted for dagen (driver værmelding + vises i banner).
	const primaryLocation = $derived(locationItems[0] ?? null);
	// Nøkkel som endrer seg når stedet (pinnet koordinat eller navn) endres.
	const primaryLocationKey = $derived(
		primaryLocation
			? primaryLocation.metadata?.lat != null
				? `${primaryLocation.metadata.lat},${primaryLocation.metadata.lon}`
				: locationDisplayName(primaryLocation)
			: null
	);
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
	let weatherCoordsKey = '';

	function getDeviceCoords(): Promise<{ lat: number; lon: number }> {
		return new Promise((resolve) => {
			if (!navigator.geolocation) return resolve({ lat: 59.9139, lon: 10.7522 });
			navigator.geolocation.getCurrentPosition(
				(pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
				() => resolve({ lat: 59.9139, lon: 10.7522 }),
				{ timeout: 4000, maximumAge: 300_000 }
			);
		});
	}

	async function loadWeather(lat: number, lon: number) {
		const date = dayContextDate;
		const weekKey = weekContextKey;
		if (!date && !weekKey) return;

		// 1. Vis fra cache umiddelbart (stale-while-revalidate)
		const cached = readCacheEntry(lat, lon);
		if (cached) {
			weatherPeriods = date
				? buildPeriods(date, cached.timeseries)
				: buildWeekPeriods(weekKey!, cached.timeseries);
		}
		// 2. Revalider hvis cache mangler eller er gammel
		if (!cached || isCacheStale(cached)) {
			const freshTs = await fetchRawTimeseries(lat, lon);
			if (freshTs) {
				weatherPeriods = date
					? buildPeriods(date, freshTs)
					: buildWeekPeriods(weekKey!, freshTs);
			}
		}
	}

	// Vær for dagens sted hvis et «Sted:»-punkt finnes, ellers enhetens posisjon
	// (fallback Oslo). Bruker pinnet koordinat når det finnes (ingen re-geokoding),
	// ellers geokoder vi navnet biaset mot posisjonen. Reagerer på endringer.
	$effect(() => {
		const loc = primaryLocation; // reaktiv avhengighet
		const key = primaryLocationKey; // reaktiv avhengighet
		if (!dayContextDate && !weekContextKey) return;
		const effectiveKey = key ?? '__device__';
		if (effectiveKey === weatherCoordsKey) return;
		weatherCoordsKey = effectiveKey;
		void (async () => {
			let coords: { lat: number; lon: number } | null = null;
			if (loc?.metadata?.lat != null && loc?.metadata?.lon != null) {
				coords = { lat: loc.metadata.lat, lon: loc.metadata.lon };
			} else if (loc) {
				const near = await getDeviceCoords();
				coords = await geocodePlace(locationDisplayName(loc), near);
			}
			if (!coords) coords = await getDeviceCoords();
			await loadWeather(coords.lat, coords.lon);
		})();
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
		const previousItems = items;
		items = items.map((i) =>
			i.id === item.id ? { ...i, checked: newChecked } : i
		);

		const ok = await patchItem(backingId, item.id, { checked: newChecked });
		if (!ok) {
			items = previousItems;
			return;
		}

		onChanged?.();
	}

	// Sørger for at lista finnes i DB. For en tom dag (virtuell liste) opprettes
	// den her ved første punkt. Returnerer null hvis opprettelsen feiler.
	async function ensureBackingId(): Promise<string | null> {
		if (backingId) return backingId;
		const res = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: checklist.title,
				emoji: checklist.emoji,
				context: checklist.context ?? undefined
			})
		});
		if (!res.ok) return null;
		const created = (await res.json()) as { id: string };
		backingId = created.id;
		onChanged?.();
		return created.id;
	}

	async function createItem(text: string, coords?: { lat: number; lon: number; label?: string }) {
		const id = await ensureBackingId();
		if (!id) return;
		const res = await fetch(`/api/checklists/${id}/items`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text, sortOrder: items.length, ...(coords && { coords }) })
		});
		if (res.ok) {
			const created = await res.json() as ChecklistItem[];
			items = [...items, ...created];
			onChanged?.();
		}
	}

	async function addItem() {
		const text = newItemText.trim();
		if (!text) return;

		// Sted/reise: geokod stedsnavnet og pinn koordinat. Ved tvetydighet
		// (flere plausible treff) ber vi brukeren velge før vi oppretter.
		const loc = parseLocationPrefix(text);
		const travel = loc ? null : parseTravelPrefix(text);
		const placeName = loc?.name ?? travel?.destination ?? null;

		newItemText = '';
		addingItem = true;
		try {
			if (placeName) {
				const near = await getDeviceCoords();
				const resolution = await resolvePlace(placeName, near);
				if (resolution.status === 'ambiguous') {
					pendingPlace = { text, placeName, candidates: resolution.candidates };
					return; // opprettelse skjer når brukeren velger i modalen
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

	// Bekreftelse av tvetydig sted
	let pendingPlace = $state<{ text: string; placeName: string; candidates: GeoCandidate[] } | null>(null);

	async function confirmPlace(candidate: GeoCandidate) {
		const pending = pendingPlace;
		pendingPlace = null;
		if (!pending) return;
		addingItem = true;
		try {
			await createItem(pending.text, { lat: candidate.lat, lon: candidate.lon, label: candidate.label });
		} finally {
			addingItem = false;
		}
	}

	async function keepPlaceAsTyped() {
		const pending = pendingPlace;
		pendingPlace = null;
		if (!pending) return;
		addingItem = true;
		try {
			await createItem(pending.text);
		} finally {
			addingItem = false;
		}
	}

	async function deleteItem(itemId: string) {
		const previousItems = items;
		items = items.filter((i) => i.id !== itemId && i.parentId !== itemId);
		const ok = await apiDeleteItem(backingId, itemId);
		if (!ok) {
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
		const ok = await patchItem(backingId, itemId, { skipped });
		if (!ok) {
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
		const res = await fetch(`/api/checklists/${backingId}/items/${itemId}/snooze`, {
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
			const created = await addItems(backingId, text, items.length, parentId) as ChecklistItem[] | null;
			if (created) {
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
		await patchItem(backingId, itemId, { text });
		onChanged?.();
	}

	function handleItemLongpress(rect: DOMRect, item: ChecklistItemLike) {
		contextMenuItem = item as ChecklistItem;
		contextMenuRect = rect;
	}

	function handleItemToggle(item: ChecklistItemLike) {
		toggleItem(item as ChecklistItem);
	}

	function handleEditCommit(_item: ChecklistItemLike, newText: string) {
		editingText = newText;
		void commitEdit();
	}

	function handleAddChild(parentId: string, text: string) {
		newSubItemTexts = { ...newSubItemTexts, [parentId]: text };
		void addSubItem(parentId);
	}

	$effect(() => {
		editInputEl = activeEditInputRef;
	});

	function dismissPayoff() {
		showPayoff = false;
		payoffDismissed = true;
	}

	async function deleteChecklist() {
		// Virtuell tom dag (ikke lagret) — bare lukk, ingenting å slette.
		if (backingId) await fetch(`/api/checklists/${backingId}`, { method: 'DELETE' });
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
		resourceId={backingId}
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

	<!-- Sted-kontekst for dagen: «Sted: X» blir et banner (driver værmelding for stedet),
	     ikke en avkryssbar rad. Langtrykk gir kontekstmeny (slett/rediger). -->
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

	<!-- Snippet for én gruppe (enten en slot-rad med gjentakelser eller et enkelt punkt). -->
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

	<!-- Items list -->
	<div class="cs-items">
		{#each timedGroups as group}
			{@render renderGroup(group)}
		{/each}

		{#if timedGroups.length > 0 && untimedGroups.length > 0}
			<div class="cs-divider" role="separator"></div>
		{/if}

		{#each untimedGroups as group}
			{@render renderGroup(group)}
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

<!-- Velg sted ved tvetydig geokoding -->
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

	/* ── Sted-kontekst-banner for dagen ── */
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

	.cs-location-pin {
		font-size: 0.85rem;
		line-height: 1;
	}

	.cs-location-name {
		font-size: 0.82rem;
		font-weight: 600;
		letter-spacing: -0.01em;
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


</style>
