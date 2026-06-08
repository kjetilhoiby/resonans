<script lang="ts">
	import { tick } from 'svelte';
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { AppPage, ChipStrip, PullToRefresh } from '$lib/components/ui';
	import ScreenTitle from '$lib/components/ui/ScreenTitle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import type { FlowContext } from '$lib/flows/types';
	import { finishNavMetric, startNavMetric } from '$lib/client/nav-metrics';
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import BreakdownModal from '$lib/components/ui/BreakdownModal.svelte';
	import { patchItem } from '$lib/utils/checklist-api';
	import { onMount } from 'svelte';

	import WeekNote from '$lib/components/domain/ukeplan/WeekNote.svelte';
	import WeekTasks from '$lib/components/domain/ukeplan/WeekTasks.svelte';
	import DaySection from '$lib/components/domain/ukeplan/DaySection.svelte';
	import WeekGoals from '$lib/components/domain/ukeplan/WeekGoals.svelte';
	import AutoCheckModal from '$lib/components/domain/ukeplan/AutoCheckModal.svelte';
	import { fetchTripWeather, fetchHomeWeather, type DayWeatherEntry, type DayWeatherSummary } from '$lib/components/domain/ukeplan/weather';
	import { buildWeekPlanFlowContext } from '$lib/components/domain/ukeplan/week-plan-context';
	import type { AutoCheckPrompt } from '$lib/components/domain/ukeplan/autocheck';
	import type {
		SaveState, WeekInfo, ChecklistItem, WeekChecklist, WeekTask, GoalReminder,
		DayChecklist, EditingItem, DayRoutine, ActiveTrip, SpondEvent
	} from '$lib/components/domain/ukeplan/types';
	import {
		createChecklistItem as _createItem,
		toggleChecklistItem as _toggleItem,
		saveEditedItem as _saveEdited,
		deleteChecklistItem as _deleteItem,
		reorderChecklistItems as _reorderItems,
		setItemSkipped as _setSkipped,
		snoozeItem as _snooze,
		addChildItem as _addChild,
		appendChecklistItems,
		setChecklistCompleted,
		handleBreakdownSave as _breakdownSave,
		confirmAutoCheck as _confirmAutoCheck,
		type MutationDeps
	} from '$lib/components/domain/ukeplan/checklist-mutations';

	interface Props {
		data: {
			week: WeekInfo;
			weekNav: { previousWeekKey: string; nextWeekKey: string; isCurrentWeek: boolean };
			weekChecklist: WeekChecklist | null;
			weekTasks: WeekTask[];
			weekNote: string;
			reflection: string;
			vision: string;
			longTermGoals: GoalReminder[];
			dayChecklists: Record<string, DayChecklist>;
			dayRoutines: Record<string, DayRoutine[]>;
			dayNotes: Record<string, string>;
			dayHeadlines: Record<string, string>;
			activeTrips: ActiveTrip[];
			spondEventsByDay: Record<string, SpondEvent[]>;
			previousWeekSummary: {
				weekKey: string; note: string; reflection: string;
				carryoverItems: string[]; incompleteTasks: string[];
			};
		};
	}

	// ── Utility functions ──

	function toLocalIsoDate(date: Date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function getIsoWeekDashedFromIsoDate(isoDate: string) {
		const [yearRaw, monthRaw, dayRaw] = isoDate.split('-');
		const year = Number.parseInt(yearRaw ?? '', 10);
		const month = Number.parseInt(monthRaw ?? '', 10);
		const day = Number.parseInt(dayRaw ?? '', 10);
		if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
			return data.week.dashedKey;
		}
		const d = new Date(Date.UTC(year, month - 1, day));
		const dayNum = d.getUTCDay() || 7;
		d.setUTCDate(d.getUTCDate() + 4 - dayNum);
		const isoYear = d.getUTCFullYear();
		const yearStart = new Date(Date.UTC(isoYear, 0, 1));
		const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
		const week = String(weekNo).padStart(2, '0');
		return `${isoYear}-W${week}`;
	}

	function addDaysIsoDate(isoDate: string, days: number) {
		const date = new Date(`${isoDate}T00:00:00.000Z`);
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	}

	// ── Props & initial state ──

	let { data }: Props = $props();
	const todayIso = toLocalIsoDate(new Date());

	const dayFromQuery = typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).get('day')
		: null;
	const nudgeTrackFromQuery = typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).get('nudgeTrack')
		: null;
	const nudgeEventIdFromQuery = typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).get('nudgeEventId')
		: null;
	const selectedDefault = data.week.days.some((d) => d.isoDate === dayFromQuery)
		? (dayFromQuery as string)
		: (data.week.days.some((d) => d.isoDate === todayIso) ? todayIso : data.week.days[0].isoDate);

	let selectedDayIso = $state(selectedDefault);
	let weekChecklistState = $state<WeekChecklist | null>(data.weekChecklist ? structuredClone(data.weekChecklist) : null);
	let dayChecklistsState = $state<Record<string, DayChecklist>>(structuredClone(data.dayChecklists));
	let weekNoteValue = $state(data.weekNote);
	let reflectionValue = $state(data.reflection);
	let visionValue = $state(data.vision);
	let dayHeadlinesState = $state<Record<string, string>>(structuredClone(data.dayHeadlines));
	let dayRoutinesState = $state<Record<string, DayRoutine[]>>(structuredClone(data.dayRoutines ?? {}));

	// ── Navigation sync ──

	let loadedWeekKey = data.week.compactKey;
	afterNavigate(({ type }) => {
		if (type === 'enter') return;
		const dayParam = typeof window !== 'undefined'
			? new URLSearchParams(window.location.search).get('day')
			: null;
		selectedDayIso = data.week.days.some((d) => d.isoDate === dayParam)
			? (dayParam as string)
			: (data.week.days.some((d) => d.isoDate === todayIso) ? todayIso : data.week.days[0].isoDate);
		if (data.week.compactKey === loadedWeekKey) return;
		loadedWeekKey = data.week.compactKey;
		weekChecklistState = data.weekChecklist ? structuredClone(data.weekChecklist) : null;
		dayChecklistsState = structuredClone(data.dayChecklists);
		dayRoutinesState = structuredClone(data.dayRoutines ?? {});
		weekNoteValue = data.weekNote;
		reflectionValue = data.reflection;
		visionValue = data.vision;
		dayHeadlinesState = { ...data.dayHeadlines };
	});

	// ── Planning / flow state ──

	let planningImportBusy = $state(false);
	let dayCloseBusy = $state(false);
	let dayCloseMessage = $state('');
	let dayPlanSheetOpen = $state(false);
	let dayPlanSheetBusy = $state(false);
	let dayPlanSheetCarryovers = $state<string[]>([]);
	let dayPlanSheetWeekTasks = $state<string[]>([]);
	let nudgeFlowStarted = $state(false);
	let nudgeFlowCompleted = $state(false);
	let dayCloseFlowOpen = $state(false);
	let dayCloseDecisions = $state<Record<string, 'carryover' | 'unsolved'>>({});
	let weekPlanFlowOpen = $state(false);
	let weekPlanFlowContext = $state<FlowContext>({});
	let openingWeekPlanFlow = $state(false);
	let weekPlanJustCompleted = $state(false);
	let foodChatOpen = $state(false);
	let foodChatItemText = $state('');

	// ── Editing / context menu / auto-check state ──

	let editingItem = $state<EditingItem | null>(null);
	let breakdownTarget = $state<{ checklistId: string; item: ChecklistItem } | null>(null);
	let expandedDayParentIds = $state<Set<string>>(new Set());
	let expandedWeekParentIds = $state<Set<string>>(new Set());
	let expandedRoutineIds = $state<Set<string>>(new Set());
	let contextMenuItem = $state<{ checklistId: string; item: ChecklistItem } | null>(null);
	let contextMenuRect = $state<DOMRect | null>(null);
	let autoCheckPrompt = $state<AutoCheckPrompt | null>(null);
	let autoCheckBusy = $state(false);

	// ── Save states ──

	let saveStates = $state<Record<string, SaveState>>({
		weekNote: 'idle', weekItems: 'idle', dayItems: 'idle', dayNote: 'idle', weekReview: 'idle'
	});
	let weekPickerInput = $state<HTMLInputElement | null>(null);

	// ── Derived values ──

	const selectedDayChecklist = $derived(dayChecklistsState[selectedDayIso] ?? null);
	const hasOpenDayItems = $derived(selectedDayChecklist ? selectedDayChecklist.items.some((i) => !i.checked) : false);
	const hasCarryovers = $derived(data.previousWeekSummary.carryoverItems.length > 0 || data.previousWeekSummary.incompleteTasks.length > 0);
	const weekIsPlanned = $derived(!!data.weekNote || (weekChecklistState?.items.length ?? 0) > 0);
	const dayIsPlanned = $derived(!!(dayHeadlinesState[selectedDayIso] ?? ''));
	const showPlanWeek = $derived(!weekIsPlanned);
	const showPlanDay = $derived(!dayIsPlanned);
	const _now = new Date();
	const _isAfter18 = _now.getHours() >= 18;
	const showCloseDay = $derived(_isAfter18 && hasOpenDayItems);
	const nudgeTrack = nudgeTrackFromQuery;
	const nudgeEventId = nudgeEventIdFromQuery;

	$effect(() => { dayHeadlinesState = { ...data.dayHeadlines }; });

	// ── Weather ──

	let tripDayWeather = $state<Record<string, DayWeatherEntry>>({});
	let homeDayWeather = $state<Record<string, DayWeatherSummary>>({});
	const tripDayEmoji = $derived.by(() => {
		const map: Record<string, string> = {};
		for (const trip of data.activeTrips) {
			for (const day of data.week.days) {
				if (day.isoDate >= trip.startDate && day.isoDate <= trip.endDate) {
					map[day.isoDate] = trip.emoji ?? '🗺️';
				}
			}
		}
		return map;
	});

	onMount(async () => {
		finishNavMetric('ukeplan');
		tripDayWeather = await fetchTripWeather({ weekDays: data.week.days, activeTrips: data.activeTrips });
		homeDayWeather = await fetchHomeWeather(data.week.days);
	});

	// ── Mutation deps (wire into checklist-mutations) ──

	function setSaveState(key: string, state: SaveState) {
		saveStates = { ...saveStates, [key]: state };
	}
	function flashSaved(key: string) {
		setSaveState(key, 'saved');
		setTimeout(() => { if (saveStates[key] === 'saved') setSaveState(key, 'idle'); }, 1400);
	}
	function saveKeyForChecklist(checklistId: string) {
		return weekChecklistState?.id === checklistId ? 'weekItems' : 'dayItems';
	}
	function updateChecklistById(checklistId: string, updater: (cl: DayChecklist | WeekChecklist) => DayChecklist | WeekChecklist) {
		if (weekChecklistState?.id === checklistId) { weekChecklistState = updater(weekChecklistState) as WeekChecklist; return; }
		for (const [key, cl] of Object.entries(dayChecklistsState)) {
			if (cl.id !== checklistId) continue;
			dayChecklistsState = { ...dayChecklistsState, [key]: updater(cl) as DayChecklist };
			return;
		}
	}
	function getChecklistById(checklistId: string) {
		if (weekChecklistState?.id === checklistId) return weekChecklistState;
		for (const cl of Object.values(dayChecklistsState)) { if (cl.id === checklistId) return cl; }
		return null;
	}

	const deps: MutationDeps = { setSaveState, flashSaved, updateChecklistById, getChecklistById, saveKeyForChecklist };

	// ── Bound mutation callbacks ──

	async function createChecklistItem(checklistId: string, text: string, count: number) {
		const prompt = await _createItem(deps, checklistId, text, count, weekChecklistState?.id ?? null);
		if (prompt) autoCheckPrompt = prompt;
	}
	async function toggleChecklistItem(cid: string, iid: string, checked: boolean) { await _toggleItem(deps, cid, iid, checked); }
	async function deleteChecklistItem(cid: string, iid: string) { editingItem = null; await _deleteItem(deps, cid, iid); }
	async function reorderChecklistItems(cid: string, src: string, tgt: string) { await _reorderItems(deps, cid, src, tgt); }
	async function saveEditedItem(item: EditingItem) { await _saveEdited(deps, item, deleteChecklistItem); editingItem = null; }
	async function startEditing(checklistId: string, item: ChecklistItem) {
		if (!checklistId || !item) { editingItem = null; return; }
		editingItem = { checklistId, itemId: item.id, text: item.text };
		await tick();
	}
	function handleContextMenuOpen(checklistId: string, item: ChecklistItem, rect: DOMRect) {
		contextMenuItem = { checklistId, item }; contextMenuRect = rect;
	}
	async function handleRoutineItemToggle(checklistId: string, itemId: string, newChecked: boolean) {
		dayRoutinesState = { ...dayRoutinesState, [selectedDayIso]: (dayRoutinesState[selectedDayIso] ?? []).map(r =>
			r.checklistId === checklistId ? { ...r, items: r.items.map(i => i.id === itemId ? { ...i, checked: newChecked } : i) } : r
		)};
		const ok = await patchItem(checklistId, itemId, { checked: newChecked });
		if (!ok) {
			dayRoutinesState = { ...dayRoutinesState, [selectedDayIso]: (dayRoutinesState[selectedDayIso] ?? []).map(r =>
				r.checklistId === checklistId ? { ...r, items: r.items.map(i => i.id === itemId ? { ...i, checked: !newChecked } : i) } : r
			)};
		}
	}
	function toggleDayParentExpansion(id: string) { const n = new Set(expandedDayParentIds); n.has(id) ? n.delete(id) : n.add(id); expandedDayParentIds = n; }
	function toggleWeekParentExpansion(id: string) { const n = new Set(expandedWeekParentIds); n.has(id) ? n.delete(id) : n.add(id); expandedWeekParentIds = n; }
	function toggleRoutineExpansion(id: string) { const n = new Set(expandedRoutineIds); n.has(id) ? n.delete(id) : n.add(id); expandedRoutineIds = n; }

	// ── Nudge reporting ──

	async function reportNudgeStage(stage: 'flow_started' | 'flow_completed') {
		if (!nudgeEventId) return;
		if (stage === 'flow_started' && nudgeFlowStarted) return;
		if (stage === 'flow_completed' && nudgeFlowCompleted) return;
		try {
			await fetch(`/api/nudges/events/${nudgeEventId}/stage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage }) });
			if (stage === 'flow_started') nudgeFlowStarted = true;
			if (stage === 'flow_completed') nudgeFlowCompleted = true;
		} catch { /* best effort */ }
	}

	// ── Day/week selection ──

	function setSelectedDay(dayIso: string) {
		selectedDayIso = dayIso;
		dayPlanSheetOpen = false;
		if (typeof window !== 'undefined') {
			const params = new URLSearchParams(window.location.search);
			params.set('day', dayIso);
			window.history.replaceState(window.history.state, '', `${window.location.pathname}?${params.toString()}`);
		}
	}
	function weekHref(weekKey: string) { return `/ukeplan?week=${weekKey}`; }
	function smartDayLabel(isoDate: string): string {
		if (isoDate === todayIso) return 'I dag';
		const raw = new Intl.DateTimeFormat('nb-NO', { weekday: 'short' }).format(new Date(isoDate + 'T12:00:00'));
		const clean = raw.replace('.', '');
		return clean.charAt(0).toUpperCase() + clean.slice(1);
	}

	// ── Ensure day checklist ──

	async function ensureDayChecklist(dayIso: string) {
		const existing = dayChecklistsState[dayIso];
		if (existing) return existing;
		const weekKey = getIsoWeekDashedFromIsoDate(dayIso);
		const response = await fetch('/api/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Dag ${dayIso}`, emoji: '☑️', context: `week:${weekKey}:day:${dayIso}` }) });
		if (!response.ok) return null;
		const created = await response.json() as DayChecklist;
		dayChecklistsState = { ...dayChecklistsState, [dayIso]: { id: created.id, title: created.title, completedAt: created.completedAt, items: created.items ?? [] } };
		return dayChecklistsState[dayIso];
	}

	// ── Day headline save ──

	async function saveDayHeadline() {
		const headline = dayHeadlinesState[selectedDayIso] ?? '';
		setSaveState('dayNote', 'saving');
		const form = new FormData();
		form.set('weekKey', data.week.dashedKey); form.set('dayIso', selectedDayIso); form.set('headline', headline);
		const response = await fetch('?/saveDayHeadline', { method: 'POST', body: form });
		if (!response.ok) { setSaveState('dayNote', 'idle'); return; }
		flashSaved('dayNote');
	}
	function updateDayHeadline(dayIso: string, value: string) { dayHeadlinesState = { ...dayHeadlinesState, [dayIso]: value }; }

	// ── Day close ──

	function openDayCloseFlow() {
		if (!selectedDayChecklist) return;
		const decisions: Record<string, 'carryover' | 'unsolved'> = {};
		for (const item of selectedDayChecklist.items.filter((i) => !i.checked)) decisions[item.id] = 'unsolved';
		dayCloseDecisions = decisions;
		dayCloseFlowOpen = true;
	}

	async function applyDayCloseFlow(andPlanNext = false) {
		if (!selectedDayChecklist || dayCloseBusy) return;
		if (nudgeTrack === 'close_day') await reportNudgeStage('flow_started');
		dayCloseBusy = true; dayCloseFlowOpen = false; dayCloseMessage = '';
		const openItems = selectedDayChecklist.items.filter((i) => !i.checked);
		const carryItems = openItems.filter((i) => dayCloseDecisions[i.id] === 'carryover');
		if (carryItems.length > 0) {
			const nextDayIso = addDaysIsoDate(selectedDayIso, 1);
			const target = await ensureDayChecklist(nextDayIso);
			if (target) {
				const existing = new Set((target.items ?? []).map((i) => i.text.trim().toLowerCase()));
				const toCarry = carryItems.map((i) => i.text.trim()).filter((t) => t.length > 0 && !existing.has(t.toLowerCase()));
				if (toCarry.length > 0) await appendChecklistItems(deps, target.id, toCarry);
			}
		}
		const closed = await setChecklistCompleted(deps, selectedDayChecklist.id, true);
		dayCloseBusy = false;
		if (!closed) { dayCloseMessage = 'Kunne ikke avslutte dagen.'; return; }
		dayCloseMessage = carryItems.length > 0 ? `Dag avsluttet. ${carryItems.length} punkt tatt med til neste dag.` : 'Dag avsluttet.';
		flashSaved('dayItems');
		if (nudgeTrack === 'close_day') await reportNudgeStage('flow_completed');
		if (andPlanNext) { const nextDayIso = addDaysIsoDate(selectedDayIso, 1); setSelectedDay(nextDayIso); await tick(); await openDayPlanSheet(); }
	}

	// ── Day plan sheet ──

	async function openDayPlanSheet() {
		if (dayPlanSheetBusy) return;
		if (nudgeTrack === 'plan_day') await reportNudgeStage('flow_started');
		dayPlanSheetBusy = true;
		const prevDayIso = addDaysIsoDate(selectedDayIso, -1);
		const prevWeekKey = getIsoWeekDashedFromIsoDate(prevDayIso);
		const res = await fetch(`/api/checklists?contexts=${encodeURIComponent(`week:${prevWeekKey}:day:${prevDayIso}`)}`);
		const prev = res.ok ? ((await res.json()) as DayChecklist[])[0] ?? null : null;
		dayPlanSheetCarryovers = (prev?.items ?? []).filter((i) => !i.checked).map((i) => i.text.trim()).filter((t) => t.length > 0);
		dayPlanSheetWeekTasks = data.weekTasks.filter((t) => t.completedCount < t.repeatCount).map((t) => t.title.trim()).filter((t) => t.length > 0);
		dayPlanSheetBusy = false; dayPlanSheetOpen = true;
	}

	// ── Week plan flow ──

	async function openWeekPlanFlow() {
		openingWeekPlanFlow = true;
		try {
			const ctx = await buildWeekPlanFlowContext(data.week.dashedKey, data.longTermGoals);
			if (!ctx) return;
			weekPlanFlowContext = ctx; weekPlanFlowOpen = true;
		} finally { openingWeekPlanFlow = false; }
	}

	// ── Import from previous week ──

	async function ensureWeekChecklist() {
		if (weekChecklistState) return weekChecklistState;
		const response = await fetch('/api/checklists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `Uke ${data.week.week}`, emoji: '🗓️', context: data.week.contextKey }) });
		if (!response.ok) return null;
		const created = await response.json() as WeekChecklist;
		weekChecklistState = { id: created.id, title: created.title, emoji: created.emoji, completedAt: created.completedAt, items: created.items ?? [] };
		return weekChecklistState;
	}

	async function importFromPreviousWeek() {
		const suggestions = [...data.previousWeekSummary.carryoverItems, ...data.previousWeekSummary.incompleteTasks].map((t) => t.trim()).filter((t) => t.length > 0);
		if (suggestions.length === 0) return;
		const checklist = await ensureWeekChecklist();
		if (!checklist) return;
		planningImportBusy = true;
		const existing = new Set((checklist.items ?? []).map((i) => i.text.trim().toLowerCase()));
		for (const text of suggestions) { if (existing.has(text.toLowerCase())) continue; await createChecklistItem(checklist.id, text, 1); existing.add(text.toLowerCase()); }
		planningImportBusy = false;
	}

	// ── Week review save ──

	async function saveWeekReview() {
		setSaveState('weekReview', 'saving');
		const form = new FormData();
		form.set('weekKey', data.week.dashedKey); form.set('reflection', reflectionValue); form.set('vision', visionValue);
		const response = await fetch('?/saveNotes', { method: 'POST', body: form });
		if (!response.ok) { setSaveState('weekReview', 'idle'); return; }
		flashSaved('weekReview');
	}
</script>

<svelte:head>
	<title>Ukeplan</title>
</svelte:head>

<AppPage width="full" padding="none" gap="sm" theme="dark" surface="default">
	<PullToRefresh excludeSelectors=".wp-header-actions, .wp-calendar-wrap">
	<div class="week-plan-page">
	<header class="wp-header">
		<ScreenTitle
			title={`Uke ${data.week.week}`}
			ariaLabel="Tilbake til hjem"
			onpress={() => { startNavMetric('ukeplan', 'home'); void goto('/'); }}
		/>
		<div class="wp-header-actions">
			{#each data.activeTrips as trip}
				<a class="wp-calendar-btn" href="/tema/{trip.id}" aria-label={trip.name}>{trip.emoji ?? '🗺️'}</a>
			{/each}
			<a class="wp-calendar-btn wp-month-btn" href={`/maanedsplan?month=${selectedDayIso.slice(0, 7)}`} aria-label="Til månedsplan" title="Månedsplan">Mnd</a>
			<div class="wp-calendar-wrap">
				<button class="wp-calendar-btn" type="button" aria-label="Velg uke" onclick={() => weekPickerInput?.showPicker?.()}><Icon name="calendar" size={18} /></button>
				<input bind:this={weekPickerInput} type="date" class="wp-week-picker-input" value={data.week.days[0].isoDate} onchange={(event) => { const val = (event.currentTarget as HTMLInputElement).value; if (val) void goto(weekHref(getIsoWeekDashedFromIsoDate(val))); }} />
			</div>
		</div>
	</header>

	{#if showPlanWeek || showPlanDay || showCloseDay || hasCarryovers}
	<ChipStrip gap={8} ariaLabel="Planleggingshandlinger" class="wp-action-strip">
		{#if showPlanWeek}
			<button class="wp-action-pill wp-action-pill--week" type="button" onclick={() => void openWeekPlanFlow()} disabled={openingWeekPlanFlow}>
				<span class="wp-action-pill-icon">{openingWeekPlanFlow ? '⏳' : '🗓️'}</span>
				<span class="wp-action-pill-label">{openingWeekPlanFlow ? 'Henter …' : 'Planlegg uka'}</span>
			</button>
		{/if}
		{#if hasCarryovers && !weekIsPlanned}
			<button class="wp-action-pill wp-action-pill--util" type="button" onclick={() => void importFromPreviousWeek()} disabled={planningImportBusy}>
				<span class="wp-action-pill-icon">{planningImportBusy ? '⏳' : '↩️'}</span>
				<span class="wp-action-pill-label">{planningImportBusy ? 'Legger til …' : 'Importer forrige uke'}</span>
			</button>
		{/if}
		{#if showPlanDay}
			<button class="wp-action-pill wp-action-pill--day" type="button" onclick={() => void openDayPlanSheet()} disabled={dayPlanSheetBusy}>
				<span class="wp-action-pill-icon">{dayPlanSheetBusy ? '⏳' : '📋'}</span>
				<span class="wp-action-pill-label">{dayPlanSheetBusy ? 'Henter …' : 'Planlegg dag'}</span>
			</button>
		{/if}
		{#if showCloseDay}
			<button class="wp-action-pill wp-action-pill--day" type="button" onclick={openDayCloseFlow} disabled={dayCloseBusy}>
				<span class="wp-action-pill-icon">{dayCloseBusy ? '⏳' : '✅'}</span>
				<span class="wp-action-pill-label">{dayCloseBusy ? 'Jobber …' : 'Avslutt dag'}</span>
			</button>
		{/if}
	</ChipStrip>
	{/if}

	<WeekNote dashedKey={data.week.dashedKey} weekNote={weekNoteValue} saveState={saveStates.weekNote} onSaveStateChange={(state) => setSaveState('weekNote', state)} />

	<WeekTasks
		weekTasks={data.weekTasks} {weekChecklistState} dashedKey={data.week.dashedKey} {weekPlanJustCompleted}
		planConversationId={data.weekChecklist?.planConversationId} saveStateWeekItems={saveStates.weekItems}
		onCreateChecklistItem={createChecklistItem} onToggleChecklistItem={toggleChecklistItem}
		onDeleteChecklistItem={deleteChecklistItem} onReorderChecklistItems={reorderChecklistItems}
		onSaveEditedItem={saveEditedItem} onStartEditing={startEditing} onCreateWeekChecklist={() => {}}
		onSetWeekPlanJustCompleted={(v) => weekPlanJustCompleted = v} onContextMenuOpen={handleContextMenuOpen}
		onToggleWeekParent={toggleWeekParentExpansion} onAddChild={async (cid, pid, text) => { await _addChild(deps, cid, pid, text); }}
		{expandedWeekParentIds} {editingItem} {selectedDayIso}
		dayChecklistId={dayChecklistsState[selectedDayIso]?.id ?? null}
	/>

	<DaySection
		weekDays={data.week.days} {selectedDayIso} {todayIso} {dayChecklistsState} {dayRoutinesState} {dayHeadlinesState}
		spondEventsByDay={data.spondEventsByDay} {tripDayEmoji} {tripDayWeather} {homeDayWeather} {dayCloseMessage}
		saveStateDayItems={saveStates.dayItems} saveStateDayNote={saveStates.dayNote} {editingItem}
		{expandedDayParentIds} {expandedRoutineIds} onSetSelectedDay={setSelectedDay}
		onToggleChecklistItem={toggleChecklistItem} onDeleteChecklistItem={deleteChecklistItem}
		onReorderChecklistItems={reorderChecklistItems} onSaveEditedItem={saveEditedItem}
		onStartEditing={startEditing} onContextMenuOpen={handleContextMenuOpen}
		onToggleDayParent={toggleDayParentExpansion} onToggleRoutineExpansion={toggleRoutineExpansion}
		onRoutineItemToggle={handleRoutineItemToggle} onAddChild={async (cid, pid, text) => { await _addChild(deps, cid, pid, text); }}
		onCreateDayItem={createChecklistItem} onEnsureDayChecklist={ensureDayChecklist}
		onSaveDayHeadline={saveDayHeadline} onUpdateDayHeadline={updateDayHeadline}
	/>

	<WeekGoals vision={data.vision} longTermGoals={data.longTermGoals} />

	</div>
	</PullToRefresh>
</AppPage>

{#if dayCloseFlowOpen}
	<FlowSheet flow={FLOWS['day_close']} context={{ dayLabel: smartDayLabel(selectedDayIso), openItems: (selectedDayChecklist?.items ?? []).filter((i) => !i.checked).map((i) => ({ id: i.id, text: i.text })) }}
		onclose={() => (dayCloseFlowOpen = false)}
		oncomplete={async (fd) => { const d = fd as { decisions?: Record<string, 'carryover' | 'unsolved'> }; if (d.decisions) dayCloseDecisions = d.decisions; dayCloseFlowOpen = false; await applyDayCloseFlow(false); }}
	/>
{/if}

{#if weekPlanFlowOpen}
	<FlowSheet flow={FLOWS['planning_week_plan']} context={weekPlanFlowContext}
		onclose={() => (weekPlanFlowOpen = false)}
		oncomplete={async () => { weekPlanFlowOpen = false; weekPlanJustCompleted = true; await invalidateAll(); }}
	/>
{/if}

{#if foodChatOpen}
	<FlowSheet flow={FLOWS['food_meal_chat']}
		context={{ systemPrompts: { chat: 'Brukeren vil planlegge et måltid fra ukeplanen. Bruk query_food, manage_meal_plan, manage_pantry og generate_shopping_list etter behov. Foreslå konkret oppskrift og handleliste.' }, prompts: { chat: `Hjelp meg planlegge "${foodChatItemText}". Foreslå oppskrift, sjekk hva jeg har i skapet/fryseren og bygg handleliste.` } }}
		onclose={() => (foodChatOpen = false)}
		oncomplete={async () => { foodChatOpen = false; await invalidateAll(); }}
	/>
{/if}

{#if dayPlanSheetOpen}
	<FlowSheet flow={FLOWS['day_plan']}
		context={{ dayIso: selectedDayIso, dayLabel: smartDayLabel(selectedDayIso), weekDashedKey: data.week.dashedKey, carryovers: dayPlanSheetCarryovers, weekTasks: dayPlanSheetWeekTasks, existingHeadline: dayHeadlinesState[selectedDayIso] ?? '' }}
		onclose={() => (dayPlanSheetOpen = false)}
		oncomplete={async (fd) => { const headline = fd['headline'] as string | undefined; if (headline) dayHeadlinesState = { ...dayHeadlinesState, [selectedDayIso]: headline }; if (nudgeTrack === 'plan_day') await reportNudgeStage('flow_completed'); await invalidateAll(); }}
	/>
{/if}

<TaskContextMenu
	open={contextMenuItem !== null} anchor={contextMenuRect} itemText={contextMenuItem?.item.text ?? ''}
	hasChildren={contextMenuItem ? (selectedDayChecklist?.items.some((i) => i.parentId === contextMenuItem!.item.id) ?? false) || (weekChecklistState?.items.some((i) => i.parentId === contextMenuItem!.item.id) ?? false) : false}
	isSkipped={!!contextMenuItem?.item.skippedAt} isChecked={!!contextMenuItem?.item.checked}
	onClose={() => { contextMenuItem = null; contextMenuRect = null; }}
	onEdit={() => { if (contextMenuItem) void startEditing(contextMenuItem.checklistId, contextMenuItem.item); }}
	onBreakdown={() => { if (contextMenuItem) breakdownTarget = contextMenuItem; }}
	onSnooze={(targetDate) => { if (contextMenuItem) void _snooze(deps, contextMenuItem.checklistId, contextMenuItem.item.id, targetDate); }}
	onDelete={() => { if (contextMenuItem) void deleteChecklistItem(contextMenuItem.checklistId, contextMenuItem.item.id); }}
	onSkip={() => { if (contextMenuItem) void _setSkipped(deps, contextMenuItem.checklistId, contextMenuItem.item.id, true); }}
	onUnskip={() => { if (contextMenuItem) void _setSkipped(deps, contextMenuItem.checklistId, contextMenuItem.item.id, false); }}
	onStartChat={async () => {
		if (!contextMenuItem) return;
		const itemText = contextMenuItem.item.text; const checklistId = contextMenuItem.checklistId; const itemId = contextMenuItem.item.id;
		contextMenuItem = null; contextMenuRect = null;
		try {
			const res = await fetch('/api/conversations/new', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: itemText, sourceContext: { sourceChecklistId: checklistId, sourceItemId: itemId, sourceItemText: itemText } }) });
			if (res.ok) { const { conversationId } = await res.json(); goto(`/samtaler?conversation=${conversationId}`); } else { goto('/samtaler'); }
		} catch { goto('/samtaler'); }
	}}
/>

{#if breakdownTarget}
	<BreakdownModal itemTitle={breakdownTarget.item.text} onClose={() => (breakdownTarget = null)} onSave={async (subtasks) => { await _breakdownSave(deps, breakdownTarget!, subtasks); breakdownTarget = null; }} />
{/if}

{#if autoCheckPrompt}
	<AutoCheckModal prompt={autoCheckPrompt} busy={autoCheckBusy}
		onConfirm={() => { autoCheckBusy = true; void _confirmAutoCheck(autoCheckPrompt!, updateChecklistById).then(() => { autoCheckBusy = false; autoCheckPrompt = null; }); }}
		onDismiss={() => (autoCheckPrompt = null)}
	/>
{/if}

<style>
	.week-plan-page {
		min-height: 100vh;
		width: 100%;
		padding: var(--screen-title-top-pad, 34px) 20px 110px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		background:
			radial-gradient(900px 480px at 100% -10%, rgba(51, 66, 122, 0.22), transparent 70%),
			linear-gradient(180deg, #060709 0%, #08090d 55%, #060709 100%);
		color: #dcdde2;
	}
	.wp-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
	.wp-header-actions { display: flex; align-items: flex-start; gap: 6px; flex-shrink: 0; }
	.wp-calendar-wrap { position: relative; flex-shrink: 0; }
	.wp-calendar-btn { width: 34px; height: 34px; display: inline-flex; align-items: center; justify-content: center; border-radius: 10px; border: none; background: #0f1118; color: #bac6f9; flex-shrink: 0; text-decoration: none; font-size: 1.1rem; }
	.wp-month-btn { font-size: 0.72rem; font-weight: 700; letter-spacing: 0.02em; border: 1px solid #1e2030; color: #8a99c4; }
	.wp-month-btn:hover { color: #bac6f9; background: #12162a; border-color: #2e3660; }
	.wp-week-picker-input { position: absolute; opacity: 0; pointer-events: none; width: 0; height: 0; top: 100%; right: 0; }
	:global(.wp-action-strip) { margin: 0 -20px; padding: 0 20px; }
	.wp-action-pill { display: inline-flex; align-items: center; gap: 8px; flex: 0 0 auto; background: hsl(228 19% 11%); border: 1px solid hsl(228 16% 18%); border-radius: 999px; padding: 8px 14px; cursor: pointer; font: inherit; color: hsl(228 22% 80%); font-size: 0.75rem; font-weight: 600; letter-spacing: 0.02em; white-space: nowrap; touch-action: manipulation; transition: background 0.15s, border-color 0.15s, transform 0.15s, box-shadow 0.15s; }
	.wp-action-pill:hover:not(:disabled) { background: hsl(228 22% 14%); border-color: hsl(228 28% 34%); transform: translateY(-1px); }
	.wp-action-pill:disabled { opacity: 0.5; cursor: default; }
	.wp-action-pill-icon { font-size: 0.95rem; line-height: 1; }
	.wp-action-pill-label { white-space: nowrap; }
	.wp-action-pill--week { border-color: rgba(139, 92, 246, 0.3); }
	.wp-action-pill--week:hover:not(:disabled) { border-color: rgba(139, 92, 246, 0.65); background: rgba(139, 92, 246, 0.08); box-shadow: 0 0 14px rgba(139, 92, 246, 0.14); }
	.wp-action-pill--day { border-color: rgba(52, 211, 153, 0.28); }
	.wp-action-pill--day:hover:not(:disabled) { border-color: rgba(52, 211, 153, 0.65); background: rgba(52, 211, 153, 0.06); box-shadow: 0 0 14px rgba(52, 211, 153, 0.10); }
	.wp-action-pill--util { border-color: rgba(251, 191, 36, 0.28); }
	.wp-action-pill--util:hover:not(:disabled) { border-color: rgba(251, 191, 36, 0.6); background: rgba(251, 191, 36, 0.06); box-shadow: 0 0 14px rgba(251, 191, 36, 0.10); }
	@media (max-width: 640px) { .week-plan-page { padding-left: 12px; padding-right: 12px; } }
</style>
