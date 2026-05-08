<script lang="ts">
	import { ACTION_PYRAMID_LABELS, BALANCE_LABELS } from '$lib/domains/egenfrekvens';
	import type { EgenfrekvensDashboardData, EgenfrekvensCheckinPointData } from '$lib/client/dashboard-cache';

	interface Props {
		data: EgenfrekvensDashboardData;
		onstartCheckin?: () => void;
	}

	let { data, onstartCheckin }: Props = $props();

	const oldestFirst = $derived([...data.points].sort((a, b) => (a.day < b.day ? -1 : 1)));

	function fmt(n: number | null, digits = 1): string {
		if (n === null) return '—';
		return n.toFixed(digits);
	}

	function fmtSigned(n: number | null, digits = 1): string {
		if (n === null) return '—';
		const sign = n > 0 ? '+' : '';
		return `${sign}${n.toFixed(digits)}`;
	}

	function fmtDayLabel(day: string): string {
		const [, m, d] = day.split('-');
		return `${d}.${m}`;
	}

	function balanceColor(v: number | null): string {
		if (v === null) return '#475569';
		if (v >= 2) return '#48b581';
		if (v >= -1) return '#8ba0f5';
		return '#ee8c8c';
	}

	function actionLabel(v: number | null): string {
		if (v === null) return 'Ingen registrering';
		return ACTION_PYRAMID_LABELS[v] ?? '';
	}

	function balanceLabel(v: number | null): string {
		if (v === null) return '';
		// Find nearest anchor
		const anchors = Object.keys(BALANCE_LABELS)
			.map(Number)
			.sort((a, b) => Math.abs(a - v) - Math.abs(b - v));
		return BALANCE_LABELS[anchors[0]] ?? '';
	}

	// Sparkline geometry for balance trend
	const sparklineWidth = 280;
	const sparklineHeight = 60;
	const sparklinePoints = $derived.by(() => {
		const points = oldestFirst.filter((p) => typeof p.balance === 'number');
		if (points.length < 2) return null;
		const xs = points.map((_, i) => (i / (points.length - 1)) * sparklineWidth);
		// balance range is -5..+5 → map to 0..height (inverted, higher value = top)
		const ys = points.map((p) => {
			const v = (p.balance as number);
			const norm = (v + 5) / 10;
			return sparklineHeight - norm * sparklineHeight;
		});
		const path = points
			.map((_, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${ys[i].toFixed(1)}`)
			.join(' ');
		const areaPath = `${path} L${sparklineWidth},${sparklineHeight} L0,${sparklineHeight} Z`;
		return { path, areaPath, points: points.map((p, i) => ({ x: xs[i], y: ys[i], val: p.balance, day: p.day, extreme: p.extreme })) };
	});

	const last7: EgenfrekvensCheckinPointData[] = $derived(data.points.slice(0, 7));
</script>

<div class="ef-dash">
	<header class="ef-header">
		<div class="ef-header-text">
			<h2>Egenfrekvens</h2>
			<p class="ef-sub">Siste {data.rangeDays} dager · {data.stats.count} sjekkin{data.stats.count === 1 ? '' : 's'}</p>
		</div>
		{#if onstartCheckin}
			<button class="ef-cta" onclick={onstartCheckin}>+ Sjekk in nå</button>
		{/if}
	</header>

	{#if data.points.length === 0}
		<div class="ef-empty">
			<p>Ingen sjekkins ennå. Start med en — det tar 30 sekunder.</p>
			{#if onstartCheckin}
				<button class="ef-cta ef-cta-large" onclick={onstartCheckin}>Sjekk in nå</button>
			{/if}
		</div>
	{:else}
		<!-- Latest snapshot -->
		{#if data.latest}
			<section class="ef-card ef-latest">
				<div class="ef-latest-head">
					<span class="ef-latest-day">{fmtDayLabel(data.latest.day)}</span>
					{#if data.streakDays > 1}
						<span class="ef-streak">🔥 {data.streakDays} dager på rad</span>
					{/if}
				</div>
				<div class="ef-balance" style:color={balanceColor(data.latest.balance)}>
					<span class="ef-balance-num">{fmtSigned(data.latest.balance, 0)}</span>
					<span class="ef-balance-lbl">{balanceLabel(data.latest.balance)}</span>
				</div>
				<div class="ef-mini-grid">
					<div class="ef-mini">
						<span class="ef-mini-lbl">Tanker</span>
						<span class="ef-mini-val">{fmt(data.latest.thoughts, 0)}<span class="ef-mini-suffix">/5</span></span>
					</div>
					<div class="ef-mini">
						<span class="ef-mini-lbl">Følelser</span>
						<span class="ef-mini-val">{fmt(data.latest.feelings, 0)}<span class="ef-mini-suffix">/5</span></span>
					</div>
					<div class="ef-mini">
						<span class="ef-mini-lbl">Handlinger</span>
						<span class="ef-mini-val">{fmt(data.latest.actions, 0)}<span class="ef-mini-suffix">/5</span></span>
					</div>
				</div>
				{#if data.latest.actions !== null}
					<p class="ef-action-hint">{actionLabel(data.latest.actions)}</p>
				{/if}
				{#if data.latest.note}
					<p class="ef-note">«{data.latest.note}»</p>
				{/if}
				{#if data.latest.reflection}
					<details class="ef-reflection">
						<summary>Refleksjon</summary>
						<p>{data.latest.reflection}</p>
					</details>
				{/if}
			</section>
		{/if}

		<!-- Trend -->
		{#if sparklinePoints}
			<section class="ef-card">
				<h3 class="ef-card-title">Balanse-trend</h3>
				<svg class="ef-sparkline" viewBox="0 0 {sparklineWidth} {sparklineHeight}" preserveAspectRatio="none" aria-label="Balanse-trend">
					<line x1="0" y1={sparklineHeight / 2} x2={sparklineWidth} y2={sparklineHeight / 2} stroke="rgba(255,255,255,0.08)" stroke-dasharray="4 4" />
					<path d={sparklinePoints.areaPath} fill="rgba(139,160,245,0.18)" />
					<path d={sparklinePoints.path} fill="none" stroke="#8ba0f5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
					{#each sparklinePoints.points as pt (pt.day)}
						<circle cx={pt.x} cy={pt.y} r={pt.extreme ? 4 : 2.5} fill={pt.extreme ? '#ee8c8c' : '#8ba0f5'}>
							<title>{fmtDayLabel(pt.day)}: {fmtSigned(pt.val, 0)}</title>
						</circle>
					{/each}
				</svg>
				<div class="ef-trend-stats">
					<div class="ef-trend-stat"><span>Snitt balanse</span><strong>{fmtSigned(data.stats.avgBalance)}</strong></div>
					<div class="ef-trend-stat"><span>Snitt tanker</span><strong>{fmt(data.stats.avgThoughts)}<span class="ef-mini-suffix">/5</span></strong></div>
					<div class="ef-trend-stat"><span>Snitt følelser</span><strong>{fmt(data.stats.avgFeelings)}<span class="ef-mini-suffix">/5</span></strong></div>
					<div class="ef-trend-stat"><span>Snitt handlinger</span><strong>{fmt(data.stats.avgActions)}<span class="ef-mini-suffix">/5</span></strong></div>
					{#if data.stats.extremeDays > 0}
						<div class="ef-trend-stat ef-trend-stat-warn"><span>Dager med utslag</span><strong>{data.stats.extremeDays}</strong></div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Recent days -->
		<section class="ef-card">
			<h3 class="ef-card-title">Siste sjekkins</h3>
			<ul class="ef-recent">
				{#each last7 as p (p.day)}
					<li class="ef-recent-row" class:ef-recent-extreme={p.extreme}>
						<span class="ef-recent-day">{fmtDayLabel(p.day)}</span>
						<span class="ef-recent-balance" style:color={balanceColor(p.balance)}>{fmtSigned(p.balance, 0)}</span>
						<span class="ef-recent-mini">T {fmt(p.thoughts, 0)}</span>
						<span class="ef-recent-mini">F {fmt(p.feelings, 0)}</span>
						<span class="ef-recent-mini">H {fmt(p.actions, 0)}</span>
						{#if p.extreme}
							<span class="ef-recent-flag" title="Utslag i sjekkin">!</span>
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
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 14px;
		padding: 14px;
	}
	.ef-card-title {
		margin: 0 0 10px;
		font-size: 0.82rem;
		font-weight: 600;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
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
	.ef-balance-lbl {
		font-size: 0.85rem;
		color: #94a3b8;
	}
	.ef-mini-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-bottom: 8px;
	}
	.ef-mini {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px 10px;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 10px;
	}
	.ef-mini-lbl {
		font-size: 0.72rem;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.ef-mini-val {
		font-size: 1.2rem;
		font-weight: 600;
		color: #e2e8f0;
	}
	.ef-mini-suffix {
		font-size: 0.75rem;
		color: #64748b;
		font-weight: 400;
		margin-left: 1px;
	}
	.ef-action-hint {
		margin: 0 0 6px;
		font-size: 0.82rem;
		color: #94a3b8;
		font-style: italic;
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
	.ef-sparkline {
		width: 100%;
		height: 60px;
		display: block;
	}
	.ef-trend-stats {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 8px;
		margin-top: 10px;
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
	}
	.ef-trend-stat strong {
		font-size: 1.05rem;
		font-weight: 600;
		color: #e2e8f0;
	}
	.ef-trend-stat-warn strong {
		color: #ee8c8c;
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
		grid-template-columns: 60px 50px 1fr 1fr 1fr 14px;
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
	.ef-recent-mini {
		color: #cbd5e1;
		font-size: 0.8rem;
	}
	.ef-recent-flag {
		text-align: center;
		color: #ee8c8c;
		font-weight: 700;
	}
</style>
