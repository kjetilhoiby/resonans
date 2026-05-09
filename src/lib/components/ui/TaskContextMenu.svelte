<!--
  TaskContextMenu — popup-meny som vises ved langtrykk på en oppgaverad.
  Følger samme mønster som DynamicWidget-popupen (fixed-posisjonering, klikk
  utenfor lukker).

  Ansvar:
  - Beregne posisjon ut fra anchor-rect (sentrert horisontalt, over hvis plass)
  - Vise hovedmeny + snooze-undermeny + dato-velger
  - Kalle callbackene; konsumenten oppdaterer egen state.
-->
<script lang="ts">
	function addDaysIso(isoDate: string, days: number): string {
		const [y, m, d] = isoDate.split('-').map(Number);
		const date = new Date(Date.UTC(y, m - 1, d));
		date.setUTCDate(date.getUTCDate() + days);
		return date.toISOString().slice(0, 10);
	}

	interface Props {
		open: boolean;
		anchor: DOMRect | null;
		itemText: string;
		hasChildren?: boolean;
		isSkipped?: boolean;
		isChecked?: boolean;
		onClose: () => void;
		onEdit?: () => void;
		onBreakdown?: () => void;
		onSnooze?: (targetDate: string) => void;
		onSkip?: () => void;
		onUnskip?: () => void;
	}

	let {
		open,
		anchor,
		itemText,
		hasChildren = false,
		isSkipped = false,
		isChecked = false,
		onClose,
		onEdit,
		onBreakdown,
		onSnooze,
		onSkip,
		onUnskip
	}: Props = $props();

	type View = 'main' | 'snooze' | 'pickDate';
	let view = $state<View>('main');
	let pickedDate = $state('');

	// Reset when menyen åpnes på nytt
	$effect(() => {
		if (open) {
			view = 'main';
			pickedDate = '';
		}
	});

	const todayIso = (() => {
		const d = new Date();
		const oslo = new Intl.DateTimeFormat('sv', { timeZone: 'Europe/Oslo' }).format(d);
		return oslo; // sv-locale gir YYYY-MM-DD
	})();

	function nextMondayIso(from: string): string {
		const [y, m, d] = from.split('-').map(Number);
		const date = new Date(Date.UTC(y, m - 1, d));
		const day = date.getUTCDay(); // 0=søn, 1=man, ...
		const delta = ((1 - day + 7) % 7) || 7; // alltid neste mandag (ikke i dag)
		date.setUTCDate(date.getUTCDate() + delta);
		return date.toISOString().slice(0, 10);
	}

	function firstOfNextMonthIso(from: string): string {
		const [y, m] = from.split('-').map(Number);
		const nextYear = m === 12 ? y + 1 : y;
		const nextMonth = m === 12 ? 1 : m + 1;
		return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
	}

	const tomorrow = $derived(addDaysIso(todayIso, 1));
	const nextMon = $derived(nextMondayIso(todayIso));
	const nextMonth = $derived(firstOfNextMonthIso(todayIso));

	// Posisjonering — kopiert fra DynamicWidget
	const popupStyle = $derived.by(() => {
		if (!open || !anchor) return '';
		const popupW = 220;
		const estH = view === 'pickDate' ? 170 : view === 'snooze' ? 220 : 230;
		const margin = 8;
		let left = anchor.left + anchor.width / 2 - popupW / 2;
		left = Math.max(margin, Math.min(left, window.innerWidth - popupW - margin));
		const spaceAbove = anchor.top;
		if (spaceAbove >= estH + margin) {
			const bottom = window.innerHeight - anchor.top + 6;
			return `position:fixed; left:${left}px; bottom:${bottom}px; width:${popupW}px;`;
		}
		const top = anchor.bottom + 6;
		return `position:fixed; left:${left}px; top:${top}px; width:${popupW}px;`;
	});

	function fmtNorwegian(iso: string): string {
		const [y, m, d] = iso.split('-').map(Number);
		const date = new Date(y, m - 1, d);
		return new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
	}

	function handleSnoozePick(target: string) {
		if (!target) return;
		onSnooze?.(target);
		onClose();
	}
</script>

{#if open && anchor}
	<div
		class="tcm-overlay"
		role="presentation"
		onpointerdown={(e) => { e.stopPropagation(); onClose(); }}
	></div>
	<div class="tcm-popup" role="dialog" aria-label="Oppgavevalg" style={popupStyle}>
		<div class="tcm-title" title={itemText}>{itemText}</div>

		{#if view === 'main'}
			{#if onEdit}
				<button
					class="tcm-btn"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); onClose(); onEdit?.(); }}
				>
					<span class="tcm-icon">✏️</span> Rediger tittel
				</button>
			{/if}

			{#if onBreakdown && !isSkipped}
				<button
					class="tcm-btn"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); onClose(); onBreakdown?.(); }}
				>
					<span class="tcm-icon">🪜</span> {hasChildren ? 'Endre deloppgaver' : 'Bryt ned i deloppgaver'}
				</button>
			{/if}

			{#if onSnooze && !isSkipped && !isChecked}
				<button
					class="tcm-btn"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); view = 'snooze'; }}
				>
					<span class="tcm-icon">🌙</span> Utsett til…
				</button>
			{/if}

			{#if isSkipped && onUnskip}
				<button
					class="tcm-btn tcm-btn-primary"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); onClose(); onUnskip?.(); }}
				>
					<span class="tcm-icon">↩︎</span> Gjør den likevel
				</button>
			{:else if onSkip && !isChecked}
				<button
					class="tcm-btn tcm-btn-danger"
					onpointerdown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); onClose(); onSkip?.(); }}
				>
					<span class="tcm-icon">✕</span> Hopp over
				</button>
			{/if}

			<button
				class="tcm-cancel"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); onClose(); }}
			>Avbryt</button>
		{:else if view === 'snooze'}
			<div class="tcm-section-label">Utsett til</div>
			<button
				class="tcm-btn"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); handleSnoozePick(tomorrow); }}
			>
				<span class="tcm-icon">🌅</span>
				<span class="tcm-label-stack">
					<span>I morgen</span>
					<span class="tcm-sub">{fmtNorwegian(tomorrow)}</span>
				</span>
			</button>
			<button
				class="tcm-btn"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); handleSnoozePick(nextMon); }}
			>
				<span class="tcm-icon">📅</span>
				<span class="tcm-label-stack">
					<span>Neste mandag</span>
					<span class="tcm-sub">{fmtNorwegian(nextMon)}</span>
				</span>
			</button>
			<button
				class="tcm-btn"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); handleSnoozePick(nextMonth); }}
			>
				<span class="tcm-icon">🗓️</span>
				<span class="tcm-label-stack">
					<span>Neste måned</span>
					<span class="tcm-sub">{fmtNorwegian(nextMonth)}</span>
				</span>
			</button>
			<button
				class="tcm-btn"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); view = 'pickDate'; }}
			>
				<span class="tcm-icon">⋯</span> Velg dato
			</button>
			<button
				class="tcm-cancel"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); view = 'main'; }}
			>Tilbake</button>
		{:else if view === 'pickDate'}
			<div class="tcm-section-label">Velg dato</div>
			<input
				type="date"
				class="tcm-date"
				min={tomorrow}
				bind:value={pickedDate}
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => e.stopPropagation()}
			/>
			<button
				class="tcm-btn tcm-btn-primary"
				disabled={!pickedDate || pickedDate <= todayIso}
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); handleSnoozePick(pickedDate); }}
			>Utsett</button>
			<button
				class="tcm-cancel"
				onpointerdown={(e) => e.stopPropagation()}
				onclick={(e) => { e.stopPropagation(); view = 'snooze'; }}
			>Tilbake</button>
		{/if}
	</div>
{/if}

<style>
	.tcm-overlay {
		position: fixed;
		inset: 0;
		z-index: 199;
	}

	.tcm-popup {
		background: #1e1e1e;
		border: 1px solid #333;
		border-radius: 12px;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		z-index: 200;
		box-shadow: 0 8px 28px rgba(0,0,0,0.6);
	}

	.tcm-title {
		font-size: 0.7rem;
		color: #777;
		padding: 4px 10px 6px;
		border-bottom: 1px solid #2a2a2a;
		margin-bottom: 4px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tcm-section-label {
		font-size: 0.65rem;
		color: #666;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 4px 10px;
	}

	.tcm-btn {
		display: flex;
		align-items: center;
		gap: 10px;
		background: none;
		border: none;
		color: #ddd;
		font-size: 0.85rem;
		padding: 9px 10px;
		border-radius: 8px;
		cursor: pointer;
		text-align: left;
		font: inherit;
		font-size: 0.85rem;
	}
	.tcm-btn:hover { background: #262626; }
	.tcm-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.tcm-btn-primary { color: #9cb0ff; }
	.tcm-btn-primary:hover { background: #1a1a2e; }

	.tcm-btn-danger { color: #e07070; }
	.tcm-btn-danger:hover { background: #2a1a1a; }

	.tcm-icon {
		width: 18px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.85rem;
		flex-shrink: 0;
	}

	.tcm-label-stack {
		display: flex;
		flex-direction: column;
		line-height: 1.15;
	}
	.tcm-sub {
		font-size: 0.7rem;
		color: #777;
	}

	.tcm-cancel {
		background: none;
		border: none;
		color: #555;
		font-size: 0.75rem;
		padding: 8px 10px;
		cursor: pointer;
		text-align: center;
		margin-top: 2px;
		border-top: 1px solid #2a2a2a;
		border-radius: 0 0 6px 6px;
	}
	.tcm-cancel:hover { color: #aaa; }

	.tcm-date {
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #ccc;
		padding: 8px 10px;
		font: inherit;
		font-size: max(0.85rem, 16px);
		outline: none;
		margin: 4px 0;
	}
	.tcm-date:focus { border-color: #4a5af0; }
</style>
