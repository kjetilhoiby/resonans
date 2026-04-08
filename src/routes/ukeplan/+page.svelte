<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { tick } from 'svelte';
	import ScreenTitle from '$lib/components/ui/ScreenTitle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';

	type SaveState = 'idle' | 'saving' | 'saved';

	interface WeekDay {
		isoDate: string;
		label: string;
		day: string;
	}

	interface WeekInfo {
		year: number;
		week: string;
		compactKey: string;
		dashedKey: string;
		contextKey: string;
		days: WeekDay[];
	}

	interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
	}

	interface WeekChecklist {
		id: string;
		title: string;
		emoji: string;
		completedAt: string | null;
		items: ChecklistItem[];
	}

	interface WeekTask {
		id: string;
		title: string;
		frequency: string | null;
		targetValue: number | null;
		repeatCount: number;
		completedCount: number;
		goalTitle: string | null;
		themeName: string | null;
	}

	interface GoalReminder {
		id: string;
		title: string;
		targetDate: string | null;
	}

	interface DayChecklist {
		id: string;
		title: string;
		completedAt: string | null;
		items: ChecklistItem[];
	}

	interface EditingItem {
		checklistId: string;
		itemId: string;
		text: string;
	}

	interface Props {
		data: {
			week: WeekInfo;
			weekNav: {
				previousWeekKey: string;
				nextWeekKey: string;
				isCurrentWeek: boolean;
			};
			weekChecklist: WeekChecklist | null;
			weekTasks: WeekTask[];
			weekNote: string;
			reflection: string;
			vision: string;
			longTermGoals: GoalReminder[];
			dayChecklists: Record<string, DayChecklist>;
			dayNotes: Record<string, string>;
			activeTrips: Array<{
				id: string;
				name: string;
				emoji: string | null;
				destination: string | null;
				startDate: string;
				endDate: string;
			}>;
			previousWeekSummary: {
				weekKey: string;
				note: string;
				reflection: string;
				carryoverItems: string[];
				incompleteTasks: string[];
			};
		};
	}

	function toLocalIsoDate(date: Date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	let { data }: Props = $props();
	const todayIso = toLocalIsoDate(new Date());
	const dayFromQuery = typeof window !== 'undefined'
		? new URLSearchParams(window.location.search).get('day')
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
	let weekComposerText = $state('');
	let weekComposerCount = $state(1);
	let dayComposerText = $state('');
	let dayComposerCount = $state(1);
	let dayNotesState = $state<Record<string, string>>(structuredClone(data.dayNotes));
	let planningImportBusy = $state(false);
	let editingItem = $state<EditingItem | null>(null);
	let dragItem = $state<{ checklistId: string; itemId: string } | null>(null);
	let skipEditBlur = false;
	let weekComposerInput = $state<HTMLInputElement | null>(null);
	let dayComposerInput = $state<HTMLInputElement | null>(null);
	let editInput = $state<HTMLInputElement | null>(null);
	let saveStates = $state<Record<string, SaveState>>({
		weekNote: 'idle',
		weekItems: 'idle',
		dayItems: 'idle',
		dayNote: 'idle',
		weekReview: 'idle'
	});

	const selectedDayChecklist = $derived(dayChecklistsState[selectedDayIso] ?? null);
	const selectedDay = $derived(data.week.days.find((day) => day.isoDate === selectedDayIso) ?? data.week.days[0]);
	const selectedDayNote = $derived(dayNotesState[selectedDayIso] ?? '');

	// Map iso-date → trip emoji for days that are part of a trip
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

	function setSelectedDay(dayIso: string) {
		selectedDayIso = dayIso;
		if (typeof window !== 'undefined') {
			const params = new URLSearchParams(window.location.search);
			params.set('day', dayIso);
			const next = `${window.location.pathname}?${params.toString()}`;
			window.history.replaceState(window.history.state, '', next);
		}
	}

	function weekHref(weekKey: string) {
		const params = new URLSearchParams();
		params.set('week', weekKey);
		return `/ukeplan?${params.toString()}`;
	}

	function checklistProgress(checklist: WeekChecklist | null) {
		if (!checklist || checklist.items.length === 0) return { done: 0, total: 0, pct: 0 };
		const done = checklist.items.filter((item) => item.checked).length;
		const total = checklist.items.length;
		return {
			done,
			total,
			pct: Math.round((done / total) * 100)
		};
	}

	const progress = $derived(checklistProgress(weekChecklistState));

	function formatDate(iso: string | null) {
		if (!iso) return 'uten dato';
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}

	function slotState(task: WeekTask, index: number) {
		return task.completedCount > index;
	}

	function doneTask(task: WeekTask) {
		return task.completedCount >= task.repeatCount;
	}

	function markInitialValue(event: FocusEvent) {
		const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		target.dataset.initialValue = target.value;
	}

	function submitOnBlurIfChanged(event: FocusEvent) {
		const target = event.currentTarget as HTMLInputElement | HTMLTextAreaElement;
		const form = target.closest('form');
		if (!form) return;

		const initial = target.dataset.initialValue ?? '';
		if (target.value === initial) return;

		const allowEmpty = form.dataset.allowEmptyAutosave === 'true';
		if (!allowEmpty && target.value.trim().length === 0) return;

		// Avoid submitting when focus just moved to another field in the same form.
		setTimeout(() => {
			if (form.contains(document.activeElement)) return;
			form.requestSubmit();
		}, 0);
	}

	function setSaveState(key: keyof typeof saveStates, state: SaveState) {
		saveStates = { ...saveStates, [key]: state };
	}

	function flashSaved(key: keyof typeof saveStates) {
		setSaveState(key, 'saved');
		setTimeout(() => {
			if (saveStates[key] === 'saved') {
				setSaveState(key, 'idle');
			}
		}, 1400);
	}

	function autosaveEnhance(key: keyof typeof saveStates, resetOnSuccess = false): SubmitFunction {
		return ({ formElement }) => {
			setSaveState(key, 'saving');
			return async ({ result, update }) => {
				await update();
				if (result.type === 'success') {
					if (resetOnSuccess) formElement.reset();
					flashSaved(key);
					return;
				}

				setSaveState(key, 'idle');
			};
		};
	}

	function saveKeyForChecklist(checklistId: string) {
		return weekChecklistState?.id === checklistId ? 'weekItems' : 'dayItems';
	}

	function updateChecklistById(checklistId: string, updater: (checklist: DayChecklist | WeekChecklist) => DayChecklist | WeekChecklist) {
		if (weekChecklistState?.id === checklistId) {
			weekChecklistState = updater(weekChecklistState) as WeekChecklist;
			return;
		}

		for (const [key, checklist] of Object.entries(dayChecklistsState)) {
			if (checklist.id !== checklistId) continue;
			dayChecklistsState = {
				...dayChecklistsState,
				[key]: updater(checklist) as DayChecklist
			};
			return;
		}
	}

	function getChecklistById(checklistId: string) {
		if (weekChecklistState?.id === checklistId) return weekChecklistState;
		for (const checklist of Object.values(dayChecklistsState)) {
			if (checklist.id === checklistId) return checklist;
		}
		return null;
	}

	async function createChecklistItem(checklistId: string, text: string, count: number) {
		const trimmed = text.trim();
		if (!trimmed) return;

		const checklist = getChecklistById(checklistId);
		if (!checklist) return;

		const key = saveKeyForChecklist(checklistId);
		setSaveState(key, 'saving');

		const response = await fetch(`/api/checklists/${checklistId}/items`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				text: trimmed,
				count,
				sortOrder: checklist.items.length
			})
		});

		if (!response.ok) {
			setSaveState(key, 'idle');
			return;
		}

		const created = await response.json() as ChecklistItem[];
		updateChecklistById(checklistId, (current) => ({
			...current,
			items: [...current.items, ...created]
		}));
		flashSaved(key);
	}

	async function toggleChecklistItem(checklistId: string, itemId: string, checked: boolean) {
		const key = saveKeyForChecklist(checklistId);
		updateChecklistById(checklistId, (current) => ({
			...current,
			items: current.items.map((item) => item.id === itemId ? { ...item, checked } : item)
		}));
		setSaveState(key, 'saving');

		const response = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ checked })
		});

		if (!response.ok) {
			updateChecklistById(checklistId, (current) => ({
				...current,
				items: current.items.map((item) => item.id === itemId ? { ...item, checked: !checked } : item)
			}));
			setSaveState(key, 'idle');
			return;
		}

		flashSaved(key);
	}

	async function saveEditedItem() {
		if (!editingItem) return;
		const activeEdit = editingItem;
		const trimmed = activeEdit.text.trim();
		const checklist = getChecklistById(activeEdit.checklistId);
		if (!checklist) return;

		if (!trimmed) {
			await deleteChecklistItem(activeEdit.checklistId, activeEdit.itemId);
			return;
		}

		const existing = checklist.items.find((item) => item.id === activeEdit.itemId);
		if (!existing || existing.text === trimmed) {
			editingItem = null;
			return;
		}

		const key = saveKeyForChecklist(activeEdit.checklistId);
		updateChecklistById(activeEdit.checklistId, (current) => ({
			...current,
			items: current.items.map((item) => item.id === activeEdit.itemId ? { ...item, text: trimmed } : item)
		}));
		setSaveState(key, 'saving');

		const response = await fetch(`/api/checklists/${activeEdit.checklistId}/items/${activeEdit.itemId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: trimmed })
		});

		if (!response.ok) {
			updateChecklistById(activeEdit.checklistId, (current) => ({
				...current,
				items: current.items.map((item) => item.id === activeEdit.itemId ? { ...item, text: existing.text } : item)
			}));
			setSaveState(key, 'idle');
			return;
		}

		editingItem = null;
		flashSaved(key);
	}

	async function deleteChecklistItem(checklistId: string, itemId: string) {
		const checklist = getChecklistById(checklistId);
		if (!checklist) return;
		const previousItems = checklist.items;
		const nextItems = previousItems.filter((item) => item.id !== itemId);
		const key = saveKeyForChecklist(checklistId);

		updateChecklistById(checklistId, (current) => ({ ...current, items: nextItems }));
		editingItem = null;
		setSaveState(key, 'saving');

		const response = await fetch(`/api/checklists/${checklistId}/items/${itemId}`, {
			method: 'DELETE'
		});

		if (!response.ok) {
			updateChecklistById(checklistId, (current) => ({ ...current, items: previousItems }));
			setSaveState(key, 'idle');
			return;
		}

		flashSaved(key);
	}

	async function reorderChecklistItems(checklistId: string, sourceId: string, targetId: string) {
		if (sourceId === targetId) return;
		const checklist = getChecklistById(checklistId);
		if (!checklist) return;

		const sourceIndex = checklist.items.findIndex((item) => item.id === sourceId);
		const targetIndex = checklist.items.findIndex((item) => item.id === targetId);
		if (sourceIndex === -1 || targetIndex === -1) return;

		const reordered = [...checklist.items];
		const [moved] = reordered.splice(sourceIndex, 1);
		reordered.splice(targetIndex, 0, moved);
		updateChecklistById(checklistId, (current) => ({ ...current, items: reordered }));

		const key = saveKeyForChecklist(checklistId);
		setSaveState(key, 'saving');

		const results = await Promise.all(
			reordered.map((item, index) =>
				fetch(`/api/checklists/${checklistId}/items/${item.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ sortOrder: index })
				})
			)
		);

		if (results.some((result) => !result.ok)) {
			updateChecklistById(checklistId, (current) => ({ ...current, items: checklist.items }));
			setSaveState(key, 'idle');
			return;
		}

		flashSaved(key);
	}

	async function startEditing(checklistId: string, item: ChecklistItem) {
		editingItem = { checklistId, itemId: item.id, text: item.text };
		await tick();
		editInput?.focus();
		editInput?.select();
	}

	function handleEditBlur() {
		if (skipEditBlur) {
			skipEditBlur = false;
			return;
		}

		void saveEditedItem();
	}

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			void saveEditedItem();
			return;
		}

		if (event.key === 'Escape') {
			editingItem = null;
		}
	}

	async function submitWeekComposer() {
		if (!weekChecklistState) return;
		await createChecklistItem(weekChecklistState.id, weekComposerText, weekComposerCount);
		weekComposerText = '';
		weekComposerCount = 1;
		await tick();
		weekComposerInput?.focus();
	}

	async function submitDayComposer() {
		const checklist = await ensureDayChecklist(selectedDayIso);
		if (!checklist) return;
		await createChecklistItem(checklist.id, dayComposerText, dayComposerCount);
		dayComposerText = '';
		dayComposerCount = 1;
		await tick();
		dayComposerInput?.focus();
	}

	async function ensureDayChecklist(dayIso: string) {
		const existing = dayChecklistsState[dayIso];
		if (existing) return existing;

		const response = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: `Dag ${dayIso}`,
				emoji: '☑️',
				context: `week:${data.week.dashedKey}:day:${dayIso}`
			})
		});

		if (!response.ok) return null;

		const created = await response.json() as DayChecklist;
		dayChecklistsState = {
			...dayChecklistsState,
			[dayIso]: {
				id: created.id,
				title: created.title,
				completedAt: created.completedAt,
				items: created.items ?? []
			}
		};

		return dayChecklistsState[dayIso];
	}

	async function ensureWeekChecklist() {
		if (weekChecklistState) return weekChecklistState;

		const response = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: `Uke ${data.week.week}`,
				emoji: '🗓️',
				context: data.week.contextKey
			})
		});

		if (!response.ok) return null;

		const created = await response.json() as WeekChecklist;
		weekChecklistState = {
			id: created.id,
			title: created.title,
			emoji: created.emoji,
			completedAt: created.completedAt,
			items: created.items ?? []
		};

		return weekChecklistState;
	}

	async function importFromPreviousWeek() {
		const suggestions = [...data.previousWeekSummary.carryoverItems, ...data.previousWeekSummary.incompleteTasks]
			.map((text) => text.trim())
			.filter((text) => text.length > 0);
		if (suggestions.length === 0) return;

		const checklist = await ensureWeekChecklist();
		if (!checklist) return;

		planningImportBusy = true;
		const existingTexts = new Set((checklist.items ?? []).map((item) => item.text.trim().toLowerCase()));
		for (const text of suggestions) {
			if (existingTexts.has(text.toLowerCase())) continue;
			await createChecklistItem(checklist.id, text, 1);
			existingTexts.add(text.toLowerCase());
		}
		planningImportBusy = false;
	}

	async function saveDayNote() {
		const dayIso = selectedDayIso;
		const note = dayNotesState[dayIso] ?? '';
		setSaveState('dayNote', 'saving');

		const form = new FormData();
		form.set('weekKey', data.week.dashedKey);
		form.set('dayIso', dayIso);
		form.set('dayNote', note);

		const response = await fetch('?/saveDayNote', {
			method: 'POST',
			body: form
		});

		if (!response.ok) {
			setSaveState('dayNote', 'idle');
			return;
		}

		flashSaved('dayNote');
	}

	async function saveWeekReview() {
		setSaveState('weekReview', 'saving');

		const form = new FormData();
		form.set('weekKey', data.week.dashedKey);
		form.set('reflection', reflectionValue);
		form.set('vision', visionValue);

		const response = await fetch('?/saveNotes', {
			method: 'POST',
			body: form
		});

		if (!response.ok) {
			setSaveState('weekReview', 'idle');
			return;
		}

		flashSaved('weekReview');
	}

	function handleComposerKeydown(event: KeyboardEvent, scope: 'week' | 'day') {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void (scope === 'week' ? submitWeekComposer() : submitDayComposer());
	}
</script>

<svelte:head>
	<title>Ukeplan</title>
</svelte:head>

<div class="week-plan-page">
	<header class="wp-header">
		<a class="wp-back" href="/" aria-label="Tilbake til hjem"><Icon name="back" size={18} /></a>
		<a class="wp-week-nav" href={weekHref(data.weekNav.previousWeekKey)} aria-label="Forrige uke">‹</a>
		<ScreenTitle
			title={`Uke ${data.week.week}`}
			subtitle={`Planrom for ${data.week.dashedKey}`}
			ariaLabel="Ukeplan"
		/>
		<a class="wp-week-nav" href={weekHref(data.weekNav.nextWeekKey)} aria-label="Neste uke">›</a>
	</header>

	{#if data.activeTrips.length > 0}
		<div class="wp-trips">
			{#each data.activeTrips as trip}
				<a class="wp-trip-banner" href="/tema/{trip.id}">
					<span class="wp-trip-icon">{trip.emoji ?? '🗺️'}</span>
					<span class="wp-trip-text">
						<strong>{trip.name}</strong>
						{#if trip.destination}<span class="wp-trip-dest">{trip.destination}</span>{/if}
						<span class="wp-trip-dates">{trip.startDate} – {trip.endDate}</span>
					</span>
					<span class="wp-trip-arrow">→</span>
				</a>
			{/each}
		</div>
	{/if}

	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Planlegg uka</h2>
			<span class="wp-pill">fra {data.previousWeekSummary.weekKey}</span>
		</div>
		{#if data.previousWeekSummary.note}
			<p class="wp-helper">Forrige ukes intro: {data.previousWeekSummary.note}</p>
		{/if}
		{#if data.previousWeekSummary.reflection}
			<p class="wp-helper">Laring: {data.previousWeekSummary.reflection}</p>
		{/if}
		{#if data.previousWeekSummary.carryoverItems.length > 0 || data.previousWeekSummary.incompleteTasks.length > 0}
			<div class="wp-suggestion-list">
				{#each data.previousWeekSummary.carryoverItems as item}
					<div class="wp-suggestion-item">Overligger: {item}</div>
				{/each}
				{#each data.previousWeekSummary.incompleteTasks as task}
					<div class="wp-suggestion-item">Ukesmaal ikke helt i havn: {task}</div>
				{/each}
			</div>
			<button class="wp-btn" type="button" onclick={() => void importFromPreviousWeek()} disabled={planningImportBusy}>
				{planningImportBusy ? 'Legger til ...' : 'Legg forslag i ukelista'}
			</button>
		{:else}
			<p class="wp-empty">Ingen tydelige overliggere fra forrige uke.</p>
		{/if}
	</section>

	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Ukesnotat</h2>
			<span class="wp-pill">uke {data.week.week}</span>
		</div>
		<form method="POST" action="?/saveWeekNote" class="wp-notes-form" use:enhance={autosaveEnhance('weekNote')} data-allow-empty-autosave="true">
			<input type="hidden" name="weekKey" value={data.week.dashedKey} />
			<div class="wp-field-shell">
				<textarea
					id="weekNote"
					name="weekNote"
					class="wp-textarea wp-textarea-note"
					bind:value={weekNoteValue}
					rows="2"
					placeholder="Ferien er over og vi skal tilbake til jobb, skole og barnehage."
					onfocus={markInitialValue}
					onblur={submitOnBlurIfChanged}
				>{data.weekNote}</textarea>
				<span class="wp-save-dot" class:is-saving={saveStates.weekNote === 'saving'} class:is-saved={saveStates.weekNote === 'saved'} aria-hidden="true"></span>
			</div>
		</form>
	</section>

	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Evaluer uka</h2>
			<span class="wp-pill">enkelt</span>
		</div>
		<div class="wp-field-shell">
			<textarea
				class="wp-textarea"
				rows="2"
				placeholder="Gikk uka etter planen? Hva laerer du til neste uke?"
				bind:value={reflectionValue}
				onfocus={markInitialValue}
				onblur={async () => {
					await saveWeekReview();
				}}
			></textarea>
		</div>
		<div class="wp-field-shell">
			<textarea
				class="wp-textarea"
				rows="2"
				placeholder="Hvordan kjennes retningen mot de langsiktige målene?"
				bind:value={visionValue}
				onfocus={markInitialValue}
				onblur={async () => {
					await saveWeekReview();
				}}
			></textarea>
			<span class="wp-save-dot" class:is-saving={saveStates.weekReview === 'saving'} class:is-saved={saveStates.weekReview === 'saved'} aria-hidden="true"></span>
		</div>
	</section>

	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Ukas oppgaver</h2>
			{#if weekChecklistState}
				<span class="wp-pill">{data.weekTasks.length + progress.total} totalt</span>
			{:else}
				<span class="wp-pill">{data.weekTasks.length} fra tema/maal</span>
			{/if}
		</div>

		<div class="wp-subhead">Fra temaer og langsiktige maal</div>
		{#if data.weekTasks.length > 0}
			<ul class="wp-task-list">
				{#each data.weekTasks as task}
					<li class="wp-task">
						<div class="wp-task-main">
							<div>
								<p class="wp-task-title" class:done={doneTask(task)}>{task.title}</p>
								<p class="wp-task-meta">
									{task.goalTitle ?? 'Uten mål'}
									{#if task.themeName} · {task.themeName}{/if}
									{#if task.frequency} · {task.frequency}{/if}
								</p>
							</div>
							<div class="wp-slot-row" aria-label="Progresjon">
								{#each Array.from({ length: task.repeatCount }) as _, index}
									<span class="wp-slot" class:checked={slotState(task, index)}>{slotState(task, index) ? '✓' : ''}</span>
								{/each}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="wp-empty">Ingen temaoppgaver er satt for denne uken.</p>
		{/if}

		<div class="wp-subhead">Egne ukeoppgaver</div>

		{#if weekChecklistState}
			{@const weekChecklistId = weekChecklistState.id}
			<div class="wp-progress-track" aria-hidden="true">
				<div class="wp-progress-fill" style={`width:${progress.pct}%`}></div>
			</div>

			<ul class="wp-checklist">
				{#each weekChecklistState.items as item}
					<li
						class="wp-check-row"
						draggable={editingItem?.itemId !== item.id}
						ondragstart={() => (dragItem = { checklistId: weekChecklistId, itemId: item.id })}
						ondragover={(event) => event.preventDefault()}
						ondrop={() => {
							if (!dragItem) return;
							void reorderChecklistItems(weekChecklistId, dragItem.itemId, item.id);
							dragItem = null;
						}}
						ondragend={() => (dragItem = null)}
					>
						<div class="wp-check-row-main">
							<button type="button" class="wp-check-toggle" onclick={() => void toggleChecklistItem(weekChecklistId, item.id, !item.checked)} aria-label="Toggle">
								<span class="wp-check-circle" class:checked={item.checked}>{item.checked ? '✓' : ''}</span>
							</button>
							{#if editingItem?.itemId === item.id}
								<div class="wp-edit-shell">
									<input
										bind:this={editInput}
										bind:value={editingItem.text}
										class="wp-input wp-edit-input"
										onblur={handleEditBlur}
										onkeydown={handleEditKeydown}
									/>
									<button
										type="button"
										class="wp-edit-delete"
										onmousedown={() => (skipEditBlur = true)}
										onclick={() => void deleteChecklistItem(weekChecklistId, item.id)}
										aria-label="Slett punkt"
									>
										×
									</button>
								</div>
							{:else}
								<button type="button" class="wp-item-text-btn" onclick={() => void startEditing(weekChecklistId, item)}>
									<span class="wp-check-text" class:checked={item.checked}>{item.text}</span>
								</button>
							{/if}
							<span class="wp-drag-handle" aria-hidden="true">⋮⋮</span>
						</div>
					</li>
				{/each}
			</ul>

			<div class="wp-add-form">
				<div class="wp-field-shell">
					<div class="wp-inline-inputs">
						<input
							bind:this={weekComposerInput}
							bind:value={weekComposerText}
							class="wp-input"
							type="text"
							placeholder="Skriv punkt og trykk Enter"
							onkeydown={(event) => handleComposerKeydown(event, 'week')}
						/>
						<input
							bind:value={weekComposerCount}
							class="wp-input wp-input-count"
							type="number"
							min="1"
							max="12"
						/>
					</div>
					<span class="wp-save-dot" class:is-saving={saveStates.weekItems === 'saving'} class:is-saved={saveStates.weekItems === 'saved'} aria-hidden="true"></span>
				</div>
			</div>
		{:else}
			<p class="wp-empty">Ingen ukeliste er opprettet for denne uken.</p>
			<form method="POST" action="?/createChecklistForWeek">
				<input type="hidden" name="weekKey" value={data.week.dashedKey} />
				<button class="wp-btn" type="submit">Opprett ukeliste</button>
			</form>
		{/if}
	</section>

	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Dager og dagsmaal</h2>
			<span class="wp-pill">{selectedDay.label} {selectedDay.day}</span>
		</div>

		<div class="wp-days" aria-label="Ukas dager">
			{#each data.week.days as day}
				{@const tripEmoji = tripDayEmoji[day.isoDate]}
				<button
					type="button"
					class="wp-day-btn"
					class:today={day.isoDate === todayIso}
					class:selected={selectedDayIso === day.isoDate}
					class:on-trip={!!tripEmoji}
					onclick={() => setSelectedDay(day.isoDate)}
				>
					{#if tripEmoji}
						<span class="wp-day-trip-emoji" aria-label="På tur">{tripEmoji}</span>
					{/if}
					<span class="wp-day-label">{day.label}</span>
					<span class="wp-day-number">{day.day}</span>
				</button>
			{/each}
		</div>

		<div class="wp-notes-form">
			<div class="wp-field-shell">
				<textarea
					class="wp-textarea"
					rows="2"
					placeholder={`Liten plan for ${selectedDay.label}...`}
					value={selectedDayNote}
					oninput={(event) => {
						const target = event.currentTarget as HTMLTextAreaElement;
						dayNotesState = { ...dayNotesState, [selectedDayIso]: target.value };
					}}
					onfocus={markInitialValue}
					onblur={async (event) => {
						submitOnBlurIfChanged(event);
						await saveDayNote();
					}}
				></textarea>
				<span class="wp-save-dot" class:is-saving={saveStates.dayNote === 'saving'} class:is-saved={saveStates.dayNote === 'saved'} aria-hidden="true"></span>
			</div>
		</div>

		{#if selectedDayChecklist}
			<ul class="wp-checklist">
				{#each selectedDayChecklist.items as item}
					<li
						class="wp-check-row"
						draggable={editingItem?.itemId !== item.id}
						ondragstart={() => (dragItem = { checklistId: selectedDayChecklist.id, itemId: item.id })}
						ondragover={(event) => event.preventDefault()}
						ondrop={() => {
							if (!dragItem) return;
							void reorderChecklistItems(selectedDayChecklist.id, dragItem.itemId, item.id);
							dragItem = null;
						}}
						ondragend={() => (dragItem = null)}
					>
						<div class="wp-check-row-main">
							<button type="button" class="wp-check-toggle" onclick={() => void toggleChecklistItem(selectedDayChecklist.id, item.id, !item.checked)} aria-label="Toggle">
								<span class="wp-check-circle" class:checked={item.checked}>{item.checked ? '✓' : ''}</span>
							</button>
							{#if editingItem?.itemId === item.id}
								<div class="wp-edit-shell">
									<input
										bind:this={editInput}
										bind:value={editingItem.text}
										class="wp-input wp-edit-input"
										onblur={handleEditBlur}
										onkeydown={handleEditKeydown}
									/>
									<button
										type="button"
										class="wp-edit-delete"
										onmousedown={() => (skipEditBlur = true)}
										onclick={() => void deleteChecklistItem(selectedDayChecklist.id, item.id)}
										aria-label="Slett punkt"
									>
										×
									</button>
								</div>
							{:else}
								<button type="button" class="wp-item-text-btn" onclick={() => void startEditing(selectedDayChecklist.id, item)}>
									<span class="wp-check-text" class:checked={item.checked}>{item.text}</span>
								</button>
							{/if}
							<span class="wp-drag-handle" aria-hidden="true">⋮⋮</span>
						</div>
					</li>
				{/each}
			</ul>

			<div class="wp-add-form">
				<div class="wp-field-shell">
					<div class="wp-inline-inputs">
						<input
							bind:this={dayComposerInput}
							bind:value={dayComposerText}
							class="wp-input"
							type="text"
							placeholder={`Skriv dagsmaal for ${selectedDay.label} og trykk Enter`}
							onkeydown={(event) => handleComposerKeydown(event, 'day')}
						/>
						<input
							bind:value={dayComposerCount}
							class="wp-input wp-input-count"
							type="number"
							min="1"
							max="12"
						/>
					</div>
					<span class="wp-save-dot" class:is-saving={saveStates.dayItems === 'saving'} class:is-saved={saveStates.dayItems === 'saved'} aria-hidden="true"></span>
				</div>
			</div>
		{:else}
			<p class="wp-empty">Ingen dagsmaal for valgt dag ennå.</p>
			<div class="wp-add-form">
				<div class="wp-field-shell">
					<div class="wp-inline-inputs">
						<input
							bind:this={dayComposerInput}
							bind:value={dayComposerText}
							class="wp-input"
							type="text"
							placeholder={`Skriv første dagsmaal for ${selectedDay.label} og trykk Enter`}
							onkeydown={(event) => handleComposerKeydown(event, 'day')}
						/>
						<input
							bind:value={dayComposerCount}
							class="wp-input wp-input-count"
							type="number"
							min="1"
							max="12"
						/>
					</div>
					<span class="wp-save-dot" class:is-saving={saveStates.dayItems === 'saving'} class:is-saved={saveStates.dayItems === 'saved'} aria-hidden="true"></span>
				</div>
			</div>
		{/if}
	</section>

	<section class="wp-card">
		<div class="wp-card-head">
			<h2>Maalbilde og retning</h2>
			<span class="wp-pill">fra maned/aar</span>
		</div>

		{#if data.vision}
			<p class="wp-vision-text">{data.vision}</p>
		{/if}

		{#if data.longTermGoals.length > 0}
			<ul class="wp-reminder-list">
				{#each data.longTermGoals as goal}
					<li class="wp-reminder-row">
						<span class="wp-reminder-title">{goal.title}</span>
						<span class="wp-reminder-date">{formatDate(goal.targetDate)}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="wp-empty">Ingen aktive hoeynivaa-maal funnet enda.</p>
		{/if}

		<p class="wp-helper">Refleksjon samles inn via nudge mot slutten av soendag.</p>
	</section>
</div>

<style>
	.week-plan-page {
		min-height: 100vh;
		width: 100%;
		padding: 18px 16px 110px;
		max-width: 760px;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
		background:
			radial-gradient(900px 480px at 100% -10%, rgba(51, 66, 122, 0.22), transparent 70%),
			linear-gradient(180deg, #060709 0%, #08090d 55%, #060709 100%);
		color: #dcdde2;
	}

	.wp-header {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.wp-back {
		width: 34px;
		height: 34px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 10px;
		border: 1px solid #222735;
		background: #0f1118;
		color: #ddd;
		text-decoration: none;
		flex-shrink: 0;
	}

	.wp-week-nav {
		width: 30px;
		height: 30px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid #273149;
		background: #11172a;
		color: #bac6f9;
		text-decoration: none;
		font-size: 1rem;
		font-weight: 700;
		flex-shrink: 0;
	}

	.wp-days {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: 6px;
	}

	.wp-day-btn {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 8px 4px;
		border-radius: 10px;
		border: 1px solid #262a36;
		background: #0b0d13;
		cursor: pointer;
		position: relative;
	}

	.wp-day-btn.on-trip {
		border-color: #2a3a4a;
		background: #0a1018;
	}

	.wp-day-trip-emoji {
		font-size: 0.65rem;
		line-height: 1;
		margin-bottom: 1px;
	}

	.wp-day-btn.today {
		border-color: #384fa7;
		background: #11172f;
	}

	.wp-day-btn.selected {
		outline: 2px solid rgba(124, 142, 245, 0.52);
		outline-offset: 0;
	}

	.wp-day-label {
		font-size: 0.67rem;
		color: #888;
		text-transform: capitalize;
	}

	.wp-day-number {
		font-size: 0.86rem;
		color: #ddd;
		font-weight: 700;
	}

	.wp-trips {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 0 4px;
	}

	.wp-trip-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 14px;
		background: linear-gradient(135deg, rgba(124, 142, 245, 0.12), rgba(124, 142, 245, 0.06));
		border: 1px solid rgba(124, 142, 245, 0.25);
		border-radius: 12px;
		text-decoration: none;
		color: inherit;
		transition: background 0.15s;
	}

	.wp-trip-banner:hover {
		background: linear-gradient(135deg, rgba(124, 142, 245, 0.2), rgba(124, 142, 245, 0.1));
	}

	.wp-trip-icon {
		font-size: 1.5rem;
		flex-shrink: 0;
	}

	.wp-trip-text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.wp-trip-text strong {
		font-size: 0.95rem;
		color: #e8eaf6;
	}

	.wp-trip-dest {
		font-size: 0.82rem;
		color: #9fa8da;
	}

	.wp-trip-dates {
		font-size: 0.78rem;
		color: #7986cb;
	}

	.wp-trip-arrow {
		font-size: 1rem;
		color: #7986cb;
		flex-shrink: 0;
	}

	.wp-card {
		background: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95));
		border: 1px solid #1f2430;
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wp-suggestion-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-suggestion-item {
		font-size: 0.76rem;
		color: #aeb4c6;
		background: #0e121c;
		border: 1px solid #242c40;
		border-radius: 8px;
		padding: 7px 9px;
	}

	.wp-card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}

	.wp-card h2 {
		margin: 0;
		font-size: 0.9rem;
		color: #ddd;
	}

	.wp-pill {
		font-size: 0.66rem;
		color: #8a90a3;
		background: #10131a;
		border: 1px solid #252c3a;
		padding: 3px 8px;
		border-radius: 999px;
	}

	.wp-subhead {
		font-size: 0.72rem;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #70788f;
		font-weight: 650;
	}

	.wp-task-list,
	.wp-checklist {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-task,
	.wp-check-row {
		border: 1px solid #232734;
		background: #0e1119;
		border-radius: 10px;
		padding: 10px;
	}

	.wp-task-main {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
	}

	.wp-task-title {
		margin: 0;
		font-size: 0.84rem;
		color: #ddd;
	}

	.wp-task-title.done {
		color: #7c8498;
		text-decoration: line-through;
	}

	.wp-task-meta {
		margin: 4px 0 0;
		font-size: 0.72rem;
		color: #626b82;
	}

	.wp-slot-row {
		display: inline-flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.wp-slot {
		width: 18px;
		height: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid #353c50;
		font-size: 0.72rem;
		line-height: 1;
		color: #7180b8;
		background: #111624;
	}

	.wp-slot.checked {
		border-color: #5566b7;
		background: #1a2454;
		color: #ccd8ff;
	}

	.wp-progress-track {
		height: 8px;
		border-radius: 999px;
		background: #151925;
		overflow: hidden;
	}

	.wp-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #4a5af0, #6f7bf4);
	}

	.wp-check-row-main {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 10px;
		align-items: center;
	}

	.wp-check-toggle,
	.wp-item-text-btn {
		border: none;
		background: transparent;
		padding: 0;
		color: inherit;
		cursor: pointer;
		text-align: left;
	}

	.wp-item-text-btn {
		width: 100%;
	}

	.wp-check-circle {
		width: 18px;
		height: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border-radius: 999px;
		border: 1px solid #3a4155;
		color: #4a5af0;
		font-size: 0.72rem;
		line-height: 1;
		flex-shrink: 0;
	}

	.wp-check-circle.checked {
		border-color: #5b6fca;
		background: #1a2556;
	}

	.wp-check-text {
		font-size: 0.82rem;
		color: #ccc;
	}

	.wp-check-text.checked {
		color: #737d95;
		text-decoration: line-through;
	}

	.wp-edit-shell {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		align-items: center;
	}

	.wp-edit-input {
		height: 34px;
	}

	.wp-edit-delete {
		width: 28px;
		height: 28px;
		border-radius: 999px;
		border: 1px solid #31394d;
		background: #131826;
		color: #a9b4d8;
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}

	.wp-drag-handle {
		color: #5e6780;
		font-size: 0.92rem;
		cursor: grab;
		user-select: none;
	}

	.wp-add-form,
	.wp-notes-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.wp-field-shell {
		position: relative;
	}

	.wp-input,
	.wp-textarea {
		width: 100%;
		background: #0f121b;
		border: 1px solid #242b3a;
		color: #ddd;
		border-radius: 10px;
		font: inherit;
	}

	.wp-inline-inputs {
		display: grid;
		grid-template-columns: 1fr 74px;
		gap: 8px;
		align-items: center;
	}

	.wp-input-count {
		text-align: center;
		padding: 0;
	}

	.wp-input {
		height: 38px;
		padding: 0 10px;
	}

	.wp-textarea {
		padding: 10px;
		resize: vertical;
		min-height: 96px;
	}

	.wp-textarea-note {
		min-height: 66px;
	}

	.wp-save-dot {
		position: absolute;
		right: 12px;
		top: 12px;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: rgba(102, 112, 138, 0.38);
		box-shadow: 0 0 0 0 rgba(124, 142, 245, 0);
		transition: background-color 160ms ease, box-shadow 220ms ease, opacity 220ms ease;
		opacity: 0;
	}

	.wp-save-dot.is-saving,
	.wp-save-dot.is-saved {
		opacity: 1;
	}

	.wp-save-dot.is-saving {
		background: #7c8ef5;
		animation: wp-dot-pulse 1s ease-in-out infinite;
	}

	.wp-save-dot.is-saved {
		background: #6ab08e;
		box-shadow: 0 0 0 5px rgba(106, 176, 142, 0.08);
	}

	@keyframes wp-dot-pulse {
		0% {
			box-shadow: 0 0 0 0 rgba(124, 142, 245, 0.22);
		}
		70% {
			box-shadow: 0 0 0 6px rgba(124, 142, 245, 0);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(124, 142, 245, 0);
		}
	}

	.wp-reminder-list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.wp-reminder-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 10px;
		padding: 10px;
		border-radius: 9px;
		background: #0f131c;
		border: 1px solid #242c3a;
	}

	.wp-reminder-title {
		font-size: 0.82rem;
		color: #d3d8e6;
	}

	.wp-reminder-date {
		font-size: 0.74rem;
		color: #7c86a2;
	}

	.wp-vision-text {
		margin: 0;
		font-size: 0.82rem;
		line-height: 1.55;
		color: #c5ccdf;
		padding: 10px;
		border-radius: 10px;
		border: 1px solid #232b3a;
		background: #0f131d;
	}

	.wp-helper {
		margin: 2px 0 0;
		font-size: 0.74rem;
		color: #76809c;
	}

	.wp-empty {
		margin: 0;
		color: #7a8399;
		font-size: 0.78rem;
	}

	@media (max-width: 640px) {
		.week-plan-page {
			padding-left: 12px;
			padding-right: 12px;
		}

		.wp-day-label {
			font-size: 0.62rem;
		}

		.wp-day-number {
			font-size: 0.78rem;
		}
	}
</style>
