<script lang="ts">
	import { tick } from 'svelte';
	import { CardTitle, ChecklistItemRow, RoutineGroupRow } from '$lib/components/ui';
	import type { ChecklistItemLike } from '$lib/types/checklist';
	import Icon from '$lib/components/ui/Icon.svelte';
	import MentionAutocomplete from '$lib/components/ui/MentionAutocomplete.svelte';
	import { sortByTime, sortByStatus, activityTypeEmoji } from '$lib/utils/checklist-group';
	import type { WeekDay, ChecklistItem, DayChecklist, EditingItem, SaveState, SpondEvent, DayRoutine } from './types';
	import type { WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';

	interface DayWeatherSummary { emoji: string; tempMax: number; periods: WeatherPeriod[] }
	interface DayWeatherEntry { symbol: string; tempMax: number }

	const SLOT_HOUR: Record<string, number> = { morning: 7, afternoon: 13, evening: 19, flex: 23 };

	type DayEntry = { type: 'item'; item: ChecklistItem } | { type: 'routine'; routine: DayRoutine };

	interface Props {
		weekDays: WeekDay[];
		selectedDayIso: string;
		todayIso: string;
		dayChecklistsState: Record<string, DayChecklist>;
		dayRoutinesState: Record<string, DayRoutine[]>;
		dayHeadlinesState: Record<string, string>;
		spondEventsByDay: Record<string, SpondEvent[]>;
		tripDayEmoji: Record<string, string>;
		tripDayWeather: Record<string, DayWeatherEntry>;
		homeDayWeather: Record<string, DayWeatherSummary>;
		dayCloseMessage: string;
		saveStateDayItems: SaveState;
		saveStateDayNote: SaveState;
		editingItem: EditingItem | null;
		expandedDayParentIds: Set<string>;
		expandedRoutineIds: Set<string>;
		// Callbacks
		onSetSelectedDay: (dayIso: string) => void;
		onToggleChecklistItem: (checklistId: string, itemId: string, checked: boolean) => Promise<void>;
		onDeleteChecklistItem: (checklistId: string, itemId: string) => Promise<void>;
		onReorderChecklistItems: (checklistId: string, sourceId: string, targetId: string) => Promise<void>;
		onSaveEditedItem: (editingItem: EditingItem) => Promise<void>;
		onStartEditing: (checklistId: string, item: ChecklistItem) => void;
		onContextMenuOpen: (checklistId: string, item: ChecklistItem, rect: DOMRect) => void;
		onToggleDayParent: (parentId: string) => void;
		onToggleRoutineExpansion: (checklistId: string) => void;
		onRoutineItemToggle: (checklistId: string, itemId: string, newChecked: boolean) => Promise<void>;
		onAddChild: (checklistId: string, parentId: string, text: string) => Promise<void>;
		onCreateDayItem: (checklistId: string, text: string, count: number) => Promise<void>;
		onEnsureDayChecklist: (dayIso: string) => Promise<DayChecklist | null>;
		onSaveDayHeadline: () => Promise<void>;
		onUpdateDayHeadline: (dayIso: string, value: string) => void;
	}

	let {
		weekDays,
		selectedDayIso,
		todayIso,
		dayChecklistsState,
		dayRoutinesState,
		dayHeadlinesState,
		spondEventsByDay,
		tripDayEmoji,
		tripDayWeather,
		homeDayWeather,
		dayCloseMessage,
		saveStateDayItems,
		saveStateDayNote,
		editingItem,
		expandedDayParentIds,
		expandedRoutineIds,
		onSetSelectedDay,
		onToggleChecklistItem,
		onDeleteChecklistItem,
		onReorderChecklistItems,
		onSaveEditedItem,
		onStartEditing,
		onContextMenuOpen,
		onToggleDayParent,
		onToggleRoutineExpansion,
		onRoutineItemToggle,
		onAddChild,
		onCreateDayItem,
		onEnsureDayChecklist,
		onSaveDayHeadline,
		onUpdateDayHeadline,
	}: Props = $props();

	let dayComposerText = $state('');
	let dayComposerInput = $state<HTMLInputElement | null>(null);
	let editInput = $state<HTMLInputElement | null>(null);
	let skipEditBlur = false;

	// Drag state
	let dragItem = $state<{ checklistId: string; itemId: string } | null>(null);
	let dragOverItemId = $state<string | null>(null);

	const selectedDayChecklist = $derived(dayChecklistsState[selectedDayIso] ?? null);
	const selectedDayRoutines = $derived(dayRoutinesState[selectedDayIso] ?? []);
	const sortedDayItems = $derived(selectedDayChecklist ? sortByStatus(sortByTime(selectedDayChecklist.items.filter((item) => !item.parentId))) : []);
	const selectedDayHeadline = $derived(dayHeadlinesState[selectedDayIso] ?? '');
	const selectedDaySpondEvents = $derived(spondEventsByDay?.[selectedDayIso] ?? []);

	const sortedDayEntries = $derived.by((): DayEntry[] => {
		const entries: Array<DayEntry & { sortKey: number }> = [];
		for (const item of sortedDayItems) {
			const h = item.metadata?.timeHour;
			entries.push({ type: 'item', item, sortKey: typeof h === 'number' ? h * 60 + (item.metadata?.timeMinute ?? 0) : 1440 });
		}
		for (const routine of selectedDayRoutines) {
			entries.push({ type: 'routine', routine, sortKey: (SLOT_HOUR[routine.slot] ?? 12) * 60 });
		}
		entries.sort((a, b) => a.sortKey - b.sortKey);
		return entries;
	});

	function smartDayLabel(isoDate: string): string {
		if (isoDate === todayIso) return 'I dag';
		const raw = new Intl.DateTimeFormat('nb-NO', { weekday: 'short' }).format(new Date(isoDate + 'T12:00:00'));
		const clean = raw.replace('.', '');
		return clean.charAt(0).toUpperCase() + clean.slice(1);
	}

	function metSymbolToEmoji(symbol: string): string {
		if (symbol.startsWith('clearsky')) return '☀️';
		if (symbol.startsWith('fair')) return '🌤️';
		if (symbol.startsWith('partlycloudy')) return '⛅';
		if (symbol.startsWith('cloudy')) return '☁️';
		if (symbol.startsWith('fog')) return '🌫️';
		if (symbol.includes('thunder')) return '⛈️';
		if (symbol.includes('snow') || symbol.includes('sleet')) return '❄️';
		if (symbol.includes('rain') || symbol.includes('shower')) return '🌧️';
		return '🌡️';
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
		setTimeout(() => {
			if (form.contains(document.activeElement)) return;
			form.requestSubmit();
		}, 0);
	}

	function makeRowLongpress(checklistId: string) {
		return (rect: DOMRect, item: ChecklistItemLike) => {
			onContextMenuOpen(checklistId, item as ChecklistItem, rect);
		};
	}

	function makeRowTextClick(checklistId: string) {
		return (item: ChecklistItemLike) => {
			onStartEditing(checklistId, item as ChecklistItem);
		};
	}

	function makeRowToggle(checklistId: string) {
		return (item: ChecklistItemLike) => {
			void onToggleChecklistItem(checklistId, item.id, !item.checked);
		};
	}

	function makeRowAddChild(checklistId: string) {
		return async (parentId: string, text: string) => {
			await onAddChild(checklistId, parentId, text);
		};
	}

	function handleEditBlur() {
		if (skipEditBlur) { skipEditBlur = false; return; }
		if (editingItem) void onSaveEditedItem(editingItem);
	}

	function handleEditKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') { event.preventDefault(); if (editingItem) void onSaveEditedItem(editingItem); return; }
		if (event.key === 'Escape') { onStartEditing('', null as any); }
	}

	async function submitDayComposer() {
		const checklist = await onEnsureDayChecklist(selectedDayIso);
		if (!checklist) return;
		await onCreateDayItem(checklist.id, dayComposerText, 1);
		dayComposerText = '';
		await tick();
		dayComposerInput?.focus();
	}

	function handleComposerKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void submitDayComposer();
	}

	function startTouchDrag(event: TouchEvent, checklistId: string, itemId: string) {
		event.preventDefault();
		dragItem = { checklistId, itemId };
		dragOverItemId = null;

		function onMove(e: TouchEvent) {
			e.preventDefault();
			const touch = e.touches[0];
			if (!touch) return;
			const el = document.elementFromPoint(touch.clientX, touch.clientY);
			const row = el?.closest('[data-item-id]') as HTMLElement | null;
			dragOverItemId = row?.dataset.itemId ?? null;
		}

		function onEnd() {
			const src = dragItem;
			const target = dragOverItemId;
			dragItem = null;
			dragOverItemId = null;
			document.removeEventListener('touchmove', onMove);
			if (src && target && target !== src.itemId) {
				void onReorderChecklistItems(src.checklistId, src.itemId, target);
			}
		}

		document.addEventListener('touchmove', onMove, { passive: false });
		document.addEventListener('touchend', onEnd, { once: true });
	}
</script>

<section class="wp-card">
	<div class="wp-card-head">
		<CardTitle>Dager og dagsmål</CardTitle>
	</div>

	<div class="wp-days" aria-label="Ukas dager">
		{#each weekDays as day}
			{@const tripEmoji = tripDayEmoji[day.isoDate]}
			{@const wx = tripDayWeather[day.isoDate]}
			{@const homeWx = homeDayWeather[day.isoDate]}
			<button
				type="button"
				class="wp-day-btn"
				class:today={day.isoDate === todayIso}
				class:selected={selectedDayIso === day.isoDate}
				class:on-trip={!!tripEmoji}
				onclick={() => onSetSelectedDay(day.isoDate)}
			>
				{#if tripEmoji && !wx}
					<span class="wp-day-trip-emoji" aria-label="På tur">{tripEmoji}</span>
				{/if}
				{#if wx}
					<span class="wp-day-wx" aria-label="Vær">
						<span class="wp-day-wx-sym">{metSymbolToEmoji(wx.symbol)}</span><span class="wp-day-wx-temp">{wx.tempMax}°</span>
					</span>
				{:else if homeWx}
					<span class="wp-day-wx" aria-label="Vær">
						<span class="wp-day-wx-sym">{homeWx.emoji}</span><span class="wp-day-wx-temp">{homeWx.tempMax}°</span>
					</span>
				{/if}
				<span class="wp-day-label">{smartDayLabel(day.isoDate)}</span>
				<span class="wp-day-number">{day.day}</span>
			</button>
		{/each}
	</div>

	<div class="wp-notes-form">
		{#if selectedDaySpondEvents.length > 0}
			<ul class="wp-spond-list">
				{#each selectedDaySpondEvents as event}
					{@const start = new Date(event.startTimestamp)}
					{@const timeStr = start.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}
					{@const href = event.spondEventId ? `https://spond.com/client/sponds/${event.spondEventId}` : null}
					<li class="wp-spond-item" class:cancelled={event.cancelled} data-rsvp={event.rsvp}>
						<span class="wp-spond-dot" aria-hidden="true"></span>
						<span class="wp-spond-time">{timeStr}</span>
						{#if href}
							<a class="wp-spond-name" {href} target="_blank" rel="noopener noreferrer">{event.name}</a>
						{:else}
							<span class="wp-spond-name">{event.name}</span>
						{/if}
						{#if event.rsvp === 'unanswered'}
							<span class="wp-spond-rsvp wp-spond-rsvp--pending" title="Ikke svart">?</span>
						{:else if event.rsvp === 'declined'}
							<span class="wp-spond-rsvp wp-spond-rsvp--declined" title="Takket nei">✗</span>
						{/if}
						{#if event.groupName}
							<span class="wp-spond-group">{event.groupName}</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		<div class="wp-field-shell">
			<textarea
				class="wp-textarea"
				rows="2"
				placeholder={`Liten plan for ${smartDayLabel(selectedDayIso)}...`}
				value={selectedDayHeadline}
				oninput={(event) => {
					const target = event.currentTarget as HTMLTextAreaElement;
					onUpdateDayHeadline(selectedDayIso, target.value);
				}}
				onfocus={markInitialValue}
				onblur={async (event) => {
					submitOnBlurIfChanged(event);
					await onSaveDayHeadline();
				}}
			></textarea>
			<span class="wp-save-dot" class:is-saving={saveStateDayNote === 'saving'} class:is-saved={saveStateDayNote === 'saved'} aria-hidden="true"></span>
		</div>
	</div>

	{#if dayCloseMessage}
		<p class="wp-helper">{dayCloseMessage}</p>
	{/if}

	{#if selectedDayChecklist || selectedDayRoutines.length > 0}
		{#snippet dayTrailingBadge(item: ChecklistItemLike)}
			{#if item.metadata?.linkedTaskId}
				<span class="wp-intent-badge" title="Koblet til ukesmål: {item.metadata.linkedTaskTitle ?? ''}">
					{item.metadata.autoChecked ? '⚡' : '🔗'}
					{item.metadata.linkedTaskTitle
						? (item.metadata.linkedTaskTitle as string).slice(0, 24) + ((item.metadata.linkedTaskTitle as string).length > 24 ? '…' : '')
						: 'Ukesmål'}
				</span>
			{:else if item.metadata?.activityType}
				<span class="wp-intent-badge" title="Registrert som aktivitet – hakes av automatisk når en matchende økt synkes">
					{item.metadata.autoChecked ? '⚡' : activityTypeEmoji(item.metadata.activityType as string)}
					{item.metadata.autoChecked ? 'Auto-hakt' : 'Auto'}
				</span>
			{/if}
		{/snippet}

		{#snippet dayTrailingAction(item: ChecklistItemLike)}
			{#if selectedDayChecklist}
				<span class="wp-drag-handle" aria-hidden="true" ontouchstart={(event) => startTouchDrag(event, selectedDayChecklist.id, item.id)}>⋮⋮</span>
			{/if}
		{/snippet}

		<ul class="wp-checklist">
			{#each sortedDayEntries as entry}
				{#if entry.type === 'routine'}
					<li class="wp-check-row">
						<RoutineGroupRow
							routine={entry.routine}
							expanded={expandedRoutineIds.has(entry.routine.checklistId)}
							ontoggleexpand={() => onToggleRoutineExpansion(entry.routine.checklistId)}
							ontoggleitem={onRoutineItemToggle}
						/>
					</li>
				{:else if selectedDayChecklist}
					{@const item = entry.item}
					<li
						class="wp-check-row"
						class:is-dragging={dragItem?.itemId === item.id}
						class:is-drag-over={dragOverItemId === item.id && dragItem?.itemId !== item.id}
						data-item-id={item.id}
						draggable={editingItem?.itemId !== item.id}
						ondragstart={() => (dragItem = { checklistId: selectedDayChecklist.id, itemId: item.id })}
						ondragover={(event) => { event.preventDefault(); dragOverItemId = item.id; }}
						ondragleave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) dragOverItemId = null; }}
						ondrop={() => {
							if (!dragItem) return;
							void onReorderChecklistItems(selectedDayChecklist.id, dragItem.itemId, item.id);
							dragItem = null;
							dragOverItemId = null;
						}}
						ondragend={() => { dragItem = null; dragOverItemId = null; }}
					>
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
									class="btn-icon-danger"
									onmousedown={() => (skipEditBlur = true)}
									onclick={() => void onDeleteChecklistItem(selectedDayChecklist.id, item.id)}
									aria-label="Slett punkt"
								><Icon name="close" size={13} /></button>
							</div>
						{:else}
							<ChecklistItemRow
								{item}
								allItems={selectedDayChecklist.items}
								expandedParentIds={expandedDayParentIds}
								ontoggle={makeRowToggle(selectedDayChecklist.id)}
								ontextclick={makeRowTextClick(selectedDayChecklist.id)}
								onlongpress={makeRowLongpress(selectedDayChecklist.id)}
								onexpand={onToggleDayParent}
								onaddchild={makeRowAddChild(selectedDayChecklist.id)}
								animated={false}
								trailingBadge={dayTrailingBadge}
								trailingAction={dayTrailingAction}
							/>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>
	{/if}

	<div class="wp-add-form">
		<div class="wp-field-shell">
			<input
				bind:this={dayComposerInput}
				bind:value={dayComposerText}
				class="wp-input"
				type="text"
				placeholder="Ny oppgave (skriv @ for å nevne en person)"
				onkeydown={handleComposerKeydown}
			/>
			<MentionAutocomplete
				textareaEl={dayComposerInput}
				value={dayComposerText}
				onValueChange={(t) => (dayComposerText = t)}
			/>
			<span class="wp-save-dot" class:is-saving={saveStateDayItems === 'saving'} class:is-saved={saveStateDayItems === 'saved'} aria-hidden="true"></span>
		</div>
	</div>
</section>

<style>
	.wp-card {
		background: var(--card-bg);
		border: none;
		border-radius: var(--card-radius, 14px);
		padding: var(--card-padding, 12px);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wp-card-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
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
		border: none;
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

	.wp-day-wx {
		display: flex;
		align-items: center;
		gap: 1px;
		line-height: 1;
		margin-bottom: 1px;
	}
	.wp-day-wx-sym { font-size: 0.8rem; }
	.wp-day-wx-temp {
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--text-secondary);
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
		font-size: 0.72rem;
		color: var(--text-tertiary);
	}

	.wp-day-number {
		font-size: 0.95rem;
		color: var(--text-primary);
		font-weight: 700;
	}

	.wp-spond-list {
		margin: 0 0 0.9rem;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.wp-spond-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.22rem 0;
		font-size: 0.82rem;
		line-height: 1.3;
	}
	.wp-spond-item.cancelled {
		opacity: 0.35;
		text-decoration: line-through;
	}
	.wp-spond-dot {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #9b8ff5;
		flex-shrink: 0;
	}
	.wp-spond-item[data-rsvp="unanswered"] .wp-spond-dot { background: #f59e0b; }
	.wp-spond-item[data-rsvp="declined"] .wp-spond-dot { background: var(--text-muted); }
	.wp-spond-item[data-rsvp="accepted"] .wp-spond-dot { background: var(--success-text); }
	.wp-spond-time {
		color: var(--text-tertiary);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.wp-spond-name {
		color: var(--text-secondary);
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		text-decoration: none;
	}
	a.wp-spond-name:hover {
		color: var(--text-primary);
		text-decoration: underline;
	}
	.wp-spond-rsvp {
		font-size: 0.72rem;
		font-weight: 700;
		flex-shrink: 0;
	}
	.wp-spond-rsvp--pending { color: #f59e0b; }
	.wp-spond-rsvp--declined { color: #6b7280; }
	.wp-spond-group {
		color: var(--text-tertiary);
		font-size: 0.72rem;
		flex-shrink: 0;
		max-width: 35%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.wp-checklist {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.wp-check-row {
		border: none;
		background: #0e1119;
		border-radius: 10px;
		padding: 10px;
		touch-action: manipulation;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
	}

	.wp-edit-shell {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		align-items: center;
	}

	.wp-intent-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 0.68rem;
		color: rgba(100, 200, 170, 0.85);
		background: rgba(52, 211, 153, 0.08);
		border: 1px solid rgba(52, 211, 153, 0.18);
		border-radius: 6px;
		padding: 1px 6px;
		margin-left: 6px;
		vertical-align: middle;
		white-space: nowrap;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.wp-drag-handle {
		color: #5e6780;
		font-size: 0.92rem;
		cursor: grab;
		user-select: none;
		touch-action: none;
	}

	.wp-check-row.is-dragging {
		opacity: 0.35;
	}

	.wp-check-row.is-drag-over {
		box-shadow: 0 -2px 0 0 var(--accent-light);
		background: rgba(124, 142, 245, 0.08);
	}

	.wp-notes-form,
	.wp-add-form {
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
		border: none;
		color: var(--text-primary);
		border-radius: 10px;
		font: inherit;
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

	.wp-edit-input {
		height: 34px;
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
		background: var(--accent-light);
		animation: wp-dot-pulse 1s ease-in-out infinite;
	}

	.wp-save-dot.is-saved {
		background: #6ab08e;
		box-shadow: 0 0 0 5px rgba(106, 176, 142, 0.08);
	}

	@keyframes wp-dot-pulse {
		0% { box-shadow: 0 0 0 0 rgba(124, 142, 245, 0.22); }
		70% { box-shadow: 0 0 0 6px rgba(124, 142, 245, 0); }
		100% { box-shadow: 0 0 0 0 rgba(124, 142, 245, 0); }
	}

	.wp-helper {
		margin: 2px 0 0;
		font-size: 0.82rem;
		color: #76809c;
	}

	@media (max-width: 640px) {
		.wp-day-label {
			font-size: 0.62rem;
		}

		.wp-day-number {
			font-size: 0.78rem;
		}
	}
</style>
