<!--
  TrailingVolumeSheet — widgetdetaljen bak «løpt siste 30 dager».

  Tre spørsmål, i den rekkefølgen de faktisk stilles:

  1. **Hvor mye har jeg løpt?** Den slepende kurven. I motsetning til den
     kumulative sesongkurven nullstilles den ikke 1. januar, så «er jeg i form
     nå» kan leses av hver dag i året.
  2. **Er jeg i rute?** Båndet (dine egne kvartiler for samme tid på året) og
     målet, hvis widgeten har ett. Aldri en pil uten en oppgitt referanse.
  3. **Er treningen riktig sammensatt?** Andel rolige, grå og harde ØKTER — ikke
     minutter. Se `session-character.ts` for hvorfor det skillet avgjør alt.

  Rampen står ved siden av nivået, men den er bevisst avdempet: den sier at
  volumet vokser fort, ikke at kroppen ikke tåler det. Restitusjonsdommen bor i
  formkurven (`effort-standing.ts`), og to modeller som begge sier «du overdriver»
  blir aldri enige.
-->
<script lang="ts">
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { CHARACTER_LABELS, type SessionCharacter } from '$lib/domain/health/session-character';

	interface Props {
		widgetId: string;
		title: string;
		onclose: () => void;
	}

	let { widgetId, title, onclose }: Props = $props();

	interface Point {
		date: string;
		value: number | null;
	}
	interface Band {
		lower: number;
		upper: number;
		median: number;
		samples: number;
	}
	interface VolumeView {
		windowDays: number;
		current: number | null;
		points: Point[];
		band: Band | null;
		ramp: { previous: number; pctChange: number; steep: boolean } | null;
		level: { standing: 'over' | 'inside' | 'under'; reference: 'goal' | 'band'; deltaKm: number; pctOfGoal?: number } | null;
		text: string;
	}
	interface Bucket {
		character: SessionCharacter;
		sessions: number;
		km: number;
		sessionShare: number;
		kmShare: number;
	}
	interface QualityView {
		composition: {
			windowDays: number;
			buckets: Bucket[];
			totalSessions: number;
			classifiedSessions: number;
			coverage: number;
		};
		text: string;
	}
	interface Payload {
		today: string;
		goalKm: number | null;
		zoneCoverage: { sessions: number; withZones: number; share: number };
		volume: Record<string, VolumeView>;
		quality: Record<string, QualityView>;
	}

	const WINDOWS = [7, 30, 90];
	let windowDays = $state(30);
	let data = $state<Payload | null>(null);
	let loading = $state(true);
	let errorText = $state<string | null>(null);
	/** Datoen brukeren har trykket på i grafen. Null = les av dagens verdi. */
	let readoutDate = $state<string | null>(null);

	$effect(() => {
		const id = widgetId;
		let alive = true;
		loading = true;
		errorText = null;
		(async () => {
			try {
				const res = await fetch(`/api/helse/trening/volum?widget=${encodeURIComponent(id)}`);
				if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
				const body = (await res.json()) as Payload;
				if (alive) data = body;
			} catch (err) {
				// Vis meldingen. En `catch {}` med en generisk tekst gjør en
				// prod-feil uløselig — det kostet en full kodegjennomgang i august.
				if (alive) errorText = err instanceof Error ? err.message : 'Kunne ikke hente volumet.';
			} finally {
				if (alive) loading = false;
			}
		})();
		return () => {
			alive = false;
		};
	});

	const view = $derived(data?.volume[String(windowDays)] ?? null);
	const quality = $derived(data?.quality[String(windowDays)] ?? null);

	/** Punktene som har en verdi. De uten er ufullstendige vinduer, ikke nuller. */
	const drawn = $derived((view?.points ?? []).filter((p): p is { date: string; value: number } => p.value !== null));

	const CHART_W = 480;
	const CHART_H = 140;

	/**
	 * Y-aksen. Gulvet er 0 fordi et akkumulert volum ikke kan være negativt, og
	 * uten gulvet dytter luften rundt dataene aksen under null — samme feil som
	 * `floorAt: 0` retter i sesongkurvene.
	 */
	const yMax = $derived.by(() => {
		const values = drawn.map((p) => p.value);
		if (view?.band) values.push(view.band.upper);
		if (data?.goalKm) values.push(data.goalKm);
		const top = values.length > 0 ? Math.max(...values) : 1;
		return top * 1.1 || 1;
	});

	function x(index: number, total: number): number {
		if (total <= 1) return 0;
		return (index / (total - 1)) * CHART_W;
	}
	function y(value: number): number {
		return CHART_H - (value / yMax) * CHART_H;
	}

	const linePath = $derived.by(() => {
		if (drawn.length === 0) return '';
		return drawn
			.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i, drawn.length).toFixed(1)},${y(p.value).toFixed(1)}`)
			.join(' ');
	});

	const readout = $derived.by(() => {
		if (!view) return null;
		if (readoutDate) {
			const hit = drawn.find((p) => p.date === readoutDate);
			if (hit) return hit;
		}
		if (view.current === null) return null;
		return { date: data?.today ?? '', value: view.current };
	});

	function pickNearest(event: MouseEvent | TouchEvent) {
		if (drawn.length === 0) return;
		const target = event.currentTarget as SVGSVGElement;
		const rect = target.getBoundingClientRect();
		const clientX = 'touches' in event ? event.touches[0]?.clientX : event.clientX;
		if (clientX == null) return;
		const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
		readoutDate = drawn[Math.round(ratio * (drawn.length - 1))].date;
	}

	function formatKm(km: number): string {
		const r = Math.round(km * 10) / 10;
		return r === Math.round(r) ? `${Math.round(r)}` : String(r).replace('.', ',');
	}

	function formatDate(date: string): string {
		const [, m, d] = date.split('-');
		return `${Number(d)}.${Number(m)}.`;
	}

	const CHARACTER_COLORS: Record<SessionCharacter, string> = {
		rolig: '#34d399',
		graa: '#fbbf24',
		hard: '#ef4444',
		ukjent: '#3a3a3a'
	};
</script>

<BottomSheet {onclose} ariaLabel={title}>
	<header class="tv-header">
		<h2>{title}</h2>
		<button class="tv-close" onclick={onclose} aria-label="Lukk">✕</button>
	</header>

	<div class="tv-body">
		{#if loading}
			<p class="tv-dim">Henter …</p>
		{:else if errorText}
			<p class="tv-error">{errorText}</p>
		{:else if !view}
			<p class="tv-dim">Ingen data.</p>
		{:else}
			<div class="tv-windows" role="group" aria-label="Vindu">
				{#each WINDOWS as days}
					<button
						class="tv-chip"
						class:active={windowDays === days}
						data-track="volumdetalj:vindu-{days}"
						onclick={() => { windowDays = days; readoutDate = null; }}
					>{days} dager</button>
				{/each}
			</div>

			<!-- 1. Hvor mye -->
			<div class="tv-lead">
				{#if readout}
					<span class="tv-value">{formatKm(readout.value)}</span>
					<span class="tv-unit">km</span>
					<span class="tv-when">
						{readoutDate && readoutDate !== data?.today
							? `${windowDays} dager fram til ${formatDate(readout.date)}`
							: `siste ${windowDays} dager`}
					</span>
				{:else}
					<span class="tv-dim">Ikke nok historikk for et helt vindu ennå.</span>
				{/if}
			</div>

			{#if drawn.length > 1}
				<svg
					class="tv-chart"
					viewBox="0 0 {CHART_W} {CHART_H}"
					preserveAspectRatio="none"
					role="img"
					aria-label="Akkumulert løping siste {windowDays} dager, over tid"
					onmousemove={pickNearest}
					ontouchstart={pickNearest}
					ontouchmove={pickNearest}
				>
					{#if view.band}
						<!-- Båndet: dine egne kvartiler for samme tid på året. Tegnes som
						     et vannrett felt fordi det gjelder DAGENS dato — en kurve ville
						     påstått at vi har regnet båndet for hvert punkt, og det har vi ikke. -->
						<rect
							x="0"
							y={y(view.band.upper)}
							width={CHART_W}
							height={Math.max(1, y(view.band.lower) - y(view.band.upper))}
							fill="rgba(124, 142, 245, 0.13)"
						/>
					{/if}
					{#if data?.goalKm}
						<line
							x1="0" x2={CHART_W}
							y1={y(data.goalKm)} y2={y(data.goalKm)}
							stroke="#4ade80" stroke-width="1.5" stroke-dasharray="5 4"
						/>
					{/if}
					<path d={linePath} fill="none" stroke="#7c8ef5" stroke-width="2" />
					{#if readout}
						{@const i = drawn.findIndex((p) => p.date === readout.date)}
						{#if i >= 0}
							<circle cx={x(i, drawn.length)} cy={y(readout.value)} r="3.5" fill="#eee" />
						{/if}
					{/if}
				</svg>
				<div class="tv-axis">
					<span>{formatDate(drawn[0].date)}</span>
					<span>{formatDate(drawn[drawn.length - 1].date)}</span>
				</div>
			{:else}
				<p class="tv-dim">For lite historikk til å tegne kurven.</p>
			{/if}

			<!-- 2. Er jeg i rute -->
			<p class="tv-text">{view.text}</p>

			{#if view.ramp && !view.ramp.steep && Math.abs(view.ramp.pctChange) > 0}
				<p class="tv-dim tv-small">
					{view.ramp.pctChange > 0 ? '+' : ''}{view.ramp.pctChange} % mot forrige {windowDays} dager.
				</p>
			{/if}

			<!-- 3. Sammensetning -->
			{#if quality}
				<section class="tv-section">
					<h3>Sammensetning</h3>
					{#if quality.composition.classifiedSessions > 0}
						<div class="tv-bar" role="img" aria-label="Fordeling av øktkarakter">
							{#each quality.composition.buckets as bucket}
								{#if bucket.sessionShare > 0}
									<div
										class="tv-seg"
										style:width="{bucket.sessionShare * 100}%"
										style:background={CHARACTER_COLORS[bucket.character]}
										title="{CHARACTER_LABELS[bucket.character]}: {bucket.sessions} økter, {formatKm(bucket.km)} km"
									></div>
								{/if}
							{/each}
						</div>
						<div class="tv-legend">
							{#each quality.composition.buckets as bucket}
								{#if bucket.sessions > 0}
									<span class="tv-legend-item">
										<span class="tv-dot" style:background={CHARACTER_COLORS[bucket.character]}></span>
										{CHARACTER_LABELS[bucket.character]}
										{Math.round(bucket.sessionShare * 100)} %
										<span class="tv-dim">({bucket.sessions} økter, {formatKm(bucket.km)} km)</span>
									</span>
								{/if}
							{/each}
						</div>
					{/if}
					<p class="tv-text">{quality.text}</p>
				</section>
			{/if}

			{#if data && data.zoneCoverage.sessions > 0 && data.zoneCoverage.share < 1}
				<p class="tv-dim tv-small">
					Sonefordeling krever pulskurve. {data.zoneCoverage.withZones} av
					{data.zoneCoverage.sessions} økter siste 90 dager har den.
				</p>
			{/if}

			<a class="tv-link" href="/trening">Se belastning og form →</a>
		{/if}
	</div>
</BottomSheet>

<style>
	.tv-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 20px 8px;
		border-bottom: 1px solid var(--border-subtle, #1e1e1e);
	}
	.tv-header h2 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--text-primary, #eee);
	}
	.tv-close {
		background: none;
		border: none;
		color: var(--text-tertiary, #777);
		font-size: 1rem;
		cursor: pointer;
		padding: 4px 8px;
	}
	.tv-body {
		padding: 14px 20px 24px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.tv-windows {
		display: flex;
		gap: 6px;
	}
	.tv-chip {
		border: none;
		border-radius: 999px;
		padding: 6px 13px;
		font-size: 0.82rem;
		background: rgba(255, 255, 255, 0.07);
		color: var(--text-secondary, #aaa);
		cursor: pointer;
	}
	.tv-chip.active {
		background: rgba(124, 142, 245, 0.2);
		color: var(--accent-light, #7c8ef5);
	}
	.tv-lead {
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex-wrap: wrap;
	}
	.tv-value {
		font-size: 2rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-primary, #eee);
	}
	.tv-unit {
		font-size: 0.95rem;
		color: var(--text-secondary, #aaa);
	}
	.tv-when {
		font-size: 0.8rem;
		color: var(--text-tertiary, #777);
		margin-left: auto;
	}
	.tv-chart {
		width: 100%;
		height: 140px;
		display: block;
		touch-action: pan-y;
	}
	.tv-axis {
		display: flex;
		justify-content: space-between;
		font-size: 0.7rem;
		color: var(--text-muted, #555);
	}
	.tv-text {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--text-secondary, #aaa);
	}
	.tv-dim {
		color: var(--text-tertiary, #777);
		margin: 0;
		font-size: 0.85rem;
	}
	.tv-small {
		font-size: 0.78rem;
	}
	.tv-error {
		color: var(--danger-text, #f87171);
		margin: 0;
		font-size: 0.88rem;
	}
	.tv-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 6px;
		border-top: 1px solid var(--border-subtle, #1e1e1e);
	}
	.tv-section h3 {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary, #eee);
	}
	.tv-bar {
		display: flex;
		height: 14px;
		border-radius: 999px;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.04);
	}
	.tv-seg {
		height: 100%;
	}
	.tv-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 0.78rem;
		color: var(--text-secondary, #aaa);
	}
	.tv-legend-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.tv-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
	}
	.tv-link {
		font-size: 0.85rem;
		color: var(--accent-light, #7c8ef5);
		text-decoration: none;
		padding-top: 4px;
	}
</style>
