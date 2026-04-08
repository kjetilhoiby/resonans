<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fly, fade, scale } from 'svelte/transition';
	import { spring, tweened } from 'svelte/motion';
	import { cubicOut, elasticOut, quintOut, backOut } from 'svelte/easing';

	// ── Nav ──────────────────────────────────────────────────────────────────
	const sections = [
		{ id: 'weather',     label: '🌦 Vær-partikler' },
		{ id: 'theme-pulse', label: '✨ Tema-puls' },
		{ id: 'transitions', label: '🔄 Sideoverganger' },
		{ id: 'focus-fade',  label: '🌫 Fokus & fade' },
		{ id: 'markers',     label: '📍 Animerte markører' },
		{ id: 'haptic',      label: '💥 Haptisk feedback' },
	] as const;
	type SectionId = typeof sections[number]['id'];
	let activeSection = $state<SectionId>('weather');

	function scrollTo(id: SectionId) {
		activeSection = id;
		document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
	}

	// ─────────────────────────────────────────────────────────────────────────
	// § 1 — WEATHER PARTICLES
	// ─────────────────────────────────────────────────────────────────────────

	type WeatherKind = 'rain' | 'snow' | 'sun' | 'thunder';
	let weather = $state<WeatherKind>('rain');

	interface Particle {
		id: number;
		x: number;   // % left
		delay: number; // ms
		dur: number;   // ms
		size: number;  // px
		opacity: number;
		wobble: number; // horizontal drift %
	}

	function makeParticles(n: number): Particle[] {
		return Array.from({ length: n }, (_, i) => ({
			id: i,
			x: Math.random() * 100,
			delay: Math.random() * 2000,
			dur: 600 + Math.random() * 800,
			size: 1 + Math.random() * 2,
			opacity: 0.35 + Math.random() * 0.5,
			wobble: (Math.random() - 0.5) * 6,
		}));
	}

	const rainParticles = makeParticles(55);
	const snowParticles = makeParticles(40);

	// Lightning flash for thunder
	let lightningVisible = $state(false);
	let lightningTimer: ReturnType<typeof setTimeout> | null = null;

	function triggerLightning() {
		lightningVisible = true;
		lightningTimer = setTimeout(() => {
			lightningVisible = false;
			lightningTimer = setTimeout(triggerLightning, 2000 + Math.random() * 4000);
		}, 120);
	}

	$effect(() => {
		if (weather === 'thunder') {
			lightningTimer = setTimeout(triggerLightning, 800);
		} else {
			if (lightningTimer) clearTimeout(lightningTimer);
			lightningVisible = false;
		}
		return () => { if (lightningTimer) clearTimeout(lightningTimer); };
	});

	// Sun rays rotation
	let sunAngle = $state(0);
	let sunRaf: number;
	$effect(() => {
		if (weather !== 'sun') { cancelAnimationFrame(sunRaf); return; }
		function tick() {
			sunAngle = (sunAngle + 0.15) % 360;
			sunRaf = requestAnimationFrame(tick);
		}
		sunRaf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(sunRaf);
	});

	// ─────────────────────────────────────────────────────────────────────────
	// § 2 — THEME PULSE  (velg tema → eksplosjon)
	// ─────────────────────────────────────────────────────────────────────────

	interface ThemeItem {
		id: string;
		name: string;
		emoji: string;
		hue: number;
	}

	const themes: ThemeItem[] = [
		{ id: 'helse',    name: 'Helse',    emoji: '🏃', hue: 142 },
		{ id: 'okonomi',  name: 'Økonomi',  emoji: '💰', hue: 45  },
		{ id: 'relasjoner', name: 'Relasjoner', emoji: '❤️', hue: 0  },
		{ id: 'kreativitet', name: 'Kreativitet', emoji: '🎨', hue: 280 },
		{ id: 'utvikling', name: 'Utvikling', emoji: '🌱', hue: 90 },
		{ id: 'fokus',    name: 'Fokus',    emoji: '🎯', hue: 210 },
	];

	let selectedTheme = $state<string | null>(null);
	let pulseThemeId  = $state<string | null>(null);
	let pulseRings = $state<{ id: number; theme: ThemeItem }[]>([]);
	let pulseCounter = 0;

	function selectTheme(t: ThemeItem) {
		selectedTheme = t.id;
		pulseThemeId = t.id;
		const id = ++pulseCounter;
		pulseRings = [...pulseRings, { id, theme: t }];
		setTimeout(() => {
			pulseRings = pulseRings.filter(r => r.id !== id);
		}, 1200);
	}

	// ─────────────────────────────────────────────────────────────────────────
	// § 3 — PAGE TRANSITIONS
	// ─────────────────────────────────────────────────────────────────────────

	type TransitionKind = 'slide' | 'morph' | 'reveal';

	const transPages = [
		{ id: 'home',  label: 'Hjem',   bg: '#0a0a0a', accent: '#667eea', emoji: '🏠' },
		{ id: 'theme', label: 'Tema',   bg: '#0d1f1a', accent: '#22c55e', emoji: '🏃' },
		{ id: 'chat',  label: 'Chat',   bg: '#10101e', accent: '#7c8ef5', emoji: '💬' },
	];
	let activeTransPage = $state(0);
	let transitionKind = $state<TransitionKind>('slide');
	let transKey = $state(0); // force remount

	function goToPage(i: number) {
		activeTransPage = i;
		transKey++;
	}

	// ─────────────────────────────────────────────────────────────────────────
	// § 4 — FOCUS FADE  (seksjoner ute av fokus fader)
	// ─────────────────────────────────────────────────────────────────────────

	const focusItems = [
		{ id: 'f1', label: 'Søvn',    value: '8t 12m', sub: 'I natt',      color: '#5fa0a0' },
		{ id: 'f2', label: 'Vekt',    value: '101,4',   sub: 'kg i dag',   color: '#e07070' },
		{ id: 'f3', label: 'Løping',  value: '24,2',    sub: 'km denne uka', color: '#7c8ef5' },
		{ id: 'f4', label: 'Økonomi', value: '14,2k',   sub: 'brukt apr',  color: '#f0b429' },
		{ id: 'f5', label: 'Mood',    value: '78 / 100', sub: 'i dag',     color: '#22c55e' },
	];
	let focusedItem = $state<string | null>(null);

	// ─────────────────────────────────────────────────────────────────────────
	// § 5 — ANIMATED MARKERS  (ring / progress / badge)
	// ─────────────────────────────────────────────────────────────────────────

	const ringGoal = 10000;
	const ringActual = tweened(0, { duration: 1400, easing: cubicOut });
	const arcCircumference = 2 * Math.PI * 42;

	let markersVisible = $state(false);
	$effect(() => {
		if (markersVisible) {
			void ringActual.set(7340);
		} else {
			void ringActual.set(0);
		}
	});

	const arcDash = $derived(Math.min($ringActual / ringGoal, 1) * arcCircumference);

	// Streaks
	const streakDays = [true, true, true, false, true, true, true];
	let streakVisible = $state(false);

	// Progress bars (top-level stores so $-syntax works)
	const bar0actual = tweened(0, { duration: 1100, easing: quintOut });
	const bar1actual = tweened(0, { duration: 1300, easing: quintOut });
	const bar2actual = tweened(0, { duration: 900,  easing: quintOut });
	const barActuals = [bar0actual, bar1actual, bar2actual];
	const barGoals = [
		{ label: 'Søvnmål',  color: '#5fa0a0', goal: 8,     actual: bar0actual },
		{ label: 'Skritt',   color: '#7c8ef5', goal: 10000, actual: bar1actual },
		{ label: 'Kalorier', color: '#f0b429', goal: 500,   actual: bar2actual },
	];
	const barValues = [7.2, 8342, 380];

	let barsVisible = $state(false);
	$effect(() => {
		if (barsVisible) {
			barActuals.forEach((store, i) => { void store.set(barValues[i]); });
		} else {
			barActuals.forEach(store => { void store.set(0); });
		}
	});

	// ─────────────────────────────────────────────────────────────────────────
	// § 6 — HAPTIC FEEDBACK DEMO
	// ─────────────────────────────────────────────────────────────────────────

	interface Ripple { id: number; x: number; y: number; }
	let ripples = $state<Ripple[]>([]);
	let rippleCounter = 0;

	function spawnRipple(e: MouseEvent | TouchEvent, container: HTMLElement) {
		const rect = container.getBoundingClientRect();
		let cx: number, cy: number;
		if (e instanceof TouchEvent) {
			cx = e.touches[0].clientX - rect.left;
			cy = e.touches[0].clientY - rect.top;
		} else {
			cx = e.clientX - rect.left;
			cy = e.clientY - rect.top;
		}
		const id = ++rippleCounter;
		ripples = [...ripples, { id, x: cx, y: cy }];
		setTimeout(() => { ripples = ripples.filter(r => r.id !== id); }, 700);
	}

	// Explosion for "big actions"
	interface Explosion { id: number; x: number; y: number; color: string; }
	let explosions = $state<Explosion[]>([]);
	let explosionCounter = 0;

	function spawnExplosion(e: MouseEvent, container: HTMLElement, color: string) {
		const rect = container.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		const id = ++explosionCounter;
		explosions = [...explosions, { id, x, y, color }];
		setTimeout(() => { explosions = explosions.filter(ex => ex.id !== id); }, 900);
	}

	// Intersection observer to trigger marker animations
	let sectionEl5: HTMLElement | undefined = $state();
	let sectionEl6: HTMLElement | undefined = $state();
	let sectionEl4: HTMLElement | undefined = $state();

	onMount(() => {
		const obs = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (e.isIntersecting) {
					if (e.target === sectionEl5)  { markersVisible = true; barsVisible = true; streakVisible = true; }
				}
			}
		}, { threshold: 0.3 });
		if (sectionEl5) obs.observe(sectionEl5);
		return () => obs.disconnect();
	});
</script>

<svelte:head>
	<title>Animasjonsutforskning — Resonans</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════
     TOP NAV
     ═══════════════════════════════════════════════════════════════════ -->
<nav class="top-nav">
	<a href="/" class="nav-back">← Hjem</a>
	<span class="nav-title">Animasjonsutforskning</span>
</nav>

<!-- sticky pill nav -->
<div class="pill-nav">
	{#each sections as s}
		<button
			class="pill"
			class:active={activeSection === s.id}
			onclick={() => scrollTo(s.id)}
		>
			{s.label}
		</button>
	{/each}
</div>

<main class="page">

<!-- ═══════════════════════════════════════════════════════════════════
     § 1  VÆR-PARTIKLER
     ═══════════════════════════════════════════════════════════════════ -->
<section id="weather" class="demo-section">
	<h2>🌦 Vær-widget med partikkeleffekter</h2>
	<p class="desc">Partikler reflekterer værtilstand — nedbør, snø, sol og torden. Passet til et kompakt widget-format.</p>

	<div class="weather-toggle">
		{#each (['rain','snow','sun','thunder'] as WeatherKind[]) as w}
			<button class="wtog" class:active={weather === w} onclick={() => (weather = w)}>
				{w === 'rain' ? '🌧' : w === 'snow' ? '❄️' : w === 'sun' ? '☀️' : '⛈'}
				{w}
			</button>
		{/each}
	</div>

	<div class="weather-widget" class:ww-rain={weather === 'rain'} class:ww-snow={weather === 'snow'} class:ww-sun={weather === 'sun'} class:ww-thunder={weather === 'thunder'}>

		<!-- Lightning flash overlay -->
		{#if lightningVisible}
			<div class="lightning-flash" transition:fade={{ duration: 80 }}></div>
		{/if}

		<!-- Rain drops -->
		{#if weather === 'rain' || weather === 'thunder'}
			{#each rainParticles as p (p.id)}
				<div
					class="raindrop"
					style:left="{p.x}%"
					style:animation-delay="{p.delay}ms"
					style:animation-duration="{p.dur}ms"
					style:width="{p.size}px"
					style:opacity={p.opacity}
					style:--wobble="{p.wobble}px"
				></div>
			{/each}
		{/if}

		<!-- Snowflakes -->
		{#if weather === 'snow'}
			{#each snowParticles as p (p.id)}
				<div
					class="snowflake"
					style:left="{p.x}%"
					style:animation-delay="{p.delay}ms"
					style:animation-duration="{p.dur * 2.5}ms"
					style:width="{p.size * 2.5}px"
					style:height="{p.size * 2.5}px"
					style:opacity={p.opacity}
					style:--wobble="{p.wobble}px"
				></div>
			{/each}
		{/if}

		<!-- Sun rays -->
		{#if weather === 'sun'}
			<div class="sun-orb" style:transform="rotate({sunAngle}deg)">
				{#each { length: 8 } as _, i}
					<div class="sun-ray" style:transform="rotate({i * 45}deg)"></div>
				{/each}
			</div>
			<!-- Shimmer particles floating up -->
			{#each rainParticles.slice(0, 18) as p (p.id)}
				<div
					class="shimmer-particle"
					style:left="{p.x}%"
					style:animation-delay="{p.delay * 1.5}ms"
					style:animation-duration="{p.dur * 3}ms"
					style:width="{p.size + 1}px"
					style:height="{p.size + 1}px"
					style:opacity={p.opacity * 0.6}
				></div>
			{/each}
		{/if}

		<!-- Widget content -->
		<div class="ww-content">
			<div class="ww-icon">
				{weather === 'rain' ? '🌧' : weather === 'snow' ? '❄️' : weather === 'sun' ? '☀️' : '⛈'}
			</div>
			<div class="ww-temp">
				{weather === 'sun' ? '22°' : weather === 'snow' ? '-4°' : weather === 'rain' ? '9°' : '11°'}
			</div>
			<div class="ww-label">
				{weather === 'sun' ? 'Klarvær, sol hele dagen' : weather === 'snow' ? 'Snøfall, kraftig vind' : weather === 'rain' ? 'Regn, 3–6 mm' : '⚡ Torden, vær forsiktig'}
			</div>
		</div>
	</div>

	<p class="hint">Bytt mellom vokabene ovenfor for å se ulike partikkelanimasjoner</p>
</section>


<!-- ═══════════════════════════════════════════════════════════════════
     § 2  TEMA-PULS
     ═══════════════════════════════════════════════════════════════════ -->
<section id="theme-pulse" class="demo-section">
	<h2>✨ Tema-valg med puls-eksplosjon</h2>
	<p class="desc">Visuell haptisk feedback ved valg av tema — utvidende ringer + farge-flash som forankrer valget i kroppen.</p>

	<div class="theme-grid-demo" style="position:relative; overflow:hidden;">
		<!-- Pulse rings (absolute overlay) -->
		{#each pulseRings as ring (ring.id)}
			<div
				class="pulse-ring-container"
				class:animating={true}
				style:--hue={ring.theme.hue}
			>
				<div class="pulse-ring pr1"></div>
				<div class="pulse-ring pr2"></div>
				<div class="pulse-ring pr3"></div>
			</div>
		{/each}

		{#each themes as t}
			<button
				class="tema-demo-btn"
				class:tema-selected={selectedTheme === t.id}
				style:--hue={t.hue}
				onclick={() => selectTheme(t)}
			>
				<span class="tema-emoji">{t.emoji}</span>
				<span class="tema-name">{t.name}</span>
				{#if selectedTheme === t.id}
					<span class="tema-check" in:scale={{ duration: 300, easing: backOut }}>✓</span>
				{/if}
			</button>
		{/each}
	</div>

	<p class="hint">Trykk på et tema for å se eksplosjon/puls-effekten</p>
</section>


<!-- ═══════════════════════════════════════════════════════════════════
     § 3  SIDEOVERGANGER
     ═══════════════════════════════════════════════════════════════════ -->
<section id="transitions" class="demo-section">
	<h2>🔄 Sideoverganger</h2>
	<p class="desc">Overgang fra hjemskjerm → tema-side → chat. Tre stilarter: slide, morph og reveal.</p>

	<div class="trans-controls">
		{#each (['slide','morph','reveal'] as TransitionKind[]) as k}
			<button class="wtog" class:active={transitionKind === k} onclick={() => (transitionKind = k)}>{k}</button>
		{/each}
	</div>

	<div class="trans-stage">
		<!-- Page tabs -->
		<div class="trans-tabs">
			{#each transPages as p, i}
				<button
					class="trans-tab"
					class:active={activeTransPage === i}
					style:--accent={p.accent}
					onclick={() => goToPage(i)}
				>
					{p.emoji} {p.label}
				</button>
			{/each}
		</div>

		<!-- Page viewport -->
		<div class="trans-viewport">
			{#key transKey}
				{@const p = transPages[activeTransPage]}
				{#if transitionKind === 'slide'}
					<div
						class="trans-page"
						style:background={p.bg}
						style:--accent={p.accent}
						in:fly={{ x: 40, duration: 360, easing: quintOut }}
						out:fly={{ x: -40, duration: 300, easing: quintOut }}
					>
						<div class="trans-page-icon">{p.emoji}</div>
						<div class="trans-page-title" style:color={p.accent}>{p.label}</div>
						<div class="trans-page-sub">Slide-overgang fra venstre</div>
					</div>
				{:else if transitionKind === 'morph'}
					<div
						class="trans-page"
						style:background={p.bg}
						style:--accent={p.accent}
						in:scale={{ start: 0.92, duration: 380, easing: cubicOut }}
						out:fade={{ duration: 220 }}
					>
						<div class="trans-page-icon">{p.emoji}</div>
						<div class="trans-page-title" style:color={p.accent}>{p.label}</div>
						<div class="trans-page-sub">Morph — scale + fade</div>
					</div>
				{:else}
					<div
						class="trans-page"
						style:background={p.bg}
						style:--accent={p.accent}
						in:fly={{ y: 30, duration: 400, easing: cubicOut }}
						out:fade={{ duration: 220 }}
					>
						<div class="trans-page-icon">{p.emoji}</div>
						<div class="trans-page-title" style:color={p.accent}>{p.label}</div>
						<div class="trans-page-sub">Reveal — glider opp</div>
					</div>
				{/if}
			{/key}
		</div>
	</div>
</section>


<!-- ═══════════════════════════════════════════════════════════════════
     § 4  FOKUS & FADE
     ═══════════════════════════════════════════════════════════════════ -->
<section id="focus-fade" class="demo-section" bind:this={sectionEl4}>
	<h2>🌫 Fokus & Fade</h2>
	<p class="desc">Hover/tap en sensor-sone → resten fader ut. Skaper ro og fokus uten å fjerne kontekst.</p>

	<div class="focus-list">
		{#each focusItems as item}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				class="focus-card"
				class:is-focused={focusedItem === item.id}
				class:is-blurred={focusedItem !== null && focusedItem !== item.id}
				style:--color={item.color}
				role="listitem"
				onmouseenter={() => (focusedItem = item.id)}
				onmouseleave={() => (focusedItem = null)}
				onfocus={() => (focusedItem = item.id)}
				onblur={() => (focusedItem = null)}
				tabindex="0"
			>
				<div class="fc-accent-bar"></div>
				<div class="fc-body">
					<div class="fc-value">{item.value}</div>
					<div class="fc-label">{item.label}</div>
					<div class="fc-sub">{item.sub}</div>
				</div>
				{#if focusedItem === item.id}
					<div class="fc-glow" transition:fade={{ duration: 200 }}></div>
				{/if}
			</div>
		{/each}
	</div>

	<p class="hint">Hover/tap en av kortene for å se fokus-effekten</p>
</section>


<!-- ═══════════════════════════════════════════════════════════════════
     § 5  ANIMERTE MARKØRER
     ═══════════════════════════════════════════════════════════════════ -->
<section id="markers" class="demo-section" bind:this={sectionEl5}>
	<h2>📍 Animerte markører</h2>
	<p class="desc">Ring-progress, fremdriftslinjer og streak-badges animerer inn ved synlighet. Verdi "telles opp" fra 0.</p>

	<div class="markers-grid">

		<!-- Ring -->
		<div class="marker-card">
			<h3>Mål-ring</h3>
			<svg class="ring-svg" viewBox="0 0 100 100">
				<circle cx="50" cy="50" r="42" fill="none" stroke="var(--border-color)" stroke-width="7"/>
				<circle
					cx="50" cy="50" r="42"
					fill="none"
					stroke="#7c8ef5"
					stroke-width="7"
					stroke-linecap="round"
					stroke-dasharray="{arcCircumference}"
					stroke-dashoffset="{arcCircumference - arcDash}"
					transform="rotate(-90 50 50)"
					style="transition: stroke-dashoffset 0.05s linear;"
				/>
				<text x="50" y="46" text-anchor="middle" fill="var(--text-primary)" font-size="13" font-weight="700">{Math.round($ringActual).toLocaleString('nb')}</text>
				<text x="50" y="60" text-anchor="middle" fill="var(--text-secondary)" font-size="8">av {ringGoal.toLocaleString('nb')} skritt</text>
			</svg>
			<button class="small-btn" onclick={() => { markersVisible = false; setTimeout(() => (markersVisible = true), 80); }}>
				Spill av igjen
			</button>
		</div>

		<!-- Progress bars -->
		<div class="marker-card">
			<h3>Fremdriftslinjer</h3>
			{#each barGoals as bg, i}
				{@const val = [($bar0actual), ($bar1actual), ($bar2actual)][i]}
				<div class="bar-row">
					<div class="bar-meta">
						<span class="bar-label">{bg.label}</span>
						<span class="bar-val" style:color={bg.color}>
							{i === 0
								? `${val.toFixed(1)}h`
								: i === 1
									? Math.round(val).toLocaleString('nb')
									: `${Math.round(val)} kcal`}
						</span>
					</div>
					<div class="bar-track">
						<div
							class="bar-fill"
							style:width="{Math.min(val / bg.goal, 1) * 100}%"
							style:background={bg.color}
						></div>
					</div>
				</div>
			{/each}
			<button class="small-btn" onclick={() => { barsVisible = false; setTimeout(() => (barsVisible = true), 80); }}>
				Spill av igjen
			</button>
		</div>

		<!-- Streak badges -->
		<div class="marker-card">
			<h3>Streak-badges</h3>
			<div class="streak-row">
				{#each streakDays as done, i}
					{#if streakVisible}
						<div
							class="streak-dot"
							class:streak-done={done}
							in:scale={{ delay: i * 80, duration: 340, easing: backOut }}
						>
							{done ? '✓' : '·'}
						</div>
					{:else}
						<div class="streak-dot"></div>
					{/if}
				{/each}
			</div>
			<p class="streak-label">6 av 7 dager aktiv</p>
			<button class="small-btn" onclick={() => { streakVisible = false; setTimeout(() => (streakVisible = true), 80); }}>
				Spill av igjen
			</button>
		</div>

	</div>
</section>


<!-- ═══════════════════════════════════════════════════════════════════
     § 6  HAPTISK FEEDBACK / RIPPLE / EKSPLOSJON
     ═══════════════════════════════════════════════════════════════════ -->
<section id="haptic" class="demo-section" bind:this={sectionEl6}>
	<h2>💥 Visuell haptisk feedback</h2>
	<p class="desc">Ripple ved vanlig tap, eksplosjon ved primærhandlinger. Forankrer brukervalg uten lyd.</p>

	<!-- Ripple demo -->
	<div class="haptic-row">
		<h3>Ripple-knapp</h3>
		<div class="ripple-area" style="position:relative; overflow:hidden;" role="presentation"
			onmousedown={(e) => spawnRipple(e, e.currentTarget as HTMLElement)}
			ontouchstart={(e) => spawnRipple(e, e.currentTarget as HTMLElement)}
		>
			{#each ripples as r (r.id)}
				<span
					class="ripple"
					style:left="{r.x}px"
					style:top="{r.y}px"
				></span>
			{/each}
			<button class="ripple-btn" tabindex="-1">Trykk her</button>
		</div>
	</div>

	<!-- Explosion / colour burst -->
	<div class="haptic-row">
		<h3>Primær-eksplosjon</h3>
		<div class="explosion-area" style="position:relative; overflow:hidden;" role="presentation">
			{#each explosions as ex (ex.id)}
				<span
					class="explosion-ring e1"
					style:left="{ex.x}px"
					style:top="{ex.y}px"
					style:border-color={ex.color}
				></span>
				<span
					class="explosion-ring e2"
					style:left="{ex.x}px"
					style:top="{ex.y}px"
					style:border-color={ex.color}
				></span>
				{#each { length: 8 } as _, i}
					<span
						class="explosion-particle"
						style:left="{ex.x}px"
						style:top="{ex.y}px"
						style:background={ex.color}
						style:--angle="{i * 45}deg"
					></span>
				{/each}
			{/each}
			{#each themes as t}
				<button
					class="explosion-btn"
					style:--hue={t.hue}
					onclick={(e) => spawnExplosion(e, (e.currentTarget as HTMLElement).closest('.explosion-area') as HTMLElement, `hsl(${t.hue}, 65%, 55%)`)}
				>
					{t.emoji} {t.name}
				</button>
			{/each}
		</div>
	</div>

	<!-- Bounce confirm -->
	<div class="haptic-row">
		<h3>Bounce-bekreftelse</h3>
		<div class="bounce-row">
			<button class="bounce-btn" style="--hue:210">Lagre</button>
			<button class="bounce-btn" style="--hue:0">Slett</button>
			<button class="bounce-btn" style="--hue:142">Send</button>
			<button class="bounce-btn" style="--hue:45">Del</button>
		</div>
		<p class="hint">Trykk og hold for å se bounce-animasjonen</p>
	</div>
</section>

</main>

<style>
/* ── Layout ──────────────────────────────────────────────────────── */
.top-nav {
	position: sticky;
	top: 0;
	z-index: 100;
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 12px 20px;
	background: var(--bg-primary);
	border-bottom: 1px solid var(--border-subtle);
}
.nav-back {
	color: var(--text-secondary);
	font-size: 0.85rem;
	text-decoration: none;
}
.nav-title {
	font-size: 0.9rem;
	font-weight: 600;
}

.pill-nav {
	position: sticky;
	top: 45px;
	z-index: 90;
	display: flex;
	gap: 6px;
	padding: 8px 16px;
	overflow-x: auto;
	background: var(--bg-primary);
	border-bottom: 1px solid var(--border-subtle);
	scrollbar-width: none;
}
.pill-nav::-webkit-scrollbar { display: none; }
.pill {
	flex-shrink: 0;
	padding: 5px 12px;
	border-radius: 20px;
	border: 1px solid var(--border-color);
	background: var(--bg-card);
	color: var(--text-secondary);
	font-size: 0.78rem;
	cursor: pointer;
	transition: background 0.15s, color 0.15s;
}
.pill.active {
	background: var(--accent-primary);
	color: #fff;
	border-color: transparent;
}

.page {
	max-width: 680px;
	margin: 0 auto;
	padding: 0 0 80px;
}

.demo-section {
	padding: 48px 20px 40px;
	border-bottom: 1px solid var(--border-subtle);
}
.demo-section h2 {
	font-size: 1.2rem;
	font-weight: 700;
	margin: 0 0 6px;
}
.desc {
	font-size: 0.85rem;
	color: var(--text-secondary);
	margin: 0 0 24px;
	line-height: 1.5;
}
.hint {
	font-size: 0.78rem;
	color: var(--text-tertiary);
	margin-top: 12px;
}

/* ── Weather toggle ──────────────────────────────────────────────── */
.weather-toggle { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
.wtog {
	padding: 6px 14px;
	border-radius: 8px;
	border: 1px solid var(--border-color);
	background: var(--bg-card);
	color: var(--text-secondary);
	font-size: 0.82rem;
	cursor: pointer;
	transition: background 0.12s, color 0.12s;
}
.wtog.active { background: var(--accent-primary); color: #fff; border-color: transparent; }

/* ── Weather widget ─────────────────────────────────────────────── */
.weather-widget {
	position: relative;
	overflow: hidden;
	height: 200px;
	border-radius: 20px;
	display: flex;
	align-items: flex-end;
	transition: background 0.8s, box-shadow 0.8s;
}
.ww-rain    { background: linear-gradient(160deg, #1a2535 0%, #2d3f5a 100%); box-shadow: 0 8px 32px rgba(60,100,160,0.25); }
.ww-snow    { background: linear-gradient(160deg, #1e2a40 0%, #3a4a6a 100%); box-shadow: 0 8px 32px rgba(100,140,200,0.25); }
.ww-sun     { background: linear-gradient(160deg, #1a3a2a 0%, #3a6040 100%); box-shadow: 0 8px 32px rgba(60,160,80,0.25); }
.ww-thunder { background: linear-gradient(160deg, #0e1520 0%, #1a2030 100%); box-shadow: 0 8px 40px rgba(120,80,200,0.4); }

.lightning-flash {
	position: absolute;
	inset: 0;
	background: rgba(220,200,255,0.35);
	pointer-events: none;
	z-index: 10;
}

/* Rain */
@keyframes rain-fall {
	0%   { transform: translateY(-10px) translateX(0); opacity: 0; }
	10%  { opacity: 1; }
	90%  { opacity: 1; }
	100% { transform: translateY(210px) translateX(var(--wobble)); opacity: 0; }
}
.raindrop {
	position: absolute;
	top: 0;
	height: 14px;
	background: linear-gradient(to bottom, transparent, rgba(160,200,255,0.85));
	border-radius: 2px;
	animation: rain-fall linear infinite;
}

/* Snow */
@keyframes snow-fall {
	0%   { transform: translateY(-10px) translateX(0) rotate(0deg); opacity: 0; }
	10%  { opacity: 1; }
	90%  { opacity: 1; }
	100% { transform: translateY(210px) translateX(var(--wobble)) rotate(360deg); opacity: 0; }
}
.snowflake {
	position: absolute;
	top: 0;
	border-radius: 50%;
	background: rgba(220,235,255,0.9);
	animation: snow-fall ease-in-out infinite;
}

/* Sun rays */
.sun-orb {
	position: absolute;
	top: 24px;
	right: 30px;
	width: 60px;
	height: 60px;
	display: flex;
	align-items: center;
	justify-content: center;
}
.sun-ray {
	position: absolute;
	top: 50%;
	left: 50%;
	width: 28px;
	height: 2px;
	margin-top: -1px;
	margin-left: 10px;
	background: linear-gradient(to right, rgba(255,220,60,0.9), transparent);
	transform-origin: 0 50%;
	border-radius: 2px;
}
@keyframes shimmer-up {
	0%   { transform: translateY(200px); opacity: 0; }
	30%  { opacity: 1; }
	80%  { opacity: 0.6; }
	100% { transform: translateY(-20px); opacity: 0; }
}
.shimmer-particle {
	position: absolute;
	bottom: 0;
	border-radius: 50%;
	background: rgba(255,220,100,0.7);
	animation: shimmer-up ease-in-out infinite;
}

/* Widget content */
.ww-content {
	position: relative;
	z-index: 5;
	padding: 20px 24px;
}
.ww-icon   { font-size: 2.2rem; margin-bottom: 4px; }
.ww-temp   { font-size: 2.6rem; font-weight: 700; color: #fff; line-height: 1; }
.ww-label  { font-size: 0.82rem; color: rgba(255,255,255,0.7); margin-top: 4px; }

/* ── Theme pulse ────────────────────────────────────────────────── */
.theme-grid-demo {
	display: grid;
	grid-template-columns: repeat(3, 1fr);
	gap: 12px;
	padding: 4px;
}

@keyframes pulse-ring-anim {
	0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0.8; }
	100% { transform: translate(-50%, -50%) scale(3.5); opacity: 0; }
}
.pulse-ring-container {
	position: absolute;
	top: 50%;
	left: 50%;
	pointer-events: none;
	z-index: 20;
}
.pulse-ring {
	position: absolute;
	border-radius: 50%;
	border: 2px solid hsl(var(--hue, 210), 65%, 60%);
	transform: translate(-50%, -50%);
	animation: pulse-ring-anim 1.1s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
}
.pr1 { width: 60px;  height: 60px;  animation-delay: 0ms;  }
.pr2 { width: 60px;  height: 60px;  animation-delay: 150ms; opacity: 0.6; }
.pr3 { width: 60px;  height: 60px;  animation-delay: 300ms; opacity: 0.3; }

.tema-demo-btn {
	position: relative;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 6px;
	padding: 16px 8px;
	border-radius: 16px;
	border: 1.5px solid var(--border-subtle);
	background: var(--bg-card);
	cursor: pointer;
	transition: transform 0.18s, border-color 0.18s, background 0.18s, box-shadow 0.18s;
	overflow: hidden;
}
.tema-demo-btn:hover {
	transform: scale(1.04);
	border-color: hsl(var(--hue, 210), 55%, 60%);
}
.tema-demo-btn.tema-selected {
	border-color: hsl(var(--hue, 210), 65%, 60%);
	background: hsla(var(--hue, 210), 55%, 55%, 0.12);
	box-shadow: 0 0 0 3px hsla(var(--hue, 210), 65%, 60%, 0.2);
}
.tema-emoji { font-size: 1.8rem; }
.tema-name  { font-size: 0.78rem; color: var(--text-secondary); }
.tema-check {
	position: absolute;
	top: 8px;
	right: 10px;
	font-size: 0.75rem;
	color: hsl(var(--hue, 210), 65%, 60%);
	font-weight: 700;
}

/* ── Transitions ────────────────────────────────────────────────── */
.trans-controls { display: flex; gap: 8px; margin-bottom: 16px; }
.trans-stage    { border-radius: 16px; overflow: hidden; border: 1px solid var(--border-color); }
.trans-tabs {
	display: flex;
	border-bottom: 1px solid var(--border-color);
	background: var(--bg-card);
}
.trans-tab {
	flex: 1;
	padding: 10px 8px;
	font-size: 0.82rem;
	border: none;
	background: transparent;
	color: var(--text-secondary);
	cursor: pointer;
	transition: background 0.12s, color 0.12s;
	border-bottom: 2px solid transparent;
}
.trans-tab.active {
	color: var(--accent-primary);
	border-bottom-color: var(--accent-primary);
	background: var(--bg-hover);
}
.trans-viewport {
	position: relative;
	overflow: hidden;
	height: 180px;
}
.trans-page {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
}
.trans-page-icon  { font-size: 2.5rem; }
.trans-page-title { font-size: 1.4rem; font-weight: 700; }
.trans-page-sub   { font-size: 0.78rem; color: rgba(255,255,255,0.5); }

/* ── Focus fade ─────────────────────────────────────────────────── */
.focus-list {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
}
.focus-card {
	position: relative;
	overflow: hidden;
	flex: 1;
	min-width: 90px;
	border-radius: 14px;
	border: 1px solid var(--border-subtle);
	background: var(--bg-card);
	padding: 14px 10px;
	cursor: pointer;
	transition: opacity 0.3s, transform 0.3s, box-shadow 0.3s;
	outline: none;
}
.focus-card.is-blurred {
	opacity: 0.22;
	transform: scale(0.96);
}
.focus-card.is-focused {
	box-shadow: 0 0 0 2px var(--color), 0 4px 20px color-mix(in srgb, var(--color) 30%, transparent);
	transform: scale(1.03);
}
.fc-accent-bar {
	position: absolute;
	top: 0; left: 0; right: 0;
	height: 3px;
	background: var(--color);
	border-radius: 14px 14px 0 0;
}
.fc-body   { padding-top: 4px; }
.fc-value  { font-size: 1.1rem; font-weight: 700; }
.fc-label  { font-size: 0.72rem; color: var(--text-secondary); margin-top: 2px; }
.fc-sub    { font-size: 0.68rem; color: var(--text-tertiary); }
.fc-glow {
	position: absolute;
	inset: 0;
	background: radial-gradient(circle at 50% 110%, color-mix(in srgb, var(--color) 20%, transparent) 0%, transparent 70%);
	pointer-events: none;
}

/* ── Markers ────────────────────────────────────────────────────── */
.markers-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
	gap: 16px;
}
.marker-card {
	background: var(--bg-card);
	border: 1px solid var(--border-subtle);
	border-radius: 16px;
	padding: 20px;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 12px;
}
.marker-card h3 {
	font-size: 0.85rem;
	font-weight: 600;
	margin: 0;
	align-self: flex-start;
}
.ring-svg { width: 110px; height: 110px; }

.bar-row { width: 100%; display: flex; flex-direction: column; gap: 4px; }
.bar-meta { display: flex; justify-content: space-between; font-size: 0.75rem; }
.bar-label { color: var(--text-secondary); }
.bar-val   { font-weight: 600; }
.bar-track {
	height: 6px;
	background: var(--bg-secondary);
	border-radius: 4px;
	overflow: hidden;
}
.bar-fill {
	height: 100%;
	border-radius: 4px;
	transition: width 0.05s linear;
}

.streak-row   { display: flex; gap: 8px; }
.streak-dot {
	width: 34px; height: 34px;
	border-radius: 50%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.8rem;
	border: 2px solid var(--border-color);
	color: var(--text-tertiary);
	transition: background 0.2s, border-color 0.2s;
}
.streak-dot.streak-done {
	background: #22c55e;
	border-color: #22c55e;
	color: #fff;
	font-weight: 700;
}
.streak-label { font-size: 0.75rem; color: var(--text-secondary); }

.small-btn {
	padding: 6px 14px;
	border-radius: 8px;
	border: 1px solid var(--border-color);
	background: var(--bg-secondary);
	color: var(--text-secondary);
	font-size: 0.75rem;
	cursor: pointer;
	margin-top: 4px;
}

/* ── Haptic feedback ────────────────────────────────────────────── */
.haptic-row { margin-bottom: 28px; }
.haptic-row h3 { font-size: 0.9rem; font-weight: 600; margin: 0 0 12px; }

/* Ripple */
.ripple-area {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 90px;
	background: var(--bg-card);
	border-radius: 14px;
	border: 1px solid var(--border-subtle);
	cursor: pointer;
}
.ripple-btn {
	pointer-events: none;
	padding: 10px 24px;
	border-radius: 10px;
	background: var(--accent-primary);
	color: #fff;
	font-size: 0.9rem;
	font-weight: 600;
	border: none;
}
@keyframes ripple-expand {
	0%   { width: 0;     height: 0;     opacity: 0.6; }
	100% { width: 180px; height: 180px; opacity: 0; }
}
.ripple {
	position: absolute;
	border-radius: 50%;
	background: rgba(102, 126, 234, 0.35);
	transform: translate(-50%, -50%);
	pointer-events: none;
	animation: ripple-expand 0.65s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
}

/* Explosion */
.explosion-area {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	padding: 16px;
	background: var(--bg-card);
	border-radius: 14px;
	border: 1px solid var(--border-subtle);
	min-height: 80px;
}
.explosion-btn {
	padding: 8px 16px;
	border-radius: 10px;
	border: 1.5px solid hsl(var(--hue, 210), 55%, 55%);
	background: hsla(var(--hue, 210), 55%, 55%, 0.1);
	color: hsl(var(--hue, 210), 55%, 65%);
	font-size: 0.82rem;
	cursor: pointer;
	transition: background 0.12s;
}
.explosion-btn:hover { background: hsla(var(--hue, 210), 55%, 55%, 0.2); }

@keyframes exp-ring {
	0%   { width: 0;     height: 0;     opacity: 0.8; }
	100% { width: 140px; height: 140px; opacity: 0; }
}
.explosion-ring {
	position: absolute;
	border-radius: 50%;
	border: 2px solid;
	transform: translate(-50%, -50%);
	pointer-events: none;
}
.e1 { animation: exp-ring 0.7s cubic-bezier(0.2, 0.8, 0.4, 1) forwards; }
.e2 { animation: exp-ring 0.9s cubic-bezier(0.2, 0.8, 0.4, 1) 80ms forwards; opacity: 0.5; }

@keyframes exp-particle {
	0%   { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(0); opacity: 1; }
	100% { transform: translate(-50%, -50%) rotate(var(--angle)) translateX(50px); opacity: 0; }
}
.explosion-particle {
	position: absolute;
	width: 5px;
	height: 5px;
	border-radius: 50%;
	transform: translate(-50%, -50%);
	pointer-events: none;
	animation: exp-particle 0.7s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
}

/* Bounce */
.bounce-row {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
}
@keyframes bounce-confirm {
	0%   { transform: scale(1); }
	30%  { transform: scale(0.88); }
	65%  { transform: scale(1.14); }
	85%  { transform: scale(0.96); }
	100% { transform: scale(1); }
}
.bounce-btn {
	padding: 10px 20px;
	border-radius: 10px;
	border: 1.5px solid hsl(var(--hue, 210), 55%, 55%);
	background: hsla(var(--hue, 210), 55%, 55%, 0.1);
	color: hsl(var(--hue, 210), 55%, 65%);
	font-size: 0.85rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.12s;
}
.bounce-btn:active {
	animation: bounce-confirm 0.42s cubic-bezier(0.3, 0.8, 0.4, 1);
}
</style>
