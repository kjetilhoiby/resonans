<!--
  ShowSlide — én fullskjerm-slide i kavalkade-showet: animert typografi
  (bokstav-strøm, count-up-tall), grafer (måned for måned + år-for-år) og
  levende gradient-bakgrunn.

  To skins: 'dark' (default, fargeblobs over nær sort) og 'fest' — klare,
  mettede farger tar over hele bakgrunnen, hvit typografi (Wrapped-plakat).

  Tekstanimasjon: intro/outro-titler strømmer inn bokstav for bokstav (CSS,
  ord-wrappet så linjefall skjer på ordgrenser); quote-tekst strømmer som
  chat (JS, STREAM_CHARS_PER_SEC) — med «{writer} skriver …»-indikator for
  hilsner fra bokhylla.

  `animate={false}` fryser alt i slutt-tilstand — brukes av /design-demoen
  (visuell regresjon) og respekteres også via prefers-reduced-motion.

  Display-typografien bruker clamp() i stedet for card-tokens med vilje:
  dette er plakat-tekst på 100dvh, ikke dashboard-innhold.
-->
<script lang="ts">
	import Konfetti from './Konfetti.svelte';
	import { STREAM_CHARS_PER_SEC, type ShowSlideDef } from './show-slides';

	interface Props {
		slide: ShowSlideDef;
		animate?: boolean;
		skin?: 'dark' | 'fest';
	}

	let { slide, animate = true, skin = 'dark' }: Props = $props();

	const nf = new Intl.NumberFormat('nb-NO');

	const reduceMotion =
		typeof window !== 'undefined' &&
		window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
	const live = $derived(animate && !reduceMotion);

	const words = (text: string) => text.split(/\s+/).filter(Boolean);
	const wordDelay = (i: number) => Math.min(i * 80, 1600);

	/** Ord → bokstaver med kumulativ delay, så titler strømmer inn tegn for tegn */
	function titleChars(text: string): Array<Array<{ ch: string; delay: number }>> {
		let offset = 0;
		return words(text).map((word) => {
			const chars = [...word].map((ch, i) => ({ ch, delay: Math.min((offset + i) * 42, 2200) }));
			offset += word.length + 1;
			return chars;
		});
	}

	// Count-up for stat-slides: rAF fra 0 til verdi med ease-out
	let counted = $state(0);
	$effect(() => {
		if (slide.kind !== 'stat') return;
		const target = slide.value;
		if (!live) {
			counted = target;
			return;
		}
		counted = 0;
		const durationMs = 1400;
		const start = performance.now();
		let raf = 0;
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / durationMs);
			const eased = 1 - Math.pow(1 - t, 3);
			counted = target * eased;
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	const countedLabel = $derived(
		slide.kind === 'stat'
			? nf.format(
					slide.decimals > 0
						? Math.round(counted * 10 ** slide.decimals) / 10 ** slide.decimals
						: Math.round(counted)
				)
			: ''
	);

	// Bokstav-strøm for quote-tekst — chat-følelse, med «skriver …»-pause først
	let streamed = $state('');
	let streaming = $state(false);
	$effect(() => {
		if (slide.kind !== 'quote') return;
		const text = slide.text;
		if (!live) {
			streamed = text;
			streaming = false;
			return;
		}
		streamed = '';
		streaming = true;
		let raf = 0;
		let start = 0;
		const tick = (now: number) => {
			if (!start) start = now;
			const n = Math.min(text.length, Math.floor(((now - start) / 1000) * STREAM_CHARS_PER_SEC));
			streamed = text.slice(0, n);
			if (n < text.length) raf = requestAnimationFrame(tick);
			else streaming = false;
		};
		const startDelay = setTimeout(
			() => {
				raf = requestAnimationFrame(tick);
			},
			slide.writer ? 1200 : 350
		);
		return () => {
			clearTimeout(startDelay);
			cancelAnimationFrame(raf);
		};
	});

	const chartMax = (bars: Array<{ value: number }>) =>
		Math.max(...bars.map((b) => b.value), 1);
</script>

<div class="slide" class:animate={live} class:skin-fest={skin === 'fest'} style={`--hue: ${slide.hue};`}>
	<div class="blob blob-a" aria-hidden="true"></div>
	<div class="blob blob-b" aria-hidden="true"></div>
	<div class="blob blob-c" aria-hidden="true"></div>

	{#if (slide.kind === 'intro' || slide.kind === 'outro') && slide.confetti}
		<Konfetti animate={live} />
	{/if}

	<div class="content">
		{#if slide.kind === 'intro' || slide.kind === 'outro'}
			<h1 class="title">
				{#each titleChars(slide.title) as word, wi (wi)}
					<span class="word">
						{#each word as { ch, delay }, ci (ci)}
							<span class="c" style={`animation-delay: ${delay}ms;`}>{ch}</span>
						{/each}
					</span>
				{/each}
			</h1>
			{#if slide.sub}
				<p class="sub rise" style="animation-delay: 1100ms;">{slide.sub}</p>
			{/if}
		{:else if slide.kind === 'stat'}
			<p class="bignum rise">
				<span class="num">{countedLabel}</span>{#if slide.unit}<span class="unit">&nbsp;{slide.unit}</span>{/if}
			</p>
			<h1 class="title title-sm">
				{#each words(slide.label) as word, i (i)}
					<span class="w" style={`animation-delay: ${600 + wordDelay(i)}ms;`}>{word}</span>
				{/each}
			</h1>
			{#if slide.sub}
				<p class="sub rise" style="animation-delay: 1400ms;">{slide.sub}</p>
			{/if}
			{#if slide.monthly}
				{@const maxM = chartMax(slide.monthly)}
				<div class="chart-months">
					{#each slide.monthly as m, i (i)}
						<div class="mcol" title={`${m.label}: ${nf.format(m.value)}`}>
							<span
								class="mbar"
								style={`height: ${Math.max(3, (m.value / maxM) * 100)}%; animation-delay: ${1300 + i * 70}ms;`}
							></span>
							<span class="mlabel">{m.label.charAt(0)}</span>
						</div>
					{/each}
				</div>
			{/if}
			{#if slide.yearly}
				{@const maxY = chartMax(slide.yearly)}
				<div class="chart-years">
					{#each slide.yearly as y, i (y.label)}
						<div class="yrow rise" style={`animation-delay: ${2100 + i * 200}ms;`}>
							<span class="ylabel">{y.label}</span>
							<span class="ytrack">
								<span
									class="ybar"
									class:is-current={i === (slide.yearly?.length ?? 0) - 1}
									style={`width: ${Math.max(2, (y.value / maxY) * 100)}%; animation-delay: ${2200 + i * 200}ms;`}
								></span>
							</span>
							<span class="yval">{nf.format(y.value)}</span>
						</div>
					{/each}
				</div>
			{/if}
		{:else if slide.kind === 'list'}
			<h1 class="title title-sm">
				{#each words(slide.title) as word, i (i)}
					<span class="w" style={`animation-delay: ${wordDelay(i)}ms;`}>{word}</span>
				{/each}
			</h1>
			<ul class="items">
				{#each slide.items as item, i (item)}
					<li class="rise" style={`animation-delay: ${700 + i * 450}ms; --ihue: ${(slide.hue + i * 36) % 360};`}>
						{item}
					</li>
				{/each}
			</ul>
			{#if slide.sub}
				<p class="sub rise" style={`animation-delay: ${900 + slide.items.length * 450}ms;`}>
					{slide.sub}
				</p>
			{/if}
		{:else if slide.kind === 'ordsky'}
			<h1 class="title title-sm">
				{#each words(slide.title) as word, i (i)}
					<span class="w" style={`animation-delay: ${wordDelay(i)}ms;`}>{word}</span>
				{/each}
			</h1>
			<div class="cloud">
				{#each slide.words as word, i (word.word)}
					<span
						class="cloud-word pop"
						style={`font-size: calc(0.9rem + ${word.weight} * 1.7rem); animation-delay: ${500 + i * 90}ms; --wo: ${0.6 + word.weight * 0.4}; --whue: ${(slide.hue + i * 23) % 360};`}
						>{word.word}</span
					>
				{/each}
			</div>
		{:else if slide.kind === 'quote'}
			{#if slide.writer}
				<p class="kicker rise">
					{slide.writer} skriver{#if streaming}<span class="typing-dots" aria-hidden="true"
							><span>.</span><span>.</span><span>.</span></span
						>{:else}&nbsp;…{/if}
				</p>
			{:else if slide.title}
				<p class="kicker rise">{slide.title}</p>
			{/if}
			<blockquote class="quote">
				{streamed}{#if streaming}<span class="caret" aria-hidden="true"></span>{/if}
			</blockquote>
			{#if slide.attribution && !streaming}
				<p class="sub attribution rise">— {slide.attribution}</p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.slide {
		position: absolute;
		inset: 0;
		overflow: hidden;
		display: flex;
		align-items: center;
		justify-content: center;
		background:
			radial-gradient(120% 90% at 80% 110%, hsl(var(--hue) 70% 14%) 0%, transparent 60%),
			radial-gradient(120% 90% at 10% -10%, hsl(calc(var(--hue) + 40) 60% 12%) 0%, transparent 55%),
			#07070a;
		color: #f4f4f6;
	}

	/* Drivende fargeblobs — transform-animert (kompositor-vennlig) */
	.blob {
		position: absolute;
		width: 70vmax;
		height: 70vmax;
		border-radius: 50%;
		filter: blur(60px);
		opacity: 0.5;
		pointer-events: none;
	}

	.blob-a {
		background: radial-gradient(circle, hsl(var(--hue) 95% 38% / 0.85) 0%, transparent 65%);
		top: -25vmax;
		left: -20vmax;
	}

	.blob-b {
		background: radial-gradient(circle, hsl(calc(var(--hue) + 60) 90% 34% / 0.75) 0%, transparent 65%);
		bottom: -30vmax;
		right: -22vmax;
	}

	/* Komplementærfargen i midten gir dybde og mer fargespill */
	.blob-c {
		background: radial-gradient(circle, hsl(calc(var(--hue) + 180) 80% 28% / 0.5) 0%, transparent 60%);
		width: 50vmax;
		height: 50vmax;
		top: 30%;
		left: 15%;
		mix-blend-mode: screen;
	}

	.animate .blob-a {
		animation: drift-a 16s ease-in-out infinite alternate;
	}

	.animate .blob-b {
		animation: drift-b 19s ease-in-out infinite alternate;
	}

	.animate .blob-c {
		animation: drift-c 23s ease-in-out infinite alternate;
	}

	@keyframes drift-a {
		from { transform: translate3d(0, 0, 0) scale(1); }
		to { transform: translate3d(12vmax, 8vmax, 0) scale(1.25); }
	}

	@keyframes drift-b {
		from { transform: translate3d(0, 0, 0) scale(1.2); }
		to { transform: translate3d(-10vmax, -9vmax, 0) scale(0.95); }
	}

	@keyframes drift-c {
		from { transform: translate3d(0, 0, 0) scale(0.9) rotate(0deg); }
		to { transform: translate3d(-8vmax, 10vmax, 0) scale(1.3) rotate(40deg); }
	}

	.content {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		text-align: center;
		padding: 48px 28px;
		max-width: 560px;
		max-height: 100%;
		width: 100%;
		overflow: hidden;
	}

	.title {
		margin: 0;
		font-size: clamp(2rem, 9vw, 3.2rem);
		font-weight: 800;
		line-height: 1.12;
		letter-spacing: -0.02em;
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0 0.28em;
	}

	.title-sm {
		font-size: clamp(1.3rem, 5.5vw, 1.9rem);
		font-weight: 700;
	}

	.word {
		display: inline-flex;
	}

	.bignum {
		margin: 0;
		font-size: clamp(3.2rem, 17vw, 6rem);
		font-weight: 800;
		letter-spacing: -0.03em;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	/* Gradient-tall — fargespennet følger slidens hue */
	.bignum .num {
		background: linear-gradient(115deg, hsl(var(--hue) 95% 80%) 10%, hsl(calc(var(--hue) + 75) 95% 70%) 90%);
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.bignum .unit {
		font-size: 0.4em;
		font-weight: 700;
		color: #f4f4f6;
	}

	.sub {
		margin: 0;
		font-size: clamp(0.95rem, 3.5vw, 1.1rem);
		color: rgb(244 244 246 / 0.65);
	}

	.kicker {
		margin: 0;
		font-size: var(--font-size-label, 0.78rem);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: hsl(var(--hue) 80% 75%);
	}

	/* «skriver …»-indikator — tre prikker som pulser i tur */
	.typing-dots span {
		display: inline-block;
		animation: dot-pulse 1.2s ease-in-out infinite;
	}

	.typing-dots span:nth-child(2) {
		animation-delay: 0.2s;
	}

	.typing-dots span:nth-child(3) {
		animation-delay: 0.4s;
	}

	@keyframes dot-pulse {
		0%, 60%, 100% { opacity: 0.25; }
		30% { opacity: 1; }
	}

	.items {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: clamp(1rem, 4vw, 1.25rem);
		font-weight: 500;
	}

	/* Hvert punkt får sin egen kulør på punktmarkøren */
	.items li::before {
		content: '';
		display: inline-block;
		width: 0.5em;
		height: 0.5em;
		border-radius: 50%;
		margin-right: 0.55em;
		vertical-align: 0.08em;
		background: hsl(var(--ihue, var(--hue)) 90% 70%);
	}

	.cloud {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: center;
		gap: 8px 16px;
	}

	.cloud-word {
		color: hsl(var(--whue, var(--hue)) 88% 76%);
		line-height: 1.15;
		font-weight: 600;
		opacity: var(--wo, 1);
	}

	.quote {
		margin: 0;
		font-size: clamp(1.25rem, 5vw, 1.7rem);
		font-style: italic;
		font-weight: 500;
		line-height: 1.4;
		white-space: pre-wrap;
		min-height: 3.4em;
	}

	.caret {
		display: inline-block;
		width: 2px;
		height: 1em;
		margin-left: 2px;
		vertical-align: -0.12em;
		background: currentColor;
		animation: caret-blink 0.9s steps(1) infinite;
	}

	@keyframes caret-blink {
		50% { opacity: 0; }
	}

	/* ── Grafer: måned for måned + år for år ───────────────────────────── */

	.chart-months {
		display: flex;
		align-items: flex-end;
		gap: 4px;
		width: 100%;
		max-width: 360px;
		height: 72px;
	}

	.mcol {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-end;
		gap: 4px;
		height: 100%;
		min-width: 0;
	}

	.mbar {
		width: 100%;
		border-radius: 3px 3px 0 0;
		background: hsl(var(--hue) 88% 64%);
		transform-origin: bottom;
	}

	.mlabel {
		font-size: 0.55rem;
		text-transform: uppercase;
		color: rgb(244 244 246 / 0.5);
	}

	.animate .mbar {
		animation: grow-y 0.5s cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	@keyframes grow-y {
		from { transform: scaleY(0); }
		to { transform: scaleY(1); }
	}

	.chart-years {
		display: flex;
		flex-direction: column;
		gap: 7px;
		width: 100%;
		max-width: 360px;
	}

	.yrow {
		display: grid;
		grid-template-columns: 64px 1fr 64px;
		align-items: center;
		gap: 8px;
		font-variant-numeric: tabular-nums;
	}

	.ylabel {
		font-size: 0.7rem;
		text-align: right;
		color: rgb(244 244 246 / 0.6);
	}

	.ytrack {
		display: block;
		height: 10px;
		border-radius: 999px;
		background: rgb(255 255 255 / 0.1);
		overflow: hidden;
	}

	.ybar {
		display: block;
		height: 100%;
		border-radius: 999px;
		background: hsl(var(--hue) 70% 52% / 0.75);
		transform-origin: left;
	}

	.ybar.is-current {
		background: linear-gradient(90deg, hsl(var(--hue) 90% 62%), hsl(calc(var(--hue) + 60) 90% 62%));
	}

	.animate .ybar {
		animation: grow-x 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	@keyframes grow-x {
		from { transform: scaleX(0); }
		to { transform: scaleX(1); }
	}

	.yval {
		font-size: 0.7rem;
		text-align: left;
		color: rgb(244 244 246 / 0.75);
	}

	/* ── Typografi-animasjoner — kun i .animate-modus ─────────────────── */

	.w,
	.c {
		display: inline-block;
	}

	.animate .w {
		opacity: 0;
		transform: translateY(0.55em);
		animation: word-in 0.55s cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	/* Bokstav-strøm: tegnene «skrives» inn med lett uskarphet */
	.animate .c {
		opacity: 0;
		transform: translateY(0.3em);
		filter: blur(5px);
		animation: char-in 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	.animate .rise {
		opacity: 0;
		transform: translateY(14px);
		animation: word-in 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}

	.animate .pop {
		opacity: 0;
		transform: scale(0.6);
		animation: pop-in 0.45s cubic-bezier(0.3, 1.4, 0.4, 1) both;
	}

	@keyframes word-in {
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes char-in {
		to {
			opacity: 1;
			transform: translateY(0);
			filter: blur(0);
		}
	}

	@keyframes pop-in {
		to {
			opacity: var(--wo, 1);
			transform: scale(1);
		}
	}

	/* ── Festskinn — mettet farge tar over hele bakgrunnen ─────────────── */

	.skin-fest {
		background:
			radial-gradient(120% 90% at 80% 110%, hsl(calc(var(--hue) + 30) 88% 47%) 0%, transparent 60%),
			linear-gradient(160deg, hsl(var(--hue) 88% 58%) 0%, hsl(var(--hue) 86% 48%) 100%);
		color: #fff;
	}

	.skin-fest .blob-a {
		background: radial-gradient(circle, hsl(calc(var(--hue) + 45) 95% 72% / 0.55) 0%, transparent 65%);
		mix-blend-mode: screen;
	}

	.skin-fest .blob-b {
		background: radial-gradient(circle, hsl(var(--hue) 85% 28% / 0.45) 0%, transparent 65%);
		mix-blend-mode: multiply;
	}

	.skin-fest .blob-c {
		background: radial-gradient(circle, hsl(calc(var(--hue) + 180) 95% 78% / 0.38) 0%, transparent 60%);
	}

	.skin-fest .bignum .num {
		background: none;
		color: #fff;
		-webkit-text-fill-color: #fff;
		text-shadow: 0 3px 28px hsl(var(--hue) 85% 25% / 0.5);
	}

	.skin-fest .kicker {
		color: rgb(255 255 255 / 0.9);
	}

	.skin-fest .sub {
		color: rgb(255 255 255 / 0.78);
	}

	.skin-fest .cloud-word {
		color: hsl(var(--whue, var(--hue)) 100% 93%);
	}

	.skin-fest .items li::before {
		background: rgb(255 255 255 / 0.95);
	}

	.skin-fest .mbar {
		background: rgb(255 255 255 / 0.92);
	}

	.skin-fest .mlabel,
	.skin-fest .ylabel {
		color: rgb(255 255 255 / 0.65);
	}

	.skin-fest .ytrack {
		background: rgb(0 0 0 / 0.18);
	}

	.skin-fest .ybar {
		background: rgb(255 255 255 / 0.55);
	}

	.skin-fest .ybar.is-current {
		background: #fff;
	}

	.skin-fest .yval {
		color: rgb(255 255 255 / 0.85);
	}

	@media (prefers-reduced-motion: reduce) {
		.animate .w,
		.animate .c,
		.animate .rise,
		.animate .pop,
		.animate .mbar,
		.animate .ybar,
		.animate .blob-a,
		.animate .blob-b,
		.animate .blob-c {
			animation: none;
			opacity: var(--wo, 1);
			transform: none;
			filter: none;
		}
	}
</style>
