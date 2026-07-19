<!--
  MiddagsTinder — sveip deg gjennom middagsforslag (ja/nei) og fyll ukas ledige
  dager én etter én. Kortbunken er kartoteket scoret + genererte varianter
  (rekombinerte råvarer). «Ja» legger retten på neste ledige dag; «nei» hopper
  til neste forslag. Varianter uten lagret rett opprettes i kartoteket ved «ja»
  så sammensetningen bevares. Tastatur: ← nei, → ja.
-->
<script lang="ts">
	import { fade } from 'svelte/transition';

	type Composition = { mainProtein: string; mainCarb: string; greens: string | null };
	export type TinderCard = {
		mealId?: string;
		title: string;
		reason: string;
		isVariant: boolean;
		composition?: Composition;
	};
	type OpenDay = { date: string; label: string };
	type Assignment = { date: string; mealId?: string; title: string };

	interface Props {
		candidates: TinderCard[];
		openDays: OpenDay[];
		onclose: () => void;
		oncommit: (assignments: Assignment[]) => void;
	}

	let { candidates, openDays, onclose, oncommit }: Props = $props();

	let index = $state(0);
	let assignments = $state<Assignment[]>([]);
	let dragX = $state(0);
	let dragging = $state(false);
	let busy = $state(false);
	let leaving = $state<'ja' | 'nei' | null>(null);

	const targetDay = $derived(openDays[assignments.length] ?? null);
	const current = $derived(index < candidates.length ? candidates[index] : null);
	const done = $derived(!targetDay || (!current && assignments.length < openDays.length));
	const filledAll = $derived(assignments.length >= openDays.length);

	const SWIPE_THRESHOLD = 90;

	async function ensureMealId(card: TinderCard): Promise<string | undefined> {
		if (card.mealId) return card.mealId;
		if (!card.isVariant || !card.composition) return undefined;
		try {
			const res = await fetch('/api/food/recipes', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					title: card.title,
					mainProtein: card.composition.mainProtein,
					mainCarb: card.composition.mainCarb,
					greens: card.composition.greens
				})
			});
			if (res.ok) {
				const data = await res.json();
				return data.meal?.id;
			}
		} catch {
			// Faller tilbake til tittel-only; plan-endepunktet auto-oppretter da.
		}
		return undefined;
	}

	async function accept() {
		if (!current || !targetDay || busy) return;
		busy = true;
		leaving = 'ja';
		const card = current;
		const day = targetDay;
		const mealId = await ensureMealId(card);
		assignments = [...assignments, { date: day.date, mealId, title: card.title }];
		advance();
	}

	function reject() {
		if (!current || busy) return;
		leaving = 'nei';
		advance();
	}

	function advance() {
		// Kort animasjonsvindu før neste kort settes inn.
		setTimeout(() => {
			index += 1;
			dragX = 0;
			leaving = null;
			busy = false;
		}, 180);
	}

	function undo() {
		if (assignments.length === 0) return;
		assignments = assignments.slice(0, -1);
	}

	// Peker-drag for sveip
	let startX = 0;
	function onpointerdown(e: PointerEvent) {
		if (busy || !current) return;
		dragging = true;
		startX = e.clientX;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	function onpointermove(e: PointerEvent) {
		if (!dragging) return;
		dragX = e.clientX - startX;
	}
	function onpointerup() {
		if (!dragging) return;
		dragging = false;
		if (dragX > SWIPE_THRESHOLD) accept();
		else if (dragX < -SWIPE_THRESHOLD) reject();
		else dragX = 0;
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowRight') accept();
		else if (e.key === 'ArrowLeft') reject();
		else if (e.key === 'Escape') onclose();
	}

	const rotation = $derived(dragX / 18);
	const hint = $derived(dragX > 30 ? 'ja' : dragX < -30 ? 'nei' : leaving);
</script>

<svelte:window on:keydown={onkeydown} />

<div class="mt-overlay" transition:fade={{ duration: 160 }}>
	<header class="mt-header">
		<button class="mt-close" onclick={onclose} aria-label="Lukk middagstinder">✕</button>
		<div class="mt-title">
			<h1>🔥 Middagstinder</h1>
			<span class="mt-progress">{assignments.length}/{openDays.length} dager fylt</span>
		</div>
		<button class="mt-undo" onclick={undo} disabled={assignments.length === 0} aria-label="Angre forrige">↩</button>
	</header>

	<div class="mt-body">
		{#if done}
			<div class="mt-summary">
				<p class="mt-summary-title">{filledAll ? 'Uka er full! 🎉' : 'Tomt for forslag'}</p>
				<div class="mt-summary-list">
					{#each assignments as a}
						<div class="mt-summary-row">
							<span class="mt-summary-day">{openDays.find((d) => d.date === a.date)?.label ?? a.date}</span>
							<span class="mt-summary-meal">🍽️ {a.title}</span>
						</div>
					{/each}
					{#if assignments.length === 0}
						<p class="mt-empty">Ingen middager valgt ennå.</p>
					{/if}
				</div>
			</div>
		{:else if current && targetDay}
			<p class="mt-target">Middag for <strong>{targetDay.label}</strong></p>
			<div class="mt-card-area">
				<div
					class="mt-card"
					class:leaving-ja={leaving === 'ja'}
					class:leaving-nei={leaving === 'nei'}
					style="transform: translateX({dragX}px) rotate({rotation}deg);"
					onpointerdown={onpointerdown}
					onpointermove={onpointermove}
					onpointerup={onpointerup}
					role="group"
					aria-label={`Forslag: ${current.title}`}
				>
					{#if hint === 'ja'}<span class="mt-stamp mt-stamp-ja">JA</span>{/if}
					{#if hint === 'nei'}<span class="mt-stamp mt-stamp-nei">NEI</span>{/if}
					<span class="mt-card-emoji">🍽️</span>
					<span class="mt-card-title">{current.title}</span>
					<span class="mt-card-reason">{current.reason}</span>
					{#if current.isVariant}
						<span class="mt-card-badge">✨ ny variant</span>
					{/if}
				</div>
			</div>
		{/if}
	</div>

	<footer class="mt-footer">
		{#if done}
			<button class="mt-commit" onclick={() => oncommit(assignments)} disabled={assignments.length === 0} data-track="middagstinder:ferdig">
				Legg {assignments.length} {assignments.length === 1 ? 'middag' : 'middager'} i uka
			</button>
		{:else}
			<div class="mt-actions">
				<button class="mt-btn mt-nei" onclick={reject} disabled={busy} aria-label="Nei takk" data-track="middagstinder:nei">✕</button>
				<button class="mt-btn mt-ja" onclick={accept} disabled={busy} aria-label="Ja, legg til" data-track="middagstinder:ja">♥</button>
			</div>
		{/if}
	</footer>
</div>

<style>
	.mt-overlay {
		position: fixed;
		inset: 0;
		z-index: 160;
		background: var(--page-bg, #0d0d10);
		display: flex;
		flex-direction: column;
	}
	.mt-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: calc(12px + env(safe-area-inset-top)) 16px 10px;
	}
	.mt-close,
	.mt-undo {
		background: rgba(255, 255, 255, 0.07);
		border: none;
		border-radius: 10px;
		color: inherit;
		width: 38px;
		height: 38px;
		font-size: 1rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.mt-undo:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.mt-title {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		align-items: center;
	}
	.mt-title h1 {
		margin: 0;
		font-size: 1.02rem;
		font-weight: 700;
	}
	.mt-progress {
		font-size: 0.76rem;
		color: var(--color-text-secondary, #999);
	}
	.mt-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 8px 20px 20px;
		overflow-y: auto;
	}
	.mt-target {
		font-size: 0.92rem;
		color: var(--color-text-secondary, #bbb);
		margin: 0 0 16px;
		text-transform: capitalize;
	}
	.mt-card-area {
		width: 100%;
		max-width: 340px;
		display: flex;
		justify-content: center;
	}
	.mt-card {
		position: relative;
		width: 100%;
		min-height: 300px;
		background: var(--card-bg, rgba(255, 255, 255, 0.05));
		border: 1px solid var(--card-border, rgba(255, 255, 255, 0.1));
		border-radius: 24px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 32px 24px;
		text-align: center;
		cursor: grab;
		touch-action: pan-y;
		user-select: none;
	}
	.mt-card:active {
		cursor: grabbing;
	}
	.mt-card.leaving-ja {
		transition: transform 0.18s ease-out;
		transform: translateX(480px) rotate(24deg) !important;
	}
	.mt-card.leaving-nei {
		transition: transform 0.18s ease-out;
		transform: translateX(-480px) rotate(-24deg) !important;
	}
	.mt-card-emoji {
		font-size: 2.6rem;
	}
	.mt-card-title {
		font-size: 1.3rem;
		font-weight: 700;
		line-height: 1.25;
	}
	.mt-card-reason {
		font-size: 0.85rem;
		color: var(--color-text-secondary, #9aa4d6);
	}
	.mt-card-badge {
		background: color-mix(in srgb, var(--accent-light) 18%, transparent);
		color: var(--accent-light);
		border-radius: 999px;
		padding: 4px 12px;
		font-size: 0.74rem;
		font-weight: 600;
	}
	.mt-stamp {
		position: absolute;
		top: 22px;
		font-size: 1.5rem;
		font-weight: 800;
		letter-spacing: 0.08em;
		padding: 4px 12px;
		border-radius: 10px;
		border: 3px solid;
	}
	.mt-stamp-ja {
		right: 20px;
		color: var(--success-text, #4ade80);
		border-color: var(--success-text, #4ade80);
		transform: rotate(14deg);
	}
	.mt-stamp-nei {
		left: 20px;
		color: var(--error-text, #f87171);
		border-color: var(--error-text, #f87171);
		transform: rotate(-14deg);
	}
	.mt-footer {
		padding: 12px 16px calc(18px + env(safe-area-inset-bottom));
	}
	.mt-actions {
		display: flex;
		justify-content: center;
		gap: 28px;
	}
	.mt-btn {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		border: 2px solid;
		background: var(--card-bg, rgba(255, 255, 255, 0.05));
		font-size: 1.5rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.mt-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.mt-nei {
		color: var(--error-text, #f87171);
		border-color: var(--error-text, #f87171);
	}
	.mt-ja {
		color: var(--success-text, #4ade80);
		border-color: var(--success-text, #4ade80);
	}
	.mt-summary {
		width: 100%;
		max-width: 360px;
	}
	.mt-summary-title {
		font-size: 1.15rem;
		font-weight: 700;
		text-align: center;
		margin: 0 0 18px;
	}
	.mt-summary-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.mt-summary-row {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		background: var(--card-bg, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--card-border, rgba(255, 255, 255, 0.07));
		border-radius: 12px;
		padding: 11px 14px;
	}
	.mt-summary-day {
		font-size: 0.8rem;
		color: var(--color-text-secondary, #999);
		text-transform: capitalize;
	}
	.mt-summary-meal {
		font-size: 0.9rem;
		font-weight: 600;
	}
	.mt-empty {
		color: var(--color-text-secondary, #999);
		text-align: center;
		font-size: 0.9rem;
	}
	.mt-commit {
		width: 100%;
		background: var(--accent-primary);
		border: none;
		border-radius: 14px;
		color: #fff;
		padding: 15px;
		font-size: 0.98rem;
		font-weight: 700;
		cursor: pointer;
	}
	.mt-commit:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
