<script lang="ts">
	import SectionLabel from '../ui/SectionLabel.svelte';

	type EffortFamily =
		| 'running'
		| 'cycling'
		| 'ebike'
		| 'strength'
		| 'yoga'
		| 'walking'
		| 'hiking'
		| 'swimming'
		| 'other';

	interface BarSpec {
		label: string;
		value: number;
	}

	interface Props {
		total: number;
		byFamily: Partial<Record<EffortFamily, number>>;
		byDay?: number[];
		bars?: BarSpec[];
		ceilings?: (number | null)[];
		hrCoveragePct?: number;
		workoutCount?: number;
		baseline?: { p4wAvg: number; delta: number };
		weekLabel?: string;
		title?: string;
	}

	let {
		total,
		byFamily,
		byDay,
		bars,
		ceilings,
		hrCoveragePct = 0,
		workoutCount = 0,
		baseline,
		weekLabel,
		title = 'Relativ effort'
	}: Props = $props();

	const dayLetters = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

	const renderedBars = $derived<BarSpec[]>(
		bars
			? bars
			: (byDay ?? []).map((value, i) => ({ label: dayLetters[i] ?? '', value }))
	);

	const isPeriodMode = $derived(bars !== undefined);

	const familyLabels: Record<EffortFamily, string> = {
		running: 'Løping',
		cycling: 'Sykkel',
		ebike: 'Elsykkel',
		strength: 'Styrke',
		yoga: 'Yoga',
		walking: 'Gåing',
		hiking: 'Tur',
		swimming: 'Svømming',
		other: 'Annet'
	};

	const familyColors: Record<EffortFamily, string> = {
		running: '#f59e0b',
		cycling: '#10b981',
		ebike: '#6ee7b7',
		strength: '#a78bfa',
		yoga: '#f472b6',
		walking: '#94a3b8',
		hiking: '#fbbf24',
		swimming: '#38bdf8',
		other: '#64748b'
	};

	const statusLabel = $derived.by(() => {
		if (isPeriodMode) return null;
		if (!baseline) return 'Ingen sammenligning ennå';
		const ratio = baseline.p4wAvg > 0 ? total / baseline.p4wAvg : 1;
		if (ratio >= 1.25) return 'Bygger opp';
		if (ratio >= 0.85) return 'Jevn fremgang';
		if (ratio >= 0.5) return 'Roligere uke';
		return 'Lett uke';
	});

	const statusHint = $derived.by(() => {
		if (isPeriodMode) return null;
		if (!baseline) return 'Trenger et par uker med data for å vise trend.';
		const ratio = baseline.p4wAvg > 0 ? total / baseline.p4wAvg : 1;
		if (ratio >= 1.25) return 'Tydelig over 4-ukers snitt — pass på restitusjon.';
		if (ratio >= 0.85) return 'Godt nivå for å bygge eller opprettholde form.';
		if (ratio >= 0.5) return 'Under snittet — rom for én økt til om du har overskudd.';
		return 'Mye lavere enn vanlig — bevisst hvile eller har noe gått tapt?';
	});

	const maxBar = $derived(
		Math.max(
			1,
			...renderedBars.map((b) => b.value),
			...(ceilings ?? []).map((c) => c ?? 0)
		)
	);

	const ceilingHints = $derived<(number | null)[]>(
		ceilings ?? renderedBars.map(() => null)
	);

	const anyOvershoot = $derived(
		ceilingHints.some((c, i) => c != null && renderedBars[i] && renderedBars[i].value > c)
	);

	const families = $derived(
		(Object.entries(byFamily) as [EffortFamily, number][])
			.filter(([, value]) => value > 0)
			.sort(([, a], [, b]) => b - a)
	);

	const familyTotal = $derived(families.reduce((sum, [, value]) => sum + value, 0));
</script>

<section class="effort-card">
	<header>
		<div class="title-row">
			<SectionLabel tag="span">{title}</SectionLabel>
			{#if weekLabel}<span class="week">{weekLabel}</span>{/if}
		</div>
		<div class="total-row">
			<span class="total">{Math.round(total)}</span>
			{#if statusLabel}<span class="status">{statusLabel}</span>{/if}
		</div>
		{#if statusHint}<p class="hint">{statusHint}</p>{/if}
	</header>

	<div
		class="spark"
		class:compact={renderedBars.length > 13}
		style="--bar-count: {Math.max(1, renderedBars.length)}"
		aria-label={isPeriodMode ? 'Effort per uke' : 'Effort per dag'}
	>
		{#each renderedBars as bar, i}
			{@const ceiling = ceilingHints[i]}
			{@const overshoot = ceiling != null && bar.value > ceiling}
			<div class="day">
				<div class="bar-track">
					<div class="bar" class:over={overshoot} style="height: {(bar.value / maxBar) * 100}%"></div>
					{#if ceiling != null}
						<div class="ceiling" style="bottom: {(ceiling / maxBar) * 100}%" title="10% over forrige: {Math.round(ceiling)}"></div>
					{/if}
				</div>
				<span class="day-letter">{bar.label}</span>
			</div>
		{/each}
	</div>
	{#if isPeriodMode && ceilings}
		<p class="band-hint">
			Stiplet linje = +10% fra forrige periode (byggesone-tak).
			{#if anyOvershoot}<span class="over-flag">Du har gått over taket noen uker.</span>{/if}
		</p>
	{/if}

	{#if families.length > 0}
		<div class="families">
			<div class="stacked-bar" aria-label="Effort per aktivitet">
				{#each families as [family, value]}
					<div
						class="seg"
						style="width: {familyTotal > 0 ? (value / familyTotal) * 100 : 0}%; background: {familyColors[family]}"
						title="{familyLabels[family]}: {Math.round(value)}"
					></div>
				{/each}
			</div>
			<ul class="legend">
				{#each families as [family, value]}
					<li>
						<span class="dot" style="background: {familyColors[family]}"></span>
						<span class="label">{familyLabels[family]}</span>
						<span class="value">{Math.round(value)}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	<footer>
		<span>{workoutCount} {workoutCount === 1 ? 'økt' : 'økter'}</span>
		<span aria-hidden="true">·</span>
		<span>{hrCoveragePct}% fra puls</span>
		{#if baseline}
			<span aria-hidden="true">·</span>
			<span class="delta" class:up={baseline.delta > 0} class:down={baseline.delta < 0}>
				{baseline.delta > 0 ? '+' : ''}{Math.round(baseline.delta)} vs 4-uker
			</span>
		{/if}
	</footer>
</section>

<style>
	.effort-card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
	}

	.week {
		font-size: 0.8rem;
		color: #555;
	}

	.total-row {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.total {
		font-size: 2.6rem;
		font-weight: 700;
		color: #f3f3f3;
		line-height: 1;
	}

	.status {
		font-size: 1rem;
		font-weight: 600;
		color: #c084fc;
	}

	.hint {
		font-size: 0.85rem;
		color: #888;
		margin: 0;
		line-height: 1.4;
	}

	.spark {
		display: grid;
		grid-template-columns: repeat(var(--bar-count, 7), 1fr);
		gap: 0.4rem;
		height: 64px;
	}

	.spark.compact {
		gap: 0.15rem;
	}

	.spark.compact .day-letter {
		font-size: 0.55rem;
	}

	.day {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.3rem;
	}

	.bar-track {
		position: relative;
		flex: 1;
		display: flex;
		align-items: flex-end;
		justify-content: center;
		background: rgba(255, 255, 255, 0.02);
		border-radius: 4px;
		overflow: hidden;
	}

	.bar {
		width: 100%;
		background: linear-gradient(180deg, #a855f7 0%, #6b21a8 100%);
		border-radius: 4px 4px 0 0;
		min-height: 2px;
	}

	.bar.over {
		background: linear-gradient(180deg, #f97316 0%, #a855f7 50%, #6b21a8 100%);
	}

	.ceiling {
		position: absolute;
		left: 0;
		right: 0;
		height: 0;
		border-top: 1px dashed rgba(249, 115, 22, 0.7);
		pointer-events: none;
	}

	.band-hint {
		font-size: 0.72rem;
		color: #777;
		margin: 0;
		line-height: 1.4;
	}

	.band-hint .over-flag {
		color: #f97316;
		margin-left: 0.3rem;
	}

	.day-letter {
		font-size: 0.7rem;
		color: #555;
		text-align: center;
		letter-spacing: 0.05em;
	}

	.families {
		display: flex;
		flex-direction: column;
		gap: 0.65rem;
	}

	.stacked-bar {
		display: flex;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.04);
	}

	.seg {
		height: 100%;
	}

	.legend {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 0.35rem 0.85rem;
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		font-size: 0.8rem;
		color: #aaa;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.legend .label {
		flex: 1;
		color: #bbb;
	}

	.legend .value {
		color: #888;
		font-variant-numeric: tabular-nums;
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		font-size: 0.75rem;
		color: #666;
	}

	.delta.up {
		color: #4ade80;
	}

	.delta.down {
		color: #fb7185;
	}
</style>
