<!--
  TripDayCalendar — per-dag gjøremålskalender for reise-tema.
  Viser hver dag i reiseperioden med tilhørende dagsjekkliste fra ukeplan.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { groupChecklistItems, activityEmoji } from '$lib/utils/checklist-group';

	interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
	}

	interface DayForecast {
		date: string;
		symbolCode: string;
		tempMin: number;
		tempMax: number;
		wind: number;
		precipitation: number;
	}

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
	}

	let { themeEmoji, startDate, endDate, dailyWeather = [] }: Props = $props();

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

	let days = $state<DayEntry[]>(generateDays(startDate, endDate));
	let loading = $state(true);

	// Per-day composer state
	let composerText = $state<Record<string, string>>({});
	let composerSaving = $state<Record<string, boolean>>({});
	let toggleSaving = $state<Record<string, boolean>>({});
	let expandedDay = $state<string | null>(null);

	const todayIso = new Date().toISOString().slice(0, 10);

	onMount(async () => {
		const contexts = days.map((d) => d.dayContext);
		if (contexts.length === 0) { loading = false; return; }

		try {
			const res = await fetch(`/api/checklists?contexts=${encodeURIComponent(contexts.join(','))}`);
			if (!res.ok) return;
			const rows = await res.json() as Array<{ id: string; context: string | null; items: ChecklistItem[] }>;

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

		const res = await fetch('/api/checklists', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				title: `Dag ${day.isoDate}`,
				emoji: themeEmoji ?? '🗺️',
				context: day.dayContext
			})
		});
		if (!res.ok) return null;
		const created = await res.json() as { id: string; title: string; items: ChecklistItem[] };

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
			const res = await fetch(`/api/checklists/${cl.id}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text, sortOrder: currentItems.length })
			});
			if (!res.ok) return;
			const newItem = await res.json() as ChecklistItem;

			days = days.map((d) =>
				d.isoDate === day.isoDate && d.checklist
					? { ...d, checklist: { ...d.checklist, items: [...d.checklist.items, newItem] } }
					: d
			);
			composerText = { ...composerText, [day.isoDate]: '' };
		} finally {
			composerSaving = { ...composerSaving, [day.isoDate]: false };
		}
	}

	async function toggleItem(day: DayEntry, item: ChecklistItem) {
		if (!day.checklist) return;
		const key = `${day.isoDate}:${item.id}`;
		toggleSaving = { ...toggleSaving, [key]: true };

		// Optimistic
		days = days.map((d) =>
			d.isoDate === day.isoDate && d.checklist
				? { ...d, checklist: { ...d.checklist, items: d.checklist.items.map((i) => i.id === item.id ? { ...i, checked: !i.checked } : i) } }
				: d
		);

		try {
			const res = await fetch(`/api/checklists/${day.checklist.id}/items/${item.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ checked: !item.checked })
			});
			if (!res.ok) {
				// rollback
				days = days.map((d) =>
					d.isoDate === day.isoDate && d.checklist
						? { ...d, checklist: { ...d.checklist, items: d.checklist.items.map((i) => i.id === item.id ? { ...i, checked: item.checked } : i) } }
						: d
				);
			}
		} finally {
			toggleSaving = { ...toggleSaving, [key]: false };
		}
	}
</script>

<div class="tdc">
	<h3 class="tdc-title">📅 Dagsprogram</h3>

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
								{#each groupChecklistItems(day.checklist!.items) as group}
									{#if group.type === 'group'}
										<li class="tdc-group-item">
											<span class="tdc-group-label">{activityEmoji(group.label) ? activityEmoji(group.label) + ' ' : ''}{group.label}</span>
											<div class="tdc-slot-row">
												{#each group.items as item (item.id)}
													<button
														type="button"
														class="tdc-slot"
														class:tdc-slot-done={item.checked}
														onclick={() => toggleItem(day, item)}
														disabled={!!toggleSaving[`${day.isoDate}:${item.id}`]}
														aria-label={item.checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
													>{item.checked ? '✓' : ''}</button>
												{/each}
											</div>
										</li>
									{:else}
										<li class="tdc-item" class:tdc-item-done={group.item.checked}>
											<button
												type="button"
												class="tdc-check-btn"
												onclick={() => toggleItem(day, group.item)}
												disabled={!!toggleSaving[`${day.isoDate}:${group.item.id}`]}
												aria-label={group.item.checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
											>
												{group.item.checked ? '✓' : '○'}
											</button>
											<span class="tdc-item-text">{group.item.text}</span>
										</li>
									{/if}
									{/each}
								</ul>
							{/if}

							<div class="tdc-composer">
								<input
									class="tdc-input"
									type="text"
									placeholder="Legg til gjøremål…"
									value={composerText[day.isoDate] ?? ''}
									oninput={(e) => { composerText = { ...composerText, [day.isoDate]: (e.currentTarget as HTMLInputElement).value }; }}
									onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && addItem(day)}
									disabled={!!composerSaving[day.isoDate]}
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

<style>
	.tdc {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.tdc-title {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--tp-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.06em;
		margin: 0;
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
	.tdc-wx-precip { color: #5b9bd8; }
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

	.tdc-item {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.tdc-item-done .tdc-item-text {
		text-decoration: line-through;
		color: var(--tp-text-muted);
	}

	/* ── Grouped items ── */
	.tdc-group-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		padding: 4px 0;
	}

	.tdc-group-label {
		font-size: 0.84rem;
		color: var(--tp-text-soft);
		flex: 1;
		min-width: 0;
	}

	.tdc-slot-row {
		display: flex;
		gap: 5px;
		flex-shrink: 0;
	}

	.tdc-slot {
		width: 24px;
		height: 24px;
		border-radius: 50%;
		border: 1px solid var(--tp-border-strong);
		background: none;
		color: var(--tp-accent);
		font-size: 0.7rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		transition: background 0.15s, border-color 0.15s;
	}
	.tdc-slot.tdc-slot-done {
		background: var(--tp-accent-bg);
		border-color: var(--tp-accent);
		color: var(--tp-accent);
	}

	.tdc-check-btn {
		background: none;
		border: 1px solid var(--tp-border-strong);
		border-radius: 50%;
		width: 22px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		cursor: pointer;
		flex-shrink: 0;
		color: var(--tp-text-muted);
		padding: 0;
	}

	.tdc-item-done .tdc-check-btn {
		background: var(--tp-accent-bg);
		border-color: var(--tp-accent);
		color: var(--tp-accent);
	}

	.tdc-item-text {
		font-size: 0.84rem;
		color: var(--tp-text-soft);
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
