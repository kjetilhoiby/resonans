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
	import WeeklyIntensityBars from './WeeklyIntensityBars.svelte';
	import type { IntensityTotals, WeekIntensity } from '$lib/domain/health/weekly-intensity';

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
		/** Målet, men BARE når det gjelder dette vinduet. Se endepunktet. */
		goalKm: number | null;
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
			missingZonesSessions: number;
			staleBaselineSessions: number;
			coverage: number;
		};
		text: string;
	}
	interface Payload {
		today: string;
		goalKm: number | null;
		zoneCoverage: {
			sessions: number;
			withZones: number;
			share: number;
			staleBaseline: number;
			baseline: { basis: string; restHr: number; maxHr: number } | null;
		};
		volume: Record<string, VolumeView>;
		quality: Record<string, QualityView>;
		/**
		 * Rolige minutter mot kvalitetsminutter per uke.
		 *
		 * Følger IKKE vindusvelgeren: bjelken er alltid tolv uker, og seksjonen
		 * sier det selv. Sammensetningen under er andeler av ØKTER i det valgte
		 * vinduet — to ulike spørsmål, og derfor to seksjoner.
		 */
		intensity: {
			weeks: WeekIntensity[];
			totals: IntensityTotals;
			text: string;
			coverage: { sessions: number; withSplit: number; share: number; staleBaseline: number };
		};
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
		if (view?.goalKm) values.push(view.goalKm);
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

	/**
	 * Punktet man peker på. `null` når man ikke skrubber.
	 *
	 * **Overskriften er ALLTID i dag.** Første utgave lot skrubbing overskrive det
	 * store tallet, og da sto «148,9 km» over en setning som sa «207,6 km siste 90
	 * dager» — to tall i samme kort uten noe som forklarte forskjellen. Setningen
	 * beskriver nå-tilstanden (bånd, rampe, nivå) og kan ikke følge en markør, så
	 * det er markøren som må være den lille.
	 */
	const scrubbed = $derived.by(() => {
		if (!readoutDate) return null;
		return drawn.find((p) => p.date === readoutDate) ?? null;
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

	/**
	 * Datoen som tekst. `withYear` når kurven kan strekke seg over årsskiftet —
	 * og det gjør den alltid her (to år).
	 *
	 * Uten årstallet sto «90 dager fram til 8.12.» på en graf merket «3.9.» til
	 * «2.9.», og 8. desember leses da som en dato i framtiden. Den var i fjor.
	 */
	function formatDate(date: string, withYear = false): string {
		const [y, m, d] = date.split('-');
		return withYear ? `${Number(d)}.${Number(m)}.${y.slice(2)}` : `${Number(d)}.${Number(m)}.`;
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
		<!-- Widgetens navn er KONTEKST; vinduet er det man leser. Sto det bare
		     «Løpedistanse siste 30 dager» mens 90 var valgt, motsa tittelen
		     innholdet. -->
		<div class="tv-heading">
			<h2>Løpt siste {windowDays} dager</h2>
			<p class="tv-subtitle">{title}</p>
		</div>
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
				{#if view.current !== null}
					<span class="tv-value">{formatKm(view.current)}</span>
					<span class="tv-unit">km</span>
					<span class="tv-when">siste {windowDays} dager</span>
				{:else}
					<span class="tv-dim">Ikke nok historikk for et helt vindu ennå.</span>
				{/if}
			</div>

			{#if drawn.length > 1}
				<!-- Y-akse. Uten den betyr høyden ingenting før man trykker, og et
				     kort man MÅ interagere med for å lese er ikke et kort man
				     skotter på. -->
				<div class="tv-plot">
					<div class="tv-yaxis" aria-hidden="true">
						<span>{formatKm(yMax)}</span>
						<span>{formatKm(yMax / 2)}</span>
						<span>0</span>
					</div>
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
					<!-- Hjelpelinjer på samme brøk som y-aksens tall. -->
					{#each [0.5] as at}
						<line
							x1="0" x2={CHART_W}
							y1={CHART_H * at} y2={CHART_H * at}
							stroke="#2a2a2a" stroke-width="1"
						/>
					{/each}
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
					{#if view.goalKm}
						<line
							x1="0" x2={CHART_W}
							y1={y(view.goalKm)} y2={y(view.goalKm)}
							stroke="#4ade80" stroke-width="1.5" stroke-dasharray="5 4"
						/>
					{/if}
					<path d={linePath} fill="none" stroke="#7c8ef5" stroke-width="2" />
					{#if scrubbed}
						{@const i = drawn.findIndex((p) => p.date === scrubbed.date)}
						{#if i >= 0}
							<line
								x1={x(i, drawn.length)} x2={x(i, drawn.length)}
								y1="0" y2={CHART_H}
								stroke="#555" stroke-width="1"
							/>
							<circle cx={x(i, drawn.length)} cy={y(scrubbed.value)} r="3.5" fill="#eee" />
						{/if}
					{/if}
				</svg>
				</div>
				<div class="tv-axis">
					<span>{formatDate(drawn[0].date, true)}</span>
					{#if scrubbed}
						<span class="tv-readout">
							{formatKm(scrubbed.value)} km · {windowDays} dager fram til
							{formatDate(scrubbed.date, true)}
						</span>
					{/if}
					<span>{formatDate(drawn[drawn.length - 1].date, true)}</span>
				</div>

				<!-- Forklaringen. Uten den er det skraverte feltet og den grønne
				     streken to former uten mening — og tallene i prosaen under er
				     ikke knyttet til noe man kan se. -->
				<div class="tv-key">
					{#if view.band}
						<span class="tv-key-item">
							<span class="tv-swatch tv-swatch-band"></span>
							Vanlig for deg her: {formatKm(view.band.lower)}–{formatKm(view.band.upper)} km
						</span>
					{/if}
					{#if view.goalKm}
						<span class="tv-key-item">
							<span class="tv-swatch tv-swatch-goal"></span>
							Mål: {formatKm(view.goalKm)} km
						</span>
					{/if}
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

			<!-- 3a. Nok rolig, nok hardt — og hvor bredt er feltet i midten -->
			{#if data}
				<WeeklyIntensityBars
					weeks={data.intensity.weeks}
					totals={data.intensity.totals}
					text={data.intensity.text}
					coverage={data.intensity.coverage}
				/>
			{/if}

			<!-- 3b. Sammensetning -->
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

			{#if data && data.zoneCoverage.staleBaseline > 0}
				<!-- Egen melding, ikke en dekningslinje: handlingen er en reanalyse,
				     ikke et pulsbelte. Uten skillet ser et beregningsproblem ut som
				     et sensorproblem. -->
				<p class="tv-warn tv-small">
					{data.zoneCoverage.staleBaseline} av {data.zoneCoverage.sessions} økter siste 90
					dager er analysert mot en annen makspuls enn dagens
					{#if data.zoneCoverage.baseline}
						(hvile {data.zoneCoverage.baseline.restHr}, maks
						{data.zoneCoverage.baseline.maxHr})
					{/if}
					og er ikke med i sammensetningen. En reanalyse tar dem inn.
				</p>
			{:else if data && data.zoneCoverage.sessions > 0 && data.zoneCoverage.share < 1}
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
	.tv-body,
	.tv-header {
		/* Tallet kan ikke markeres. De blå håndtakene over «148» i felttesten var
		   iOS-tekstmarkering utløst av skrubbingen — en graf man drar fingeren
		   over må ikke også være tekst man kan velge. */
		-webkit-user-select: none;
		user-select: none;
		-webkit-touch-callout: none;
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
	.tv-plot {
		display: flex;
		gap: 6px;
		align-items: stretch;
	}
	.tv-yaxis {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		font-size: 0.65rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted, #555);
		text-align: right;
		min-width: 26px;
	}
	.tv-chart {
		flex: 1;
		height: 140px;
		display: block;
		touch-action: pan-y;
	}
	.tv-key {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 14px;
		font-size: 0.72rem;
		color: var(--text-tertiary, #777);
	}
	.tv-key-item {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.tv-swatch {
		width: 14px;
		height: 8px;
		border-radius: 2px;
		flex: none;
	}
	.tv-swatch-band {
		background: rgba(124, 142, 245, 0.35);
	}
	.tv-swatch-goal {
		height: 0;
		border-top: 2px dashed #4ade80;
		border-radius: 0;
	}
	.tv-readout {
		color: var(--text-secondary, #aaa);
		font-variant-numeric: tabular-nums;
	}
	.tv-warn {
		color: var(--warning-text, #fbbf24);
		margin: 0;
	}
	.tv-heading h2 {
		margin: 0;
	}
	.tv-subtitle {
		margin: 2px 0 0;
		font-size: 0.75rem;
		color: var(--text-tertiary, #777);
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
