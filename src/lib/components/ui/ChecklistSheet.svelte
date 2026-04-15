<!--
  ChecklistSheet — full-screen overlay som viser sjekklisten.

  Inneholder:
  - Header: emoji + tittel + lukk-knapp
  - Scrollbar liste med checkboxer
  - "Legg til punkt" input
  - Payoff-animasjon når alle punkter er avkrysset
-->
<script lang="ts">
	import { fly, fade, scale } from 'svelte/transition';
	import { elasticOut, cubicOut } from 'svelte/easing';

	export interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
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

	// Vis payoff-animasjon én gang når alt er fullført
	$effect(() => {
		if (allDone && !payoffDismissed && !showPayoff) {
			setTimeout(() => { showPayoff = true; }, 400);
		}
	});

	async function toggleItem(item: ChecklistItem) {
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
			<span class="cs-header-emoji">{checklist.emoji}</span>
			<div>
				<h2 class="cs-title">{checklist.title}</h2>
				<p class="cs-subtitle">{done} av {total} fullført</p>
			</div>
		</div>
		<button class="cs-close-btn" onclick={onclose} aria-label="Lukk">✕</button>
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
		{#each items as item (item.id)}
			<button
				class="cs-item"
				class:cs-item-checked={item.checked}
				onclick={() => toggleItem(item)}
			>
				<div class="cs-checkbox" class:cs-checkbox-checked={item.checked}>
					{#if item.checked}
						<span class="cs-tick" transition:scale={{ duration: 200, easing: elasticOut }}>✓</span>
					{/if}
				</div>
				<span class="cs-item-text">{item.text}</span>
			</button>
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
		>＋</button>
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
					<span class="cs-payoff-emoji">{checklist.emoji}</span>
				</div>
			</div>

			<h3 class="cs-payoff-title">Alt er klart!</h3>
			<p class="cs-payoff-sub">{checklist.title}</p>
			<p class="cs-payoff-cta">Trykk hvor som helst for å lukke</p>
		</div>
	</div>
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
		width: 22px;
		height: 22px;
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
		font-size: 0.85rem;
		outline: none;
		transition: border-color 0.12s;
	}
	.cs-add-input:focus { border-color: #4a5af0; }
	.cs-add-input::placeholder { color: #444; }

	.cs-add-btn {
		width: 38px;
		height: 38px;
		border-radius: 10px;
		background: #4a5af0;
		border: none;
		color: white;
		font-size: 1.1rem;
		cursor: pointer;
		flex-shrink: 0;
		transition: background 0.12s, opacity 0.12s;
	}
	.cs-add-btn:hover:not(:disabled) { background: #3a4adf; }
	.cs-add-btn:disabled { opacity: 0.35; cursor: not-allowed; background: #2a2a2a; }

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
</style>
