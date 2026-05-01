<!--
  ChecklistWidget — compact ring-widget for sjekklister på hjemskjermen.
  Bruker samme visuelle stil som DynamicWidget (GoalRing, luftig layout).
-->
<script lang="ts">
	import GoalRing from '../ui/GoalRing.svelte';

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
	const pct = $derived(total > 0 ? (done / total) * 100 : 0);
	const isComplete = $derived(done === total && total > 0);
	const ringText = $derived(`${done}/${total}`);

	function toLocalIsoDate(d: Date): string {
		return d.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
	}

	function getContextLabel(context: string | null): string {
		if (!context) return checklist.title;

		const todayIso = toLocalIsoDate(new Date());
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		const tomorrowIso = toLocalIsoDate(tomorrow);

		const dayMatch = context.match(/^week:(\d{4}-W\d{2}):day:(\d{4}-\d{2}-\d{2})$/);
		if (dayMatch) {
			const iso = dayMatch[2];
			if (iso === todayIso) return 'I dag';
			if (iso === tomorrowIso) return 'I morgen';
			const weekday = new Intl.DateTimeFormat('nb-NO', { weekday: 'short' }).format(new Date(iso + 'T12:00:00'));
			const cap = weekday.replace('.', '');
			return cap.charAt(0).toUpperCase() + cap.slice(1);
		}

		const weekMatch = context.match(/^week:(\d{4}-W(\d{2}))$/);
		if (weekMatch) {
			const currentWeek = toLocalIsoDate(new Date()).slice(0, 4) + '-W' +
				String(getIsoWeekNumber(new Date())).padStart(2, '0');
			if (`week:${currentWeek}` === context) return 'Hele uka';
			return `Uke ${Number.parseInt(weekMatch[2], 10)}`;
		}

		const monthMatch = context.match(/^month:(\d{4}-(\d{2}))$/);
		if (monthMatch) {
			const label = new Intl.DateTimeFormat('nb-NO', { month: 'long' })
				.format(new Date(`${monthMatch[1]}-01T12:00:00`));
			return label.charAt(0).toUpperCase() + label.slice(1);
		}

		return checklist.title;
	}

	function getIsoWeekNumber(d: Date): number {
		const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
		date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
		const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
		return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	}

	const label = $derived(getContextLabel(checklist.context));
	const ringColor = $derived(isComplete ? '#5fa080' : '#7c8ef5');

	// Long-press for remove menu
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let showMenu = $state(false);
	let popupStyle = $state('');
	let elRef: HTMLDivElement | null = null;

	function handlePressStart() {
		pressTimer = setTimeout(() => {
			if (elRef) {
				const r = elRef.getBoundingClientRect();
				const popupW = 150;
				const popupH = 80;
				const margin = 8;
				let left = r.left + r.width / 2 - popupW / 2;
				left = Math.max(margin, Math.min(left, window.innerWidth - popupW - margin));
				const spaceAbove = r.top;
				if (spaceAbove >= popupH + margin) {
					const bottom = window.innerHeight - r.top + 6;
					popupStyle = `position:fixed; left:${left}px; bottom:${bottom}px; width:${popupW}px;`;
				} else {
					const top = r.bottom + 6;
					popupStyle = `position:fixed; left:${left}px; top:${top}px; width:${popupW}px;`;
				}
			}
			showMenu = true;
		}, 600);
	}

	function handlePressEnd(e: PointerEvent) {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
		if (showMenu) e.preventDefault();
	}

	function handleClick() {
		if (showMenu) return;
		onclick?.();
	}
</script>

<div
	bind:this={elRef}
	class="dw"
	role="button"
	tabindex="0"
	onpointerdown={handlePressStart}
	onpointerup={handlePressEnd}
	onpointerleave={handlePressEnd}
	onclick={handleClick}
	onkeydown={(e) => e.key === 'Enter' && handleClick()}
	title={checklist.title}
	style:--c={ringColor}
>
	<div class="dw-ring">
		<GoalRing pct={isComplete ? 100 : pct} size={70} strokeWidth={4} color={ringColor}>
			<span class="dw-val" class:complete={isComplete}>{ringText}</span>
		</GoalRing>
	</div>

	<div class="dw-label" style:color={ringColor}>{label}</div>

	{#if showMenu}
		<div
			class="dw-overlay"
			role="presentation"
			onpointerdown={(e) => { e.stopPropagation(); showMenu = false; }}
		></div>
		<div class="dw-popup" role="dialog" aria-label="Liste-alternativer" style={popupStyle}>
			<button
				class="dw-popup-btn dw-popup-danger"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); showMenu = false; onremove?.(); }}
			>
				Fjern liste
			</button>
			<button
				class="dw-popup-cancel"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); showMenu = false; }}
			>
				Avbryt
			</button>
		</div>
	{/if}
</div>

<style>
	.dw {
		position: relative;
		width: 90px;
		min-height: 106px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		user-select: none;
	}

	.dw-ring {
		position: relative;
		width: 70px;
		height: 70px;
	}

	.dw-val {
		font-size: 1rem;
		font-weight: 700;
		color: #eee;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.dw-val.complete {
		color: #9fd1b3;
	}

	.dw-label {
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		text-align: center;
		opacity: 0.8;
	}

	.dw-overlay {
		position: fixed;
		inset: 0;
		z-index: 199;
	}

	.dw-popup {
		background: #1e1e1e;
		border: 1px solid #333;
		border-radius: 10px;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		z-index: 200;
		box-shadow: 0 4px 20px rgba(0,0,0,0.6);
	}

	.dw-popup-btn {
		background: none;
		border: none;
		font-size: 0.8rem;
		padding: 6px 10px;
		border-radius: 6px;
		cursor: pointer;
		text-align: center;
	}

	.dw-popup-danger {
		color: #e07070;
		border-bottom: 1px solid #2a2a2a;
		border-radius: 6px 6px 0 0;
	}
	.dw-popup-danger:hover { background: #2a1a1a; }

	.dw-popup-cancel {
		background: none;
		border: none;
		color: #555;
		font-size: 0.75rem;
		padding: 4px 10px;
		cursor: pointer;
		text-align: center;
	}
	.dw-popup-cancel:hover { color: #888; }
</style>
