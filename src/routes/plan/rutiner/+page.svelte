<script lang="ts">
	import { tick } from 'svelte';
	import { Button, Input, ChecklistCheckbox } from '$lib/components/ui';
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	type Slot = 'morning' | 'afternoon' | 'evening' | 'flex';

	interface RoutineItem {
		text: string;
		estimateMinutes?: number;
		sortOrder?: number;
	}

	interface Routine {
		id: string;
		title: string;
		emoji: string;
		slot: Slot;
		daysOfWeek: number[];
		items: RoutineItem[];
		active: boolean;
		sortOrder: number;
	}

	interface TodaysItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		estimateMinutes: number | null;
	}

	interface TodaysRoutine {
		definitionId: string;
		title: string;
		emoji: string;
		slot: Slot;
		checklistId: string;
		date: string;
		completedAt: string | null;
		items: TodaysItem[];
	}

	let { data }: { data: PageData } = $props();

	const SLOT_LABEL: Record<Slot, string> = {
		morning: 'Morgen',
		afternoon: 'Ettermiddag',
		evening: 'Kveld',
		flex: 'Fleksibel'
	};
	const SLOT_ORDER: Slot[] = ['morning', 'afternoon', 'evening', 'flex'];

	const DAYS = [
		{ value: 1, short: 'Ma' },
		{ value: 2, short: 'Ti' },
		{ value: 3, short: 'On' },
		{ value: 4, short: 'To' },
		{ value: 5, short: 'Fr' },
		{ value: 6, short: 'Lø' },
		{ value: 0, short: 'Sø' }
	];

	const WEEKDAYS = [1, 2, 3, 4, 5];
	const WEEKEND = [0, 6];
	const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

	let editing = $state<{
		id: string | null;
		title: string;
		emoji: string;
		slot: Slot;
		daysOfWeek: number[];
		items: string[];
	} | null>(null);

	let saving = $state(false);
	let deleting = $state<string | null>(null);

	function newRoutineDraft(slot: Slot = 'morning') {
		editing = {
			id: null,
			title: '',
			emoji: '🔁',
			slot,
			daysOfWeek: ALL_DAYS,
			items: ['']
		};
	}

	function editRoutine(r: Routine) {
		editing = {
			id: r.id,
			title: r.title,
			emoji: r.emoji,
			slot: r.slot,
			daysOfWeek: [...r.daysOfWeek],
			items: r.items.length ? [...r.items.map((it) => it.text), ''] : ['']
		};
	}

	function cancel() {
		editing = null;
	}

	function toggleDay(day: number) {
		if (!editing) return;
		const set = new Set(editing.daysOfWeek);
		if (set.has(day)) set.delete(day);
		else set.add(day);
		editing.daysOfWeek = [...set].sort((a, b) => a - b);
	}

	function setDays(days: number[]) {
		if (!editing) return;
		editing.daysOfWeek = [...days].sort((a, b) => a - b);
	}

	function arraysEqual(a: number[], b: number[]) {
		if (a.length !== b.length) return false;
		const as = [...a].sort();
		const bs = [...b].sort();
		return as.every((v, i) => v === bs[i]);
	}

	function addItem() {
		if (!editing) return;
		editing.items = [...editing.items, ''];
		tick().then(() => {
			const inputs = document.querySelectorAll<HTMLInputElement>('.item-editor input');
			inputs[inputs.length - 1]?.focus();
		});
	}

	function handleItemKeydown(e: KeyboardEvent, idx: number) {
		if (!editing) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			if (editing.items[idx].trim()) {
				editing.items = [...editing.items.slice(0, idx + 1), '', ...editing.items.slice(idx + 1)];
				tick().then(() => {
					const inputs = document.querySelectorAll<HTMLInputElement>('.item-editor input');
					inputs[idx + 1]?.focus();
				});
			}
		} else if (e.key === 'Backspace' && editing.items[idx] === '' && editing.items.length > 1) {
			e.preventDefault();
			editing.items = editing.items.filter((_, i) => i !== idx);
			tick().then(() => {
				const inputs = document.querySelectorAll<HTMLInputElement>('.item-editor input');
				inputs[Math.max(0, idx - 1)]?.focus();
			});
		}
	}

	function removeItem(idx: number) {
		if (!editing) return;
		editing.items = editing.items.filter((_, i) => i !== idx);
		if (editing.items.length === 0) editing.items = [''];
	}

	function moveItem(idx: number, dir: -1 | 1) {
		if (!editing) return;
		const next = [...editing.items];
		const target = idx + dir;
		if (target < 0 || target >= next.length) return;
		[next[idx], next[target]] = [next[target], next[idx]];
		editing.items = next;
	}

	async function save() {
		if (!editing) return;
		const title = editing.title.trim();
		if (!title) return;
		if (editing.daysOfWeek.length === 0) return;
		const cleanItems = editing.items.map((s) => s.trim()).filter((s) => s.length > 0);
		if (cleanItems.length === 0) return;

		saving = true;
		try {
			const body = {
				title,
				emoji: editing.emoji || '🔁',
				slot: editing.slot,
				daysOfWeek: editing.daysOfWeek,
				items: cleanItems
			};
			const url = editing.id ? `/api/routines/${editing.id}` : '/api/routines';
			const method = editing.id ? 'PUT' : 'POST';
			const res = await fetch(url, {
				method,
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (!res.ok) {
				console.error('Lagring feilet:', await res.text());
				return;
			}
			editing = null;
			await invalidateAll();
		} finally {
			saving = false;
		}
	}

	async function remove(id: string) {
		if (!confirm('Slette denne rutinen?')) return;
		deleting = id;
		try {
			const res = await fetch(`/api/routines/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				console.error('Sletting feilet:', await res.text());
				return;
			}
			await invalidateAll();
		} finally {
			deleting = null;
		}
	}

	function formatDays(days: number[]): string {
		if (days.length === 0) return 'ingen dager';
		if (arraysEqual(days, ALL_DAYS)) return 'hver dag';
		if (arraysEqual(days, WEEKDAYS)) return 'hverdager';
		if (arraysEqual(days, WEEKEND)) return 'helg';
		return DAYS.filter((d) => days.includes(d.value)).map((d) => d.short).join(', ');
	}

	const grouped = $derived.by(() => {
		const groups: Record<Slot, Routine[]> = { morning: [], afternoon: [], evening: [], flex: [] };
		for (const r of data.routines as Routine[]) {
			groups[r.slot].push(r);
		}
		for (const slot of SLOT_ORDER) {
			groups[slot].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
		}
		return groups;
	});

	const todaysBySlot = $derived.by(() => {
		const groups: Record<Slot, TodaysRoutine[]> = { morning: [], afternoon: [], evening: [], flex: [] };
		for (const r of (data.todaysRoutines ?? []) as TodaysRoutine[]) groups[r.slot].push(r);
		return groups;
	});

	const SLOT_WINDOWS: Record<Slot, [number, number]> = {
		morning: [4, 12],
		afternoon: [12, 17],
		evening: [17, 24],
		flex: [0, 24]
	};

	function currentHour(): number {
		try {
			const h = new Intl.DateTimeFormat('en-GB', {
				timeZone: 'Europe/Oslo',
				hour: '2-digit',
				hour12: false
			}).format(new Date());
			return parseInt(h, 10);
		} catch {
			return new Date().getHours();
		}
	}

	function isSlotActive(slot: Slot, hour: number): boolean {
		const [start, end] = SLOT_WINDOWS[slot];
		return hour >= start && hour < end;
	}

	const hour = $derived(currentHour());

	let pendingItem = $state<string | null>(null);

	async function toggleItem(routine: TodaysRoutine, item: TodaysItem) {
		if (pendingItem === item.id) return;
		pendingItem = item.id;
		try {
			const res = await fetch(`/api/checklists/${routine.checklistId}/items/${item.id}`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ checked: !item.checked })
			});
			if (!res.ok) {
				console.error('Kunne ikke oppdatere item:', await res.text());
				return;
			}
			await invalidateAll();
		} finally {
			pendingItem = null;
		}
	}
</script>

<svelte:head>
	<title>Rutiner · Resonans</title>
</svelte:head>

<div class="rutiner">
	{#if (data.todaysRoutines ?? []).length > 0}
		<section class="today">
			<header class="today-head">
				<h2>I dag</h2>
				<span class="today-date">{(data.todaysRoutines as TodaysRoutine[])[0].date}</span>
			</header>
			<div class="today-grid">
				{#each SLOT_ORDER as slot (slot)}
					{#if todaysBySlot[slot].length > 0}
						<div class="today-column" class:active={isSlotActive(slot, hour)}>
							<h3>{SLOT_LABEL[slot]}</h3>
							{#each todaysBySlot[slot] as routine (routine.definitionId)}
								<article class="today-card">
									<header>
										<span class="emoji">{routine.emoji}</span>
										<span class="title">{routine.title}</span>
									</header>
									<ul class="checks">
										{#each routine.items as item (item.id)}
											<li class:checked={item.checked}>
												<ChecklistCheckbox
													checked={item.checked}
													size="sm"
													onclick={() => toggleItem(routine, item)}
												/>
												<span class="text"><TaskTitle title={item.text} /></span>
											</li>
										{/each}
									</ul>
								</article>
							{/each}
						</div>
					{/if}
				{/each}
			</div>
		</section>
	{/if}

	<section class="manage">
		<header class="manage-head">
			<h2>Mine rutiner</h2>
			<Button onClick={() => newRoutineDraft('morning')}>Ny rutine</Button>
		</header>

		{#each SLOT_ORDER as slot (slot)}
			<section class="slot-section">
				<h3>{SLOT_LABEL[slot]}</h3>
				{#if grouped[slot].length === 0}
					<p class="empty">Ingen rutiner i denne luken.</p>
				{:else}
					<ul class="routine-list">
						{#each grouped[slot] as r (r.id)}
							<li class="routine-card">
								<header>
									<span class="emoji">{r.emoji}</span>
									<div class="meta">
										<h4>{r.title}</h4>
										<p class="days">{formatDays(r.daysOfWeek)} · {r.items.length} punkt{r.items.length === 1 ? '' : 'er'}</p>
									</div>
									<div class="actions">
										<Button variant="ghost" onClick={() => editRoutine(r)}>Rediger</Button>
										<Button variant="ghost" onClick={() => remove(r.id)} disabled={deleting === r.id}>
											{deleting === r.id ? '…' : 'Slett'}
										</Button>
									</div>
								</header>
								<ol class="items">
									{#each r.items as it (it.text + it.sortOrder)}
										<li>{it.text}</li>
									{/each}
								</ol>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/each}
	</section>
</div>

{#if editing}
	<div class="modal-backdrop" role="dialog" aria-modal="true">
		<div class="modal">
			<header>
				<h2>{editing.id ? 'Rediger rutine' : 'Ny rutine'}</h2>
				<button class="close" onclick={cancel} aria-label="Lukk">×</button>
			</header>

			<div class="field">
				<label for="title">Tittel</label>
				<Input id="title" bind:value={editing.title} placeholder="Lørdag morgen" />
			</div>

			<div class="field row">
				<div class="emoji-field">
					<label for="emoji">Emoji</label>
					<input id="emoji" bind:value={editing.emoji} class="emoji-input" />
				</div>
				<div class="slot-field">
					<label for="slot">Tidspunkt</label>
					<select id="slot" bind:value={editing.slot}>
						{#each SLOT_ORDER as s (s)}
							<option value={s}>{SLOT_LABEL[s]}</option>
						{/each}
					</select>
				</div>
			</div>

			<div class="field">
				<div class="label-row">
					<span>Dager</span>
					<div class="day-presets">
						<button type="button" onclick={() => setDays(WEEKDAYS)} class:active={arraysEqual(editing.daysOfWeek, WEEKDAYS)}>Hverdager</button>
						<button type="button" onclick={() => setDays(WEEKEND)} class:active={arraysEqual(editing.daysOfWeek, WEEKEND)}>Helg</button>
						<button type="button" onclick={() => setDays(ALL_DAYS)} class:active={arraysEqual(editing.daysOfWeek, ALL_DAYS)}>Hver dag</button>
					</div>
				</div>
				<div class="day-chips">
					{#each DAYS as d (d.value)}
						<button
							type="button"
							class:active={editing.daysOfWeek.includes(d.value)}
							onclick={() => toggleDay(d.value)}
						>
							{d.short}
						</button>
					{/each}
				</div>
			</div>

			<div class="field">
				<span class="label-row">Punkter</span>
				<ul class="item-editor">
					{#each editing.items as _, idx (idx)}
						<li>
							<input
								bind:value={editing.items[idx]}
								placeholder={idx === editing.items.length - 1 ? 'Nytt punkt...' : ''}
								onkeydown={(e) => handleItemKeydown(e, idx)}
							/>
							{#if editing.items[idx].trim()}
								<button type="button" class="reorder-btn" onclick={() => moveItem(idx, -1)} disabled={idx === 0} aria-label="Flytt opp">↑</button>
								<button type="button" class="reorder-btn" onclick={() => moveItem(idx, 1)} disabled={idx >= editing.items.filter(s => s.trim()).length - 1} aria-label="Flytt ned">↓</button>
								<button type="button" class="remove-btn" onclick={() => removeItem(idx)} aria-label="Fjern">×</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>

			<footer>
				<Button variant="ghost" onClick={cancel}>Avbryt</Button>
				<Button onClick={save} disabled={saving}>{saving ? 'Lagrer…' : editing.id ? 'Lagre' : 'Opprett'}</Button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.rutiner {
		display: flex;
		flex-direction: column;
		gap: 28px;
		padding: 16px 0 32px;
	}

	/* I dag */
	.today {
		padding: 0 16px;
	}
	.today-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		margin-bottom: 0.75rem;
	}
	.today-head h2 {
		margin: 0;
		font-size: 1.1rem;
		color: var(--text-primary, #fff);
	}
	.today-date {
		font-size: 0.85rem;
		color: var(--text-secondary, #888);
	}
	.today-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 12px;
	}
	.today-column {
		display: flex;
		flex-direction: column;
		gap: 8px;
		opacity: 0.65;
		transition: opacity 0.2s;
	}
	.today-column.active {
		opacity: 1;
	}
	.today-column h3 {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary, #888);
	}
	.today-column.active h3 {
		color: var(--accent-primary, #7c8ef5);
	}
	.today-card {
		background: var(--bg-secondary, #1a1a1a);
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 12px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.today-card > header {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.today-card .emoji {
		font-size: 1.05rem;
	}
	.today-card .title {
		font-weight: 600;
		font-size: 0.92rem;
		color: var(--text-primary, #fff);
	}
	.checks {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.checks li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		font-size: 0.88rem;
		color: #ccc;
		line-height: 1.4;
	}
	.checks li.checked .text {
		text-decoration: line-through;
		color: #444;
	}

	/* Mine rutiner */
	.manage-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 16px;
		margin-bottom: 12px;
	}
	.manage-head h2 {
		margin: 0;
		font-size: 1.1rem;
		color: var(--text-primary, #fff);
	}
	.slot-section {
		padding: 0 16px;
		margin-bottom: 20px;
	}
	.slot-section h3 {
		margin: 0 0 0.5rem;
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary, #888);
	}
	.meta h4 {
		margin: 0;
		font-size: 1rem;
		color: var(--text-primary, #fff);
	}
	.empty {
		color: var(--text-secondary, #888);
		font-size: 0.9rem;
		margin: 0;
	}
	.routine-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.routine-card {
		background: var(--bg-secondary, #1a1a1a);
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 12px;
		padding: 14px 16px;
	}
	.routine-card header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}
	.emoji {
		font-size: 1.5rem;
		line-height: 1;
	}
	.meta {
		flex: 1;
		min-width: 0;
	}
	.meta h3 {
		margin: 0;
		font-size: 1rem;
		color: var(--text-primary, #fff);
	}
	.meta .days {
		margin: 4px 0 0;
		font-size: 0.85rem;
		color: var(--text-secondary, #999);
	}
	.actions {
		display: flex;
		gap: 4px;
	}
	.items {
		margin: 10px 0 0;
		padding-left: 22px;
		color: var(--text-secondary, #bbb);
		font-size: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		z-index: 100;
	}
	.modal {
		background: var(--bg-primary, #0f0f0f);
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 16px;
		padding: 20px;
		width: min(560px, 100%);
		max-height: 90vh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
		color: var(--text-primary, #fff);
	}
	.modal > header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.modal > header h2 {
		margin: 0;
		font-size: 1.1rem;
	}
	.close {
		background: none;
		border: none;
		color: var(--text-secondary, #999);
		font-size: 1.4rem;
		cursor: pointer;
		padding: 0 6px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.field.row {
		flex-direction: row;
		gap: 12px;
	}
	.emoji-field { width: 110px; }
	.slot-field { flex: 1; }
	.emoji-input,
	.slot-field select,
	.item-editor input {
		width: 100%;
		background: var(--bg-secondary, #1a1a1a);
		border: 1px solid var(--border, #2a2a2a);
		border-radius: 8px;
		padding: 8px 10px;
		color: var(--text-primary, #fff);
		font: inherit;
		box-sizing: border-box;
	}
	.field label,
	.field .label-row {
		font-size: 0.85rem;
		color: var(--text-secondary, #aaa);
	}
	.label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.link {
		background: none;
		border: none;
		color: var(--accent-primary, #7c8ef5);
		font: inherit;
		cursor: pointer;
		padding: 0;
	}
	.day-presets {
		display: flex;
		gap: 4px;
	}
	.day-presets button {
		background: none;
		border: 1px solid var(--border, #2a2a2a);
		color: var(--text-secondary, #aaa);
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.day-presets button.active {
		background: var(--accent-primary, #7c8ef5);
		color: #fff;
		border-color: transparent;
	}
	.day-chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.day-chips button {
		background: var(--bg-secondary, #1a1a1a);
		border: 1px solid var(--border, #2a2a2a);
		color: var(--text-secondary, #aaa);
		padding: 8px 12px;
		border-radius: 8px;
		min-width: 44px;
		cursor: pointer;
		font: inherit;
	}
	.day-chips button.active {
		background: var(--accent-primary, #7c8ef5);
		border-color: transparent;
		color: #fff;
	}
	.item-editor {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}
	.item-editor li {
		display: flex;
		align-items: center;
		gap: 4px;
		border-bottom: 1px solid #1a1a1a;
	}
	.item-editor li:last-child { border-bottom: none; }
	.item-editor input {
		flex: 1;
		background: transparent;
		border: none;
		color: #ccc;
		font: inherit;
		font-size: 0.88rem;
		padding: 10px 0;
		outline: none;
	}
	.item-editor input::placeholder { color: #444; }
	.reorder-btn, .remove-btn {
		background: transparent;
		border: none;
		color: #555;
		font-size: 0.85rem;
		cursor: pointer;
		padding: 4px 6px;
		border-radius: 4px;
		transition: color 0.1s;
	}
	.reorder-btn:hover { color: #aaa; }
	.reorder-btn:disabled { opacity: 0.3; cursor: default; }
	.remove-btn:hover { color: #e07070; }
	.modal > footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
