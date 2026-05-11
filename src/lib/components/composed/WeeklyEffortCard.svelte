<script lang="ts">
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

	interface Props {
		total: number;
		byFamily: Partial<Record<EffortFamily, number>>;
		byDay: number[];
		hrCoveragePct?: number;
		workoutCount?: number;
		baseline?: { p4wAvg: number; delta: number };
		weekLabel?: string;
	}

	let {
		total,
		byFamily,
		byDay,
		hrCoveragePct = 0,
		workoutCount = 0,
		baseline,
		weekLabel
	}: Props = $props();

	const dayLetters = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

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
		if (!baseline) return 'Ingen sammenligning ennå';
		const ratio = baseline.p4wAvg > 0 ? total / baseline.p4wAvg : 1;
		if (ratio >= 1.25) return 'Bygger opp';
		if (ratio >= 0.85) return 'Jevn fremgang';
		if (ratio >= 0.5) return 'Roligere uke';
		return 'Lett uke';
	});

	const statusHint = $derived.by(() => {
		if (!baseline) return 'Trenger et par uker med data for å vise trend.';
		const ratio = baseline.p4wAvg > 0 ? total / baseline.p4wAvg : 1;
		if (ratio >= 1.25) return 'Tydelig over 4-ukers snitt — pass på restitusjon.';
		if (ratio >= 0.85) return 'Godt nivå for å bygge eller opprettholde form.';
		if (ratio >= 0.5) return 'Under snittet — rom for én økt til om du har overskudd.';
		return 'Mye lavere enn vanlig — bevisst hvile eller har noe gått tapt?';
	});

	const maxDay = $derived(Math.max(1, ...byDay));

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
			<span class="title">Relativ effort</span>
			{#if weekLabel}<span class="week">{weekLabel}</span>{/if}
		</div>
		<div class="total-row">
			<span class="total">{Math.round(total)}</span>
			<span class="status">{statusLabel}</span>
		</div>
		<p class="hint">{statusHint}</p>
	</header>

	<div class="spark" aria-label="Effort per dag">
		{#each byDay as value, i}
			<div class="day">
				<div class="bar-track">
					<div class="bar" style="height: {(value / maxDay) * 100}%"></div>
				</div>
				<span class="day-letter">{dayLetters[i]}</span>
			</div>
		{/each}
	</div>

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
		background: #141414;
		border: 1px solid #242424;
		border-radius: 16px;
		padding: 1.25rem;
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

	.title {
		font-size: 0.85rem;
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
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
		grid-template-columns: repeat(7, 1fr);
		gap: 0.4rem;
		height: 64px;
	}

	.day {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.3rem;
	}

	.bar-track {
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
