<!--
  ChecklistWidget — compact ring-widget for sjekklister på hjemskjermen.
  Bruker samme visuelle stil som DynamicWidget (GoalRing, luftig layout).
-->
<script lang="ts">
	import GoalRing from '../ui/GoalRing.svelte';
	import DayWheelChart, { type DayData } from '../visualizations/DayWheelChart.svelte';
	import { isLocationItem } from '$lib/utils/checklist-group';

	export interface ChecklistItem {
		id: string;
		text: string;
		checked: boolean;
		sortOrder: number;
		parentId?: string | null;
		skippedAt?: string | null;
		metadata?: { kind?: string; locationName?: string } | null;
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
		monthDayData?: DayData[];
		onclick?: () => void;
		onremove?: () => void;
		onplan?: () => void;
		/** Skru av månedshjulets evige syklus-animasjon (brukes av /design for stabile screenshots). */
		monthWheelCycle?: boolean;
	}

	let { checklist, monthDayData, onclick, onremove, onplan, monthWheelCycle = true }: Props = $props();

	// Skipped items ("gjør ikke") teller verken som planlagt eller løst.
	// Sted-kontekst-punkter («Sted: X») er ikke avkryssbare og teller ikke med.
	// For items with children, count the children (not the group header) for accurate progress.
	const effectiveItems = $derived(
		checklist.items.filter((i) => {
			if (i.skippedAt) return false;
			if (isLocationItem(i)) return false;
			if (i.parentId) return true;
			return !checklist.items.some((c) => c.parentId === i.id);
		})
	);
	const total = $derived(effectiveItems.length);
	const done = $derived(effectiveItems.filter((i) => i.checked).length);
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
			if (iso === todayIso) return 'Dagen';
			if (iso === tomorrowIso) return 'I morgen';
			const weekday = new Intl.DateTimeFormat('nb-NO', { weekday: 'short' }).format(new Date(iso + 'T12:00:00'));
			const cap = weekday.replace('.', '');
			return cap.charAt(0).toUpperCase() + cap.slice(1);
		}

		const weekMatch = context.match(/^week:(\d{4}-W(\d{2}))$/);
		if (weekMatch) {
			const currentWeek = toLocalIsoDate(new Date()).slice(0, 4) + '-W' +
				String(getIsoWeekNumber(new Date())).padStart(2, '0');
			if (`week:${currentWeek}` === context) return 'Uka';
			return `Uke ${Number.parseInt(weekMatch[2], 10)}`;
		}

		const monthMatch = context.match(/^month:(\d{4}-(\d{2}))$/);
		if (monthMatch) {
			return 'Måneden';
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

	// Måneds-widgeten sykler gjennom datasett — denne overstyrer labelen mens hjulet er aktivt.
	let monthCycleLabel = $state<string>('Gjort');

	// Måneds-widget: bytt ut GoalRing med DayWheelChart
	const monthMatch = $derived(checklist.context?.match(/^month:(\d{4})-(\d{2})$/));
	const isMonthWidget = $derived(!!monthMatch);

	const dayWheelData = $derived.by((): { year: number; month: number; days: DayData[] } | null => {
		if (!monthMatch) return null;
		const year = Number(monthMatch[1]);
		const month = Number(monthMatch[2]);
		const daysInMonth = new Date(year, month, 0).getDate();
		// Hvis foreldrekomponenten har gitt oss faktiske dagsdata, bruk dem.
		if (monthDayData && monthDayData.length === daysInMonth) {
			return { year, month, days: monthDayData };
		}
		// Fallback: ingen dagsdata tilgjengelig → vis tomme sektorer.
		const days: DayData[] = Array.from({ length: daysInMonth }, () => ({
			planned: 0,
			completed: 0,
			isPast: false,
			isToday: false,
		}));
		return { year, month, days };
	});

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
		if (total === 0 && onplan) {
			onplan();
			return;
		}
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
	{#if total === 0 && onplan}
		<div class="dw-empty-ring">
			<span class="dw-empty-plus">+</span>
		</div>
		<div class="dw-label dw-label--empty">{label}</div>
		<span class="dw-plan-hint">Planlegg</span>
	{:else if isMonthWidget && dayWheelData}
		<div class="dw-ring dw-ring--overflow">
			<DayWheelChart
				year={dayWheelData.year}
				month={dayWheelData.month}
				days={dayWheelData.days}
				size={120}
				cycle={monthWheelCycle}
				bind:currentLabel={monthCycleLabel}
			/>
		</div>
		<div class="dw-label" style:color={ringColor}>{monthCycleLabel}</div>
	{:else}
		<div class="dw-ring">
			<GoalRing pct={isComplete ? 100 : pct} size={60} strokeWidth={4} color={ringColor}>
				<span class="dw-val" class:complete={isComplete}>{ringText}</span>
			</GoalRing>
		</div>
		<div class="dw-label" style:color={ringColor}>{label}</div>
	{/if}

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
		width: 78px;
		min-height: 90px;
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
		width: 60px;
		height: 60px;
	}

	.dw-ring--overflow {
		overflow: visible;
	}
	.dw-ring--overflow :global(svg) {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 120px !important;
		max-width: 120px !important;
		height: 120px;
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	.dw-empty-ring {
		width: 60px;
		height: 60px;
		border-radius: 50%;
		border: 2px dashed #2a2e3f;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: border-color 0.15s;
	}
	.dw:hover .dw-empty-ring {
		border-color: #7c8ef5;
	}

	.dw-empty-plus {
		font-size: 1.4rem;
		font-weight: 300;
		color: #3a3f52;
		line-height: 1;
		transition: color 0.15s;
	}
	.dw:hover .dw-empty-plus {
		color: #7c8ef5;
	}

	.dw-label--empty {
		color: #3a3f52 !important;
		transition: color 0.15s;
	}
	.dw:hover .dw-label--empty {
		color: #7c8ef5 !important;
	}

	.dw-plan-hint {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #2e3347;
		transition: color 0.15s;
	}
	.dw:hover .dw-plan-hint {
		color: #7c8ef5;
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
