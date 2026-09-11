<script lang="ts">
	/**
	 * Én rad i sykdomsforløpet: etikett, setning og kurve.
	 *
	 * Komponenten tar `days` fra vinduet og indekserer punktene mot DEN, ikke mot
	 * sine egne. Det er hele grunnen til at rad-komponenten er dum: aksen skal
	 * være strukturelt lik på tvers av radene, ikke lik fordi to komponenter er
	 * enige. Avtalen brytes første gang noen endrer en padding.
	 */
	import {
		episodeAxis,
		formatEpisodeValue,
		type EpisodeDay,
		type EpisodeTrack
	} from '$lib/domain/health/sick-episode';

	interface Props {
		track: EpisodeTrack;
		days: EpisodeDay[];
		onsetIndex: number;
		endIndex: number;
	}

	let { track, days, onsetIndex, endIndex }: Props = $props();

	const W = 300;
	const H = 44;
	/** Største hull en linje trekkes over. En rett strek over ti dager påstår en
	 * utvikling ingen har målt — samme regel som `MAX_WEIGHT_GAP_DAYS`. */
	const MAX_GAP = 3;

	const axis = $derived(episodeAxis(track));

	const xAt = (i: number) => (days.length <= 1 ? W / 2 : (i / (days.length - 1)) * W);
	const yAt = (v: number) => {
		if (!axis) return H / 2;
		const t = (v - axis.min) / (axis.max - axis.min || 1);
		// Klipp mot domenet: en verdi utenfor rammen skal ligge på kanten, ikke
		// tegnes utenfor SVG-en (samme felle som `TrajectoryChart`).
		return H - Math.max(0, Math.min(1, t)) * H;
	};

	const dots = $derived(
		track.points
			.map((p, i) => ({ i, value: p.value }))
			.filter((p): p is { i: number; value: number } => p.value !== null)
	);

	/** Sammenhengende strekk, brutt over hull større enn MAX_GAP. */
	const segments = $derived.by(() => {
		const out: { i: number; value: number }[][] = [];
		let current: { i: number; value: number }[] = [];
		for (const dot of dots) {
			const prev = current[current.length - 1];
			if (prev && dot.i - prev.i > MAX_GAP) {
				if (current.length > 1) out.push(current);
				current = [];
			}
			current.push(dot);
		}
		if (current.length > 1) out.push(current);
		return out;
	});

	/**
	 * Normalområdet som en boks i kurvens koordinater.
	 *
	 * Null når raden ikke har et bånd, eller når båndet ligger helt utenfor
	 * aksen — da ville en rektangelkant i toppen lest som en måling.
	 */
	const normalBand = $derived.by(() => {
		if (!axis || !track.normal) return null;
		const top = yAt(track.normal.high);
		const bottom = yAt(track.normal.low);
		const height = bottom - top;
		if (height <= 0) return null;
		return { y: top, height };
	});

	const sickX = $derived(xAt(onsetIndex));
	const sickW = $derived(Math.max(1, xAt(endIndex) - xAt(onsetIndex)));

	// Domenelagets formatterer, ikke en egen: setningen under kurven kommer
	// derfra, og to formatterere ville skrevet samme tall på to måter.
	const fmt = (value: number) => formatEpisodeValue(value, track.decimals);

	/**
	 * Skal tallet markeres?
	 *
	 * Fortegnet på avviket må matche radens egen retning: sovepuls OPP og HRV NED
	 * er begge «verdt å se på», og en felles «stiger»-regel ville markert den ene
	 * riktig og den andre motsatt.
	 */
	const isNotable = $derived(
		track.delta !== null &&
			track.notableDirection !== null &&
			(track.notableDirection === 'up' ? track.delta > 0 : track.delta < 0)
	);

	/** Tallet som står ved siden av etiketten. */
	const headline = $derived.by(() => {
		if (track.absoluteIsMeaningless) {
			if (track.delta === null) return null;
			const sign = track.delta > 0 ? '+' : '−';
			return `${sign}${fmt(Math.abs(track.delta))} ${track.unit}`;
		}
		if (track.latest === null) return null;
		return `${fmt(track.latest)} ${track.unit}`;
	});
</script>

<div class="rad">
	<div class="topp">
		<span class="etikett">{track.label}</span>
		{#if headline}
			<span class="tall" class:notabel={isNotable}>
				{headline}
			</span>
		{/if}
	</div>

	{#if axis}
		<!--
			Y-spennet skrives PÅ kurven. Uten det er «−17 ms» et tall uten skala:
			en linje som dupper halve rammen sier ingenting om rammen er ti eller
			hundre enheter høy. Labelene er HTML, ikke SVG-tekst —
			`preserveAspectRatio="none"` strekker alt inni svg-en vannrett, og en
			strukket skrift ser ut som en feil.
		-->
		<div class="kurveboks">
			<span class="akse-topp">{fmt(axis.max)}</span>
			<span class="akse-bunn">{fmt(axis.min)}</span>
			<svg class="kurve" viewBox="0 0 {W} {H}" preserveAspectRatio="none" aria-hidden="true">
			<!-- Sykedagene skravert, så man ser hvor forløpet ligger i vinduet. -->
			<rect x={sickX} y="0" width={sickW} height={H} class="syk" />
			<!--
				Normalområdet som et bånd i bakgrunnen: «hvor langt fra det vanlige»
				blir da noe man SER, ikke noe man regner ut av to tall. Det tegnes
				først, under alt annet — det er bakgrunn, ikke en måling.
			-->
			{#if normalBand}
				<rect
					x="0"
					y={normalBand.y}
					width={W}
					height={normalBand.height}
					class="normalbaand"
				/>
			{/if}
			<!--
				To referanselinjer, og de er hele poenget med raden: avstanden mellom
				dem ER tallet setningen under oppgir. Baselinen går over HELE bredden
				(den er referansen dagene måles mot), forløpsmedianen bare over
				sykedagene — der den faktisk gjelder.

				Stiplet mot hel, ikke farge mot farge: en farge her ville lest som en
				dom, og `preserveAspectRatio="none"` strekker dashene vannrett, så
				to ulike stiplinger hadde vært umulige å skille.
			-->
			{#if track.baseline !== null}
				<line x1="0" x2={W} y1={yAt(track.baseline)} y2={yAt(track.baseline)} class="baseline" />
			{/if}
			{#if track.during !== null}
				<line
					x1={sickX}
					x2={sickX + sickW}
					y1={yAt(track.during)}
					y2={yAt(track.during)}
					class="under"
				/>
			{/if}
			{#each segments as segment, s (s)}
				<polyline
					class="linje"
					points={segment.map((d) => `${xAt(d.i)},${yAt(d.value)}`).join(' ')}
				/>
			{/each}
			{#each dots as dot (dot.i)}
				<circle cx={xAt(dot.i)} cy={yAt(dot.value)} r="2.5" class="punkt" />
			{/each}
			</svg>
		</div>
	{/if}

	{#if track.text}
		<p class="setning">{track.text}</p>
	{/if}

	{#if track.normalText}
		<p class="setning normal">{track.normalText}</p>
	{/if}

	{#if track.returnText}
		<!--
			«Er det på vei tilbake» er spørsmålet man sitter med underveis, så det
			står for seg og ikke i en hale på setningen over.
		-->
		<p class="setning retur" class:tilbake={track.normal?.recentInside === true}>
			{track.returnText}
		</p>
	{/if}

	<p class="fot">
		{#if track.source}<span>{track.source}</span>{/if}
		<span
			>{track.measuredSickDays} av {track.sickDays}
			{track.sickDays === 1 ? 'sykedag' : 'sykedager'} målt</span
		>
		{#if track.todayExcluded}
			<!-- Uten denne ser dagens fravær ut som en manglende måling. -->
			<span>i dag teller ikke før døgnet er omme</span>
		{/if}
	</p>
</div>

<style>
	.rad {
		padding: 12px 0;
		border-top: 1px solid var(--border-subtle);
	}

	.topp {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}

	.etikett {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
	}

	.tall {
		font-size: 14px;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}

	/*
	 * Dempet gult, ikke varselfarge. Raden sier at noe ligger over det vanlige —
	 * den sier ikke at det er galt. Akutt/kronisk er det eneste signalet som får
	 * varsle om kroppen.
	 */
	.tall.notabel {
		color: var(--warning-text);
	}

	.kurveboks {
		position: relative;
		margin: 8px 0 6px;
	}

	.kurve {
		display: block;
		width: 100%;
		height: 44px;
		overflow: visible;
	}

	/*
	 * Aksetallene ligger OVER kurven, ikke ved siden av: en egen kolonne ville
	 * kostet bredde på alle ti radene for to tall man leser én gang.
	 */
	.akse-topp,
	.akse-bunn {
		position: absolute;
		right: 0;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		pointer-events: none;
	}

	.akse-topp {
		top: -2px;
	}

	.akse-bunn {
		bottom: -2px;
	}

	.syk {
		fill: rgba(255, 255, 255, 0.045);
	}

	/*
	 * Kromafritt og svakt: båndet er konteksten linja leses i, ikke en av
	 * seriene. Fikk det en kulør, ville det konkurrert med kurven og lest som
	 * en dom om hva som er riktig sone å ligge i.
	 */
	.normalbaand {
		fill: rgba(160, 170, 190, 0.1);
	}

	.baseline {
		stroke: var(--text-muted);
		stroke-width: 1;
		stroke-dasharray: 3 3;
		vector-effect: non-scaling-stroke;
	}

	.under {
		stroke: var(--text-secondary);
		stroke-width: 1.5;
		vector-effect: non-scaling-stroke;
	}

	.linje {
		fill: none;
		stroke: var(--accent-muted);
		stroke-width: 1.5;
		stroke-linejoin: round;
		vector-effect: non-scaling-stroke;
	}

	.punkt {
		fill: var(--accent-light);
	}

	.setning {
		margin: 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--text-secondary);
	}

	.setning.normal {
		margin-top: 2px;
		color: var(--text-tertiary);
	}

	.setning.retur {
		margin-top: 2px;
		font-weight: 500;
	}

	/*
	 * Tilbake i det vanlige er den ene tilstanden brukeren leter etter, så den
	 * får en farge. Grønt, ikke som en klarering — se `describeReturnSummary`,
	 * som sier i klartekst at tallene ikke uttaler seg om belastning.
	 */
	.setning.retur.tilbake {
		color: var(--success-text);
	}

	.fot {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 10px;
		margin: 4px 0 0;
		font-size: 11px;
		color: var(--text-muted);
	}
</style>
