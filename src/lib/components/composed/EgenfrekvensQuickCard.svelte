<!--
  EgenfrekvensQuickCard — kompakt sjekk-inn-kort for hjemmeskjerm.

  Viser dagens to slots (morgen/kveld) som tall + en 7-dagers historikk
  med to fargede prikker pr dag. Tap på tom slot åpner kjapp-flow med
  riktig slot. "Dypdykk"-link åpner det fulle flowet.
-->
<script lang="ts">
	interface SlotEntry {
		level: number | null;
		mode: 'quick' | 'full';
		balance: number | null;
	}

	interface DayPoint {
		day: string;
		morning: SlotEntry | null;
		evening: SlotEntry | null;
	}

	interface Props {
		todayMorning: SlotEntry | null;
		todayEvening: SlotEntry | null;
		recent: DayPoint[];
		onOpenQuick: (slot: 'morning' | 'evening') => void;
		onOpenFull: (slot: 'morning' | 'evening') => void;
	}

	let { todayMorning, todayEvening, recent, onOpenQuick, onOpenFull }: Props = $props();

	function display(entry: SlotEntry | null): string {
		if (!entry) return '—';
		if (entry.level !== null) return String(entry.level);
		// Fallback for legacy full-events uten level: vis balanse mappet til 1-5
		if (entry.balance !== null) {
			const lvl = Math.round((entry.balance + 5) / 2);
			return String(Math.max(1, Math.min(5, lvl)));
		}
		return '·';
	}

	function levelColor(entry: SlotEntry | null): string {
		const d = display(entry);
		if (d === '—' || d === '·') return '#475569';
		const n = Number(d);
		if (n >= 4) return '#48b581';
		if (n >= 3) return '#8ba0f5';
		if (n >= 2) return '#f6c177';
		return '#ee8c8c';
	}

	function suggestedSlot(): 'morning' | 'evening' {
		return new Date().getHours() < 14 ? 'morning' : 'evening';
	}

	const last7 = $derived([...recent].slice(0, 7).reverse());
</script>

<div class="quick-card">
	<header class="quick-head">
		<h3 class="quick-title">Sjekk inn</h3>
		<span class="quick-sub">1-5, to ganger om dagen</span>
	</header>

	<div class="quick-slots">
		<button
			type="button"
			class="quick-slot"
			class:filled={todayMorning !== null}
			style:--slot-color={levelColor(todayMorning)}
			onclick={() => onOpenQuick('morning')}
			aria-label={todayMorning ? `Morgen: ${display(todayMorning)}` : 'Sjekk inn morgen'}
		>
			<span class="quick-slot-lbl">Morgen</span>
			<span class="quick-slot-val">{display(todayMorning)}</span>
		</button>
		<button
			type="button"
			class="quick-slot"
			class:filled={todayEvening !== null}
			style:--slot-color={levelColor(todayEvening)}
			onclick={() => onOpenQuick('evening')}
			aria-label={todayEvening ? `Kveld: ${display(todayEvening)}` : 'Sjekk inn kveld'}
		>
			<span class="quick-slot-lbl">Kveld</span>
			<span class="quick-slot-val">{display(todayEvening)}</span>
		</button>
	</div>

	{#if last7.length > 0}
		<div class="quick-mini" aria-label="Siste 7 dager">
			{#each last7 as p (p.day)}
				<div class="mini-day" title={p.day}>
					<span
						class="mini-dot"
						class:empty={!p.morning}
						style:background={p.morning ? levelColor(p.morning) : 'transparent'}
					></span>
					<span
						class="mini-dot"
						class:empty={!p.evening}
						style:background={p.evening ? levelColor(p.evening) : 'transparent'}
					></span>
				</div>
			{/each}
		</div>
	{/if}

	<button type="button" class="quick-deepdive" onclick={() => onOpenFull(suggestedSlot())}>
		Vil du gå dypere? Åpne dypdykk (4 dimensjoner)
	</button>
</div>

<style>
	.quick-card {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 16px;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.quick-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}
	.quick-title {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		color: #e2e8f0;
	}
	.quick-sub {
		font-size: 0.75rem;
		color: #94a3b8;
	}
	.quick-slots {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.quick-slot {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px 12px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 12px;
		cursor: pointer;
		text-align: left;
		transition: background 0.15s, border-color 0.15s;
		color: inherit;
	}
	.quick-slot:hover {
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.12);
	}
	.quick-slot.filled {
		border-color: color-mix(in srgb, var(--slot-color) 40%, transparent);
		background: color-mix(in srgb, var(--slot-color) 8%, rgba(255, 255, 255, 0.03));
	}
	.quick-slot-lbl {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #94a3b8;
	}
	.quick-slot-val {
		font-size: 1.8rem;
		font-weight: 700;
		color: var(--slot-color, #cbd5e1);
		line-height: 1;
	}
	.quick-mini {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 6px;
	}
	.mini-day {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 4px 0;
		border-radius: 6px;
		background: rgba(255, 255, 255, 0.02);
	}
	.mini-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #334155;
	}
	.mini-dot.empty {
		border: 1px dashed rgba(255, 255, 255, 0.15);
		background: transparent;
	}
	.quick-deepdive {
		background: none;
		border: 1px dashed rgba(255, 255, 255, 0.12);
		color: #8ba0f5;
		padding: 8px 12px;
		border-radius: 10px;
		font-size: 0.82rem;
		cursor: pointer;
		text-align: center;
	}
	.quick-deepdive:hover {
		background: rgba(139, 160, 245, 0.06);
		border-color: rgba(139, 160, 245, 0.4);
	}
</style>
