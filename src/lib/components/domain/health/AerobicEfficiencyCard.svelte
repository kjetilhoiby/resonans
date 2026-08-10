<script lang="ts">
	/**
	 * Efficiency Factor — fart per hjerteslag, bakkekorrigert.
	 *
	 * Svarer på «ligger puls/fart-kurven flatere nå enn før». VO2max gjør ikke
	 * det: VDOT antar maksimal innsats, og en uke uten hard løping gir et
	 * fantomfall. Se `$lib/domain/health/aerobic-efficiency.ts`.
	 */
	type Point = { date: string; ef: number };
	type Trend = {
		current: number | null;
		previous: number | null;
		changeShare: number | null;
		direction: 'bedre' | 'dårligere' | 'uendret' | 'ukjent';
		currentCount: number;
		previousCount: number;
		insufficient: boolean;
	};

	let { data }: { data: { points: Point[]; trend: Trend } | null } = $props();

	const trend = $derived(data?.trend ?? null);
	const points = $derived(data?.points ?? []);

	const changeText = $derived.by(() => {
		if (!trend || trend.changeShare == null) return null;
		const pct = Math.abs(trend.changeShare * 100);
		const sign = trend.changeShare > 0 ? '+' : '−';
		return `${sign}${pct.toFixed(1).replace('.', ',')} %`;
	});

	/**
	 * Minimal sparkline, inline. De to som finnes fra før (`WaistSparkline`,
	 * `RelationSparkline`) tar domenespesifikke props og lar seg ikke gjenbruke.
	 * Én bruker rettferdiggjør ikke en ny delt komponent — trenger et kort til
	 * det samme, ekstraheres den til `ui/`.
	 */
	const SPARK_W = 280;
	const SPARK_H = 40;
	const sparkPath = $derived.by(() => {
		if (points.length < 2) return '';
		const values = points.map((p) => p.ef);
		const min = Math.min(...values);
		const max = Math.max(...values);
		// Gulv på spennet, av samme grunn som MIN_WEIGHT_AXIS_SPAN_KG: en akse
		// strukket til målingene gjør 1 % variasjon om til et stup.
		const span = Math.max(max - min, 0.15);
		const mid = (max + min) / 2;
		const lo = mid - span / 2;
		return values
			.map((v, i) => {
				const x = (i / (values.length - 1)) * SPARK_W;
				const y = SPARK_H - ((v - lo) / span) * SPARK_H;
				return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${Math.max(0, Math.min(SPARK_H, y)).toFixed(1)}`;
			})
			.join(' ');
	});

	const headline = $derived.by(() => {
		if (!trend) return 'Ingen data';
		if (trend.direction === 'ukjent') return 'For få økter til å si noe';
		if (trend.direction === 'uendret') return 'Uendret siste to måneder';
		return trend.direction === 'bedre'
			? 'Flatere kurve enn for to måneder siden'
			: 'Brattere kurve enn for to måneder siden';
	});
</script>

<div class="ef-card">
	<div class="ef-head">
		<span class="ef-label">Fart per hjerteslag</span>
		{#if trend?.current != null}
			<span class="ef-value">{trend.current.toFixed(2).replace('.', ',')}</span>
		{/if}
	</div>

	<p class="ef-headline" class:good={trend?.direction === 'bedre'} class:warn={trend?.direction === 'dårligere'}>
		{headline}
		{#if changeText && trend?.direction !== 'ukjent'}
			<span class="ef-change">{changeText}</span>
		{/if}
	</p>

	{#if sparkPath}
		<svg
			class="ef-spark"
			viewBox="0 0 {SPARK_W} {SPARK_H}"
			preserveAspectRatio="none"
			role="img"
			aria-label="Utvikling i fart per hjerteslag over {points.length} økter"
		>
			<path d={sparkPath} fill="none" stroke="currentColor" stroke-width="1.5" vector-effect="non-scaling-stroke" />
		</svg>
	{/if}

	{#if trend && !trend.insufficient && trend.previous != null}
		<p class="ef-detail">
			Median {trend.current?.toFixed(2).replace('.', ',')} m/min per slag over
			{trend.currentCount} økter, mot {trend.previous.toFixed(2).replace('.', ',')} over
			{trend.previousCount} økter for åtte uker siden.
		</p>
	{:else if trend?.insufficient}
		<p class="ef-detail">
			Trenger minst fire jevne løpeøkter i hvert vindu. Nå: {trend.currentCount} mot
			{trend.previousCount}.
		</p>
	{/if}

	<!-- Varmeforbeholdet er ikke en fotnote man kan droppe: puls stiger 5–10 slag
	     i varmen, og «nå mot for to måneder siden» krysser i Norge nettopp fra
	     kjøligere til varmere. Uten dette leses sommeren som formtap. -->
	<p class="ef-caveat">
		Regnet på bakkekorrigert tempo, bare jevne løpeøkter over 20 min. Puls stiger 5–10 slag i
		varmen, så en sommermåned mot en vårmåned er ikke helt sammenlignbar.
	</p>
</div>

<style>
	.ef-card {
		background: var(--surface, #141414);
		border-radius: 14px;
		padding: 1rem 1.1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.ef-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.75rem;
	}
	.ef-label {
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted, #8b8b8b);
	}
	.ef-value {
		font-size: 1.9rem;
		font-weight: 600;
		color: var(--text, #f2f2f2);
	}
	.ef-headline {
		margin: 0;
		font-size: 0.95rem;
		color: var(--text, #f2f2f2);
	}
	.ef-headline.good {
		color: #34d399;
	}
	.ef-headline.warn {
		color: #fbbf24;
	}
	.ef-change {
		opacity: 0.85;
		margin-left: 0.4rem;
	}
	.ef-spark {
		width: 100%;
		height: 40px;
		color: #7c8ef5;
		display: block;
	}
	.ef-detail,
	.ef-caveat {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-muted, #8b8b8b);
		line-height: 1.4;
	}
	.ef-caveat {
		opacity: 0.75;
	}
</style>
