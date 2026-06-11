<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';
	import {
		PERIOD_SLOTS,
		PERIOD_SLOT_LEVEL_LABELS,
		type PeriodSlotId
	} from '$lib/domains/egenfrekvens/period-slots';
	import type { EgenfrekvensDashboardData, EgenfrekvensCheckinPointData, EgenfrekvensSlotPointData } from '$lib/client/dashboard-cache';

	interface Props {
		data: EgenfrekvensDashboardData;
		onstartCheckin?: () => void;
		onstartQuick?: () => void;
		ondelete?: (eventIds: string[]) => void;
	}

	let { data, onstartCheckin, onstartQuick, ondelete }: Props = $props();

	const oldestFirst = $derived([...data.points].sort((a, b) => (a.day < b.day ? -1 : 1)));

	function fmt(n: number | null | undefined, digits = 1): string {
		if (n === null || n === undefined) return '—';
		return n.toFixed(digits);
	}

	function fmtDayLabel(day: string): string {
		const [, m, d] = day.split('-');
		return `${d}.${m}`;
	}

	function levelColor(v: number | null): string {
		if (v === null) return '#475569';
		if (v >= 4) return '#48b581';
		if (v >= 3) return '#8ba0f5';
		if (v >= 2) return '#f6c177';
		return '#ee8c8c';
	}

	function levelBg(v: number | null): string {
		if (v === null) return 'rgba(255,255,255,0.02)';
		if (v >= 4) return 'rgba(72,181,129,0.16)';
		if (v >= 3) return 'rgba(139,160,245,0.16)';
		if (v >= 2) return 'rgba(246,193,119,0.16)';
		return 'rgba(238,140,140,0.16)';
	}

	function levelLabel(v: number | null): string {
		if (v === null) return '';
		return PERIOD_SLOT_LEVEL_LABELS[Math.round(v)] ?? '';
	}

	function slotsOf(p: EgenfrekvensCheckinPointData): Partial<Record<PeriodSlotId, EgenfrekvensSlotPointData>> {
		return p.slots ?? {};
	}

	// Nivå for en dag: siste slot-registrering (etter timestamp), fallback til balance-mapping
	function pointLevel(p: EgenfrekvensCheckinPointData | null): number | null {
		if (!p) return null;
		const entries = Object.values(slotsOf(p)).filter(
			(e): e is EgenfrekvensSlotPointData => !!e && typeof e.level === 'number'
		);
		if (entries.length > 0) {
			entries.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
			return entries[0].level;
		}
		if (typeof p.balance === 'number') return Math.max(1, Math.min(5, Math.round((p.balance + 5) / 2)));
		return null;
	}

	// Notat for en dag: siste slot-notat, fallback til dagsnotatet (gamle full-sjekkins)
	function pointNote(p: EgenfrekvensCheckinPointData): string | null {
		const noted = Object.values(slotsOf(p)).filter(
			(e): e is EgenfrekvensSlotPointData => !!e && typeof e.note === 'string' && e.note.length > 0
		);
		if (noted.length > 0) {
			noted.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
			return noted[0].note;
		}
		return p.note;
	}

	const sparklineWidth = 280;
	const sparklineHeight = 60;

	function balanceToY(b: number): number {
		const norm = (b + 5) / 10;
		return sparklineHeight - norm * sparklineHeight;
	}

	const sparklinePoints = $derived.by(() => {
		const points = oldestFirst.filter((p) => typeof p.balance === 'number');
		if (points.length < 2) return null;
		const xs = points.map((_, i) => (i / (points.length - 1)) * sparklineWidth);
		const ys = points.map((p) => balanceToY(p.balance as number));
		const path = points
			.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`)
			.join(' ');
		const areaPath = `${path} L${sparklineWidth},${sparklineHeight} L0,${sparklineHeight} Z`;
		return {
			path,
			areaPath,
			points: points.map((p, i) => ({ x: xs[i], y: ys[i], val: p.balance, day: p.day, extreme: p.extreme }))
		};
	});

	// Døgnrytme-grid: nyeste dag øverst, maks 14 dager
	const gridDays = $derived(data.points.slice(0, 14));
	const last7: EgenfrekvensCheckinPointData[] = $derived(data.points.slice(0, 7));
</script>

<div class="ef-dash">
	<header class="ef-header">
		<div class="ef-header-text">
			<h2>Egenfrekvens</h2>
			<p class="ef-sub">Siste {data.rangeDays} dager · {data.stats.count} sjekkin{data.stats.count === 1 ? '' : 's'}</p>
		</div>
		<div class="ef-cta-row">
			{#if onstartQuick}
				<button class="ef-cta" onclick={onstartQuick}>+ Sjekk inn</button>
			{/if}
			{#if onstartCheckin}
				<button class="ef-cta ef-cta-secondary" onclick={onstartCheckin}>Dypdykk</button>
			{/if}
		</div>
	</header>

	{#if data.points.length === 0}
		<div class="ef-empty">
			<p>Ingen sjekkins ennå. Start med en — det tar 30 sekunder.</p>
			{#if onstartQuick}
				<button class="ef-cta ef-cta-large" onclick={onstartQuick}>Sjekk inn nå</button>
			{:else if onstartCheckin}
				<button class="ef-cta ef-cta-large" onclick={onstartCheckin}>Sjekk inn nå</button>
			{/if}
		</div>
	{:else}
		{#if data.latest}
			{@const latestLevel = pointLevel(data.latest)}
			{@const latestNote = pointNote(data.latest)}
			{@const latestSlots = slotsOf(data.latest)}
			<section class="ef-card ef-latest">
				<div class="ef-latest-head">
					<span class="ef-latest-day">{fmtDayLabel(data.latest.day)}</span>
					{#if data.streakDays > 1}
						<span class="ef-streak">🔥 {data.streakDays} dager på rad</span>
					{/if}
				</div>
				<div class="ef-balance" style:color={levelColor(latestLevel)}>
					<span class="ef-balance-num">{latestLevel ?? '—'}<span class="ef-balance-suffix">/5</span></span>
					<span class="ef-balance-lbl">{levelLabel(latestLevel)}</span>
				</div>
				<div class="ef-slot-strip" role="list" aria-label="Dagens slots">
					{#each PERIOD_SLOTS as slot (slot.id)}
						{@const entry = latestSlots[slot.id]}
						<div
							class="ef-slot-cell"
							role="listitem"
							style:background={levelBg(entry?.level ?? null)}
							title="{slot.shortLabel}: {entry?.level != null ? `${entry.level}/5` : 'ikke registrert'}{entry?.note ? ` — ${entry.note}` : ''}"
						>
							<span class="ef-slot-emoji">{slot.emoji}</span>
							<span class="ef-slot-val" style:color={levelColor(entry?.level ?? null)}>{entry?.level ?? '·'}</span>
						</div>
					{/each}
				</div>
				{#if latestNote}
					<p class="ef-note">«{latestNote}»</p>
				{/if}
				{#if data.latest.reflectionSynthesis || data.latest.reflection || data.latest.reflectionThread?.length}
					<details class="ef-reflection">
						<summary>Refleksjon</summary>
						{#if data.latest.reflectionSynthesis}
							<p>{data.latest.reflection}</p>
						{:else if data.latest.reflectionThread?.length}
							{#if data.latest.reflection}
								<p class="ef-reflection-state">{data.latest.reflection}</p>
							{/if}
							<ul class="ef-reflection-thread">
								{#each data.latest.reflectionThread as msg, i (i)}
									<li class="ef-reflection-msg ef-reflection-{msg.role}">
										<span class="ef-reflection-role">{msg.role === 'user' ? 'Du' : 'AI'}</span>
										<span class="ef-reflection-text">{msg.text}</span>
									</li>
								{/each}
							</ul>
						{:else if data.latest.reflection}
							<p>{data.latest.reflection}</p>
						{/if}
					</details>
				{/if}
			</section>
		{/if}

		<section class="ef-card">
			<SectionLabel>Døgnrytme</SectionLabel>
			<div class="ef-grid" role="table" aria-label="Sjekkins per slot og dag">
				<div class="ef-grid-row ef-grid-head" role="row">
					<span class="ef-grid-day" role="columnheader"></span>
					{#each PERIOD_SLOTS as slot (slot.id)}
						<span class="ef-grid-col" role="columnheader" title={slot.shortLabel}>{slot.emoji}</span>
					{/each}
				</div>
				{#each gridDays as p (p.day)}
					{@const daySlots = slotsOf(p)}
					<div class="ef-grid-row" role="row">
						<span class="ef-grid-day" role="rowheader">{fmtDayLabel(p.day)}</span>
						{#each PERIOD_SLOTS as slot (slot.id)}
							{@const entry = daySlots[slot.id]}
							<span
								class="ef-grid-cell"
								role="cell"
								style:background={levelBg(entry?.level ?? null)}
								style:color={levelColor(entry?.level ?? null)}
								title="{fmtDayLabel(p.day)} {slot.shortLabel.toLowerCase()}: {entry?.level != null ? `${entry.level}/5 — ${levelLabel(entry.level)}` : 'ikke registrert'}{entry?.note ? ` · ${entry.note}` : ''}"
							>{entry?.level ?? ''}</span>
						{/each}
					</div>
				{/each}
			</div>
			<div class="ef-trend-stats">
				<div class="ef-trend-stat"><span>Snitt</span><strong>{fmt(data.stats.avgLevel)}<span class="ef-mini-suffix">/5</span></strong></div>
				{#each PERIOD_SLOTS as slot (slot.id)}
					{@const slotAvg = data.stats.avgLevelBySlot?.[slot.id] ?? null}
					<div class="ef-trend-stat">
						<span>{slot.emoji} {slot.shortLabel}</span>
						<strong style:color={levelColor(slotAvg === null ? null : Math.round(slotAvg))}>{fmt(slotAvg)}</strong>
					</div>
				{/each}
				{#if data.stats.extremeDays > 0}
					<div class="ef-trend-stat ef-trend-stat-warn"><span>Dager med utslag</span><strong>{data.stats.extremeDays}</strong></div>
				{/if}
			</div>
		</section>

		{#if sparklinePoints}
			<section class="ef-card">
				<SectionLabel>Trend</SectionLabel>
				<svg class="ef-sparkline" viewBox="0 0 {sparklineWidth} {sparklineHeight}" preserveAspectRatio="none" aria-label="Nivå-trend">
					<line x1="0" y1={sparklineHeight / 2} x2={sparklineWidth} y2={sparklineHeight / 2} stroke="rgba(255,255,255,0.08)" stroke-dasharray="4 4" />
					<path d={sparklinePoints.areaPath} fill="rgba(139,160,245,0.18)" />
					<path d={sparklinePoints.path} fill="none" stroke="#8ba0f5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
					{#each sparklinePoints.points as pt (pt.day)}
						<circle cx={pt.x} cy={pt.y} r={pt.extreme ? 4 : 2.5} fill={pt.extreme ? '#ee8c8c' : '#8ba0f5'}>
							<title>{fmtDayLabel(pt.day)}</title>
						</circle>
					{/each}
				</svg>
			</section>
		{/if}

		<section class="ef-card">
			<SectionLabel>Siste sjekkins</SectionLabel>
			<ul class="ef-recent">
				{#each last7 as p (p.day)}
					{@const lvl = pointLevel(p)}
					{@const note = pointNote(p)}
					<li class="ef-recent-row" class:ef-recent-extreme={p.extreme}>
						<span class="ef-recent-day">{fmtDayLabel(p.day)}</span>
						<span class="ef-recent-balance" style:color={levelColor(lvl)}>{lvl ?? '—'}</span>
						<span class="ef-recent-note">{note ?? ''}</span>
						{#if p.extreme}
							<span class="ef-recent-flag" title="Utslag i sjekkin">!</span>
						{/if}
						{#if ondelete && p.eventIds?.length}
							<button
								class="ef-recent-delete"
								title="Slett sjekkin"
								aria-label="Slett sjekkins for {fmtDayLabel(p.day)}"
								onclick={(e) => { e.stopPropagation(); ondelete(p.eventIds!); }}
							>×</button>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</div>

<style>
	.ef-dash {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.ef-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.ef-header h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: #e2e8f0;
	}
	.ef-sub {
		margin: 2px 0 0;
		font-size: 0.82rem;
		color: #94a3b8;
	}
	.ef-cta {
		background: #8ba0f5;
		border: none;
		color: #0b1220;
		padding: 8px 14px;
		border-radius: 10px;
		font-weight: 600;
		font-size: 0.85rem;
		cursor: pointer;
		flex-shrink: 0;
	}
	.ef-cta:hover {
		background: #a3b4f7;
	}
	.ef-cta-large {
		padding: 10px 18px;
		font-size: 0.9rem;
	}
	.ef-cta-row {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}
	.ef-cta-secondary {
		background: rgba(255, 255, 255, 0.06);
		color: #cbd5e1;
		border: 1px solid rgba(255, 255, 255, 0.12);
	}
	.ef-cta-secondary:hover {
		background: rgba(255, 255, 255, 0.1);
	}
	.ef-empty {
		padding: 24px 16px;
		border: 1px dashed rgba(255, 255, 255, 0.12);
		border-radius: 14px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		color: #94a3b8;
	}
	.ef-empty p {
		margin: 0;
		font-size: 0.9rem;
	}
	.ef-card {
		background: var(--card-bg-subtle, rgba(255, 255, 255, 0.03));
		border: 1px solid var(--card-border, rgba(255, 255, 255, 0.06));
		border-radius: var(--card-radius, 14px);
		padding: var(--card-padding, 14px);
	}
	.ef-card :global(.section-label) {
		margin-bottom: 10px;
	}
	.ef-latest-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 6px;
	}
	.ef-latest-day {
		font-size: 0.82rem;
		color: #94a3b8;
	}
	.ef-streak {
		font-size: 0.78rem;
		color: #f6c177;
	}
	.ef-balance {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin: 4px 0 12px;
	}
	.ef-balance-num {
		font-size: 2.4rem;
		font-weight: 700;
		line-height: 1;
	}
	.ef-balance-suffix {
		font-size: 1.1rem;
		font-weight: 500;
		color: #64748b;
		margin-left: 2px;
	}
	.ef-balance-lbl {
		font-size: 0.85rem;
		color: #94a3b8;
	}

	/* Dagens slot-stripe */
	.ef-slot-strip {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 6px;
		margin-bottom: 8px;
	}
	.ef-slot-cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 8px 4px;
		border-radius: 10px;
	}
	.ef-slot-emoji {
		font-size: 0.95rem;
		line-height: 1;
	}
	.ef-slot-val {
		font-size: 0.95rem;
		font-weight: 600;
	}

	/* Døgnrytme-grid */
	.ef-grid {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.ef-grid-row {
		display: grid;
		grid-template-columns: 48px repeat(5, 1fr);
		gap: 4px;
		align-items: center;
	}
	.ef-grid-head {
		margin-bottom: 2px;
	}
	.ef-grid-col {
		text-align: center;
		font-size: 0.85rem;
		line-height: 1;
	}
	.ef-grid-day {
		font-size: 0.74rem;
		color: #94a3b8;
	}
	.ef-grid-cell {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 26px;
		border-radius: 7px;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.ef-note {
		margin: 8px 0 0;
		padding: 10px 12px;
		background: rgba(139, 160, 245, 0.06);
		border-left: 3px solid #8ba0f5;
		border-radius: 0 8px 8px 0;
		font-size: 0.88rem;
		color: #cbd5e1;
	}
	.ef-reflection {
		margin-top: 8px;
		font-size: 0.85rem;
		color: #cbd5e1;
	}
	.ef-reflection summary {
		cursor: pointer;
		color: #8ba0f5;
		font-weight: 500;
	}
	.ef-reflection p {
		margin: 8px 0 0;
	}
	.ef-reflection-state {
		color: #8ba0f5;
		font-size: 0.78rem;
		letter-spacing: 0.02em;
	}
	.ef-reflection-thread {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ef-reflection-msg {
		display: grid;
		grid-template-columns: 32px 1fr;
		gap: 8px;
		align-items: start;
		font-size: 0.85rem;
		line-height: 1.45;
	}
	.ef-reflection-role {
		color: #8ba0f5;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		padding-top: 2px;
	}
	.ef-reflection-msg.ef-reflection-user .ef-reflection-text {
		color: #f1f5f9;
		font-weight: 500;
	}
	.ef-reflection-msg.ef-reflection-assistant .ef-reflection-role {
		color: #64748b;
	}
	.ef-reflection-msg.ef-reflection-assistant .ef-reflection-text {
		color: #94a3b8;
	}
	.ef-sparkline {
		width: 100%;
		height: 60px;
		display: block;
	}
	.ef-trend-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-top: 12px;
	}
	.ef-trend-stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 8px;
	}
	.ef-trend-stat span {
		font-size: 0.72rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		white-space: nowrap;
	}
	.ef-trend-stat strong {
		font-size: 1.05rem;
		font-weight: 600;
		color: #e2e8f0;
	}
	.ef-trend-stat-warn strong {
		color: #ee8c8c;
	}
	.ef-mini-suffix {
		font-size: 0.75rem;
		color: #64748b;
		font-weight: 400;
		margin-left: 1px;
	}
	.ef-recent {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ef-recent-row {
		display: grid;
		grid-template-columns: 48px 28px 1fr 14px 20px;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.02);
		font-size: 0.85rem;
	}
	.ef-recent-extreme {
		background: rgba(238, 140, 140, 0.06);
	}
	.ef-recent-day {
		color: #94a3b8;
	}
	.ef-recent-balance {
		font-weight: 600;
	}
	.ef-recent-note {
		color: #94a3b8;
		font-size: 0.8rem;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ef-recent-flag {
		text-align: center;
		color: #ee8c8c;
		font-weight: 700;
	}
	.ef-recent-delete {
		background: none;
		border: none;
		color: #475569;
		font-size: 1rem;
		cursor: pointer;
		padding: 0 2px;
		line-height: 1;
		opacity: 0;
		transition: opacity 0.15s, color 0.15s;
	}
	.ef-recent-row:hover .ef-recent-delete { opacity: 1; }
	.ef-recent-delete:hover { color: #ee8c8c; }
</style>
