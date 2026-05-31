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
		dailySeries = [],
		categoryLabels = {},
		compact = false
	}: {
		thisWeek: ScreenTimeMetric | null;
		prevWeek?: ScreenTimeMetric | null;
		goals?: GoalEval[];
		dailySeries?: DayPoint[];
		categoryLabels?: Record<string, string>;
		compact?: boolean;
	} = $props();

	function fmt(min: number | null | undefined): string {
		if (typeof min !== 'number' || !Number.isFinite(min) || min <= 0) return '0m';
		const h = Math.floor(min / 60);
		const m = Math.round(min % 60);
		if (h <= 0) return `${m}m`;
		if (m <= 0) return `${h}t`;
		return `${h}t ${m}m`;
	}

	const dayLabels = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

	// Endring i snitt/dag mot forrige uke
	const totalDelta = $derived(
		thisWeek && prevWeek ? thisWeek.avgPerDayMinutes - prevWeek.avgPerDayMinutes : null
	);
	const socialDelta = $derived(
		thisWeek && prevWeek ? thisWeek.socialAvgPerDayMinutes - prevWeek.socialAvgPerDayMinutes : null
	);

	// Siste 7 dager fra serien
	const last7 = $derived(dailySeries.slice(-7));
	const maxDay = $derived(Math.max(1, ...last7.map((d) => d.totalMinutes), thisWeek?.maxDayMinutes ?? 0));

	// Time-for-time
	const maxHour = $derived(Math.max(1, ...(thisWeek?.byHour ?? [])));

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

		{#if last7.length > 0}
			<div class="st-section">
				<span class="section-title">Per dag</span>
				<div class="day-bars">
					{#each last7 as d, i}
						<div class="day-col" title={`${d.date}: ${fmt(d.totalMinutes)} (scrolling ${fmt(d.socialMinutes)})`}>
							<div class="bar-track">
								<div class="bar-total" style={`height:${(d.totalMinutes / maxDay) * 100}%`}>
									<div
										class="bar-social"
										style={`height:${d.totalMinutes > 0 ? (d.socialMinutes / d.totalMinutes) * 100 : 0}%`}
									></div>
								</div>
							</div>
							<span class="day-label">{dayLabels[new Date(d.date).getDay() === 0 ? 6 : new Date(d.date).getDay() - 1]}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if !compact && (thisWeek.byHour ?? []).some((v) => v > 0)}
			<div class="st-section">
				<span class="section-title">Tid på døgnet (snitt over uka)</span>
				<div class="hour-bars">
					{#each thisWeek.byHour as h, hour}
						<div
							class="hour-col"
							title={`kl. ${String(hour).padStart(2, '0')}: ${fmt(Math.round(h / Math.max(1, thisWeek.hourlyDayCount)))} /dag`}
						>
							<div class="hour-track">
								<div class="hour-total" style={`height:${(h / maxHour) * 100}%`}>
									<div
										class="hour-social"
										style={`height:${h > 0 ? ((thisWeek.socialByHour[hour] ?? 0) / h) * 100 : 0}%`}
									></div>
								</div>
							</div>
							{#if hour % 6 === 0}
								<span class="hour-label">{String(hour).padStart(2, '0')}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
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
	}
	.hour-total {
		width: 100%;
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
