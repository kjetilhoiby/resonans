<!--
	Moodboard for det nye designspråket «blekk på krem» (Marimekko-inspirert).
	Bevisst frittstående utforskings-artefakt: importerer IKKE app-komponenter,
	bruker IKKE AppPage. Alt er egen markup/SVG/inline-stil så vi kan iterere
	fritt på følelsen før vi rører den ekte appen. Holdes utenfor visuell regresjon.
-->
<script lang="ts">
	import { onMount } from 'svelte';

	const INK = '#1B1A17';
	const CREAM = '#F6F1E7';
	const ACCENT = '#EC5A2E';

	// Felles geometri — alle tre variantene (skarp / Rough.js / filter) bruker
	// nøyaktig samme tall, så sammenligningen er rettferdig.
	type Shape =
		| { kind: 'rect'; x: number; y: number; w: number; h: number }
		| { kind: 'poly'; pts: number[] };
	type Building = { shape: Shape; win: [number, number, number, number][] };

	const buildings: Building[] = [
		{ shape: { kind: 'rect', x: 24, y: 66, w: 40, h: 84 }, win: [[33, 80, 6, 8], [49, 80, 6, 8], [33, 98, 6, 8], [49, 98, 6, 8], [33, 116, 6, 8], [49, 116, 6, 8]] },
		{ shape: { kind: 'poly', pts: [76, 150, 76, 58, 104, 38, 132, 58, 132, 150] }, win: [[88, 72, 10, 12], [110, 72, 10, 12], [88, 96, 10, 12], [110, 96, 10, 12], [88, 120, 10, 12], [110, 120, 10, 12]] },
		{ shape: { kind: 'rect', x: 146, y: 84, w: 30, h: 66 }, win: [[154, 96, 14, 8], [154, 112, 14, 8], [154, 128, 14, 8]] },
		{ shape: { kind: 'rect', x: 188, y: 50, w: 34, h: 100 }, win: [[197, 64, 16, 9], [197, 84, 16, 9], [197, 104, 16, 9], [197, 124, 16, 9]] },
		{ shape: { kind: 'rect', x: 232, y: 100, w: 22, h: 50 }, win: [[238, 112, 10, 8], [238, 130, 10, 7]] }
	];

	// Prikk-rutenett for Räsymatto-motivet
	const dots: { cx: number; cy: number; r: number }[] = [];
	for (let row = 0; row < 4; row++) {
		for (let col = 0; col < 5; col++) {
			dots.push({ cx: 22 + col * 30 + (row % 2) * 15, cy: 22 + row * 28, r: 8 });
		}
	}

	const strokeD = 'M16 50 C 56 22, 88 64, 128 40 S 176 30, 188 42';

	// ── Mønster-geometri (deterministisk) — strå-hjul + prikk-ringer ──
	function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
		const a = ((deg - 90) * Math.PI) / 180;
		return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
	}
	// Sparkline: normaliser verdier til viewBox og lag en myk kurve. Returnerer
	// path-d, endepunkt (siste verdi) og y for en gitt målverdi (stiplet mållinje).
	function spark(values: number[], w: number, h: number, pad = 6, lo?: number, hi?: number) {
		const min = lo ?? Math.min(...values);
		const max = hi ?? Math.max(...values);
		const span = max - min || 1;
		const x = (i: number) => pad + (i / (values.length - 1)) * (w - 2 * pad);
		const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
		const pts = values.map((v, i) => [x(i), y(v)] as [number, number]);
		let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
		for (let i = 1; i < pts.length; i++) {
			const [px, py] = pts[i - 1];
			const [cx, cy] = pts[i];
			const mx = (px + cx) / 2;
			d += ` Q ${px.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${((py + cy) / 2).toFixed(1)}`;
			d += ` T ${cx.toFixed(1)} ${cy.toFixed(1)}`;
		}
		return { d, ex: pts[pts.length - 1][0], ey: pts[pts.length - 1][1], goalY: y };
	}
	// 30-dagers serier (ukentlige snitt-punkter) mot mål, per domene.
	const goalWidgets = [
		{ key: 'vekt', label: 'Vekt · 30 dager', now: '79,1', unit: 'kg', delta: '−1,1 kg · mål 78', color: 'var(--c-trening)', behind: false,
		  series: [80.4, 80.1, 79.8, 79.6, 79.3, 79.1], goal: 78, lo: 77.5, hi: 80.6 },
		{ key: 'lop', label: 'Løping · 30 dager', now: '71', unit: 'km', delta: '+9 km foran plan', color: 'var(--c-trening)', behind: false,
		  series: [12, 28, 39, 52, 61, 71], goal: 60, lo: 0, hi: 75 },
		{ key: 'sovn', label: 'Snittsøvn · 30 dager', now: '7,2', unit: 't', delta: '−0,3 t under mål', color: 'var(--c-sovn)', behind: true,
		  series: [7.6, 7.4, 7.3, 7.1, 7.0, 7.2], goal: 7.5, lo: 6.6, hi: 7.8 }
	];
	// Forhåndsberegnet søvn-sparkline til prikk-radens utvidede kort.
	const sovnSpark = spark(goalWidgets[2].series, 190, 52, 8, goalWidgets[2].lo, goalWidgets[2].hi);
	// Radialt strå-hjul (som strå-fatet) — konsentriske bånd av radiale streker
	const strawRays: { x1: number; y1: number; x2: number; y2: number }[] = [];
	for (let i = 0; i < 60; i++) {
		const deg = (360 / 60) * i;
		for (const band of [[20, 33], [39, 55], [61, 75]]) {
			const [x1, y1] = polar(80, 80, band[0], deg);
			const [x2, y2] = polar(80, 80, band[1], deg);
			strawRays.push({ x1, y1, x2, y2 });
		}
	}
	// Prikk-ring i hjul-senteret (Räsymatto-aktig)
	const wheelCenter = Array.from({ length: 10 }, (_, i) => {
		const [x, y] = polar(80, 80, 12, (360 / 10) * i);
		return { x, y };
	});
	// Sjekkliste-fremdrift: 8 prikker, 5 fylt, 1 aksent (neste), 2 åpne
	const progressDots = Array.from({ length: 8 }, (_, i) => {
		const [x, y] = polar(60, 60, 40, (360 / 8) * i);
		return { x, y, state: i < 5 ? 'done' : i === 5 ? 'next' : 'todo' };
	});

	function polyPoints(pts: number[]): string {
		const out: string[] = [];
		for (let i = 0; i < pts.length; i += 2) out.push(`${pts[i]},${pts[i + 1]}`);
		return out.join(' ');
	}
	function pairs(pts: number[]): [number, number][] {
		const out: [number, number][] = [];
		for (let i = 0; i < pts.length; i += 2) out.push([pts[i], pts[i + 1]]);
		return out;
	}

	// Rough.js-genererte path-er (klient-side, deterministisk via seed)
	type RPath = { d: string; stroke: string; strokeWidth: number; fill?: string };
	let roughCity = $state<RPath[]>([]);
	let roughSun = $state<RPath[]>([]);
	let roughDots = $state<RPath[]>([]);
	let roughStroke = $state<RPath[]>([]);

	onMount(async () => {
		const rough: any = (await import('roughjs')).default;
		const gen = rough.generator();
		let seed = 1;
		const inkFill = () => ({ fill: INK, fillStyle: 'solid', stroke: INK, strokeWidth: 1.4, roughness: 1.8, bowing: 1.4, seed: seed++ });
		const creamFill = () => ({ fill: CREAM, fillStyle: 'solid', stroke: CREAM, strokeWidth: 0.6, roughness: 1.4, seed: seed++ });

		const city: RPath[] = [];
		for (const b of buildings) {
			const drawable = b.shape.kind === 'rect'
				? gen.rectangle(b.shape.x, b.shape.y, b.shape.w, b.shape.h, inkFill())
				: gen.polygon(pairs(b.shape.pts), inkFill());
			city.push(...gen.toPaths(drawable));
			for (const w of b.win) city.push(...gen.toPaths(gen.rectangle(w[0], w[1], w[2], w[3], creamFill())));
		}
		roughCity = city;

		roughSun = gen.toPaths(gen.circle(60, 60, 80, { fill: ACCENT, fillStyle: 'solid', stroke: ACCENT, strokeWidth: 1.4, roughness: 1.5, seed: 42 }));

		const dotsP: RPath[] = [];
		for (const dt of dots) dotsP.push(...gen.toPaths(gen.circle(dt.cx, dt.cy, dt.r * 2, { fill: INK, fillStyle: 'solid', stroke: INK, strokeWidth: 0.8, roughness: 1.6, seed: seed++ })));
		roughDots = dotsP;

		roughStroke = gen.toPaths(gen.path(strokeD, { stroke: INK, strokeWidth: 6, roughness: 2, bowing: 2.4, seed: 5, fill: 'none' }));
	});

	// ── Strenger & resonans (animert egenfrekvens) ──
	// Hver streng er festet i begge ender og svinger som en stående bølge på
	// SIN egen frekvens/egenmodus — bokstavelig egenfrekvens (jf. appnavnet).
	const STRINGS = [
		{ x: 36, mode: 2, amp: 7, freq: 1.3, phase: 0.0, accent: false },
		{ x: 78, mode: 3, amp: 6, freq: 1.7, phase: 1.1, accent: false },
		{ x: 120, mode: 2, amp: 9, freq: 1.1, phase: 2.2, accent: true },
		{ x: 162, mode: 4, amp: 5, freq: 2.1, phase: 0.5, accent: false },
		{ x: 204, mode: 3, amp: 6, freq: 1.5, phase: 1.7, accent: false }
	];
	const WAVE_TOP = 12;
	const WAVE_SPAN = 136;
	const WAVE_SEG = 56;
	let waveT = $state(0);
	let reduceMotion = $state(false);
	function stringPath(baseX: number, mode: number, amp: number, freq: number, phase: number, t: number): string {
		let d = '';
		for (let i = 0; i <= WAVE_SEG; i++) {
			const y = WAVE_TOP + (WAVE_SPAN / WAVE_SEG) * i;
			const env = Math.sin((mode * Math.PI * (y - WAVE_TOP)) / WAVE_SPAN);
			const x = baseX + amp * env * Math.sin((2 * Math.PI * freq * t) / 1000 + phase);
			d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' ';
		}
		return d;
	}
	const stringPaths = $derived(
		STRINGS.map((s) => ({ d: stringPath(s.x, s.mode, s.amp, s.freq, s.phase, waveT), accent: s.accent }))
	);

	// Vibrasjon: høy frekvens + bittelite utslag → strengen sveiper for fort til å
	// oppfattes som en kurve; vi tegner svøpet (amplitude-spindelen) + en dirrende linje inni.
	const VIBES = [
		{ x: 60, mode: 6, amp: 4, freq: 7.5, phase: 0.0, accent: false },
		{ x: 120, mode: 5, amp: 5, freq: 6.0, phase: 1.0, accent: true },
		{ x: 180, mode: 7, amp: 3.5, freq: 9.0, phase: 0.4, accent: false }
	];
	function envelopePath(baseX: number, mode: number, amp: number): string {
		let d = '';
		for (let i = 0; i <= WAVE_SEG; i++) {
			const y = WAVE_TOP + (WAVE_SPAN / WAVE_SEG) * i;
			const e = amp * Math.abs(Math.sin((mode * Math.PI * (y - WAVE_TOP)) / WAVE_SPAN));
			d += (i === 0 ? 'M' : 'L') + (baseX + e).toFixed(2) + ' ' + y.toFixed(2) + ' ';
		}
		for (let i = WAVE_SEG; i >= 0; i--) {
			const y = WAVE_TOP + (WAVE_SPAN / WAVE_SEG) * i;
			const e = amp * Math.abs(Math.sin((mode * Math.PI * (y - WAVE_TOP)) / WAVE_SPAN));
			d += 'L' + (baseX - e).toFixed(2) + ' ' + y.toFixed(2) + ' ';
		}
		return d + 'Z';
	}
	const vibeEnvelopes = VIBES.map((v) => envelopePath(v.x, v.mode, v.amp));
	const vibePaths = $derived(VIBES.map((v) => stringPath(v.x, v.mode, v.amp, v.freq, v.phase, waveT)));

	onMount(() => {
		reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
		if (reduceMotion) {
			waveT = 520; // frosset i en svingende fase
			return;
		}
		let raf = 0;
		const loop = (ts: number) => {
			waveT = ts;
			raf = requestAnimationFrame(loop);
		};
		raf = requestAnimationFrame(loop);
		return () => cancelAnimationFrame(raf);
	});
</script>

<svelte:head>
	<title>Moodboard · Blekk på krem</title>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Petrona:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<div class="mb">
	<!-- ═══ HERO ═══ -->
	<header class="hero">
		<svg class="hero-art" viewBox="0 0 520 220" role="img" aria-label="Byhus-silhuett med sol">
			<!-- Sol -->
			<circle cx="78" cy="56" r="30" fill="var(--accent)" />
			<!-- Byrekke -->
			<g fill="var(--ink)">
				<!-- A: smalt tårn, prikk-vinduer -->
				<rect x="40" y="120" width="46" height="92" />
				<g fill="var(--cream)">
					<circle cx="52" cy="138" r="3.2" /><circle cx="64" cy="138" r="3.2" /><circle cx="76" cy="138" r="3.2" />
					<circle cx="52" cy="156" r="3.2" /><circle cx="64" cy="156" r="3.2" /><circle cx="76" cy="156" r="3.2" />
					<circle cx="52" cy="174" r="3.2" /><circle cx="64" cy="174" r="3.2" /><circle cx="76" cy="174" r="3.2" />
				</g>
				<!-- B: bredt med saltak, rute-vinduer -->
				<path d="M96 212 V96 L132 70 L168 96 V212 Z" />
				<g fill="var(--cream)">
					<rect x="106" y="108" width="12" height="16" /><rect x="126" y="108" width="12" height="16" /><rect x="146" y="108" width="12" height="16" />
					<rect x="106" y="136" width="12" height="16" /><rect x="126" y="136" width="12" height="16" /><rect x="146" y="136" width="12" height="16" />
					<rect x="106" y="164" width="12" height="16" /><rect x="126" y="164" width="12" height="16" /><rect x="146" y="164" width="12" height="16" />
				</g>
				<!-- C: kontur-hus med horisontale striper -->
				<rect x="180" y="132" width="58" height="80" fill="none" stroke="var(--ink)" stroke-width="3.5" />
				<g stroke="var(--ink)" stroke-width="3">
					<line x1="180" y1="150" x2="238" y2="150" /><line x1="180" y1="168" x2="238" y2="168" />
					<line x1="180" y1="186" x2="238" y2="186" />
				</g>
				<!-- D: høyt slankt -->
				<rect x="250" y="78" width="40" height="134" />
				<g fill="var(--cream)">
					<rect x="260" y="92" width="20" height="10" /><rect x="260" y="112" width="20" height="10" />
					<rect x="260" y="132" width="20" height="10" /><rect x="260" y="152" width="20" height="10" />
					<rect x="260" y="172" width="20" height="10" />
				</g>
				<!-- E: bredt lavt, store ruter -->
				<rect x="302" y="150" width="74" height="62" />
				<g fill="var(--cream)">
					<rect x="312" y="162" width="22" height="22" /><rect x="344" y="162" width="22" height="22" />
				</g>
				<!-- F: trekant-topp, prikker -->
				<path d="M388 212 V128 L414 104 L440 128 V212 Z" />
				<g fill="var(--cream)">
					<circle cx="404" cy="146" r="3.6" /><circle cx="424" cy="146" r="3.6" />
					<circle cx="404" cy="168" r="3.6" /><circle cx="424" cy="168" r="3.6" />
					<circle cx="414" cy="190" r="3.6" />
				</g>
				<!-- G: smal pidestall -->
				<rect x="452" y="158" width="30" height="54" />
				<g fill="var(--cream)"><rect x="460" y="170" width="14" height="12" /><rect x="460" y="190" width="14" height="10" /></g>
			</g>
			<!-- bakkelinje (løs blekkstrek) -->
			<path d="M28 213 Q 260 208 496 213" fill="none" stroke="var(--ink)" stroke-width="3" stroke-linecap="round" />
		</svg>

		<p class="eyebrow">Designspråk · utforsking</p>
		<h1 class="display">Blekk på krem</h1>
		<p class="lead">
			Et roligere, mer organisk uttrykk for Resonans — inspirert av Marimekko-keramikk.
			Varm papirbakgrunn, håndtegnede blekk-illustrasjoner, og <em>én</em> bold solfarge
			brukt sparsomt for å lede blikket og sette stemning.
		</p>
	</header>

	<!-- brush-skille -->
	<svg class="brush" viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true">
		<path d="M6 14 C 120 4, 200 20, 320 11 S 520 6, 594 13 C 520 18, 360 22, 230 18 S 70 22, 6 14 Z" fill="var(--ink)" />
	</svg>

	<!-- ═══ FORM-EKSPERIMENT: skarp vs. håndtegnet ═══ -->
	{#snippet sharpCity()}
		{#each buildings as b}
			{#if b.shape.kind === 'rect'}
				<rect x={b.shape.x} y={b.shape.y} width={b.shape.w} height={b.shape.h} fill={INK} />
			{:else}
				<polygon points={polyPoints(b.shape.pts)} fill={INK} />
			{/if}
			{#each b.win as w}
				<rect x={w[0]} y={w[1]} width={w[2]} height={w[3]} fill={CREAM} />
			{/each}
		{/each}
	{/snippet}
	{#snippet sharpSun()}
		<circle cx="60" cy="60" r="40" fill={ACCENT} />
	{/snippet}
	{#snippet sharpDots()}
		{#each dots as d}
			<ellipse cx={d.cx} cy={d.cy} rx={d.r} ry={d.r} fill={INK} />
		{/each}
	{/snippet}
	{#snippet sharpStroke()}
		<path d={strokeD} fill="none" stroke={INK} stroke-width="8" stroke-linecap="round" />
	{/snippet}
	{#snippet roughOut(list: { d: string; stroke: string; strokeWidth: number; fill?: string }[])}
		{#each list as p}
			<path d={p.d} fill={p.fill ?? 'none'} stroke={p.stroke ?? 'none'} stroke-width={p.strokeWidth} stroke-linecap="round" stroke-linejoin="round" />
		{/each}
	{/snippet}
	{#snippet disp(id: string, bleed: number = 0.2, scale: number = 3.4)}
		<!-- color-interpolation-filters=sRGB gir renere kantblending; en mild
		     feGaussianBlur til slutt mykner displacement-aliasingen og leser som blekk-bleed. -->
		<filter id={id} x="-16%" y="-16%" width="132%" height="132%" color-interpolation-filters="sRGB">
			<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="2" seed="7" result="n" />
			<feDisplacementMap in="SourceGraphic" in2="n" {scale} xChannelSelector="R" yChannelSelector="G" result="d" />
			<feGaussianBlur in="d" stdDeviation={bleed} />
		</filter>
	{/snippet}

	<!-- Små domene-glyfer (currentColor → settes via CSS). Brukt i prikk-rader. -->
	{#snippet glyph(kind: string)}
		{#if kind === 'sun'}
			<circle cx="12" cy="12" r="4.2" />
			{#each Array(8) as _, i}<line x1={polar(12, 12, 6.6, (360 / 8) * i)[0]} y1={polar(12, 12, 6.6, (360 / 8) * i)[1]} x2={polar(12, 12, 9.6, (360 / 8) * i)[0]} y2={polar(12, 12, 9.6, (360 / 8) * i)[1]} />{/each}
		{:else if kind === 'moon'}
			<path d="M20 15 A8 8 0 1 1 10 5 A6.2 6.2 0 0 0 20 15 Z" />
		{:else if kind === 'book'}
			<path d="M12 7 v11 M12 7 C 9.5 5.5 6 5.5 4.5 6.4 V16 C 6 15.2 9.5 15.2 12 16.8 M12 7 C 14.5 5.5 18 5.5 19.5 6.4 V16 C 18 15.2 14.5 15.2 12 16.8" />
		{:else if kind === 'coin'}
			<path d="M9.5 8.5 v7 M9.5 12 l4 -3.2 M9.5 12 l4 3.2" />
		{:else if kind === 'heart'}
			<path d="M12 18.5 C 4.5 13 6 6.5 12 9.2 C 18 6.5 19.5 13 12 18.5 Z" />
		{/if}
	{/snippet}

	<section class="block">
		<p class="kicker">Form · eksperiment</p>
		<h2 class="h2">Skarp vs. håndtegnet</h2>
		<p class="desc">
			Samme geometri, tre teknikker side om side. <b>Rough.js</b> er motoren bak Excalidraw — den gir
			ujevn strek og litt levende fyll. <b>feTurbulence</b> er et rent SVG-filter (null avhengigheter) som
			forskyver kantene på formene vi allerede har. Begge mykner det harde, geometriske uttrykket.
		</p>

		<div class="cmp">
			<span class="cmp-subject">Byhus</span>
			<div class="cmp-cells">
				<div class="cmp-cell"><svg viewBox="0 0 264 160">{@render sharpCity()}</svg><span class="cmp-tag">Skarp</span></div>
				<div class="cmp-cell"><svg viewBox="0 0 264 160">{@render roughOut(roughCity)}</svg><span class="cmp-tag">Rough.js</span></div>
				<div class="cmp-cell"><svg viewBox="0 0 264 160"><defs>{@render disp('d-city')}</defs><g filter="url(#d-city)">{@render sharpCity()}</g></svg><span class="cmp-tag">feTurbulence</span></div>
			</div>
		</div>

		<div class="cmp">
			<span class="cmp-subject">Solen</span>
			<div class="cmp-cells">
				<div class="cmp-cell"><svg viewBox="0 0 120 120">{@render sharpSun()}</svg><span class="cmp-tag">Skarp</span></div>
				<div class="cmp-cell"><svg viewBox="0 0 120 120">{@render roughOut(roughSun)}</svg><span class="cmp-tag">Rough.js</span></div>
				<div class="cmp-cell"><svg viewBox="0 0 120 120"><defs>{@render disp('d-sun')}</defs><g filter="url(#d-sun)">{@render sharpSun()}</g></svg><span class="cmp-tag">feTurbulence</span></div>
			</div>
		</div>

		<div class="cmp">
			<span class="cmp-subject">Prikk-mønster</span>
			<div class="cmp-cells">
				<div class="cmp-cell"><svg viewBox="0 0 160 120">{@render sharpDots()}</svg><span class="cmp-tag">Skarp</span></div>
				<div class="cmp-cell"><svg viewBox="0 0 160 120">{@render roughOut(roughDots)}</svg><span class="cmp-tag">Rough.js</span></div>
				<div class="cmp-cell"><svg viewBox="0 0 160 120"><defs>{@render disp('d-dots')}</defs><g filter="url(#d-dots)">{@render sharpDots()}</g></svg><span class="cmp-tag">feTurbulence</span></div>
			</div>
		</div>

		<div class="cmp">
			<span class="cmp-subject">Strek</span>
			<div class="cmp-cells">
				<div class="cmp-cell"><svg viewBox="0 0 200 80">{@render sharpStroke()}</svg><span class="cmp-tag">Skarp</span></div>
				<div class="cmp-cell"><svg viewBox="0 0 200 80">{@render roughOut(roughStroke)}</svg><span class="cmp-tag">Rough.js</span></div>
				<div class="cmp-cell"><svg viewBox="0 0 200 80"><defs>{@render disp('d-stroke')}</defs><g filter="url(#d-stroke)">{@render sharpStroke()}</g></svg><span class="cmp-tag">feTurbulence</span></div>
			</div>
		</div>
	</section>

	<!-- brush-skille -->
	<svg class="brush" viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true">
		<path d="M6 14 C 120 4, 200 20, 320 11 S 520 6, 594 13 C 520 18, 360 22, 230 18 S 70 22, 6 14 Z" fill="var(--ink)" />
	</svg>

	<!-- ═══ PALETT ═══ -->
	<section class="block">
		<p class="kicker">01 — Palett</p>
		<h2 class="h2">Blekk, krem og én sol</h2>
		<p class="desc">Nær-svart blekk på varm papirhvit. Aksenten er den eneste mettede fargen — den dukker opp der blikket skal lande.</p>
		<div class="swatches">
			<div class="swatch"><span class="chip" style="background:#F6F1E7"></span><b>Krem</b><code>#F6F1E7</code><small>bakgrunn / papir</small></div>
			<div class="swatch"><span class="chip" style="background:#FBF8F1;box-shadow:inset 0 0 0 1px #E3DCCD"></span><b>Papir lys</b><code>#FBF8F1</code><small>kort / flate-lag</small></div>
			<div class="swatch"><span class="chip" style="background:#1B1A17"></span><b>Blekk</b><code>#1B1A17</code><small>tekst / strek</small></div>
			<div class="swatch"><span class="chip" style="background:#4A453C"></span><b>Blekk mykt</b><code>#4A453C</code><small>sekundærtekst</small></div>
			<div class="swatch"><span class="chip" style="background:#8A8475"></span><b>Dempet</b><code>#8A8475</code><small>meta / hint</small></div>
			<div class="swatch"><span class="chip" style="background:#EC5A2E"></span><b>Sol</b><code>#EC5A2E</code><small>signaturaksent</small></div>
		</div>

		<h3 class="subsection" style="margin-top: 28px;">Domenefarger</h3>
		<p class="desc">
			Én ekstra frihet: en liten palett av varme glasur-toner som <em>kun</em> identifiserer domene —
			på prikker, sirkler og datalinjer. Tekst, struktur, emfase og CTA-er forblir blekk + sol. Farge er identitet, ikke dekor.
		</p>
		<div class="swatches">
			<div class="swatch"><span class="chip" style="background:#EC5A2E"></span><b>Trening</b><code>#EC5A2E</code><small>bevegelse / helse</small></div>
			<div class="swatch"><span class="chip" style="background:#5E7C8B"></span><b>Søvn</b><code>#5E7C8B</code><small>støvblå</small></div>
			<div class="swatch"><span class="chip" style="background:#7E8A5A"></span><b>Bøker</b><code>#7E8A5A</code><small>salvie</small></div>
			<div class="swatch"><span class="chip" style="background:#C99A3C"></span><b>Økonomi</b><code>#C99A3C</code><small>sennep</small></div>
			<div class="swatch"><span class="chip" style="background:#9B5C6B"></span><b>Familie</b><code>#9B5C6B</code><small>plomme</small></div>
		</div>
	</section>

	<!-- ═══ TYPOGRAFI ═══ -->
	<section class="block">
		<p class="kicker">02 — Typografi</p>
		<h2 class="h2">Varm overskrift, rolig brødtekst</h2>
		<p class="desc"><b>Petrona</b> (varm display-serif med rolige f/j) til titler og store tall; <b>Hanken Grotesk</b> til brødtekst og UI.</p>

		<div class="type-card">
			<span class="type-tag">Display · Petrona</span>
			<p class="spec-display">God morgen, Kjetil</p>
			<p class="spec-h2">Hva har du fått til denne uka?</p>
			<div class="spec-figures">
				<span class="figure">7,8<small>t søvn</small></span>
				<span class="figure">+12<small>km foran plan</small></span>
				<span class="figure accent">3<small>av 4 gjort</small></span>
			</div>
			<span class="type-tag">Brødtekst · Hanken Grotesk</span>
			<p class="spec-body">
				Du sov godt i natt og ligger foran løpeplanen. To ting står igjen før helga — begge kan vente
				til i morgen om du vil. Resten av lista er rolig.
			</p>
			<p class="spec-meta">Onsdag 14. juni · oppdatert 08:12</p>
		</div>
	</section>

	<!-- ═══ MOTIV-GALLERI ═══ -->
	<section class="block">
		<p class="kicker">03 — Blekk-motiver</p>
		<h2 class="h2">Håndtegnede, gjenbrukbare</h2>
		<p class="desc">Fire byggeklosser. Tegnet i blekk så de arver tekstfargen; solfargen legges på der det trengs.</p>

		<div class="motif-grid">
			<figure class="motif">
				<svg viewBox="0 0 200 140" role="img" aria-label="Byhus">
					<g fill="var(--ink)">
						<rect x="24" y="64" width="34" height="64" />
						<path d="M64 128 V58 L86 40 L108 58 V128 Z" />
						<rect x="120" y="78" width="26" height="50" />
						<rect x="152" y="52" width="28" height="76" />
					</g>
					<g fill="var(--cream)">
						<circle cx="34" cy="78" r="2.6" /><circle cx="48" cy="78" r="2.6" />
						<circle cx="34" cy="94" r="2.6" /><circle cx="48" cy="94" r="2.6" />
						<rect x="72" y="70" width="9" height="12" /><rect x="91" y="70" width="9" height="12" />
						<rect x="72" y="90" width="9" height="12" /><rect x="91" y="90" width="9" height="12" />
						<rect x="160" y="64" width="12" height="9" /><rect x="160" y="82" width="12" height="9" /><rect x="160" y="100" width="12" height="9" />
					</g>
				</svg>
				<figcaption>Byhus-silhuett</figcaption>
			</figure>

			<figure class="motif">
				<svg viewBox="0 0 200 140" role="img" aria-label="Sol">
					<circle cx="100" cy="70" r="42" fill="var(--accent)" />
				</svg>
				<figcaption>Solen — aksent</figcaption>
			</figure>

			<figure class="motif">
				<svg viewBox="0 0 200 140" role="img" aria-label="Prikk-mønster">
					<defs>
						<pattern id="rasy" width="22" height="20" patternUnits="userSpaceOnUse">
							<ellipse cx="6" cy="6" rx="6" ry="7" fill="var(--ink)" />
							<ellipse cx="16" cy="15" rx="5.6" ry="6.6" fill="var(--ink)" transform="rotate(8 16 15)" />
						</pattern>
					</defs>
					<rect x="14" y="10" width="172" height="120" fill="url(#rasy)" />
				</svg>
				<figcaption>Räsymatto-prikker</figcaption>
			</figure>

			<figure class="motif">
				<svg viewBox="0 0 200 140" role="img" aria-label="Organisk strek">
					<path d="M24 86 C 64 58, 96 104, 140 74 S 184 58, 184 58" fill="none" stroke="var(--ink)" stroke-width="9" stroke-linecap="round" />
					<circle cx="170" cy="44" r="9" fill="var(--accent)" />
				</svg>
				<figcaption>Organisk strek</figcaption>
			</figure>
		</div>
	</section>

	<!-- ═══ MØNSTER-BOARD ═══ -->
	<section class="block">
		<p class="kicker">Mønster · system</p>
		<h2 class="h2">Fire familier, fire datatyper</h2>
		<p class="desc">
			Hvert mønster er <b>feTurbulence-myknet</b> (organisk kant) og tilebart, og er koblet til
			flaten/datatypen det hører til — mønsteret <em>er</em> data, ikke bare pynt. Global solaksent,
			brukt sparsomt.
		</p>

		<div class="pat-grid">
			<!-- 1. STRÅ & LINJER → tid -->
			<article class="pat">
				<div class="pat-swatch">
					<svg class="pat-band-svg" viewBox="0 0 320 56" preserveAspectRatio="none">
						<defs>
							<pattern id="t-straw" width="16" height="56" patternUnits="userSpaceOnUse">
								<path d="M4 4 V52" stroke="var(--ink)" stroke-width="1" fill="none" />
								<path d="M9 9 V48" stroke="var(--ink)" stroke-width="1" fill="none" />
								<path d="M13 2 V46" stroke="var(--ink)" stroke-width="1" fill="none" />
							</pattern>
							{@render disp('f-straw', 0, 2.6)}
						</defs>
						<rect width="320" height="56" fill="url(#t-straw)" filter="url(#f-straw)" />
					</svg>
				</div>
				<div class="pat-body">
					<h3>Strå & linjer</h3>
					<p class="pat-role">Tid · trender, hjul</p>
					<div class="pat-demo">
						<svg viewBox="0 0 160 160" role="img" aria-label="Måneds-hjul">
							<defs>{@render disp('f-wheel', 0, 2.6)}</defs>
							<g filter="url(#f-wheel)">
								<g stroke="var(--ink)" stroke-width="1" stroke-linecap="round">
									{#each strawRays as r}<line x1={r.x1} y1={r.y1} x2={r.x2} y2={r.y2} />{/each}
								</g>
								<g fill="var(--ink)">{#each wheelCenter as d}<circle cx={d.x} cy={d.y} r="2.4" />{/each}</g>
								<circle cx="80" cy="80" r="3.4" fill="var(--accent)" />
							</g>
						</svg>
					</div>
					<p class="pat-cap">Måneds-hjul — reskin av <code>DayWheelChart</code>. Aksent = i dag.</p>
				</div>
			</article>

			<!-- 2. PRIKKER & PERLER → diskret telling -->
			<article class="pat">
				<div class="pat-swatch">
					<svg class="pat-band-svg" viewBox="0 0 320 56" preserveAspectRatio="none">
						<defs>
							<pattern id="t-dots" width="20" height="18" patternUnits="userSpaceOnUse">
								<ellipse cx="5" cy="5" rx="5.6" ry="6.4" fill="var(--ink)" />
								<ellipse cx="15" cy="14" rx="5.6" ry="6.4" fill="var(--ink)" />
							</pattern>
							{@render disp('f-dots')}
						</defs>
						<rect width="320" height="56" fill="url(#t-dots)" filter="url(#f-dots)" />
					</svg>
				</div>
				<div class="pat-body">
					<h3>Prikker & perler</h3>
					<p class="pat-role">Diskret · sjekklister, dager</p>
					<div class="pat-demo">
						<svg viewBox="0 0 120 120" role="img" aria-label="Sjekkliste-fremdrift">
							<defs>{@render disp('f-prog')}</defs>
							<g filter="url(#f-prog)">
								{#each progressDots as d}
									<circle
										cx={d.x} cy={d.y} r="7"
										fill={d.state === 'todo' ? 'none' : d.state === 'next' ? 'var(--accent)' : 'var(--ink)'}
										stroke="var(--ink)" stroke-width="1.6"
									/>
								{/each}
							</g>
							<text x="60" y="67" text-anchor="middle" class="ring-num">5/8</text>
						</svg>
					</div>
					<p class="pat-cap">Fremdriftsring — prikk = punkt. Aksent = neste.</p>
				</div>
			</article>

			<!-- 3. HUS & SKYLINE → hjem/identitet -->
			<article class="pat pat--wide">
				<div class="pat-body">
					<h3>Hus & skyline</h3>
					<p class="pat-role">Hjem · identitet, oversikt</p>
				</div>
				<div class="pat-scene">
					<svg viewBox="0 0 320 130" preserveAspectRatio="xMidYMax meet" role="img" aria-label="Hjem-bånd">
						<defs>{@render disp('f-home')}</defs>
						<circle cx="280" cy="34" r="18" fill="var(--accent)" />
						<text x="20" y="44" class="scene-title">Hjem</text>
						<g filter="url(#f-home)">
							<g fill="var(--ink)">
								<rect x="16" y="78" width="26" height="46" />
								<path d="M50 124 V72 L66 58 L82 72 V124 Z" />
								<rect x="92" y="86" width="20" height="38" />
								<rect x="122" y="62" width="22" height="62" />
								<rect x="154" y="92" width="34" height="32" />
								<path d="M198 124 V80 L214 66 L230 80 V124 Z" />
								<rect x="240" y="74" width="20" height="50" />
								<rect x="270" y="96" width="34" height="28" />
							</g>
							<g fill="var(--cream)">
								<circle cx="24" cy="90" r="2" /><circle cx="34" cy="90" r="2" /><circle cx="24" cy="104" r="2" /><circle cx="34" cy="104" r="2" />
								<rect x="56" y="82" width="7" height="9" /><rect x="70" y="82" width="7" height="9" /><rect x="56" y="98" width="7" height="9" /><rect x="70" y="98" width="7" height="9" />
								<rect x="128" y="72" width="10" height="7" /><rect x="128" y="86" width="10" height="7" /><rect x="128" y="100" width="10" height="7" />
								<rect x="162" y="100" width="12" height="12" />
								<rect x="246" y="84" width="8" height="7" /><rect x="246" y="98" width="8" height="7" />
							</g>
						</g>
					</svg>
				</div>
				<p class="pat-cap">Hjemskjerm-bånd / app-identitet. Solen som blikkleder.</p>
			</article>

			<!-- 4. BLOMSTERENG → vekst/feiring -->
			<article class="pat pat--wide">
				<div class="pat-body">
					<h3>Blomstereng</h3>
					<p class="pat-role">Vekst · familie, kavalkade, feiring</p>
				</div>
				<div class="pat-scene">
					<svg viewBox="0 0 320 140" preserveAspectRatio="xMidYMax meet" role="img" aria-label="Blomstereng">
						<defs>{@render disp('f-garden', 0, 2.6)}</defs>
						<text x="20" y="32" class="scene-title">Året blomstret</text>
						<g filter="url(#f-garden)">
							<!-- solsikke -->
							<g transform="translate(44,96)">
								<g stroke="var(--ink)" stroke-width="2" stroke-linecap="round">
									{#each Array(16) as _, i}
										<line x1={0} y1={0} x2={polar(0, 0, 26, (360 / 16) * i)[0]} y2={polar(0, 0, 26, (360 / 16) * i)[1]} transform="translate(0,0)" />
									{/each}
								</g>
								<circle cx="0" cy="0" r="13" fill="var(--ink)" />
								<circle cx="0" cy="0" r="5" fill="var(--cream)" />
							</g>
							<!-- stripet frøkapsel -->
							<g transform="translate(112,84)">
								<ellipse cx="0" cy="0" rx="12" ry="34" fill="var(--ink)" />
								<g stroke="var(--cream)" stroke-width="2"><line x1="-12" y1="-16" x2="12" y2="-16" /><line x1="-12" y1="-4" x2="12" y2="-4" /><line x1="-12" y1="8" x2="12" y2="8" /><line x1="-12" y1="20" x2="12" y2="20" /></g>
							</g>
							<!-- dandelion / allium -->
							<g transform="translate(168,118)" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round">
								<line x1="0" y1="0" x2="0" y2="-46" />
								{#each Array(12) as _, i}
									<line x1="0" y1="-50" x2={polar(0, -50, 16, (360 / 12) * i)[0]} y2={polar(0, -50, 16, (360 / 12) * i)[1]} />
								{/each}
							</g>
							<!-- blad med linjer -->
							<g transform="translate(224,92)">
								<path d="M0 34 C -16 6, -16 -22, 0 -34 C 16 -22, 16 6, 0 34 Z" fill="none" stroke="var(--ink)" stroke-width="2" />
								<g stroke="var(--ink)" stroke-width="1"><line x1="-9" y1="-20" x2="-9" y2="24" /><line x1="0" y1="-30" x2="0" y2="30" /><line x1="9" y1="-20" x2="9" y2="24" /></g>
							</g>
						</g>
						<!-- aksent-blomst (eneste pop) -->
						<g transform="translate(286,96)">
							<circle cx="0" cy="0" r="16" fill="var(--accent)" />
							<circle cx="0" cy="0" r="6" fill="var(--cream)" />
						</g>
					</svg>
				</div>
				<p class="pat-cap">Feiring / tom tilstand. Tett mønster, én aksent-blomst.</p>
			</article>
		</div>
	</section>

	<!-- ═══ DOMENE-MOTIVER ═══ -->
	<section class="block">
		<p class="kicker">Domene-motiver · utforsking</p>
		<h2 class="h2">Et motiv per domene</h2>
		<p class="desc">
			I tillegg til de fire grunnfamiliene kan hvert tema få sitt eget blekk-motiv — så en flate
			kjennes igjen på <em>mønsteret</em>, ikke bare fargen. Forslag under (alle feTurbulence-myknet, ink + sparsom
			aksent). Räsymatto-prikkene er nå tettere, nærmere Marimekkos.
		</p>

		<div class="dm-grid">
			<!-- Helse -->
			<article class="dm">
				<div class="dm-art">
					<svg viewBox="0 0 240 72" role="img" aria-label="Helse-motiv">
						<defs>
							<pattern id="dm-helse" width="48" height="40" patternUnits="userSpaceOnUse">
								<path d="M24 38 V16" stroke="var(--ink)" stroke-width="1.4" fill="none" stroke-linecap="round" />
								<ellipse cx="15" cy="22" rx="7" ry="3.4" fill="var(--ink)" transform="rotate(-38 15 22)" />
								<ellipse cx="33" cy="18" rx="7" ry="3.4" fill="var(--ink)" transform="rotate(38 33 18)" />
								<circle cx="24" cy="12" r="3.2" fill="var(--ink)" />
							</pattern>
							{@render disp('dmf-helse')}
						</defs>
						<rect width="240" height="72" fill="url(#dm-helse)" filter="url(#dmf-helse)" />
					</svg>
				</div>
				<h3>Helse</h3>
				<p>Spirer & blader — vitalitet, vekst</p>
			</article>

			<!-- Trening & bevegelse -->
			<article class="dm">
				<div class="dm-art">
					<svg viewBox="0 0 240 72" role="img" aria-label="Trening-motiv">
						<defs>
							<pattern id="dm-trening" width="48" height="24" patternUnits="userSpaceOnUse">
								<path d="M0 12 q 12 -9 24 0 t 24 0" stroke="var(--ink)" stroke-width="1.8" fill="none" stroke-linecap="round" />
							</pattern>
							{@render disp('dmf-trening')}
						</defs>
						<rect width="240" height="72" fill="url(#dm-trening)" filter="url(#dmf-trening)" />
					</svg>
				</div>
				<h3>Trening & bevegelse</h3>
				<p>Bevegelseslinjer — rytme, flyt</p>
			</article>

			<!-- Bøker -->
			<article class="dm">
				<div class="dm-art">
					<svg viewBox="0 0 240 72" role="img" aria-label="Bøker-motiv">
						<defs>
							<pattern id="dm-boker" width="58" height="72" patternUnits="userSpaceOnUse">
								<g fill="var(--ink)">
									<rect x="3" y="22" width="9" height="46" />
									<rect x="15" y="14" width="11" height="54" />
									<rect x="30" y="28" width="8" height="40" transform="rotate(7 34 48)" />
									<rect x="44" y="18" width="10" height="50" />
								</g>
								<g fill="var(--cream)">
									<rect x="17" y="24" width="7" height="3" />
									<rect x="46" y="28" width="6" height="3" />
								</g>
							</pattern>
							{@render disp('dmf-boker')}
						</defs>
						<rect width="240" height="72" fill="url(#dm-boker)" filter="url(#dmf-boker)" />
					</svg>
				</div>
				<h3>Bøker</h3>
				<p>Bokrygger — hylle, lesefremdrift</p>
			</article>

			<!-- Ukedager -->
			<article class="dm">
				<div class="dm-art">
					<svg viewBox="0 0 240 72" role="img" aria-label="Ukedager-motiv">
						<defs>{@render disp('dmf-uke')}</defs>
						<g filter="url(#dmf-uke)">
							{#each [40, 52, 34, 58, 46, 30, 38] as h, i}
								<rect x={20 + i * 30} y={64 - h} width="16" height={h} rx="3" fill={i === 2 ? 'var(--accent)' : 'var(--ink)'} />
							{/each}
						</g>
					</svg>
				</div>
				<h3>Ukedager</h3>
				<p>7-rytme — i dag i aksent</p>
			</article>

			<!-- Økonomi -->
			<article class="dm">
				<div class="dm-art">
					<svg viewBox="0 0 240 72" role="img" aria-label="Økonomi-motiv">
						<defs>
							<pattern id="dm-okonomi" width="34" height="72" patternUnits="userSpaceOnUse">
								<g fill="var(--ink)">
									<ellipse cx="17" cy="60" rx="11" ry="3.6" />
									<ellipse cx="17" cy="51" rx="11" ry="3.6" />
									<ellipse cx="17" cy="42" rx="11" ry="3.6" />
									<ellipse cx="17" cy="33" rx="11" ry="3.6" />
								</g>
							</pattern>
							{@render disp('dmf-okonomi')}
						</defs>
						<rect width="240" height="72" fill="url(#dm-okonomi)" filter="url(#dmf-okonomi)" />
					</svg>
				</div>
				<h3>Økonomi</h3>
				<p>Myntstabler — beløp, akkumulering</p>
			</article>

			<!-- Familie & relasjoner -->
			<article class="dm">
				<div class="dm-art">
					<svg viewBox="0 0 240 72" role="img" aria-label="Familie-motiv">
						<defs>
							<pattern id="dm-familie" width="48" height="24" patternUnits="userSpaceOnUse">
								<path d="M0 6 q 12 12 24 0 t 24 0" stroke="var(--ink)" stroke-width="1.8" fill="none" stroke-linecap="round" />
								<path d="M0 18 q 12 -12 24 0 t 24 0" stroke="var(--ink)" stroke-width="1.8" fill="none" stroke-linecap="round" />
							</pattern>
							{@render disp('dmf-familie')}
						</defs>
						<rect width="240" height="72" fill="url(#dm-familie)" filter="url(#dmf-familie)" />
					</svg>
				</div>
				<h3>Familie & relasjoner</h3>
				<p>Fletteverk — to tråder som veves</p>
			</article>

			<!-- Refleksjon -->
			<article class="dm">
				<div class="dm-art">
					<svg viewBox="0 0 240 72" role="img" aria-label="Refleksjon-motiv">
						<defs>{@render disp('dmf-refleksjon')}</defs>
						<g filter="url(#dmf-refleksjon)" fill="none" stroke="var(--ink)" stroke-width="1.6">
							<circle cx="120" cy="36" r="10" />
							<circle cx="120" cy="36" r="20" />
							<circle cx="120" cy="36" r="30" />
						</g>
						<circle cx="120" cy="36" r="4" fill="var(--accent)" />
					</svg>
				</div>
				<h3>Refleksjon</h3>
				<p>Resonans-ringer — ringer i vann (egenfrekvens)</p>
			</article>

			<!-- Reise -->
			<article class="dm">
				<div class="dm-art">
					<svg viewBox="0 0 240 72" role="img" aria-label="Reise-motiv">
						<defs>{@render disp('dmf-reise')}</defs>
						<circle cx="210" cy="20" r="9" fill="var(--accent)" />
						<g filter="url(#dmf-reise)">
							<g fill="var(--ink)">
								<path d="M10 64 L46 22 L82 64 Z" />
								<path d="M70 64 L110 16 L150 64 Z" />
								<path d="M140 64 L172 30 L204 64 Z" />
							</g>
							<path d="M8 66 Q 70 54 120 64 T 232 58" stroke="var(--ink)" stroke-width="2" fill="none" stroke-dasharray="2 7" stroke-linecap="round" />
						</g>
					</svg>
				</div>
				<h3>Reise</h3>
				<p>Fjell & sti — rute, dager</p>
			</article>
		</div>
	</section>

	<!-- ═══ STRENGER & RESONANS ═══ -->
	<section class="block">
		<p class="kicker">Strenger · resonans</p>
		<h2 class="h2">Strenger som svinger</h2>
		<p class="desc">
			Strå-familien tatt et steg videre: strenger festet i begge ender som vibrerer, hver på
			<em>sin egen frekvens</em> — egenfrekvens, bokstavelig appnavnet. Tenkt som levende bakgrunn på
			hjem-/refleksjons-flatene, eller som «pluss»: rør en streng, så svinger den ut og roer seg.
		</p>
		<div class="strings-stage">
			<svg viewBox="0 0 240 160" role="img" aria-label="Vibrerende strenger">
				{#each STRINGS as s}
					<circle cx={s.x} cy="12" r="2.4" fill="var(--ink)" />
					<circle cx={s.x} cy="148" r="2.4" fill="var(--ink)" />
				{/each}
				{#each stringPaths as s}
					<path d={s.d} fill="none" stroke={s.accent ? 'var(--accent)' : 'var(--ink)'} stroke-width={s.accent ? 2.4 : 1.6} stroke-linecap="round" />
				{/each}
			</svg>
		</div>
		<p class="section-desc" style="margin-top: 12px;">
			{reduceMotion
				? 'Redusert bevegelse er på — strengene vises i ro (frosset svingefase).'
				: 'Animert: hver streng har ulik frekvens og node-mønster (egenmodus), så de driver inn og ut av fase.'}
		</p>

		<h3 class="subsection" style="margin-top: 28px;">… og vibrasjon</h3>
		<p class="section-desc">
			Motsatt ytterpunkt: høy frekvens, bittelite utslag. Strengen sveiper så fort at den blir et uskarpt
			<em>svøp</em> (den svake spindelen) med en dirrende linje inni. Svingning ↔ vibrasjon — samme motor, ulik karakter.
		</p>
		<div class="strings-stage">
			<svg viewBox="0 0 240 160" role="img" aria-label="Vibrerende strenger">
				{#each VIBES as v}
					<circle cx={v.x} cy="12" r="2.4" fill="var(--ink)" />
					<circle cx={v.x} cy="148" r="2.4" fill="var(--ink)" />
				{/each}
				{#each vibeEnvelopes as e, i}
					<path d={e} fill={VIBES[i].accent ? 'var(--accent)' : 'var(--ink)'} opacity="0.16" />
				{/each}
				{#each vibePaths as p, i}
					<path d={p} fill="none" stroke={VIBES[i].accent ? 'var(--accent)' : 'var(--ink)'} stroke-width="1.3" stroke-linecap="round" />
				{/each}
			</svg>
		</div>
	</section>

	<!-- ═══ ORGANISKE FELT — hagen som scene ═══ -->
	<section class="block">
		<p class="kicker">Organiske felt · forsøk</p>
		<h2 class="h2">Hagen som scene</h2>
		<p class="desc">
			Nytt forsøk etter prinsippet ditt: tematisk sammenhengende, med logisk plassering. Planter rotfestet i en
			grunnlinje, lagdelt dybde (høye spir bak, tett løv foran), beslektede arter som griper inn i hverandre — en
			<em>hage</em>, ikke en samling motiver.
		</p>
		<div class="organic">
			<svg viewBox="0 0 320 190" role="img" aria-label="Hage-scene">
				<defs>
					<clipPath id="cp-gpod"><ellipse cx="0" cy="0" rx="10" ry="28" /></clipPath>
					{@render disp('garden')}
				</defs>
				<g filter="url(#garden)">
					<!-- grunnlinje -->
					<path d="M4 176 Q 160 170 316 176" fill="none" stroke="var(--ink)" stroke-width="2" />

					<!-- BAK: høye spir og blader -->
					<path d="M36 176 C 20 140 22 96 32 60" fill="none" stroke="var(--ink)" stroke-width="2" />
					<path d="M300 176 C 314 138 312 100 304 72" fill="none" stroke="var(--ink)" stroke-width="2" />
					<!-- allium-spir A -->
					<line x1="72" y1="176" x2="72" y2="48" stroke="var(--ink)" stroke-width="1.6" />
					<g stroke="var(--ink)" stroke-width="1.2" stroke-linecap="round">
						{#each Array(13) as _, i}<line x1="72" y1="44" x2={polar(72, 44, 15, (360 / 13) * i)[0]} y2={polar(72, 44, 15, (360 / 13) * i)[1]} />{/each}
					</g>
					<g fill="var(--ink)">{#each Array(13) as _, i}<circle cx={polar(72, 44, 15, (360 / 13) * i)[0]} cy={polar(72, 44, 15, (360 / 13) * i)[1]} r="1.6" />{/each}</g>
					<!-- allium-spir B -->
					<line x1="250" y1="176" x2="250" y2="58" stroke="var(--ink)" stroke-width="1.6" />
					<g stroke="var(--ink)" stroke-width="1.2" stroke-linecap="round">
						{#each Array(11) as _, i}<line x1="250" y1="54" x2={polar(250, 54, 12, (360 / 11) * i)[0]} y2={polar(250, 54, 12, (360 / 11) * i)[1]} />{/each}
					</g>
					<!-- høy stripet frøkapsel -->
					<line x1="118" y1="176" x2="118" y2="70" stroke="var(--ink)" stroke-width="1.6" />
					<g transform="translate(118 46)">
						<g clip-path="url(#cp-gpod)">
							<rect x="-10" y="-28" width="20" height="56" fill="var(--ink)" />
							<g stroke="var(--cream)" stroke-width="2.4">
								{#each Array(6) as _, i}<line x1="-10" y1={-22 + i * 9} x2="10" y2={-22 + i * 9} />{/each}
							</g>
						</g>
					</g>

					<!-- MIDT: blomster -->
					<line x1="100" y1="176" x2="100" y2="96" stroke="var(--ink)" stroke-width="1.4" />
					<g stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round">
						{#each Array(12) as _, i}<line x1={polar(100, 84, 11, (360 / 12) * i)[0]} y1={polar(100, 84, 11, (360 / 12) * i)[1]} x2={polar(100, 84, 22, (360 / 12) * i)[0]} y2={polar(100, 84, 22, (360 / 12) * i)[1]} />{/each}
					</g>
					<circle cx="100" cy="84" r="10" fill="var(--ink)" /><circle cx="100" cy="84" r="3.6" fill="var(--cream)" />
					<!-- daisy -->
					<line x1="158" y1="176" x2="158" y2="116" stroke="var(--ink)" stroke-width="1.3" />
					<g fill="var(--ink)">{#each Array(8) as _, i}<circle cx={polar(158, 104, 9, (360 / 8) * i)[0]} cy={polar(158, 104, 9, (360 / 8) * i)[1]} r="3.4" />{/each}</g>
					<circle cx="158" cy="104" r="4.6" fill="var(--cream)" stroke="var(--ink)" stroke-width="1" />
					<!-- rund blomst -->
					<line x1="214" y1="176" x2="214" y2="104" stroke="var(--ink)" stroke-width="1.4" />
					<circle cx="214" cy="92" r="12" fill="var(--ink)" /><circle cx="214" cy="92" r="4" fill="var(--cream)" />
					<!-- bær-kvist -->
					<path d="M278 176 Q 286 150 280 126" fill="none" stroke="var(--ink)" stroke-width="1.3" />
					<g fill="var(--ink)"><circle cx="280" cy="126" r="3.6" /><circle cx="274" cy="136" r="3.6" /><circle cx="284" cy="144" r="3.4" /></g>

					<!-- FRONT: tett løv langs grunnlinja -->
					<g fill="var(--ink)">
						{#each [[26, 30, -14], [52, 40, 6], [84, 32, -8], [134, 30, 12], [176, 42, -6], [206, 30, 9], [238, 38, -10], [292, 32, 13]] as l}
							<path transform={`translate(${l[0]} 176) rotate(${l[2]})`} d={`M0 0 C -7 ${-l[1] * 0.42} -7 ${-l[1] * 0.85} 0 ${-l[1]} C 7 ${-l[1] * 0.85} 7 ${-l[1] * 0.42} 0 0 Z`} />
						{/each}
					</g>
					<!-- lav stripet pod foran -->
					<line x1="64" y1="176" x2="64" y2="150" stroke="var(--ink)" stroke-width="1.3" />
					<g transform="translate(64 138)"><ellipse rx="7" ry="14" fill="var(--ink)" /><g stroke="var(--cream)" stroke-width="1.8"><line x1="-7" y1="-6" x2="7" y2="-6" /><line x1="-7" y1="2" x2="7" y2="2" /></g></g>

					<!-- AKSENT: framtredende blomst, midt foran -->
					<line x1="134" y1="176" x2="134" y2="128" stroke="var(--ink)" stroke-width="1.6" />
					<circle cx="134" cy="116" r="15" fill="var(--accent)" /><circle cx="134" cy="116" r="5" fill="var(--cream)" />

					<!-- bunndekke-prikker -->
					<g fill="var(--ink)"><circle cx="110" cy="168" r="2.4" /><circle cx="190" cy="170" r="2.4" /><circle cx="226" cy="166" r="2.2" /><circle cx="300" cy="168" r="2.2" /></g>
				</g>
			</svg>
		</div>
		<p class="section-desc">
			Lagdelt og rotfestet — leses som en hage, ikke spredte ikoner. En ekte produksjonsversjon ville vært
			håndtegnet og enda tettere, men dette viser retningen: tematisk helhet + logisk plassering.
		</p>
	</section>

	<!-- ═══ SKJERMER (samlet & gruppert) ═══ -->
	<section class="block">
		<p class="kicker">Skjermskisser · språket i bruk</p>
		<h2 class="h2">Skjermer</h2>
		<p class="desc">
			Alle skjerm-skissene samlet og gruppert. Varmt og lavt informasjonstrykk som standard, kompakt der dataene
			faktisk krever det — råskisser for å se om språket bærer i bruk.
		</p>

		<h3 class="subsection">Inngang & dashbord</h3>
		<div class="sketches">
			<!-- HJEM — dagslista er helten: dumpe inn + krysse av -->
			<article class="sketch">
				<div class="sketch-screen">
					<p class="sk-eyebrow">Onsdag 14. juni</p>
					<h3 class="sk-greet">God morgen,<br />Kjetil</h3>
					<p class="sk-progress">Du har fått til <b>3 av 7</b> i dag. Rolig tempo — resten kan vente.</p>
					<div class="sk-daylist">
						<div class="dl-row dl-done"><span class="sk-dot sk-dot--done"></span>Løpetur før jobb</div>
						<div class="dl-row dl-done"><span class="sk-dot sk-dot--done"></span>Levere i barnehagen</div>
						<div class="dl-row dl-done"><span class="sk-dot sk-dot--done"></span>Svare Anita</div>
						<div class="dl-row"><span class="sk-dot sk-dot--accent"></span>Ringe lærer · 14:00</div>
						<div class="dl-row"><span class="sk-dot"></span>Handle til middag</div>
						<div class="dl-row"><span class="sk-dot"></span>Vanne plantene</div>
					</div>
					<div class="sk-capture">Skriv noe — så sorterer jeg det …</div>
				</div>
				<p class="sketch-label">Hjem · dagsliste</p>
			</article>

			<!-- HJEM (alt) — dashbord-følelse: hele livet på ett rolig blikk -->
			<article class="sketch">
				<div class="sketch-screen">
					<p class="sk-eyebrow">Onsdag 14. juni</p>
					<h3 class="sk-greet">God morgen,<br />Kjetil</h3>
					<p class="sk-progress">Alt henger sammen. Her er dagen din på ett blikk.</p>
					<div class="db-grid">
						<div class="db-tile">
							<svg class="db-motif" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15 A8 8 0 1 1 10 5 A6.2 6.2 0 0 0 20 15 Z" /></svg>
							<b>7,8t</b><span>søvn</span>
						</div>
						<div class="db-tile db-tile--accent">
							<svg class="db-motif" viewBox="0 0 24 24" aria-hidden="true">
								<circle cx="12" cy="12" r="4.2" />
								{#each Array(8) as _, i}<line x1={polar(12, 12, 6.6, (360 / 8) * i)[0]} y1={polar(12, 12, 6.6, (360 / 8) * i)[1]} x2={polar(12, 12, 9.6, (360 / 8) * i)[0]} y2={polar(12, 12, 9.6, (360 / 8) * i)[1]} />{/each}
							</svg>
							<b>+12 km</b><span>denne uka</span>
						</div>
						<div class="db-tile">
							<svg class="db-motif" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7 v11 M12 7 C 9.5 5.5 6 5.5 4.5 6.4 V16 C 6 15.2 9.5 15.2 12 16.8 M12 7 C 14.5 5.5 18 5.5 19.5 6.4 V16 C 18 15.2 14.5 15.2 12 16.8" /></svg>
							<b>s. 148</b><span>i boka</span>
						</div>
						<div class="db-tile">
							<svg class="db-motif" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /><path d="M10 8.5 v7 M10 12 l3.4 -3.2 M10 12 l3.4 3.2" /></svg>
							<b>God</b><span>kontroll</span>
						</div>
					</div>
					<p class="sk-eyebrow db-mt">Det neste</p>
					<div class="sk-rows">
						<div class="sk-row"><span class="sk-dot sk-dot--accent"></span>Ringe lærer · 14:00</div>
						<div class="sk-row"><span class="sk-dot"></span>Handle til middag</div>
					</div>
				</div>
				<p class="sketch-label">Hjem · dashbord</p>
			</article>

			<!-- HELSE -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Helse</h3>
					<div class="sk-hero-stat">
						<svg viewBox="0 0 84 84" class="sk-ring" aria-hidden="true">
							<circle cx="42" cy="42" r="34" fill="none" stroke="var(--line)" stroke-width="6" />
							<circle cx="42" cy="42" r="34" fill="none" stroke="var(--ink)" stroke-width="6" stroke-linecap="round" stroke-dasharray="167 214" transform="rotate(-90 42 42)" />
						</svg>
						<div class="sk-hero-num"><b>7,8</b><span>t søvn</span></div>
					</div>
					<div class="sk-statrow">
						<div class="sk-stat"><b>−1,1</b><span>kg</span></div>
						<div class="sk-stat sk-stat--accent"><b>+12</b><span>km</span></div>
					</div>
					<div class="sk-rows">
						<div class="sk-row"><span class="sk-dot sk-dot--done"></span>Løping · 8,2 km</div>
						<div class="sk-row"><span class="sk-dot sk-dot--done"></span>Yoga · 40 min</div>
						<div class="sk-row"><span class="sk-dot sk-dot--accent"></span>Svømming i dag?</div>
					</div>
				</div>
				<p class="sketch-label">Tema · Helse</p>
			</article>

			<!-- UKEPLAN -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Uke 24</h3>
					<svg class="sk-week" viewBox="0 0 220 60" aria-hidden="true">
						{#each [34, 46, 28, 52, 40, 24, 32] as h, i}
							<rect x={6 + i * 30} y={56 - h} width="20" height={h} rx="3" fill={i === 2 ? 'var(--accent)' : 'var(--ink)'} />
						{/each}
					</svg>
					<div class="sk-rows">
						<div class="sk-row"><span class="sk-dot sk-dot--done"></span>Handle til helga</div>
						<div class="sk-row"><span class="sk-dot sk-dot--done"></span>Ringe mamma</div>
						<div class="sk-row"><span class="sk-dot sk-dot--accent"></span>Levere skjema</div>
						<div class="sk-row"><span class="sk-dot"></span>Booke service</div>
					</div>
					<div class="sk-goal"><span>Løping</span><span class="sk-bar"><span class="sk-barfill" style="width:71%"></span></span></div>
				</div>
				<p class="sketch-label">Ukeplan</p>
			</article>
		</div>

		<h3 class="subsection">Hjem · widget-konsepter</h3>
		<p class="desc">
			Tre svar på det samme: hva får plass på Hjem, og hvordan sorteres det. Byggeklossen er «30 dager mot mål» —
			bare målbare, agerbare tall. Domenefarge på datalinjen, mållinje stiplet, resten blekk.
		</p>

		<!-- BYGGEKLOSSEN: 30 dager mot mål -->
		<div class="gw-row">
			{#each goalWidgets as w}
				{@const s = spark(w.series, 190, 60, 8, w.lo, w.hi)}
				<div class="gw-card">
					<p class="fe-kicker">{w.label}</p>
					<p class="gw-now"><b>{w.now}</b> <span>{w.unit}</span></p>
					<svg class="gw-spark" viewBox="0 0 190 60" aria-hidden="true">
						<defs>{@render disp(`gw-${w.key}`, 0, 2.2)}</defs>
						<line x1="6" y1={s.goalY(w.goal)} x2="184" y2={s.goalY(w.goal)} stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 4" />
						<text x="6" y={s.goalY(w.goal) - 4} class="gw-goal-tag">mål</text>
						<path d={s.d} fill="none" stroke={w.color} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" filter={`url(#gw-${w.key})`} />
						<circle cx={s.ex} cy={s.ey} r="3.4" fill={w.color} />
					</svg>
					<p class="gw-delta" class:gw-delta--behind={w.behind}>{w.delta}</p>
				</div>
			{/each}
		</div>

		<div class="sketches">
			<!-- HJEM · KARUSELL — horisontal overflow-scroll, sortert mest presserende først -->
			<article class="sketch">
				<div class="sketch-screen">
					<p class="sk-eyebrow">Onsdag 14. juni</p>
					<h3 class="sk-greet">God morgen,<br />Kjetil</h3>
					<p class="sk-progress">Tre mål på vei. Søvnen henger litt etter — den ligger først.</p>
					<div class="hw-carousel">
						{#each [goalWidgets[2], goalWidgets[0], goalWidgets[1]] as w}
							{@const s = spark(w.series, 130, 42, 6, w.lo, w.hi)}
							<div class="cw-card" class:cw-card--behind={w.behind}>
								{#if w.behind}<span class="cw-flag">Henger etter</span>{/if}
								<p class="cw-label">{w.label.split(' · ')[0]}</p>
								<p class="cw-now"><b>{w.now}</b> {w.unit}</p>
								<svg class="cw-spark" viewBox="0 0 130 42" aria-hidden="true">
									<defs>{@render disp(`cw-${w.key}`, 0, 1.8)}</defs>
									<line x1="4" y1={s.goalY(w.goal)} x2="126" y2={s.goalY(w.goal)} stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 4" />
									<path d={s.d} fill="none" stroke={w.color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" filter={`url(#cw-${w.key})`} />
									<circle cx={s.ex} cy={s.ey} r="3" fill={w.color} />
								</svg>
							</div>
						{/each}
					</div>
					<p class="hw-hint">Sveip for flere widgets →</p>
				</div>
				<p class="sketch-label">Hjem · karusell</p>
			</article>

			<!-- HJEM · PRIKK-RAD — ikon i farget sirkel per verdi, utvider ved trykk -->
			<article class="sketch">
				<div class="sketch-screen">
					<p class="sk-eyebrow">Onsdag 14. juni</p>
					<h3 class="sk-greet">God morgen,<br />Kjetil</h3>
					<p class="sk-progress">Alt på én rad. Trykk på en prikk for å folde den ut.</p>
					<div class="dot-rad">
						{#each [{ k: 'sun', c: 'var(--c-trening)', v: '+12', l: 'Trening' }, { k: 'moon', c: 'var(--c-sovn)', v: '7,2t', l: 'Søvn', open: true }, { k: 'book', c: 'var(--c-boker)', v: 's.148', l: 'Bøker' }, { k: 'coin', c: 'var(--c-okonomi)', v: 'God', l: 'Økonomi' }, { k: 'heart', c: 'var(--c-familie)', v: '3. jul', l: 'Familie' }] as d}
							<div class="dm" class:dm--open={d.open}>
								<span class="dm-circle" style="background:{d.c}">
									<svg class="dm-icon" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{@render glyph(d.k)}</g></svg>
								</span>
								<span class="dm-val">{d.v}</span>
								<span class="dm-lbl">{d.l}</span>
							</div>
						{/each}
					</div>
					<div class="dm-expanded">
						<p class="fe-kicker">Søvn · 30 dager</p>
						<p class="gw-now"><b>7,2</b> <span>t</span></p>
						<svg class="gw-spark" viewBox="0 0 190 52" aria-hidden="true">
							<defs>{@render disp('dm-sovn', 0, 2.2)}</defs>
							<line x1="6" y1={sovnSpark.goalY(goalWidgets[2].goal)} x2="184" y2={sovnSpark.goalY(goalWidgets[2].goal)} stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 4" />
							<path d={sovnSpark.d} fill="none" stroke="var(--c-sovn)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#dm-sovn)" />
							<circle cx={sovnSpark.ex} cy={sovnSpark.ey} r="3.4" fill="var(--c-sovn)" />
						</svg>
						<p class="gw-delta gw-delta--behind">−0,3 t under mål · prøv en rolig kveld</p>
					</div>
				</div>
				<p class="sketch-label">Hjem · prikk-rad</p>
			</article>
		</div>

		<h3 class="subsection">Hjem · flere retninger</h3>
		<p class="desc">
			Samme skjerm, ulik personlighet — fra praktisk synthese til rent redaksjonelt, tidssensitivt og lekende organisk.
			Bare for å kjenne hvor langt språket strekker seg.
		</p>
		<div class="sketches">
			<!-- HYBRID — dagslista øverst (det du faktisk gjør) + mot-mål-strip under -->
			<article class="sketch">
				<div class="sketch-screen">
					<p class="sk-eyebrow">Onsdag 14. juni</p>
					<h3 class="sk-greet">God morgen,<br />Kjetil</h3>
					<p class="sk-progress">3 av 7 gjort. Lista først — målene rett under.</p>
					<div class="sk-daylist">
						<div class="dl-row dl-done"><span class="sk-dot sk-dot--done"></span>Løpetur før jobb</div>
						<div class="dl-row dl-done"><span class="sk-dot sk-dot--done"></span>Levere i barnehagen</div>
						<div class="dl-row"><span class="sk-dot sk-dot--accent"></span>Ringe lærer · 14:00</div>
						<div class="dl-row"><span class="sk-dot"></span>Handle til middag</div>
					</div>
					<p class="sk-eyebrow hb-mt">Mot mål</p>
					<div class="hb-goals">
						{#each goalWidgets as w}
							{@const s = spark(w.series, 80, 28, 4, w.lo, w.hi)}
							<div class="hb-goal">
								<span class="hb-lbl">{w.label.split(' · ')[0]}</span>
								<span class="hb-val"><b>{w.now}</b>{w.unit}</span>
								<svg class="hb-spark" viewBox="0 0 80 28" aria-hidden="true">
									<line x1="2" y1={s.goalY(w.goal)} x2="78" y2={s.goalY(w.goal)} stroke="var(--muted)" stroke-width="1" stroke-dasharray="2 3" />
									<path d={s.d} fill="none" stroke={w.color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
									<circle cx={s.ex} cy={s.ey} r="2.6" fill={w.color} />
								</svg>
							</div>
						{/each}
					</div>
				</div>
				<p class="sketch-label">Hjem · hybrid</p>
			</article>

			<!-- BREV — rent redaksjonelt, prosa-først, lavest informasjonstrykk -->
			<article class="sketch">
				<div class="sketch-screen sk-letter">
					<p class="sk-eyebrow">Onsdag 14. juni · 08:12</p>
					<p class="lt-lead">God morgen, Kjetil.</p>
					<p class="lt-body">Du sov godt i natt — <b>tredje gode natt på rad</b>. Det merkes nok på overskuddet. Og du ligger <b>foran løpeplanen</b>, så i dag trenger du ikke presse.</p>
					<p class="lt-body">To ting står igjen før helga: <span class="lt-link">ringe læreren</span> og <span class="lt-link">handle til middag</span>. Begge kan vente til ettermiddagen.</p>
					<p class="lt-sign">— Resonans</p>
					<div class="lt-actions"><span class="th-chip">Vis hele dagen</span><span class="th-chip th-chip--accent">Skriv tilbake</span></div>
				</div>
				<p class="sketch-label">Hjem · brev</p>
			</article>

			<!-- MORGEN — tidssensitiv: dagen foran deg (07:00-toppen i bruksdata) -->
			<article class="sketch">
				<div class="sketch-screen">
					<p class="sk-eyebrow">07:10 · morgen</p>
					<h3 class="sk-greet">God morgen,<br />Kjetil</h3>
					<p class="sk-progress">Tre ting i dag. Sol, 18°. Du er uthvilt.</p>
					<div class="sk-rows">
						<div class="sk-row"><span class="sk-dot sk-dot--accent"></span>Ringe lærer · 14:00</div>
						<div class="sk-row"><span class="sk-dot"></span>Handle til middag</div>
						<div class="sk-row"><span class="sk-dot"></span>Løpetur — du ligger foran</div>
					</div>
					<div class="fe-card fe-card--accent mg-nudge">
						<p class="fe-kicker">Dagens dytt</p>
						<p class="fe-body">Rolig tempo i dag — spar litt til helga.</p>
					</div>
				</div>
				<p class="sketch-label">Hjem · morgen</p>
			</article>

			<!-- KVELD — tidssensitiv: dagen som var + refleksjon (20-23-toppen) -->
			<article class="sketch">
				<div class="sketch-screen sk-dusk">
					<p class="sk-eyebrow">21:40 · kveld</p>
					<h3 class="sk-greet">God kveld,<br />Kjetil</h3>
					<p class="sk-progress">Du fikk til 5 av 7. Fin dag.</p>
					<div class="sk-daylist">
						<div class="dl-row dl-done"><span class="sk-dot sk-dot--done"></span>Ringe lærer</div>
						<div class="dl-row dl-done"><span class="sk-dot sk-dot--done"></span>Handle til middag</div>
						<div class="dl-row dl-done"><span class="sk-dot sk-dot--done"></span>Løpetur · 8,2 km</div>
					</div>
					<div class="fe-card">
						<p class="fe-kicker">Før du legger deg</p>
						<p class="fe-body">Hvordan kjentes dagen? <span class="lt-link">Skriv et par ord →</span></p>
					</div>
					<p class="kv-tomorrow">I morgen: foreldremøte 17:00</p>
				</div>
				<p class="sketch-label">Hjem · kveld</p>
			</article>

			<!-- HAGE — lekende organisk: hver plante er et område, søvn trenger stell -->
			<article class="sketch">
				<div class="sketch-screen">
					<p class="sk-eyebrow">Onsdag 14. juni</p>
					<h3 class="sk-greet">Hagen din</h3>
					<p class="sk-progress">Hver plante er et område. De vokser når du steller dem.</p>
					<svg class="hg-garden" viewBox="0 0 240 124" role="img" aria-label="Hagen din">
						<defs>{@render disp('hg', 0, 2.4)}</defs>
						<g filter="url(#hg)">
							<path d="M6 116 Q 120 112 234 116" fill="none" stroke="var(--ink)" stroke-width="1.6" />
							<!-- trening: høy og frisk -->
							<line x1="36" y1="116" x2="36" y2="46" stroke="var(--ink)" stroke-width="1.4" />
							<path d="M36 86 q -12 -4 -16 -14 M36 70 q 12 -4 16 -14" fill="none" stroke="var(--ink)" stroke-width="1.2" stroke-linecap="round" />
							<circle cx="36" cy="40" r="9" fill="var(--c-trening)" /><circle cx="36" cy="40" r="3" fill="var(--cream)" />
							<!-- søvn: henger med hodet (trenger stell) -->
							<path d="M90 116 C 90 80 93 64 78 58" fill="none" stroke="var(--ink)" stroke-width="1.4" />
							<circle cx="74" cy="56" r="7" fill="var(--c-sovn)" opacity="0.45" /><circle cx="74" cy="56" r="2.4" fill="var(--cream)" />
							<!-- bøker -->
							<line x1="140" y1="116" x2="140" y2="58" stroke="var(--ink)" stroke-width="1.3" />
							<path d="M140 90 q 12 -3 16 -12 M140 76 q -12 -3 -16 -12" fill="none" stroke="var(--ink)" stroke-width="1.2" stroke-linecap="round" />
							<circle cx="140" cy="52" r="8" fill="var(--c-boker)" /><circle cx="140" cy="52" r="2.8" fill="var(--cream)" />
							<!-- økonomi -->
							<line x1="185" y1="116" x2="185" y2="68" stroke="var(--ink)" stroke-width="1.2" />
							<circle cx="185" cy="62" r="7" fill="var(--c-okonomi)" /><circle cx="185" cy="62" r="2.4" fill="var(--cream)" />
							<!-- familie -->
							<line x1="214" y1="116" x2="214" y2="54" stroke="var(--ink)" stroke-width="1.3" />
							<path d="M214 84 q 12 -3 15 -11 M214 72 q -12 -3 -15 -11" fill="none" stroke="var(--ink)" stroke-width="1.2" stroke-linecap="round" />
							<circle cx="214" cy="48" r="8.5" fill="var(--c-familie)" /><circle cx="214" cy="48" r="3" fill="var(--cream)" />
						</g>
					</svg>
					<div class="hg-legend">
						<span><span class="hg-key" style="background:var(--c-trening)"></span>Trening</span>
						<span><span class="hg-key" style="background:var(--c-sovn)"></span>Søvn — trenger stell</span>
						<span><span class="hg-key" style="background:var(--c-boker)"></span>Bøker</span>
					</div>
				</div>
				<p class="sketch-label">Hjem · hage (eksperiment)</p>
			</article>
		</div>
		<h3 class="subsection">Rolige former — lavt informasjonstrykk</h3>
		<div class="sketches">
			<!-- TRÅD -->
			<article class="sketch">
				<div class="sketch-screen sk-thread">
					<p class="sk-eyebrow">I dag · 08:14</p>
					<div class="th-bot">
						<span class="th-dot"></span>
						<div class="th-body"><p>Du har sovet godt tre netter på rad nå. Det merkes kanskje på overskuddet i dag?</p></div>
					</div>
					<div class="th-user">Ja, faktisk. Føler meg opplagt.</div>
					<div class="th-bot">
						<span class="th-dot"></span>
						<div class="th-body">
							<p>Fint å høre. Vil du legge en rolig løpetur på planen, eller bare nyte dagen?</p>
							<div class="th-actions"><span class="th-chip">Legg til løp</span><span class="th-chip th-chip--accent">Bare nyt</span></div>
						</div>
					</div>
				</div>
				<p class="sketch-label">Samtale · tråd</p>
			</article>

			<!-- DAGSFEED -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">I dag</h3>
					<div class="fe-list">
						<div class="fe-card">
							<p class="fe-kicker">Søvn</p>
							<p class="fe-body">Tredje gode natt på rad — 7,8 timer. Kvelden kan godt få være rolig.</p>
						</div>
						<div class="fe-card fe-card--accent">
							<p class="fe-kicker">Refleksjon</p>
							<p class="fe-body">Hvordan kjentes uka som gikk?</p>
							<span class="fe-link">Skriv et par ord →</span>
						</div>
						<div class="fe-card">
							<p class="fe-kicker">Bøker</p>
							<p class="fe-body">Du leste ferdig «Lyset vi ikke ser» denne uka. 🌿</p>
						</div>
					</div>
				</div>
				<p class="sketch-label">Dagsfeed</p>
			</article>

			<!-- KOMPAKT TABELL -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Perioder</h3>
					<div class="tb">
						<div class="tb-head"><span></span><span>7 d</span><span>30 d</span><span>90 d</span></div>
						<div class="tb-row"><span>Vekt</span><span>−0,4</span><span>−1,1</span><span class="tb-accent">+2,7</span></div>
						<div class="tb-row"><span>Søvn</span><span>7,2</span><span>7,5</span><span>7,4</span></div>
						<div class="tb-row"><span>Skritt</span><span>8,1k</span><span>7,4k</span><span>7,9k</span></div>
						<div class="tb-row"><span>Løping</span><span>18</span><span>62</span><span>171</span></div>
					</div>
					<p class="tb-note">Tett, men varmt — myke skiller, ikke kaldt rutenett. For data som faktisk er tabellariske.</p>
				</div>
				<p class="sketch-label">Kompakt · der det teller</p>
			</article>
		</div>
		<h3 class="subsection">Innsikt & vaner</h3>
		<div class="sketches">
			<!-- SKJERMTID — nøkkeløyeblikk: last opp skjermbilde, jeg leser tallene -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Skjermtid</h3>
					<div class="st-hero">
						<p class="st-num">3t 12m <span>i dag</span></p>
						<p class="ek-sub">40 min mindre enn i går. Fint — du fikk mer tid offline.</p>
					</div>
					<svg class="sk-week" viewBox="0 0 220 60" aria-hidden="true">
						{#each [48, 40, 52, 36, 44, 30, 33] as h, i}
							<rect x={6 + i * 30} y={56 - h} width="20" height={h} rx="3" fill={i === 6 ? 'var(--accent)' : 'var(--ink)'} />
						{/each}
					</svg>
					<div class="sk-rows">
						<div class="sk-row"><span class="sk-dot sk-dot--done"></span>Instagram · 1t 04m</div>
						<div class="sk-row"><span class="sk-dot sk-dot--done"></span>Nettlesing · 48 m</div>
						<div class="sk-row"><span class="sk-dot"></span>Meldinger · 22 m</div>
					</div>
					<div class="st-upload">
						<span class="st-cam">📷</span>
						<span>Last opp skjermbilde fra Skjermtid — så leser jeg av tallene</span>
					</div>
				</div>
				<p class="sketch-label">Skjermtid · last opp</p>
			</article>

			<!-- INNSIKT — kryss-domene signal, varmt formidlet (lukker signal-gapet) -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Innsikt</h3>
					<div class="fe-card fe-card--accent">
						<p class="fe-kicker">Mønster funnet</p>
						<p class="fe-body">I uker du løper tre ganger eller mer, sover du i snitt <b>42 min</b> lengre.</p>
					</div>
					<div class="ins-pair">
						<div class="ins-line"><span>Løp 3+</span><span class="sk-bar"><span class="sk-barfill" style="width:88%"></span></span><b>7,9t</b></div>
						<div class="ins-line"><span>Løp 0–2</span><span class="sk-bar"><span class="sk-barfill ins-muted" style="width:62%"></span></span><b>7,2t</b></div>
					</div>
					<div class="fe-card">
						<p class="fe-kicker">Enda en ting</p>
						<p class="fe-body">Du leser mest på søndager — tre ganger så mange sider som ellers i uka.</p>
					</div>
					<span class="fe-link">Spør meg om mer →</span>
				</div>
				<p class="sketch-label">Innsikt · kryss-signal</p>
			</article>
		</div>
		<h3 class="subsection">Flere domener</h3>
		<div class="sketches">
			<!-- EGENFREKVENS -->
			<article class="sketch">
				<div class="sketch-screen">
					<!-- Resonans-ringene ER skalaen: nivået fyller 1–5 ringer (her 4 av 5). -->
					<svg class="ef-rings" viewBox="0 0 120 120" aria-hidden="true">
						<defs>{@render disp('ef-r')}</defs>
						<g filter="url(#ef-r)" fill="none">
							{#each [10, 19, 28, 37, 46] as r, i}
								<circle cx="60" cy="60" r={r} stroke={i < 4 ? 'var(--accent)' : 'var(--line)'} stroke-width={i < 4 ? 2.6 : 1.4} />
							{/each}
						</g>
						<circle cx="60" cy="60" r="4" fill="var(--accent)" />
					</svg>
					<h3 class="ef-prompt">Hvordan kjennes dagen så langt?</h3>
					<div class="ef-slider">
						<span class="ef-track"><span class="ef-fill" style="width:75%"></span><span class="ef-handle" style="left:75%"></span></span>
					</div>
					<div class="ef-scale-labels"><span>Tung</span><span>Strålende</span></div>
					<div class="ef-field">Skriv en setning, om du vil …</div>
					<span class="fe-link">Fortsett i chat →</span>
				</div>
				<p class="sketch-label">Egenfrekvens · innsjekk</p>
			</article>

			<!-- ØKONOMI -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Økonomi</h3>
					<div class="ek-sum">
						<p class="sk-eyebrow">Brukt i juni</p>
						<p class="ek-num">18 240 <span>kr</span></p>
						<p class="ek-sub">Litt under snittet for måneden. God kontroll.</p>
					</div>
					<p class="sk-eyebrow ek-mt">Siste bevegelser</p>
					<div class="txn">
						<div class="txn-row"><span class="txn-name">Rema 1000<small>I går</small></span><span class="txn-amt">−486</span></div>
						<div class="txn-row"><span class="txn-name">Strøm<small>3. juni</small></span><span class="txn-amt txn-amt--accent">−2 140</span></div>
						<div class="txn-row"><span class="txn-name">Vipps · Anita<small>2. juni</small></span><span class="txn-amt">−300</span></div>
						<div class="txn-row"><span class="txn-name">Lønn<small>1. juni</small></span><span class="txn-amt">+42 800</span></div>
					</div>
				</div>
				<p class="sketch-label">Økonomi · feed + liste</p>
			</article>

			<!-- KAVALKADE -->
			<article class="sketch">
				<div class="sketch-screen">
					<p class="sk-eyebrow">14. juni · bursdag</p>
					<h3 class="sk-greet">Året ditt</h3>
					<svg class="kv-garden" viewBox="0 0 240 90" role="img" aria-label="Hage">
						<defs>{@render disp('kv-g')}</defs>
						<g filter="url(#kv-g)">
							<path d="M6 82 Q 120 78 234 82" fill="none" stroke="var(--ink)" stroke-width="1.6" />
							<line x1="40" y1="82" x2="40" y2="30" stroke="var(--ink)" stroke-width="1.3" />
							<g stroke="var(--ink)" stroke-width="1" stroke-linecap="round">{#each Array(10) as _, i}<line x1="40" y1="28" x2={polar(40, 28, 9, (360 / 10) * i)[0]} y2={polar(40, 28, 9, (360 / 10) * i)[1]} />{/each}</g>
							<line x1="118" y1="82" x2="118" y2="24" stroke="var(--ink)" stroke-width="1.3" />
							<g stroke="var(--ink)" stroke-width="1" stroke-linecap="round">{#each Array(11) as _, i}<line x1="118" y1="22" x2={polar(118, 22, 9, (360 / 11) * i)[0]} y2={polar(118, 22, 9, (360 / 11) * i)[1]} />{/each}</g>
							<line x1="80" y1="82" x2="80" y2="50" stroke="var(--ink)" stroke-width="1.2" />
							<g stroke="var(--ink)" stroke-width="1.4" stroke-linecap="round">{#each Array(10) as _, i}<line x1={polar(80, 42, 7, (360 / 10) * i)[0]} y1={polar(80, 42, 7, (360 / 10) * i)[1]} x2={polar(80, 42, 14, (360 / 10) * i)[0]} y2={polar(80, 42, 14, (360 / 10) * i)[1]} />{/each}</g>
							<circle cx="80" cy="42" r="6" fill="var(--ink)" /><circle cx="80" cy="42" r="2.2" fill="var(--cream)" />
							<line x1="200" y1="82" x2="200" y2="46" stroke="var(--ink)" stroke-width="1.2" />
							<circle cx="200" cy="38" r="8" fill="var(--ink)" /><circle cx="200" cy="38" r="2.6" fill="var(--cream)" />
							<g fill="var(--ink)">{#each [[18, 20, -12], [58, 24, 7], [100, 18, -8], [150, 22, 10], [176, 18, -6], [222, 20, 12]] as l}<path transform={`translate(${l[0]} 82) rotate(${l[2]})`} d={`M0 0 C -5 ${-l[1] * 0.42} -5 ${-l[1] * 0.85} 0 ${-l[1]} C 5 ${-l[1] * 0.85} 5 ${-l[1] * 0.42} 0 0 Z`} />{/each}</g>
							<line x1="158" y1="82" x2="158" y2="56" stroke="var(--ink)" stroke-width="1.3" />
							<circle cx="158" cy="48" r="10" fill="var(--accent)" /><circle cx="158" cy="48" r="3.4" fill="var(--cream)" />
						</g>
					</svg>
					<div class="kv-nums">
						<div class="kv-row"><b>412</b><span>km løpt</span></div>
						<div class="kv-row"><b>23</b><span>bøker lest</span></div>
						<div class="kv-row"><b>7,4</b><span>t snittsøvn</span></div>
					</div>
					<div class="kv-cta">Spill av året →</div>
				</div>
				<p class="sketch-label">Kavalkade · året</p>
			</article>
		</div>

		<h3 class="subsection">Familie, bøker & ferie</h3>
		<div class="sketches">
			<!-- FAMILIE -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Familie</h3>
					<svg class="fam-weave" viewBox="0 0 216 36" preserveAspectRatio="none" aria-hidden="true">
						<defs>{@render disp('fam-w')}</defs>
						<g filter="url(#fam-w)" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round">
							<path d="M0 11 q 18 16 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0" />
							<path d="M0 25 q 18 -16 36 0 t 36 0 t 36 0 t 36 0 t 36 0 t 36 0" />
						</g>
					</svg>
					<div class="fam-card">
						<p class="fe-kicker">Parsjekk</p>
						<p class="fe-body">Dere har ikke snakket om uka på en stund. Ta en kaffe i kveld?</p>
						<div class="th-actions"><span class="th-chip">Senere</span><span class="th-chip th-chip--accent">Sett av tid</span></div>
					</div>
					<div class="sk-rows">
						<div class="sk-row"><span class="sk-dot sk-dot--done"></span>Anita · bursdag 3. juli</div>
						<div class="sk-row"><span class="sk-dot"></span>Foreldremøte torsdag</div>
					</div>
				</div>
				<p class="sketch-label">Familie · parsjekk</p>
			</article>

			<!-- BØKER -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Bøker</h3>
					<svg class="bok-shelf" viewBox="0 0 220 70" aria-hidden="true">
						<defs>{@render disp('bok-s')}</defs>
						<g filter="url(#bok-s)">
							{#each [{ x: 8, w: 10, h: 50, t: 'ink' }, { x: 20, w: 8, h: 44, t: 'ink' }, { x: 30, w: 12, h: 56, t: 'ink' }, { x: 44, w: 9, h: 40, t: 'out' }, { x: 55, w: 11, h: 52, t: 'acc' }, { x: 68, w: 8, h: 46, t: 'ink' }, { x: 78, w: 13, h: 58, t: 'ink' }, { x: 93, w: 9, h: 42, t: 'out' }, { x: 104, w: 10, h: 50, t: 'ink' }, { x: 116, w: 8, h: 44, t: 'ink' }, { x: 126, w: 12, h: 54, t: 'out' }, { x: 140, w: 9, h: 48, t: 'ink' }, { x: 151, w: 11, h: 56, t: 'ink' }, { x: 164, w: 8, h: 42, t: 'out' }, { x: 174, w: 10, h: 50, t: 'ink' }, { x: 186, w: 9, h: 46, t: 'ink' }, { x: 197, w: 12, h: 54, t: 'out' }] as s}
								<rect x={s.x} y={64 - s.h} width={s.w} height={s.h} fill={s.t === 'out' ? 'none' : s.t === 'acc' ? 'var(--accent)' : 'var(--ink)'} stroke="var(--ink)" stroke-width={s.t === 'out' ? 1.6 : 0} />
							{/each}
						</g>
					</svg>
					<div class="bok-current">
						<p class="fe-kicker">Leser nå</p>
						<p class="bok-title">Lyset vi ikke ser</p>
						<div class="sk-goal"><span>s. 148 / 530</span><span class="sk-bar"><span class="sk-barfill" style="width:28%"></span></span></div>
					</div>
					<div class="sk-rows">
						<div class="sk-row"><span class="sk-dot sk-dot--done"></span>23 lest i år</div>
						<div class="sk-row"><span class="sk-dot sk-dot--accent"></span>12 klipp lagret</div>
					</div>
				</div>
				<p class="sketch-label">Bøker · lesefremdrift</p>
			</article>

			<!-- FERIE -->
			<article class="sketch">
				<div class="sketch-screen">
					<h3 class="sk-title">Sommerferie</h3>
					<p class="sk-eyebrow">1.–7. juli · Volda</p>
					<div class="fp">
						{#each [['Ma', '☀', 'Reise + handle'], ['Ti', '☀', 'Fjelltur'], ['On', '⛅', 'Bading'], ['To', '🌧', 'Rolig dag'], ['Fr', '☀', 'Besøk'], ['Lø', '☀', 'Strand'], ['Sø', '⛅', 'Hjemreise']] as d, i}
							<div class="fp-row" class:fp-row--accent={i === 1}>
								<span class="fp-day">{d[0]}</span>
								<span class="fp-w">{d[1]}</span>
								<span class="fp-plan">{d[2]}</span>
							</div>
						{/each}
					</div>
					<p class="tb-note">Kompakt dagsplan — en hel uke på én skjerm, der det trengs, men varmt.</p>
				</div>
				<p class="sketch-label">Ferie · dagsplan</p>
			</article>
		</div>
	</section>

	<!-- brush-skille -->
	<svg class="brush" viewBox="0 0 600 24" preserveAspectRatio="none" aria-hidden="true">
		<path d="M6 14 C 120 4, 200 20, 320 11 S 520 6, 594 13 C 520 18, 360 22, 230 18 S 70 22, 6 14 Z" fill="var(--ink)" />
	</svg>

	<!-- ═══ VIGNETTER ═══ -->
	<section class="block">
		<p class="kicker">04 — Vignetter</p>
		<h2 class="h2">Hvordan det kan føles</h2>
		<p class="desc">Statiske mockups — ikke ekte komponenter. Bare for å kjenne på språket på faktiske flater.</p>

		<div class="vignettes">
			<!-- Hjem-hilsen -->
			<article class="vig phone">
				<div class="phone-top">
					<svg class="phone-sun" viewBox="0 0 60 60" aria-hidden="true"><circle cx="30" cy="30" r="22" fill="var(--accent)" /></svg>
					<p class="phone-eyebrow">Onsdag 14. juni</p>
					<h3 class="phone-greet">God morgen,<br />Kjetil</h3>
					<p class="phone-sub">Du sov 7,8 timer og ligger foran løpeplanen. Rolig dag i vente.</p>
				</div>
				<svg class="phone-city" viewBox="0 0 360 110" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
					<g fill="var(--ink)">
						<rect x="16" y="46" width="34" height="64" />
						<path d="M58 110 V40 L80 24 L102 40 V110 Z" />
						<rect x="112" y="58" width="26" height="52" />
						<rect x="146" y="30" width="30" height="80" />
						<rect x="184" y="64" width="48" height="46" />
						<path d="M242 110 V52 L262 36 L282 52 V110 Z" />
						<rect x="292" y="44" width="24" height="66" />
						<rect x="324" y="70" width="22" height="40" />
					</g>
					<g fill="var(--cream)">
						<circle cx="26" cy="60" r="2.4" /><circle cx="40" cy="60" r="2.4" /><circle cx="26" cy="76" r="2.4" /><circle cx="40" cy="76" r="2.4" />
						<rect x="66" y="52" width="8" height="11" /><rect x="84" y="52" width="8" height="11" /><rect x="66" y="70" width="8" height="11" /><rect x="84" y="70" width="8" height="11" />
						<rect x="154" y="42" width="14" height="8" /><rect x="154" y="58" width="14" height="8" /><rect x="154" y="74" width="14" height="8" />
						<rect x="196" y="76" width="16" height="16" />
					</g>
				</svg>
			</article>

			<!-- Stat-kort med prikk-header -->
			<article class="vig card">
				<div class="card-band">
					<svg viewBox="0 0 280 44" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
						<defs>
							<pattern id="band" width="20" height="18" patternUnits="userSpaceOnUse">
								<ellipse cx="5" cy="5" rx="5.4" ry="6.2" fill="var(--ink)" />
								<ellipse cx="15" cy="14" rx="5" ry="6" fill="var(--ink)" transform="rotate(10 15 14)" />
							</pattern>
						</defs>
						<rect width="280" height="44" fill="url(#band)" opacity="0.9" />
					</svg>
				</div>
				<div class="card-body">
					<p class="card-label">Søvn i natt</p>
					<p class="card-value">7,8<span class="unit">t</span><svg class="value-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="var(--accent)" /></svg></p>
					<p class="card-note">+0,6 t mot snittet ditt. Beste natt på to uker.</p>
					<div class="card-foot">
						<span class="tick">Mål 8 t</span>
						<span class="bar"><span class="bar-fill" style="width:78%"></span></span>
					</div>
				</div>
			</article>

			<!-- Chat / triage -->
			<article class="vig chat">
				<div class="bubble user">Jeg svømte 30 min i dag</div>
				<div class="bubble bot">
					<span class="bot-dot" aria-hidden="true"></span>
					<div>
						<p class="bot-text">Fint — registrert som økt. Det er tredje svømmeturen denne uka, du ligger godt an mot målet.</p>
						<div class="bot-actions">
							<button class="ghost-btn">Se uka</button>
							<button class="ghost-btn accent">Sett nytt mål</button>
						</div>
					</div>
				</div>
			</article>
		</div>
	</section>

	<footer class="foot">
		<svg class="foot-mark" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="14" fill="var(--accent)" /></svg>
		<p>Moodboard · utforsking av designspråk. Ikke ekte komponenter — neste steg er en skin-token-klasse og håndtegnede komponenter.</p>
	</footer>
</div>

<style>
	.mb {
		--cream: #f6f1e7;
		--paper: #fbf8f1;
		--ink: #1b1a17;
		--ink-2: #4a453c;
		--muted: #8a8475;
		--line: #e3dccd;
		--accent: #ec5a2e;
		--accent-deep: #c8431c;
		/* Domenefarger — kun for kategoriske markører (prikker/sirkler/datalinjer). */
		--c-trening: #ec5a2e;
		--c-sovn: #5e7c8b;
		--c-boker: #7e8a5a;
		--c-okonomi: #c99a3c;
		--c-familie: #9b5c6b;
		--font-display: 'Petrona', Georgia, serif;
		--font-body: 'Hanken Grotesk', system-ui, -apple-system, sans-serif;

		min-height: 100dvh;
		background: var(--cream);
		color: var(--ink);
		font-family: var(--font-body);
		-webkit-font-smoothing: antialiased;
		padding: clamp(24px, 6vw, 64px) clamp(20px, 5vw, 56px) 80px;
		max-width: 1080px;
		margin: 0 auto;
		box-sizing: border-box;
	}

	.mb :global(*) { box-sizing: border-box; }

	/* ── Hero ── */
	.hero { max-width: 640px; margin: 0 auto 8px; text-align: center; }
	.hero-art { width: 100%; max-width: 520px; height: auto; display: block; margin: 0 auto 24px; }
	.eyebrow {
		font-size: 0.74rem; letter-spacing: 0.18em; text-transform: uppercase;
		color: var(--accent-deep); font-weight: 600; margin: 0 0 8px;
	}
	.display {
		font-family: var(--font-display);
		font-weight: 600; font-size: clamp(2.6rem, 8vw, 4.4rem);
		line-height: 0.98; letter-spacing: -0.02em; margin: 0 0 18px;
		font-optical-sizing: auto;
	}
	.lead { font-size: 1.06rem; line-height: 1.6; color: var(--ink-2); margin: 0 auto; max-width: 540px; }
	.lead em { color: var(--accent-deep); font-style: italic; }

	/* ── Brush-skille ── */
	.brush { width: 100%; height: 22px; display: block; margin: 56px 0; opacity: 0.92; }

	/* ── Form-sammenligning ── */
	.cmp { margin-bottom: 22px; }
	.cmp-subject { display: block; font-size: 0.8rem; font-weight: 600; color: var(--ink-2); margin: 0 0 8px; }
	.cmp-cells { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
	.cmp-cell { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 12px 12px 8px; display: flex; flex-direction: column; }
	.cmp-cell svg { width: 100%; height: auto; display: block; overflow: visible; }
	.cmp-tag { font-size: 0.62rem; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); text-align: center; margin-top: 8px; font-weight: 600; }

	/* ── Blokk ── */
	.block { max-width: 820px; margin: 0 auto; }
	.kicker {
		font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase;
		color: var(--muted); font-weight: 600; margin: 0 0 6px;
	}
	.h2 {
		font-family: var(--font-display); font-weight: 600;
		font-size: clamp(1.6rem, 4vw, 2.2rem); letter-spacing: -0.015em;
		margin: 0 0 10px; line-height: 1.05;
	}
	.desc { font-size: 0.98rem; line-height: 1.55; color: var(--ink-2); margin: 0 0 28px; max-width: 560px; }

	/* ── Palett ── */
	.swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 16px; }
	.swatch {
		display: flex; flex-direction: column; gap: 3px;
		background: var(--paper); border: 1px solid var(--line);
		border-radius: 18px; padding: 14px;
	}
	.chip { height: 56px; border-radius: 12px; margin-bottom: 8px; }
	.swatch b { font-size: 0.92rem; font-weight: 600; }
	.swatch code { font-size: 0.74rem; color: var(--ink-2); font-family: 'SF Mono', ui-monospace, monospace; }
	.swatch small { font-size: 0.74rem; color: var(--muted); }

	/* ── Typografi ── */
	.type-card { background: var(--paper); border: 1px solid var(--line); border-radius: 24px; padding: clamp(20px, 4vw, 36px); }
	.type-tag {
		display: inline-block; font-size: 0.68rem; letter-spacing: 0.14em; text-transform: uppercase;
		color: var(--muted); font-weight: 600; margin: 0 0 6px;
	}
	.type-tag:not(:first-child) { margin-top: 28px; }
	.spec-display { font-family: var(--font-display); font-weight: 600; font-size: clamp(2rem, 6vw, 3.2rem); line-height: 1; letter-spacing: -0.02em; margin: 0 0 14px; }
	.spec-h2 { font-family: var(--font-display); font-weight: 500; font-size: 1.4rem; margin: 0 0 18px; color: var(--ink); }
	.spec-figures { display: flex; flex-wrap: wrap; gap: 28px; margin: 0 0 8px; }
	.figure { font-family: var(--font-display); font-weight: 600; font-size: 2.6rem; line-height: 1; display: flex; flex-direction: column; }
	.figure small { font-family: var(--font-body); font-weight: 500; font-size: 0.72rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; margin-top: 6px; }
	.figure.accent { color: var(--accent); }
	.spec-body { font-size: 1rem; line-height: 1.62; color: var(--ink-2); margin: 0 0 10px; max-width: 48ch; }
	.spec-meta { font-size: 0.78rem; color: var(--muted); margin: 0; }

	/* ── Motiv-galleri ── */
	.motif-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }
	.motif { margin: 0; background: var(--paper); border: 1px solid var(--line); border-radius: 20px; padding: 14px; }
	.motif svg { width: 100%; height: auto; display: block; }
	.motif figcaption { font-size: 0.78rem; color: var(--ink-2); text-align: center; margin-top: 10px; font-weight: 500; }

	/* ── Vignetter ── */
	.vignettes { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; align-items: start; }
	.vig { background: var(--paper); border: 1px solid var(--line); border-radius: 26px; overflow: hidden; }

	/* hjem-hilsen */
	.phone { display: flex; flex-direction: column; min-height: 380px; }
	.phone-top { padding: 26px 24px 8px; position: relative; }
	.phone-sun { position: absolute; top: 22px; right: 22px; width: 44px; height: 44px; }
	.phone-eyebrow { font-size: 0.74rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 0 0 10px; }
	.phone-greet { font-family: var(--font-display); font-weight: 600; font-size: 2.1rem; line-height: 1.02; letter-spacing: -0.02em; margin: 0 0 12px; }
	.phone-sub { font-size: 0.92rem; line-height: 1.5; color: var(--ink-2); margin: 0; max-width: 30ch; }
	.phone-city { width: 100%; height: auto; margin-top: auto; display: block; }

	/* stat-kort */
	.card-band { height: 44px; overflow: hidden; }
	.card-band svg { width: 100%; height: 44px; display: block; }
	.card-body { padding: 18px 22px 22px; }
	.card-label { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 0 0 8px; }
	.card-value { font-family: var(--font-display); font-weight: 600; font-size: 3.2rem; line-height: 1; margin: 0 0 10px; display: flex; align-items: baseline; gap: 4px; }
	.card-value .unit { font-size: 1.2rem; color: var(--ink-2); }
	.value-sun { width: 16px; height: 16px; align-self: flex-start; margin-left: 2px; }
	.card-note { font-size: 0.9rem; line-height: 1.5; color: var(--ink-2); margin: 0 0 18px; }
	.card-foot { display: flex; align-items: center; gap: 12px; }
	.tick { font-size: 0.74rem; color: var(--muted); white-space: nowrap; }
	.bar { flex: 1; height: 8px; background: var(--line); border-radius: 99px; overflow: hidden; }
	.bar-fill { display: block; height: 100%; background: var(--accent); border-radius: 99px; }

	/* chat */
	.chat { padding: 20px; display: flex; flex-direction: column; gap: 14px; background: var(--cream); }
	.bubble { font-size: 0.92rem; line-height: 1.5; border-radius: 20px; padding: 12px 16px; max-width: 86%; }
	.bubble.user { align-self: flex-end; background: var(--ink); color: var(--cream); border-bottom-right-radius: 6px; }
	.bubble.bot { align-self: flex-start; background: var(--paper); border: 1.5px solid var(--ink); color: var(--ink); border-bottom-left-radius: 6px; display: flex; gap: 10px; }
	.bot-dot { width: 10px; height: 10px; border-radius: 99px; background: var(--accent); flex-shrink: 0; margin-top: 5px; }
	.bot-text { margin: 0 0 12px; }
	.bot-actions { display: flex; flex-wrap: wrap; gap: 8px; }
	.ghost-btn {
		font-family: var(--font-body); font-size: 0.8rem; font-weight: 600;
		background: transparent; color: var(--ink); border: 1.5px solid var(--ink);
		border-radius: 99px; padding: 6px 14px; cursor: pointer;
	}
	.ghost-btn.accent { color: var(--cream); background: var(--accent); border-color: var(--accent); }

	/* ── Mønster-board ── */
	.pat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
	.pat { background: var(--paper); border: 1px solid var(--line); border-radius: 24px; overflow: hidden; display: flex; flex-direction: column; }
	.pat--wide { grid-column: 1 / -1; }
	.pat-swatch { border-bottom: 1px solid var(--line); line-height: 0; }
	.pat-band-svg { width: 100%; height: 56px; display: block; }
	.pat-body { padding: 16px 20px 6px; }
	.pat h3 { font-family: var(--font-display); font-weight: 600; font-size: 1.3rem; margin: 0 0 2px; }
	.pat-role { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 0; }
	.pat-demo { display: flex; justify-content: center; padding: 16px 0 4px; }
	.pat-demo svg { width: 168px; height: auto; overflow: visible; }
	.pat-scene { padding: 4px 20px 0; }
	.pat-scene svg { width: 100%; height: auto; display: block; overflow: visible; }
	.pat-cap { font-size: 0.78rem; color: var(--ink-2); text-align: center; margin: 8px 0 0; padding: 0 20px 16px; }
	.pat-body .pat-cap { padding-left: 0; padding-right: 0; padding-bottom: 12px; }
	.pat-cap code { font-size: 0.72rem; background: var(--cream); border: 1px solid var(--line); border-radius: 4px; padding: 0 4px; }
	.ring-num { font-family: var(--font-display); font-weight: 600; font-size: 22px; fill: var(--ink); }
	.scene-title { font-family: var(--font-display); font-weight: 600; font-size: 22px; fill: var(--ink); }
	@media (max-width: 640px) {
		.pat-grid { grid-template-columns: 1fr; }
		.pat--wide { grid-column: auto; }
	}

	/* ── Domene-motiver ── */
	.dm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
	.dm { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; overflow: hidden; }
	.dm-art { border-bottom: 1px solid var(--line); background: var(--cream); line-height: 0; }
	.dm-art svg { width: 100%; height: auto; display: block; }
	.dm h3 { font-family: var(--font-display); font-weight: 600; font-size: 1.05rem; margin: 12px 16px 2px; }
	.dm p { font-size: 0.78rem; color: var(--ink-2); margin: 0 16px 14px; }

	/* ── Organiske felt ── */
	.organic { background: var(--paper); border: 1px solid var(--line); border-radius: 24px; padding: 6px 10px 0; margin-bottom: 16px; line-height: 0; }
	.organic svg { width: 100%; height: auto; display: block; }

	/* ── Skjermskisser ── */
	.sketches { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px; }
	.sketch { display: flex; flex-direction: column; gap: 8px; }
	.sketch-screen { background: var(--paper); border: 1px solid var(--line); border-radius: 22px; padding: 18px 16px; min-height: 372px; display: flex; flex-direction: column; }
	.sketch-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 600; text-align: center; margin: 0; }
	.sk-eyebrow { font-size: 0.66rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); font-weight: 600; margin: 0 0 8px; }
	.sk-greet { font-family: var(--font-display); font-weight: 600; font-size: 1.6rem; line-height: 1.02; margin: 0 0 8px; }
	.sk-progress { font-size: 0.86rem; color: var(--ink-2); margin: 0 0 16px; line-height: 1.4; }
	.sk-progress b { color: var(--ink); font-family: var(--font-display); font-weight: 600; }
	.sk-daylist { display: flex; flex-direction: column; gap: 12px; margin-bottom: auto; }
	.dl-row { display: flex; align-items: center; gap: 11px; font-size: 0.9rem; color: var(--ink); }
	.dl-done { color: var(--muted); }
	.sk-capture { margin-top: 16px; border: 1.5px dashed var(--line); border-radius: 14px; padding: 11px 14px; font-size: 0.82rem; color: var(--muted); }
	.sk-title { font-family: var(--font-display); font-weight: 600; font-size: 1.5rem; margin: 0 0 14px; }
	.sk-hero-stat { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; }
	.sk-ring { width: 72px; height: 72px; flex-shrink: 0; }
	.sk-hero-num b { font-family: var(--font-display); font-weight: 600; font-size: 1.8rem; display: block; line-height: 1; }
	.sk-hero-num span { font-size: 0.72rem; color: var(--muted); }
	.sk-statrow { display: flex; gap: 10px; margin-bottom: 16px; }
	.sk-stat { flex: 1; background: var(--cream); border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; }
	.sk-stat b { font-family: var(--font-display); font-weight: 600; font-size: 1.4rem; display: block; line-height: 1; }
	.sk-stat span { font-size: 0.7rem; color: var(--muted); }
	.sk-stat--accent b { color: var(--accent); }
	.sk-rows { display: flex; flex-direction: column; gap: 10px; }
	.sk-row { display: flex; align-items: center; gap: 10px; font-size: 0.85rem; color: var(--ink); }
	.sk-dot { width: 14px; height: 14px; border-radius: 999px; border: 1.6px solid var(--ink); flex-shrink: 0; }
	.sk-dot--done { background: var(--ink); }
	.sk-dot--accent { background: var(--accent); border-color: var(--accent); }
	.sk-week { width: 100%; height: auto; display: block; margin-bottom: 14px; }
	.sk-goal { display: flex; align-items: center; gap: 10px; margin-top: 14px; font-size: 0.78rem; color: var(--muted); }
	.sk-bar { flex: 1; height: 7px; background: var(--line); border-radius: 99px; overflow: hidden; }
	.sk-barfill { display: block; height: 100%; background: var(--accent); }

	/* ── Hjem · dashbord (glanceable fliser) ── */
	.db-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: auto; }
	.db-tile { background: var(--cream); border: 1px solid var(--line); border-radius: 16px; padding: 12px 13px; display: flex; flex-direction: column; gap: 1px; }
	.db-tile--accent { border-color: var(--accent); }
	.db-motif { width: 22px; height: 22px; margin-bottom: 7px; fill: none; stroke: var(--ink); stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
	.db-tile--accent .db-motif { stroke: var(--accent); }
	.db-tile b { font-family: var(--font-display); font-weight: 600; font-size: 1.35rem; line-height: 1; }
	.db-tile--accent b { color: var(--accent); }
	.db-tile span { font-size: 0.7rem; color: var(--muted); }
	.db-mt { margin-top: 16px; margin-bottom: 8px; }

	/* ── Skjermtid (last opp-øyeblikket) ── */
	.st-hero { margin-bottom: 14px; }
	.st-num { font-family: var(--font-display); font-weight: 600; font-size: 1.9rem; line-height: 1; margin: 0 0 6px; }
	.st-num span { font-size: 0.8rem; color: var(--muted); font-family: var(--font-body); font-weight: 400; }
	.st-upload { margin-top: auto; display: flex; align-items: center; gap: 11px; border: 1.5px dashed var(--accent); border-radius: 14px; padding: 12px 14px; font-size: 0.8rem; color: var(--ink-2); line-height: 1.35; }
	.st-cam { font-size: 1.15rem; flex-shrink: 0; }

	/* ── Innsikt (kryss-signal) ── */
	.fe-body b { font-family: var(--font-display); font-weight: 600; }
	.ins-pair { margin: 14px 0; display: flex; flex-direction: column; gap: 10px; }
	.ins-line { display: grid; grid-template-columns: 52px 1fr auto; gap: 10px; align-items: center; font-size: 0.78rem; color: var(--ink-2); }
	.ins-line b { font-family: var(--font-display); font-weight: 600; color: var(--ink); font-size: 0.9rem; }
	.ins-muted { opacity: 0.4; }

	/* ── Hjem · widget-konsepter (30 dager mot mål) ── */
	.gw-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 28px; }
	.gw-card { background: var(--paper); border: 1px solid var(--line); border-radius: 18px; padding: 16px 18px; }
	.gw-now { font-family: var(--font-display); margin: 6px 0 10px; line-height: 1; }
	.gw-now b { font-weight: 600; font-size: 1.9rem; }
	.gw-now span { font-size: 0.85rem; color: var(--muted); font-family: var(--font-body); }
	.gw-spark { width: 100%; height: auto; display: block; overflow: visible; }
	.gw-goal-tag { font-family: var(--font-body); font-size: 8px; fill: var(--muted); text-transform: uppercase; letter-spacing: 0.08em; }
	.gw-delta { font-size: 0.78rem; color: var(--muted); margin: 8px 0 0; }
	.gw-delta--behind { color: var(--accent-deep); }

	/* karusell */
	.hw-carousel { display: flex; gap: 12px; overflow-x: auto; margin: 0 -16px; padding: 4px 16px 10px; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; }
	.cw-card { flex: 0 0 142px; scroll-snap-align: start; background: var(--cream); border: 1px solid var(--line); border-radius: 16px; padding: 12px 13px; }
	.cw-card--behind { border-color: var(--accent); }
	.cw-flag { display: inline-block; font-size: 0.58rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--cream); background: var(--accent); border-radius: 999px; padding: 2px 7px; margin-bottom: 7px; }
	.cw-label { font-size: 0.72rem; color: var(--muted); font-weight: 600; margin: 0 0 4px; }
	.cw-now { font-family: var(--font-display); margin: 0 0 8px; line-height: 1; font-size: 0.8rem; color: var(--muted); }
	.cw-now b { font-weight: 600; font-size: 1.3rem; color: var(--ink); }
	.cw-spark { width: 100%; height: auto; display: block; overflow: visible; }
	.hw-hint { font-size: 0.72rem; color: var(--muted); margin: 6px 0 0; }

	/* prikk-rad */
	.dot-rad { display: flex; flex-wrap: wrap; gap: 14px 10px; margin: 4px 0 18px; }
	.dm { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 52px; }
	.dm-circle { width: 46px; height: 46px; border-radius: 999px; display: flex; align-items: center; justify-content: center; color: var(--cream); }
	.dm--open .dm-circle { box-shadow: 0 0 0 3px var(--cream), 0 0 0 4.5px var(--ink); }
	.dm-icon { width: 24px; height: 24px; }
	.dm-val { font-family: var(--font-display); font-weight: 600; font-size: 0.82rem; line-height: 1; }
	.dm-lbl { font-size: 0.62rem; color: var(--muted); }
	.dm-expanded { background: var(--paper); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; }

	/* ── Hjem · flere retninger ── */
	/* hybrid: dagsliste + mot-mål-strip */
	.hb-mt { margin-top: 18px; margin-bottom: 10px; }
	.hb-goals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
	.hb-goal { display: flex; flex-direction: column; gap: 2px; }
	.hb-lbl { font-size: 0.66rem; color: var(--muted); font-weight: 600; }
	.hb-val { font-family: var(--font-body); font-size: 0.66rem; color: var(--muted); }
	.hb-val b { font-family: var(--font-display); font-weight: 600; font-size: 0.98rem; color: var(--ink); margin-right: 2px; }
	.hb-spark { width: 100%; height: auto; display: block; margin-top: 3px; overflow: visible; }

	/* brev: redaksjonelt */
	.lt-lead { font-family: var(--font-display); font-weight: 600; font-size: 1.5rem; margin: 4px 0 12px; }
	.lt-body { font-size: 0.92rem; line-height: 1.6; color: var(--ink-2); margin: 0 0 12px; }
	.lt-body b { color: var(--ink); font-weight: 600; }
	.lt-link { color: var(--accent-deep); font-weight: 600; border-bottom: 1.5px solid var(--accent); }
	.lt-sign { font-family: var(--font-display); font-style: italic; font-size: 0.86rem; color: var(--muted); margin: 0 0 auto; }
	.lt-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }

	/* morgen / kveld */
	.mg-nudge { margin-top: auto; }
	.sk-dusk { background: #efe7d6; }
	.kv-tomorrow { font-size: 0.74rem; color: var(--muted); margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--line); }

	/* hage */
	.hg-garden { width: 100%; height: auto; display: block; margin: 6px 0 14px; overflow: visible; }
	.hg-legend { display: flex; flex-direction: column; gap: 7px; margin-top: auto; }
	.hg-legend span { display: flex; align-items: center; gap: 8px; font-size: 0.76rem; color: var(--ink-2); }
	.hg-key { width: 11px; height: 11px; border-radius: 999px; flex-shrink: 0; }

	/* ── Roligere former (tråd / feed / kompakt tabell) ── */
	.sk-thread { gap: 14px; }
	.sk-thread .sk-eyebrow { margin-bottom: 0; }
	.th-bot { background: var(--cream); border: 1.5px solid var(--ink); border-radius: 16px; border-bottom-left-radius: 5px; padding: 12px 14px; display: flex; gap: 10px; }
	.th-body { flex: 1; min-width: 0; }
	.th-bot p { margin: 0; font-size: 0.86rem; line-height: 1.5; color: var(--ink); }
	.th-dot { width: 9px; height: 9px; border-radius: 999px; background: var(--accent); flex-shrink: 0; margin-top: 5px; }
	.th-user { align-self: flex-end; background: var(--ink); color: var(--cream); font-size: 0.86rem; line-height: 1.45; border-radius: 16px; border-bottom-right-radius: 5px; padding: 10px 14px; max-width: 82%; }
	.th-actions { display: flex; gap: 8px; margin-top: 10px; }
	.th-actions { flex-wrap: wrap; }
	.th-chip { font-size: 0.75rem; font-weight: 600; border: 1.5px solid var(--ink); border-radius: 999px; padding: 5px 11px; white-space: nowrap; }
	.th-chip--accent { background: var(--accent); color: var(--cream); border-color: var(--accent); }

	.fe-list { display: flex; flex-direction: column; gap: 12px; }
	.fe-card { background: var(--cream); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; }
	.fe-card--accent { border-color: var(--accent); }
	.fe-kicker { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--muted); font-weight: 600; margin: 0 0 6px; }
	.fe-body { margin: 0; font-size: 0.9rem; line-height: 1.5; color: var(--ink); }
	.fe-link { display: inline-block; margin-top: 10px; font-size: 0.8rem; font-weight: 600; color: var(--accent-deep); }

	.tb { display: flex; flex-direction: column; }
	.tb-head, .tb-row { display: grid; grid-template-columns: 1.3fr 1fr 1fr 1fr; gap: 6px; padding: 9px 4px; align-items: baseline; }
	.tb-head { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); font-weight: 600; }
	.tb-row { border-top: 1px solid var(--line); font-size: 0.9rem; color: var(--ink); }
	.tb-row span { font-family: var(--font-display); }
	.tb-row span:first-child { font-family: var(--font-body); font-size: 0.82rem; color: var(--ink-2); }
	.tb-accent { color: var(--accent); }
	.tb-note { font-size: 0.72rem; color: var(--muted); margin: 12px 0 0; line-height: 1.4; }

	/* ── Flere flater (egenfrekvens / økonomi / kavalkade) ── */
	.ef-rings { width: 134px; height: auto; display: block; margin: 4px auto 18px; overflow: visible; }
	.ef-prompt { font-family: var(--font-display); font-weight: 600; font-size: 1.3rem; line-height: 1.15; margin: 0 0 18px; }
	.ef-slider { max-width: 220px; margin: 0 0 8px; }
	.ef-track { position: relative; display: block; height: 8px; background: var(--line); border-radius: 999px; }
	.ef-fill { position: absolute; left: 0; top: 0; height: 100%; background: var(--accent); border-radius: 999px; }
	.ef-handle { position: absolute; top: 50%; width: 20px; height: 20px; border-radius: 999px; background: var(--cream); border: 2px solid var(--accent); transform: translate(-50%, -50%); }
	.ef-scale-labels { display: flex; justify-content: space-between; max-width: 200px; font-size: 0.7rem; color: var(--muted); margin-bottom: auto; }
	.ef-field { border: 1.5px dashed var(--line); border-radius: 14px; padding: 12px 14px; font-size: 0.82rem; color: var(--muted); margin: 16px 0 12px; }

	.ek-sum { background: var(--cream); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; margin-bottom: 16px; }
	.ek-num { font-family: var(--font-display); font-weight: 600; font-size: 2rem; line-height: 1; margin: 0 0 6px; }
	.ek-num span { font-size: 0.9rem; color: var(--muted); }
	.ek-sub { font-size: 0.82rem; color: var(--ink-2); margin: 0; line-height: 1.4; }
	.ek-mt { margin-top: 4px; }
	.txn { display: flex; flex-direction: column; }
	.txn-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 10px 2px; border-top: 1px solid var(--line); }
	.txn-name { display: flex; flex-direction: column; font-size: 0.86rem; color: var(--ink); }
	.txn-name small { font-size: 0.68rem; color: var(--muted); margin-top: 2px; }
	.txn-amt { font-family: var(--font-display); font-weight: 600; font-size: 0.95rem; color: var(--ink); white-space: nowrap; }
	.txn-amt--accent { color: var(--accent); }

	.kv-garden { width: 100%; height: auto; display: block; margin: 8px 0 16px; overflow: visible; }
	.kv-nums { display: flex; flex-direction: column; gap: 10px; margin-bottom: auto; }
	.kv-row { display: flex; align-items: baseline; gap: 10px; }
	.kv-row b { font-family: var(--font-display); font-weight: 600; font-size: 1.5rem; line-height: 1; min-width: 56px; }
	.kv-row span { font-size: 0.82rem; color: var(--ink-2); }
	.kv-cta { margin-top: 16px; background: var(--accent); color: var(--cream); font-size: 0.85rem; font-weight: 600; text-align: center; border-radius: 999px; padding: 11px; }

	/* ── Familie / bøker / ferie ── */
	.fam-weave { width: 100%; height: auto; display: block; margin: 10px 0 16px; overflow: visible; }
	.fam-card { background: var(--cream); border: 1px solid var(--accent); border-radius: 16px; padding: 14px 16px; margin-bottom: 16px; }
	.bok-shelf { width: 100%; height: auto; display: block; margin: 6px 0 16px; overflow: visible; }
	.bok-current { background: var(--cream); border: 1px solid var(--line); border-radius: 16px; padding: 14px 16px; margin-bottom: 16px; }
	.bok-title { font-family: var(--font-display); font-weight: 600; font-size: 1.1rem; margin: 2px 0 10px; }
	.fp { display: flex; flex-direction: column; }
	.fp-row { display: grid; grid-template-columns: 28px 24px 1fr; gap: 10px; align-items: center; padding: 9px 4px; border-top: 1px solid var(--line); font-size: 0.86rem; color: var(--ink); }
	.fp-day { font-family: var(--font-display); font-weight: 600; color: var(--ink-2); }
	.fp-w { text-align: center; }
	.fp-row--accent .fp-day, .fp-row--accent .fp-plan { color: var(--accent); }

	/* ── Strenger & resonans ── */
	.strings-stage {
		background: var(--paper);
		border: 1px solid var(--line);
		border-radius: 24px;
		padding: 18px 24px;
	}
	.strings-stage svg { width: 100%; max-width: 380px; height: auto; display: block; margin: 0 auto; }

	/* ── Footer ── */
	.foot { display: flex; align-items: center; gap: 14px; max-width: 820px; margin: 64px auto 0; padding-top: 24px; border-top: 1px solid var(--line); }
	.foot-mark { width: 28px; height: 28px; flex-shrink: 0; }
	.foot p { font-size: 0.82rem; color: var(--muted); line-height: 1.5; margin: 0; }
</style>
