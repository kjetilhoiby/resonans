<!--
  TripDayCalendar — per-dag gjøremålskalender for reise-tema.
  Viser hver dag i reiseperioden med tilhørende dagsjekkliste fra ukeplan.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import { groupChecklistItems, sortByStatus, sortByTime } from '$lib/utils/checklist-group';
	import type { ChecklistItemLike } from '$lib/types/checklist';
	import ChecklistItemRow from '$lib/components/ui/ChecklistItemRow.svelte';
	import ChecklistGroupRow from '$lib/components/ui/ChecklistGroupRow.svelte';
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import MentionAutocomplete from '$lib/components/ui/MentionAutocomplete.svelte';
	import { tripApi, type TripApi, type ChecklistItem, type DayForecast } from './trip-api';

	interface DayEntry {
		isoDate: string;
		label: string;
		dayNum: string;
		weekContext: string;
		dayContext: string;
		checklist: { id: string; items: ChecklistItem[] } | null;
	}

	interface Props {
		themeEmoji: string | null;
		startDate: string; // YYYY-MM-DD
		endDate: string;   // YYYY-MM-DD
		dailyWeather?: DayForecast[];
		api?: TripApi;
	}

	let { themeEmoji, startDate, endDate, dailyWeather = [], api = tripApi }: Props = $props();

	const weatherByDate = $derived(new Map(dailyWeather.map((d) => [d.date, d])));

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

	// ── ISO week key helper ─────────────────────────────────
	function isoWeekKey(isoDate: string): string {
		const [y, m, d] = isoDate.split('-').map(Number);
		const date = new Date(Date.UTC(y, m - 1, d));
		const dayNum = date.getUTCDay() || 7;
		date.setUTCDate(date.getUTCDate() + 4 - dayNum);
		const year = date.getUTCFullYear();
		const yearStart = new Date(Date.UTC(year, 0, 1));
		const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
		return `${year}-W${String(weekNo).padStart(2, '0')}`;
	}

	// ── Generate all days between startDate and endDate inclusive ──
	function generateDays(start: string, end: string): DayEntry[] {
		const days: DayEntry[] = [];
		const cur = new Date(start + 'T00:00:00Z');
		const last = new Date(end + 'T00:00:00Z');
		while (cur <= last) {
			const isoDate = cur.toISOString().slice(0, 10);
			const wk = isoWeekKey(isoDate);
			const weekContext = `week:${wk}`;
			const dayContext = `${weekContext}:day:${isoDate}`;
			days.push({
				isoDate,
				label: new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'short' }).format(cur),
				dayNum: String(cur.getUTCDate()),
				weekContext,
				dayContext,
				checklist: null
			});
			cur.setUTCDate(cur.getUTCDate() + 1);
		}
		return days;
	}

	let days = $state<DayEntry[]>([]);
	$effect(() => { days = generateDays(startDate, endDate); });
	let loading = $state(true);

	// Per-day composer state
	let composerText = $state<Record<string, string>>({});
	let composerSaving = $state<Record<string, boolean>>({});
	let toggleSaving = $state<Record<string, boolean>>({});
	let expandedDay = $state<string | null>(null);
	let contextMenuDay = $state<DayEntry | null>(null);
	let contextMenuItem = $state<ChecklistItem | null>(null);
	let contextMenuRect = $state<DOMRect | null>(null);
	let editingItemId = $state<string | null>(null);
	let editingText = $state('');
	let expandedParentIds = $state<Set<string>>(new Set());
	let composerInputEl = $state<HTMLInputElement | null>(null);

	const todayIso = new Date().toISOString().slice(0, 10);

	onMount(async () => {
		const contexts = days.map((d) => d.dayContext);
		if (contexts.length === 0) { loading = false; return; }

		try {
			const rows = await api.getChecklists(contexts);
			if (!rows) return;

			// Build lookup by context
			const byContext = new Map(rows.map((r) => [r.context, r]));
			days = days.map((d) => {
				const found = byContext.get(d.dayContext);
				return found ? { ...d, checklist: { id: found.id, items: found.items } } : d;
			});
		} finally {
			loading = false;
		}
	});

	// Ensure a day checklist exists, update local state
	async function ensureChecklist(day: DayEntry): Promise<{ id: string; items: ChecklistItem[] } | null> {
		if (day.checklist) return day.checklist;

		const created = await api.createChecklist({
			title: `Dag ${day.isoDate}`,
			emoji: themeEmoji ?? '🗺️',
			context: day.dayContext
		});
		if (!created) return null;

		days = days.map((d) =>
			d.isoDate === day.isoDate
				? { ...d, checklist: { id: created.id, items: created.items ?? [] } }
				: d
		);
		return { id: created.id, items: created.items ?? [] };
	}

	async function addItem(day: DayEntry) {
		const text = (composerText[day.isoDate] ?? '').trim();
		if (!text) return;
		composerSaving = { ...composerSaving, [day.isoDate]: true };
		try {
			const cl = await ensureChecklist(day);
			if (!cl) return;
			const currentItems = days.find((d) => d.isoDate === day.isoDate)?.checklist?.items ?? [];
			const created = await api.addChecklistItems(cl.id, text, currentItems.length);
			if (!created) return;
			updateDayItems(day.isoDate, items => [...items, ...created]);
			composerText = { ...composerText, [day.isoDate]: '' };
		} finally {
			composerSaving = { ...composerSaving, [day.isoDate]: false };
		}
	}

	function updateDayItems(isoDate: string, fn: (items: ChecklistItem[]) => ChecklistItem[]) {
		days = days.map(d =>
			d.isoDate === isoDate && d.checklist
				? { ...d, checklist: { ...d.checklist, items: fn(d.checklist.items) } }
				: d
		);
	}

	async function toggleItem(day: DayEntry, item: ChecklistItem) {
		if (!day.checklist) return;
		const key = `${day.isoDate}:${item.id}`;
		toggleSaving = { ...toggleSaving, [key]: true };
		updateDayItems(day.isoDate, items => items.map(i => i.id === item.id ? { ...i, checked: !i.checked } : i));
		try {
			const ok = await api.patchChecklistItem(day.checklist.id, item.id, { checked: !item.checked });
			if (!ok) updateDayItems(day.isoDate, items => items.map(i => i.id === item.id ? { ...i, checked: item.checked } : i));
		} finally {
			toggleSaving = { ...toggleSaving, [key]: false };
		}
	}

	function handleLongpress(day: DayEntry) {
		return (rect: DOMRect, item: ChecklistItemLike) => {
			contextMenuDay = day;
			contextMenuItem = item as ChecklistItem;
			contextMenuRect = rect;
		};
	}

	function handleTextClick(day: DayEntry) {
		return (item: ChecklistItemLike) => {
			contextMenuDay = day;
			editingItemId = item.id;
			editingText = item.text;
		};
	}

	function handleToggle(day: DayEntry) {
		return (item: ChecklistItemLike) => {
			toggleItem(day, item as ChecklistItem);
		};
	}

	async function commitEdit() {
		if (!editingItemId || !contextMenuDay?.checklist) return;
		const day = contextMenuDay;
		const itemId = editingItemId;
		const text = editingText.trim();
		editingItemId = null;
		editingText = '';
		if (!text || !day.checklist) return;
		updateDayItems(day.isoDate, items => items.map(i => i.id === itemId ? { ...i, text } : i));
		await api.patchChecklistItem(day.checklist.id, itemId, { text });
	}

	async function skipItem() {
		if (!contextMenuItem || !contextMenuDay?.checklist) return;
		const day = contextMenuDay;
		const item = contextMenuItem;
		const skipped = !item.skippedAt;
		contextMenuItem = null;
		contextMenuRect = null;
		updateDayItems(day.isoDate, items => items.map(i => i.id === item.id ? { ...i, skippedAt: skipped ? new Date().toISOString() : null } : i));
		await api.patchChecklistItem(day.checklist!.id, item.id, { skippedAt: skipped ? new Date().toISOString() : null });
	}

	async function snoozeItem(targetDate: string) {
		if (!contextMenuItem || !contextMenuDay?.checklist) return;
		const day = contextMenuDay;
		const itemId = contextMenuItem.id;
		contextMenuItem = null;
		contextMenuRect = null;
		updateDayItems(day.isoDate, items => items.filter(i => i.id !== itemId));
		await api.patchChecklistItem(day.checklist!.id, itemId, { snoozedToDate: targetDate });
	}

	function toggleParentExpansion(parentId: string) {
		const next = new Set(expandedParentIds);
		if (next.has(parentId)) next.delete(parentId);
		else next.add(parentId);
		expandedParentIds = next;
	}

	function makeAddChild(day: DayEntry) {
		return async (parentId: string, text: string) => {
			if (!day.checklist) return;
			const created = await api.addChecklistItems(day.checklist.id, text, day.checklist.items.length, parentId);
			if (!created) return;
			updateDayItems(day.isoDate, items => [...items, ...created]);
		};
	}

	async function handleDeleteItem() {
		if (!contextMenuItem || !contextMenuDay?.checklist) return;
		const day = contextMenuDay;
		const itemId = contextMenuItem.id;
		contextMenuItem = null;
		contextMenuRect = null;
		if (!day.checklist) return;
		updateDayItems(day.isoDate, items => items.filter(i => i.id !== itemId));
		await api.deleteChecklistItem(day.checklist.id, itemId);
	}
</script>

<div class="tdc">
	<SectionLabel>📅 Dagsprogram</SectionLabel>

	{#if loading}
		<p class="tdc-loading">Laster dagsprogram…</p>
	{:else}
		<div class="tdc-days">
			{#each days as day}
				{@const isToday = day.isoDate === todayIso}
				{@const itemCount = day.checklist?.items.length ?? 0}
				{@const doneCount = day.checklist?.items.filter((i) => i.checked).length ?? 0}
				{@const isExpanded = expandedDay === day.isoDate}
				{@const wx = weatherByDate.get(day.isoDate)}

				<div
					class="tdc-day"
					class:tdc-day-today={isToday}
					class:tdc-day-expanded={isExpanded}
				>
					<button
						type="button"
						class="tdc-day-header"
						onclick={() => { expandedDay = isExpanded ? null : day.isoDate; }}
						aria-expanded={isExpanded}
					>
						<span class="tdc-day-label">{day.label}</span>
						{#if wx}
							<span class="tdc-wx">
								<span class="tdc-wx-sym">{metSymbolToEmoji(wx.symbolCode)}</span>
								<span class="tdc-wx-temps"><span class="tdc-wx-max">↑{wx.tempMax}°</span><span class="tdc-wx-min">↓{wx.tempMin}°</span></span>
								{#if wx.precipitation > 0}<span class="tdc-wx-precip">💧{wx.precipitation}</span>{/if}
								<span class="tdc-wx-wind">💨{wx.wind}</span>
							</span>
						{/if}
						{#if itemCount > 0}
							<span class="tdc-day-badge">{doneCount}/{itemCount}</span>
						{/if}
						<span class="tdc-day-chevron">{isExpanded ? '▲' : '▼'}</span>
					</button>

					{#if isExpanded}
						<div class="tdc-day-body">
							{#if itemCount === 0}
								<p class="tdc-empty">Ingen gjøremål ennå</p>
							{:else}
								<ul class="tdc-items">
								{#each groupChecklistItems(sortByStatus(sortByTime(day.checklist!.items.filter(i => !i.parentId)))) as group}
									{#if group.type === 'group'}
										<li class="tdc-group-item">
											<ChecklistGroupRow
												label={group.label}
												items={group.items}
												allItems={day.checklist!.items}
												animated={false}
												ontoggle={handleToggle(day)}
												onlongpress={handleLongpress(day)}
											/>
										</li>
									{:else}
										<li class="tdc-item">
											<ChecklistItemRow
												item={group.item}
												allItems={day.checklist!.items}
												{expandedParentIds}
												animated={false}
												editing={editingItemId === group.item.id}
												bind:editText={editingText}
												ontoggle={handleToggle(day)}
												ontextclick={handleTextClick(day)}
												onlongpress={handleLongpress(day)}
												onexpand={toggleParentExpansion}
												onaddchild={makeAddChild(day)}
												oneditcommit={() => commitEdit()}
												oneditcancel={() => { editingItemId = null; editingText = ''; }}
											/>
										</li>
									{/if}
								{/each}
								</ul>
							{/if}

							<div class="tdc-composer">
								<input
									bind:this={composerInputEl}
									class="tdc-input"
									type="text"
									placeholder="Ny oppgave (skriv @ for å nevne en person)"
									value={composerText[day.isoDate] ?? ''}
									oninput={(e) => { composerText = { ...composerText, [day.isoDate]: (e.currentTarget as HTMLInputElement).value }; }}
									onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && addItem(day)}
									disabled={!!composerSaving[day.isoDate]}
								/>
								<MentionAutocomplete
									textareaEl={composerInputEl}
									value={composerText[day.isoDate] ?? ''}
									onValueChange={(t) => { composerText = { ...composerText, [day.isoDate]: t }; }}
								/>
								<button
									type="button"
									class="tdc-add-btn"
									onclick={() => addItem(day)}
									disabled={!!composerSaving[day.isoDate] || !(composerText[day.isoDate] ?? '').trim()}
								>+</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<TaskContextMenu
	open={!!contextMenuItem}
	anchor={contextMenuRect}
	itemText={contextMenuItem?.text ?? ''}
	isChecked={contextMenuItem?.checked ?? false}
	isSkipped={!!contextMenuItem?.skippedAt}
	onClose={() => { contextMenuItem = null; contextMenuRect = null; }}
	onEdit={() => {
		if (contextMenuItem) {
			contextMenuDay = contextMenuDay;
			editingItemId = contextMenuItem.id;
			editingText = contextMenuItem.text;
		}
		contextMenuItem = null;
		contextMenuRect = null;
	}}
	onSkip={skipItem}
	onUnskip={skipItem}
	onSnooze={snoozeItem}
	onDelete={handleDeleteItem}
/>

<style>
	.tdc {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.tdc-loading {
		font-size: 0.84rem;
		color: var(--tp-text-muted);
		margin: 0;
	}

	.tdc-days {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.tdc-day {
		border: 1px solid var(--tp-border);
		border-radius: 10px;
		background: var(--tp-bg-2);
		overflow: hidden;
	}

	.tdc-day-today {
		border-color: var(--tp-accent);
	}

	.tdc-day-header {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
	}

	.tdc-day-label {
		flex: 1;
		font-size: 0.84rem;
		color: var(--tp-text-soft);
		text-transform: capitalize;
	}

	.tdc-day-today .tdc-day-label {
		color: var(--tp-accent);
		font-weight: 600;
	}

	.tdc-day-badge {
		font-size: 0.7rem;
		color: var(--tp-text-muted);
		background: var(--tp-bg-1);
		border-radius: 20px;
		padding: 2px 7px;
	}

	.tdc-day-chevron {
		font-size: 0.6rem;
		color: var(--tp-text-muted);
	}

	/* Inline weather in day header */
	.tdc-wx {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 0.7rem;
		flex-shrink: 0;
	}
	.tdc-wx-sym { font-size: 0.95rem; line-height: 1; }
	.tdc-wx-temps { display: flex; gap: 2px; font-weight: 600; }
	.tdc-wx-max { color: var(--tp-text); }
	.tdc-wx-min { color: var(--tp-text-muted); }
	.tdc-wx-precip { color: var(--trip-precip, #5b9bd8); }
	.tdc-wx-wind { color: var(--tp-text-muted); }

	.tdc-day-body {
		padding: 0 12px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.tdc-empty {
		font-size: 0.8rem;
		color: var(--tp-text-muted);
		margin: 0;
	}

	.tdc-items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tdc-composer {
		display: flex;
		gap: 6px;
	}

	.tdc-input {
		flex: 1;
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		border-radius: 8px;
		padding: 6px 10px;
		font-size: 0.84rem;
		color: var(--tp-text);
		outline: none;
	}

	.tdc-input:focus {
		border-color: var(--tp-border-strong);
	}

	.tdc-add-btn {
		background: var(--tp-accent-bg);
		border: 1px solid var(--tp-border-strong);
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 1rem;
		color: var(--tp-accent);
		cursor: pointer;
	}

	.tdc-add-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
