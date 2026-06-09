<script lang="ts">
	/**
	 * ScreenTimeCard — viser skjermtid for siste uke: total/snitt, scrolling (sosiale
	 * medier), endring fra forrige uke, fordeling per dag og per time på døgnet,
	 * kategorisplitt og evt. ukesmål med progresjon. Rent presentasjonell.
	 */

	type Categories = Record<string, number>;
	interface ScreenTimeMetric {
		totalMinutes: number;
		avgPerDayMinutes: number;
		maxDayMinutes: number;
		socialMinutes: number;
		socialAvgPerDayMinutes: number;
		byCategory: Categories;
		byHour: number[];
		socialByHour: number[];
		dayCount: number;
		hourlyDayCount: number;
	}
	interface GoalEval {
		id: string;
		title: string;
		currentMinutes: number | null;
		targetMinutes: number;
		withinTarget: boolean | null;
		pct: number | null;
		deltaMinutes: number | null;
		basisLabel: string;
	}
	interface DayPoint {
		date: string;
		totalMinutes: number;
		socialMinutes: number;
		detailed: boolean;
	}

	let {
		thisWeek,
		prevWeek = null,
		goals = [],
		weekDays = [],
		categoryLabels = {},
		compact = false,
		cumulative = [],
		cumulativeRefs = []
	}: {
		thisWeek: ScreenTimeMetric | null;
		prevWeek?: ScreenTimeMetric | null;
		goals?: GoalEval[];
		weekDays?: DayPoint[];
		categoryLabels?: Record<string, string>;
		compact?: boolean;
		/** Akkumulert serie for valgt uke (punkt per time fra man 00:00). */
		cumulative?: number[];
		/** Tilsvarende serier for tidligere uker — tegnes som tynne grå referanselinjer. */
		cumulativeRefs?: number[][];
	} = $props();

	function fmt(min: number | null | undefined): string {
		if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return '0m';
		const h = Math.floor(min / 60);
		const m = Math.round(min % 60);
		if (h <= 0) return `${m}m`;
		if (m <= 0) return `${h}t`;
		return `${h}t ${m}m`;
	}

	// Fast man–søn-rekkefølge. weekDays er alltid lengde 7, index 0 = mandag.
	const dayLabels = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

	// Endring i snitt/dag mot forrige uke
	const totalDelta = $derived(
		thisWeek && prevWeek ? thisWeek.avgPerDayMinutes - prevWeek.avgPerDayMinutes : null
	);
	const socialDelta = $derived(
		thisWeek && prevWeek ? thisWeek.socialAvgPerDayMinutes - prevWeek.socialAvgPerDayMinutes : null
	);

	const hasWeekDays = $derived(weekDays.some((d) => d.totalMinutes > 0));
	const maxDay = $derived(Math.max(1, ...weekDays.map((d) => d.totalMinutes), thisWeek?.maxDayMinutes ?? 0));

	// Time-for-time: snitt per klokketime denne uka vs forrige.
	const hasHourly = $derived((thisWeek?.byHour ?? []).some((v) => v > 0));
	const thisHourAvg = $derived(
		(thisWeek?.byHour ?? []).map((v) => v / Math.max(1, thisWeek?.hourlyDayCount ?? 1))
	);
	const prevHourAvg = $derived(
		prevWeek && prevWeek.hourlyDayCount > 0 && (prevWeek.byHour ?? []).some((v) => v > 0)
			? prevWeek.byHour.map((v) => v / Math.max(1, prevWeek.hourlyDayCount))
			: null
	);
	const maxHourAvg = $derived(Math.max(1, ...thisHourAvg, ...(prevHourAvg ?? [])));

	/* ── Akkumulert ukegraf (man 00 → søn 24) ─────────────── */
	const HOURS_PER_WEEK = 168;
	const CHART_W = 360;
	const CHART_H = 150;
	const PAD = { top: 8, right: 10, bottom: 18, left: 36 };
	const plotW = CHART_W - PAD.left - PAD.right;
	const plotH = CHART_H - PAD.top - PAD.bottom;

	const hasCumulative = $derived(cumulative.length > 1);
	let hourViewChoice = $state<'cumulative' | 'hours'>('cumulative');
	const hourView = $derived(
		hasCumulative && (hourViewChoice === 'cumulative' || !hasHourly) ? 'cumulative' : 'hours'
	);

	const cumulativeMax = $derived(
		Math.max(
			1,
			cumulative[cumulative.length - 1] ?? 0,
			...cumulativeRefs.map((r) => r[r.length - 1] ?? 0)
		)
	);

	function cumX(i: number): number {
		return PAD.left + (i / HOURS_PER_WEEK) * plotW;
	}
	function cumY(v: number): number {
		return PAD.top + plotH - (v / cumulativeMax) * plotH;
	}
	function cumulativePath(series: number[]): string {
		if (series.length < 2) return '';
		return series
			.map((v, i) => `${i === 0 ? 'M' : 'L'}${cumX(i).toFixed(1)},${cumY(v).toFixed(1)}`)
			.join(' ');
	}
	const cumulativeArea = $derived(
		hasCumulative
			? `${cumulativePath(cumulative)} L${cumX(cumulative.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${cumX(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`
			: ''
	);
	const cumulativeEnd = $derived(
		hasCumulative
			? {
					x: cumX(cumulative.length - 1),
					y: cumY(cumulative[cumulative.length - 1]),
					value: cumulative[cumulative.length - 1]
				}
			: null
	);

	function fmtAxis(min: number): string {
		if (min >= 95) return `${Math.round(min / 60)}t`;
		return `${Math.round(min)}m`;
	}

	// Kategorier sortert
	const categoryRows = $derived(
		Object.entries(thisWeek?.byCategory ?? {})
			.map(([key, minutes]) => ({ key, minutes: Number(minutes) || 0 }))
			.filter((r) => r.minutes > 0)
			.sort((a, b) => b.minutes - a.minutes)
	);
	const categoryTotal = $derived(categoryRows.reduce((s, r) => s + r.minutes, 0) || 1);

	function deltaText(delta: number | null): { label: string; tone: 'down' | 'up' | 'flat' } | null {
		if (delta === null) return null;
		if (delta < -1) return { label: `↓ ${fmt(Math.abs(delta))}`, tone: 'down' };
		if (delta > 1) return { label: `↑ ${fmt(delta)}`, tone: 'up' };
		return { label: '→ uendret', tone: 'flat' };
	}
</script>

<div class="st-card" class:compact>
	{#if !thisWeek}
		<div class="st-empty">
			<p>Ingen skjermtid registrert ennå.</p>
			<p class="hint">Legg inn et iOS Skjermtid-skjermbilde for å komme i gang.</p>
		</div>
	{:else}
		<div class="st-headline">
			<div class="metric">
				<span class="metric-label">Skjermtid · snitt/dag</span>
				<span class="metric-value">{fmt(thisWeek.avgPerDayMinutes)}</span>
				{#if deltaText(totalDelta)}
					{@const d = deltaText(totalDelta)}
					<span class="delta {d?.tone}">{d?.label} fra forrige uke</span>
				{/if}
			</div>
			<div class="metric">
				<span class="metric-label">Scrolling · snitt/dag</span>
				<span class="metric-value social">{fmt(thisWeek.socialAvgPerDayMinutes)}</span>
				{#if deltaText(socialDelta)}
					{@const d = deltaText(socialDelta)}
					<span class="delta {d?.tone}">{d?.label}</span>
				{/if}
			</div>
		</div>

		{#if !compact && hasWeekDays}
			<div class="st-section">
				<span class="section-title">Per dag</span>
				<div class="day-bars">
					{#each weekDays as d, i}
						<div class="day-col" title={`${d.date}: ${fmt(d.totalMinutes)} (scrolling ${fmt(d.socialMinutes)})`}>
							<div class="bar-track">
								<div class="bar-total" style={`height:${(d.totalMinutes / maxDay) * 100}%`}>
									<div
										class="bar-social"
										style={`height:${d.totalMinutes > 0 ? (d.socialMinutes / d.totalMinutes) * 100 : 0}%`}
									></div>
								</div>
							</div>
							<span class="day-label">{dayLabels[i]}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if !compact && (hasCumulative || hasHourly)}
			<div class="st-section">
				<div class="section-head">
					<span class="section-title">
						{hourView === 'cumulative' ? 'Akkumulert gjennom uka' : 'Per time av døgnet (snitt/dag)'}
					</span>
					{#if hasCumulative && hasHourly}
						<div class="view-toggle" role="group" aria-label="Velg visning">
							<button
								class:active={hourView === 'cumulative'}
								onclick={() => (hourViewChoice = 'cumulative')}
								data-track="skjermtid:visning-akkumulert">Akkumulert</button
							>
							<button
								class:active={hourView === 'hours'}
								onclick={() => (hourViewChoice = 'hours')}
								data-track="skjermtid:visning-per-time">Per time</button
							>
						</div>
					{/if}
				</div>

				{#if hourView === 'cumulative'}
					<svg
						viewBox={`0 0 ${CHART_W} ${CHART_H}`}
						class="cum-chart"
						role="img"
						aria-label="Akkumulert skjermtid fra mandag til søndag"
					>
						{#each [0.25, 0.5, 0.75, 1] as t}
							<line
								x1={PAD.left}
								x2={PAD.left + plotW}
								y1={PAD.top + plotH - t * plotH}
								y2={PAD.top + plotH - t * plotH}
								class="cum-grid"
							/>
						{/each}
						<line
							x1={PAD.left}
							x2={PAD.left + plotW}
							y1={PAD.top + plotH}
							y2={PAD.top + plotH}
							class="cum-baseline"
						/>
						{#each [0.5, 1] as t}
							<text x={PAD.left - 5} y={PAD.top + plotH - t * plotH + 3} class="cum-axis-y">
								{fmtAxis(t * cumulativeMax)}
							</text>
						{/each}
						{#each dayLabels as label, i}
							{#if i > 0}
								<line
									x1={cumX(i * 24)}
									x2={cumX(i * 24)}
									y1={PAD.top}
									y2={PAD.top + plotH}
									class="cum-grid day"
								/>
							{/if}
							<text x={cumX(i * 24 + 12)} y={CHART_H - 5} class="cum-axis-x">{label}</text>
						{/each}

						{#each cumulativeRefs as ref}
							<path d={cumulativePath(ref)} class="cum-ref" />
						{/each}

						<path d={cumulativeArea} class="cum-area" />
						<path d={cumulativePath(cumulative)} class="cum-line" />
						{#if cumulativeEnd}
							<circle cx={cumulativeEnd.x} cy={cumulativeEnd.y} r="3" class="cum-dot" />
						{/if}
					</svg>
					<div class="cum-legend">
						<span class="legend-item"><span class="swatch this"></span>Denne uka ({fmt(Math.round(cumulativeEnd?.value ?? 0))})</span>
						{#if cumulativeRefs.length > 0}
							<span class="legend-item">
								<span class="swatch ref"></span>Siste {cumulativeRefs.length} uke{cumulativeRefs.length === 1 ? '' : 'r'}
							</span>
						{/if}
					</div>
				{:else}
					<div class="hour-bars">
						{#each thisHourAvg as v, hour}
							{@const prev = prevHourAvg?.[hour] ?? null}
							{@const delta = prev === null ? null : Math.round(v - prev)}
							{@const total = thisWeek.byHour[hour] ?? 0}
							<div
								class="hour-col"
								title={`kl. ${String(hour).padStart(2, '0')}: ${fmt(Math.round(v))} /dag${
									prev === null
										? ''
										: ` · forrige uke ${fmt(Math.round(prev))}${delta === 0 ? '' : ` (${delta! > 0 ? '+' : '−'}${fmt(Math.abs(delta!))})`}`
								}`}
							>
								<div class="hour-track">
									{#if prevHourAvg}
										<div class="hour-prev" style={`height:${(prev! / maxHourAvg) * 100}%`}></div>
									{/if}
									<div class="hour-total" style={`height:${(v / maxHourAvg) * 100}%`}>
										<div
											class="hour-social"
											style={`height:${total > 0 ? ((thisWeek.socialByHour[hour] ?? 0) / total) * 100 : 0}%`}
										></div>
									</div>
								</div>
								{#if hour % 6 === 0}
									<span class="hour-label">{String(hour).padStart(2, '0')}</span>
								{/if}
							</div>
						{/each}
					</div>
					{#if prevHourAvg}
						<div class="cum-legend">
							<span class="legend-item"><span class="swatch this"></span>Denne uka</span>
							<span class="legend-item"><span class="swatch ref"></span>Forrige uke</span>
						</div>
					{/if}
				{/if}
			</div>
		{:else if !compact}
			<p class="st-hint">Ingen time-for-time for denne uka. Last opp et <strong>dagsbilde</strong> (Dag-fanen) for å se tid på døgnet.</p>
		{/if}

		{#if !compact && categoryRows.length > 0}
			<div class="st-section">
				<span class="section-title">Kategorier</span>
				<div class="cat-list">
					{#each categoryRows as row}
						<div class="cat-row">
							<span class="cat-name" class:social={row.key === 'social'}>
								{categoryLabels[row.key] ?? row.key}
							</span>
							<div class="cat-bar">
								<div
									class="cat-fill"
									class:social={row.key === 'social'}
									style={`width:${(row.minutes / categoryTotal) * 100}%`}
								></div>
							</div>
							<span class="cat-min">{fmt(row.minutes)}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if goals.length > 0}
			<div class="st-section">
				<span class="section-title">Ukesmål</span>
				<div class="goal-list">
					{#each goals as g}
						<div class="goal-row" class:ok={g.withinTarget === true} class:over={g.withinTarget === false}>
							<div class="goal-head">
								<span class="goal-title">{g.title}</span>
								<span class="goal-val">
									{g.currentMinutes === null ? '–' : fmt(g.currentMinutes)} / {fmt(g.targetMinutes)}
								</span>
							</div>
							<div class="goal-bar">
								<div
									class="goal-fill"
									class:over={g.withinTarget === false}
									style={`width:${Math.min(100, Math.round((g.pct ?? 0) * 100))}%`}
								></div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.st-card {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		background: var(--bg-secondary, #161616);
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: 16px;
		padding: 1.25rem;
		color: var(--text-primary, #fff);
	}
	.st-card.compact {
		gap: 0.85rem;
		padding: 1rem;
	}
	.st-empty {
		text-align: center;
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
	}
	.st-empty .hint {
		font-size: 0.85rem;
		opacity: 0.7;
	}
	.st-headline {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
	}
	.metric {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.metric-label {
		font-size: 0.78rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
	}
	.metric-value {
		font-size: 1.9rem;
		font-weight: 700;
		line-height: 1.1;
	}
	.metric-value.social {
		color: var(--accent-primary, #4aa8ff);
	}
	.delta {
		font-size: 0.78rem;
	}
	.delta.down {
		color: #4ade80;
	}
	.delta.up {
		color: #fb923c;
	}
	.delta.flat {
		color: var(--text-secondary, rgba(255, 255, 255, 0.5));
	}
	.section-title {
		display: block;
		font-size: 0.78rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
		margin-bottom: 0.5rem;
	}
	.st-hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.5));
		padding: 0.5rem 0.75rem;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 8px;
	}
	.day-bars {
		display: flex;
		gap: 0.4rem;
		align-items: flex-end;
		height: 88px;
	}
	.day-col {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		height: 100%;
	}
	.bar-track {
		flex: 1;
		width: 70%;
		display: flex;
		align-items: flex-end;
	}
	.bar-total {
		width: 100%;
		background: var(--text-secondary, rgba(255, 255, 255, 0.25));
		border-radius: 4px 4px 0 0;
		display: flex;
		align-items: flex-end;
		min-height: 2px;
	}
	.bar-social {
		width: 100%;
		background: var(--accent-primary, #4aa8ff);
		border-radius: 4px 4px 0 0;
	}
	.day-label {
		font-size: 0.7rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.5));
	}
	.section-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}
	.section-head .section-title {
		margin-bottom: 0;
	}
	.view-toggle {
		display: flex;
		gap: 2px;
		background: rgba(255, 255, 255, 0.06);
		border-radius: 8px;
		padding: 2px;
	}
	.view-toggle button {
		background: none;
		border: none;
		color: var(--text-secondary, rgba(255, 255, 255, 0.55));
		font-size: 0.72rem;
		padding: 0.25rem 0.55rem;
		border-radius: 6px;
		cursor: pointer;
	}
	.view-toggle button.active {
		background: rgba(255, 255, 255, 0.12);
		color: var(--text-primary, #fff);
	}
	.cum-chart {
		width: 100%;
		height: auto;
		display: block;
	}
	.cum-grid {
		stroke: rgba(255, 255, 255, 0.07);
		stroke-width: 1;
	}
	.cum-grid.day {
		stroke: rgba(255, 255, 255, 0.05);
	}
	.cum-baseline {
		stroke: rgba(255, 255, 255, 0.18);
		stroke-width: 1;
	}
	.cum-axis-y {
		fill: var(--text-secondary, rgba(255, 255, 255, 0.45));
		font-size: 8px;
		text-anchor: end;
	}
	.cum-axis-x {
		fill: var(--text-secondary, rgba(255, 255, 255, 0.45));
		font-size: 8px;
		text-anchor: middle;
	}
	.cum-ref {
		fill: none;
		stroke: rgba(255, 255, 255, 0.18);
		stroke-width: 1;
	}
	.cum-area {
		fill: var(--accent-primary, #4aa8ff);
		opacity: 0.08;
	}
	.cum-line {
		fill: none;
		stroke: var(--accent-primary, #4aa8ff);
		stroke-width: 2;
		stroke-linejoin: round;
	}
	.cum-dot {
		fill: var(--accent-primary, #4aa8ff);
	}
	.cum-legend {
		display: flex;
		gap: 1rem;
		margin-top: 0.4rem;
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.72rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.55));
	}
	.swatch {
		width: 14px;
		height: 3px;
		border-radius: 2px;
	}
	.swatch.this {
		background: var(--accent-primary, #4aa8ff);
	}
	.swatch.ref {
		background: rgba(255, 255, 255, 0.3);
	}
	.hour-bars {
		display: flex;
		gap: 1px;
		align-items: flex-end;
		height: 64px;
	}
	.hour-col {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		height: 100%;
		position: relative;
	}
	.hour-track {
		flex: 1;
		width: 100%;
		display: flex;
		align-items: flex-end;
		gap: 1px;
	}
	.hour-prev {
		flex: 1;
		min-width: 0;
		background: rgba(255, 255, 255, 0.14);
		border-radius: 2px 2px 0 0;
		min-height: 1px;
	}
	.hour-total {
		flex: 1;
		min-width: 0;
		background: var(--text-secondary, rgba(255, 255, 255, 0.22));
		border-radius: 2px 2px 0 0;
		display: flex;
		align-items: flex-end;
		min-height: 1px;
	}
	.hour-social {
		width: 100%;
		background: var(--accent-primary, #4aa8ff);
		border-radius: 2px 2px 0 0;
	}
	.hour-label {
		position: absolute;
		bottom: -16px;
		font-size: 0.6rem;
		color: var(--text-secondary, rgba(255, 255, 255, 0.4));
	}
	.cat-list {
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}
	.cat-row {
		display: grid;
		grid-template-columns: 120px 1fr auto;
		gap: 0.6rem;
		align-items: center;
		font-size: 0.82rem;
	}
	.cat-name {
		color: var(--text-secondary, rgba(255, 255, 255, 0.7));
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.cat-name.social {
		color: var(--accent-primary, #4aa8ff);
		font-weight: 600;
	}
	.cat-bar {
		height: 8px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 4px;
		overflow: hidden;
	}
	.cat-fill {
		height: 100%;
		background: var(--text-secondary, rgba(255, 255, 255, 0.35));
		border-radius: 4px;
	}
	.cat-fill.social {
		background: var(--accent-primary, #4aa8ff);
	}
	.cat-min {
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
		font-variant-numeric: tabular-nums;
	}
	.goal-list {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.goal-head {
		display: flex;
		justify-content: space-between;
		font-size: 0.82rem;
		margin-bottom: 0.3rem;
	}
	.goal-val {
		color: var(--text-secondary, rgba(255, 255, 255, 0.6));
		font-variant-numeric: tabular-nums;
	}
	.goal-bar {
		height: 8px;
		background: rgba(255, 255, 255, 0.08);
		border-radius: 4px;
		overflow: hidden;
	}
	.goal-fill {
		height: 100%;
		background: #4ade80;
		border-radius: 4px;
	}
	.goal-fill.over {
		background: #fb923c;
	}
</style>
