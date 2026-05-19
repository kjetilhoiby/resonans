<script lang="ts">
	import { ACTION_PYRAMID_LABELS } from '$lib/domains/egenfrekvens';
	import type { EgenfrekvensDashboardData, EgenfrekvensCheckinPointData } from '$lib/client/dashboard-cache';

	const LEVEL_LABELS: Record<number, string> = {
		1: 'Helt nede',
		2: 'Tungt',
		3: 'Midt på',
		4: 'Greit',
		5: 'God flyt'
	};

	interface Props {
		data: EgenfrekvensDashboardData;
		onstartCheckin?: () => void;
		onstartQuick?: () => void;
		ondelete?: (eventIds: string[]) => void;
	}

	let { data, onstartCheckin, onstartQuick, ondelete }: Props = $props();

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

	function levelColor(v: number | null): string {
		if (v === null) return '#475569';
		if (v >= 4) return '#48b581';
		if (v >= 3) return '#8ba0f5';
		if (v >= 2) return '#f6c177';
		return '#ee8c8c';
	}

	function actionLabel(v: number | null): string {
		if (v === null) return 'Ingen registrering';
		return ACTION_PYRAMID_LABELS[v] ?? '';
	}

	function levelLabel(v: number | null): string {
		if (v === null) return '';
		return LEVEL_LABELS[Math.round(v)] ?? '';
	}

	// Foretrekk level fra siste registrering (quick eller full), fallback til mapping fra balance
	function pointLevel(p: EgenfrekvensCheckinPointData | null): number | null {
		if (!p) return null;
		const explicit = p.evening?.level ?? p.morning?.level;
		if (typeof explicit === 'number') return explicit;
		if (typeof p.balance === 'number') return Math.max(1, Math.min(5, Math.round((p.balance + 5) / 2)));
		return null;
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

	// Egne sparkline-spor for morgen/kveld når quick-data finnes
	const slotSparklines = $derived.by(() => {
		const total = oldestFirst.length;
		if (total < 2) return null;
		const xs = oldestFirst.map((_, i) => (i / (total - 1)) * sparklineWidth);

		const morningDots: Array<{ x: number; y: number; day: string; val: number }> = [];
		const eveningDots: Array<{ x: number; y: number; day: string; val: number }> = [];

		oldestFirst.forEach((p, i) => {
			if (p.morning && typeof p.morning.balance === 'number') {
				morningDots.push({ x: xs[i], y: balanceToY(p.morning.balance), day: p.day, val: p.morning.level ?? Math.round((p.morning.balance + 5) / 2) });
			}
			if (p.evening && typeof p.evening.balance === 'number') {
				eveningDots.push({ x: xs[i], y: balanceToY(p.evening.balance), day: p.day, val: p.evening.level ?? Math.round((p.evening.balance + 5) / 2) });
			}
		});

		if (morningDots.length === 0 && eveningDots.length === 0) return null;

		const lineFrom = (dots: Array<{ x: number; y: number }>) =>
			dots.length >= 2
				? dots.map((d, i) => `${i === 0 ? 'M' : 'L'}${d.x.toFixed(1)},${d.y.toFixed(1)}`).join(' ')
				: null;

		return {
			morningPath: lineFrom(morningDots),
			eveningPath: lineFrom(eveningDots),
			morningDots,
			eveningDots
		};
	});

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

		{#if sparklinePoints}
			<section class="ef-card">
				<h3 class="ef-card-title">Balanse-trend</h3>
				<svg class="ef-sparkline" viewBox="0 0 {sparklineWidth} {sparklineHeight}" preserveAspectRatio="none" aria-label="Balanse-trend">
					<line x1="0" y1={sparklineHeight / 2} x2={sparklineWidth} y2={sparklineHeight / 2} stroke="rgba(255,255,255,0.08)" stroke-dasharray="4 4" />
					{#if slotSparklines}
						{#if slotSparklines.morningPath}
							<path d={slotSparklines.morningPath} fill="none" stroke="#f6c177" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.85" />
						{/if}
						{#if slotSparklines.eveningPath}
							<path d={slotSparklines.eveningPath} fill="none" stroke="#8ba0f5" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.85" />
						{/if}
						{#each slotSparklines.morningDots as pt (`m-${pt.day}`)}
							<circle cx={pt.x} cy={pt.y} r="2.5" fill="#f6c177">
								<title>{fmtDayLabel(pt.day)} morgen: {pt.val}/5</title>
							</circle>
						{/each}
						{#each slotSparklines.eveningDots as pt (`e-${pt.day}`)}
							<circle cx={pt.x} cy={pt.y} r="2.5" fill="#8ba0f5">
								<title>{fmtDayLabel(pt.day)} kveld: {pt.val}/5</title>
							</circle>
						{/each}
					{:else}
						<path d={sparklinePoints.areaPath} fill="rgba(139,160,245,0.18)" />
						<path d={sparklinePoints.path} fill="none" stroke="#8ba0f5" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
						{#each sparklinePoints.points as pt (pt.day)}
							<circle cx={pt.x} cy={pt.y} r={pt.extreme ? 4 : 2.5} fill={pt.extreme ? '#ee8c8c' : '#8ba0f5'}>
								<title>{fmtDayLabel(pt.day)}: {fmtSigned(pt.val, 0)}</title>
							</circle>
						{/each}
					{/if}
				</svg>
				{#if slotSparklines}
					<div class="ef-legend">
						<span class="ef-legend-item"><span class="ef-legend-dot" style:background="#f6c177"></span>Morgen</span>
						<span class="ef-legend-item"><span class="ef-legend-dot" style:background="#8ba0f5"></span>Kveld</span>
					</div>
				{/if}
				<div class="ef-trend-stats">
					<div class="ef-trend-stat"><span>Snitt nivå</span><strong>{fmt(data.stats.avgLevel)}<span class="ef-mini-suffix">/5</span></strong></div>
					<div class="ef-trend-stat"><span>Snitt tanker</span><strong>{fmt(data.stats.avgThoughts)}<span class="ef-mini-suffix">/5</span></strong></div>
					<div class="ef-trend-stat"><span>Snitt følelser</span><strong>{fmt(data.stats.avgFeelings)}<span class="ef-mini-suffix">/5</span></strong></div>
					<div class="ef-trend-stat"><span>Snitt handlinger</span><strong>{fmt(data.stats.avgActions)}<span class="ef-mini-suffix">/5</span></strong></div>
					{#if data.stats.extremeDays > 0}
						<div class="ef-trend-stat ef-trend-stat-warn"><span>Dager med utslag</span><strong>{data.stats.extremeDays}</strong></div>
					{/if}
				</div>
			</section>
		{/if}

		<section class="ef-card">
			<h3 class="ef-card-title">Siste sjekkins</h3>
			<ul class="ef-recent">
				{#each last7 as p (p.day)}
					{@const lvl = pointLevel(p)}
					<li class="ef-recent-row" class:ef-recent-extreme={p.extreme}>
						<span class="ef-recent-day">{fmtDayLabel(p.day)}</span>
						<span class="ef-recent-balance" style:color={levelColor(lvl)}>{lvl ?? '—'}</span>
						<span class="ef-recent-mini">T {fmt(p.thoughts, 0)}</span>
						<span class="ef-recent-mini">F {fmt(p.feelings, 0)}</span>
						<span class="ef-recent-mini">H {fmt(p.actions, 0)}</span>
						{#if p.extreme}
							<span class="ef-recent-flag" title="Utslag i sjekkin">!</span>
						{/if}
						{#if ondelete && p.eventIds?.length}
							<button
								class="ef-recent-delete"
								title="Slett sjekkin"
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
	.ef-legend {
		display: flex;
		gap: 14px;
		margin-top: 6px;
		font-size: 0.75rem;
		color: #94a3b8;
	}
	.ef-legend-item {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.ef-legend-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
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
		grid-template-columns: 60px 50px 1fr 1fr 1fr 14px 20px;
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
