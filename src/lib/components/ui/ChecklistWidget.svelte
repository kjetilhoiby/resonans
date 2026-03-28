<!--
  ChecklistWidget — compact ring-widget for sjekklister på hjemskjermen.

  Viser: emoji, prosentring, X/Y-teller, tittel.
  Tap → åpner ChecklistSheet.
  Langt trykk / høyreklikk → contextmenu med fjern-valg.
-->
<script lang="ts">
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
		onclick?: () => void;
		onremove?: () => void;
	}

	let { checklist, onclick, onremove }: Props = $props();

	const total = $derived(checklist.items.length);
	const done = $derived(checklist.items.filter((i) => i.checked).length);
	const pct = $derived(total > 0 ? done / total : 0);
	const isComplete = $derived(done === total && total > 0);

	// SVG ring (samme radius som GoalRing)
	const R = 32;
	const C = 2 * Math.PI * R; // ~201
	const dash = $derived(Math.min(pct, 1) * C);

	// Farge: grønn ved fullført, blå ellers
	const ringColor = $derived(isComplete ? '#5fa080' : '#7c8ef5');

	let showMenu = $state(false);

	function handleContextMenu(e: MouseEvent) {
		e.preventDefault();
		showMenu = true;
	}

	function handleClickOutside() {
		showMenu = false;
	}
</script>

<button
	class="cl-widget"
	class:cl-complete={isComplete}
	{onclick}
	oncontextmenu={handleContextMenu}
	title={checklist.title}
>
	<!-- SVG ring -->
	<div class="cl-ring-wrap">
		<svg class="cl-ring-svg" viewBox="0 0 80 80">
			<!-- Track -->
			<circle cx="40" cy="40" r={R} fill="none" stroke="#222" stroke-width="7"/>
			<!-- Progress -->
			<circle
				cx="40" cy="40" r={R}
				fill="none"
				stroke={ringColor}
				stroke-width="7"
				stroke-dasharray="{dash} {C}"
				stroke-linecap="round"
				transform="rotate(-90 40 40)"
				style="transition: stroke-dasharray 0.4s cubic-bezier(0.34,1.56,0.64,1)"
			/>
		</svg>
		<div class="cl-ring-inner">
			{#if isComplete}
				<span class="cl-done-check">✓</span>
			{:else}
				<span class="cl-emoji">{checklist.emoji}</span>
			{/if}
		</div>
	</div>

	<!-- Counter -->
	<p class="cl-count" style="color:{ringColor}">{done}/{total}</p>

	<!-- Title -->
	<p class="cl-title">{checklist.title}</p>

	{#if isComplete}
		<p class="cl-complete-label">Ferdig!</p>
	{/if}
</button>

<!-- Context menu -->
{#if showMenu}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="cl-backdrop" onclick={handleClickOutside}></div>
	<div class="cl-menu">
		<button class="cl-menu-item cl-menu-danger" onclick={() => { showMenu = false; onremove?.(); }}>
			Fjern liste
		</button>
		<button class="cl-menu-item" onclick={() => showMenu = false}>Avbryt</button>
	</div>
{/if}

<style>
	.cl-widget {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 4px;
		border-radius: 12px;
		min-width: 72px;
		transition: opacity 0.15s;
	}
	.cl-widget:hover { opacity: 0.85; }
	.cl-widget:active { opacity: 0.7; transform: scale(0.96); }

	.cl-ring-wrap {
		position: relative;
		width: 64px;
		height: 64px;
	}

	.cl-ring-svg {
		width: 100%;
		height: 100%;
		display: block;
	}

	.cl-ring-inner {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.cl-emoji {
		font-size: 1.25rem;
		line-height: 1;
	}

	.cl-done-check {
		font-size: 1.4rem;
		color: #5fa080;
		font-weight: 700;
	}

	.cl-count {
		font-size: 0.62rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
		margin: 0;
		letter-spacing: 0.02em;
	}

	.cl-title {
		font-size: 0.6rem;
		color: #666;
		margin: 0;
		text-align: center;
		max-width: 72px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		line-height: 1.3;
	}

	.cl-complete .cl-title { color: #5fa080; }

	.cl-complete-label {
		font-size: 0.58rem;
		font-weight: 600;
		color: #5fa080;
		margin: 0;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	/* Context menu */
	.cl-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
	}

	.cl-menu {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		overflow: hidden;
		z-index: 101;
		min-width: 140px;
		box-shadow: 0 8px 24px rgba(0,0,0,0.4);
	}

	.cl-menu-item {
		display: block;
		width: 100%;
		padding: 10px 16px;
		background: transparent;
		border: none;
		color: #ccc;
		font-size: 0.8rem;
		text-align: left;
		cursor: pointer;
		transition: background 0.1s;
	}
	.cl-menu-item:hover { background: #222; }
	.cl-menu-danger { color: #e07070; }
</style>
