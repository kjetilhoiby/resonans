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
	import { fly, fade, scale } from 'svelte/transition';
	import { elasticOut, cubicOut } from 'svelte/easing';
	import { onMount } from 'svelte';
	import { groupChecklistItems, activityEmoji } from '$lib/utils/checklist-group';
	import WeatherStrip, { type WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import BreakdownModal from '$lib/components/ui/BreakdownModal.svelte';
	import { readCacheEntry, isCacheStale, fetchRawTimeseries, buildPeriods, buildWeekPeriods } from '$lib/utils/weather';

	export interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		parentId?: string;
		children?: ChecklistItem[];
	}

	export interface Checklist {
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
	}

	let { checklist, onclose, onDeleted, onChanged }: Props = $props();

	let items = $state<ChecklistItem[]>([...checklist.items]);
	let newItemText = $state('');
	let showPayoff = $state(false);
	let payoffDismissed = $state(false);
	let addingItem = $state(false);
	let breakdownItem = $state<ChecklistItem | null>(null);
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;

	const done = $derived(items.filter((i) => i.checked).length);
	const total = $derived(items.length);
	const allDone = $derived(total > 0 && done === total);
	const pct = $derived(total > 0 ? done / total : 0);
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

	const displayTitle = $derived.by(() => {
		const ctx = checklist.context;
		if (!ctx) return checklist.title;
		const todayIso = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowIso = tomorrow.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
		const dayMatch = ctx.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
		if (dayMatch) {
			if (dayMatch[2] === todayIso) return 'I dag';
			if (dayMatch[2] === tomorrowIso) return 'I morgen';
			return new Intl.DateTimeFormat('nb-NO', { weekday: 'long', day: 'numeric', month: 'long' })
				.format(new Date(dayMatch[2] + 'T12:00:00'));
		}
		const weekMatch = ctx.match(/^week:(\d{4}-W\d{2})$/);
		if (weekMatch) return 'Hele uka';
		return checklist.title;
	});

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

	// Langtrykk-handler (700ms)
	function handleItemMouseDown(item: ChecklistItem) {
		longPressTimer = setTimeout(() => {
			breakdownItem = item;
			longPressTimer = null;
		}, 700);
	}

	function handleItemMouseUp() {
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

	function handleAddKey(e: KeyboardEvent) {
		if (e.key === 'Enter') addItem();
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
		<button class="cs-close-btn" onclick={onclose} aria-label="Lukk"><Icon name="close" size={14} /></button>
	</div>

	<!-- Progress bar -->
	<div class="cs-progress-track">
		<div
			class="cs-progress-fill"
			style="width:{pct * 100}%; background:{ringColor}"
		></div>
	</div>

	<!-- Items list -->
	<div class="cs-items">
		{#each groupChecklistItems(items.filter(i => !i.parentId)) as group}
			{#if group.type === 'group'}
				<div class="cs-group-row">
					<span class="cs-group-label">{activityEmoji(group.label) ? activityEmoji(group.label) + ' ' : ''}{group.label}</span>
					<div class="cs-slot-row">
						{#each group.items as item (item.id)}
							{@const hasChildren = items.some(i => i.parentId === item.id)}
							<button
								type="button"
								class="cs-slot"
								class:cs-slot-checked={item.checked}
								class:cs-slot-parent={hasChildren}
								onmousedown={() => handleItemMouseDown(item)}
								onmouseup={handleItemMouseUp}
								onmouseleave={handleItemMouseUp}
								onclick={() => toggleItem(item)}
								title={hasChildren ? 'Langtrykk for å redigere substeps' : 'Langtrykk for å dele opp'}
								aria-label={item.checked ? 'Marker som ikke gjort' : 'Marker som gjort'}
							>
								{item.checked ? '✓' : ''}
								{#if hasChildren}
									<span class="cs-slot-indicator">✕</span>
								{/if}
							</button>
						{/each}
					</div>
				</div>
			{:else}
				{@const hasChildren = items.some(i => i.parentId === group.item.id)}
				<div class="cs-item-wrapper">
					<button
						class="cs-item"
						class:cs-item-checked={group.item.checked}
						class:cs-item-parent={hasChildren}
						onmousedown={() => handleItemMouseDown(group.item)}
						onmouseup={handleItemMouseUp}
						onmouseleave={handleItemMouseUp}
						onclick={() => toggleItem(group.item)}
						title={hasChildren ? 'Langtrykk for å redigere substeps' : 'Langtrykk for å dele opp'}
					>
						<span class="cs-item-text">{group.item.text}</span>
						<div class="cs-checkbox" class:cs-checkbox-checked={group.item.checked}>
							{#if group.item.checked}
								<span class="cs-tick" transition:scale={{ duration: 200, easing: elasticOut }}>✓</span>
							{/if}
						</div>
					</button>
					{#if hasChildren}
						<div class="cs-children">
							{#each items.filter(i => i.parentId === group.item.id) as child (child.id)}
								<button
									class="cs-child-item"
									class:cs-child-checked={child.checked}
									onmouseup={handleItemMouseUp}
									onmouseleave={handleItemMouseUp}
									onclick={() => toggleItem(child)}
								>
									<span class="cs-child-indent">↳</span>
									<span class="cs-child-text">{child.text}</span>
									<div class="cs-checkbox cs-checkbox-small" class:cs-checkbox-checked={child.checked}>
										{#if child.checked}
											<span class="cs-tick" transition:scale={{ duration: 200, easing: elasticOut }}>✓</span>
										{/if}
									</div>
								</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		{/each}
	</div>

	<!-- Add item input -->
	<div class="cs-add-row">
		<input
			class="cs-add-input"
			type="text"
			placeholder="Legg til punkt…"
			bind:value={newItemText}
			onkeydown={handleAddKey}
			disabled={addingItem}
		/>
		<button
			class="cs-add-btn"
			onclick={addItem}
			disabled={!newItemText.trim() || addingItem}
		><Icon name="plus" size={16} /></button>
	</div>

	<!-- Footer: delete -->
	<div class="cs-footer">
		<a class="cs-calendar-link" href={calendarHref}>Åpne i kalender</a>
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

	.cs-item-text {
		font-size: 0.88rem;
		color: #ccc;
		line-height: 1.4;
		transition: color 0.15s, text-decoration 0.15s;
	}

	.cs-item-checked .cs-item-text {
		color: #444;
		text-decoration: line-through;
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

	.cs-item-parent {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
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
	}

	.cs-child-item:last-child {
		border-bottom: none;
	}

	.cs-child-item:hover {
		opacity: 0.8;
	}

	.cs-child-indent {
		font-size: 0.7rem;
		color: #444;
		flex-shrink: 0;
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
</style>
