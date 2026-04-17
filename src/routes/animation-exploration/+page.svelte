<script lang="ts">
	import { fly, fade, scale } from 'svelte/transition';
	import { tweened, spring } from 'svelte/motion';
	import { cubicOut, quintOut, elasticOut } from 'svelte/easing';

	// ── Screen navigation ────────────────────────────────────────────────────
	type Screen = 'home' | 'theme' | 'chat';
	const screenOrder: Screen[] = ['home', 'theme', 'chat'];
	let screen = $state<Screen>('home');
	let screenKey = $state(0);
	let dir = $state<1 | -1>(1);

	function navigate(to: Screen) {
		const from = screenOrder.indexOf(screen);
		const toIdx = screenOrder.indexOf(to);
		dir = toIdx >= from ? 1 : -1;
		screen = to;
		screenKey++;
		triggerNavWave();
	}

	// ── Global motion state ──────────────────────────────────────────────────
	const globalHue = tweened(160, { duration: 800, easing: cubicOut });
	const breathIntensity = spring(1, { stiffness: 0.05, damping: 0.4 });
	let navWave = $state(0);

	// ── Ambient breath (rAF) ─────────────────────────────────────────────────
	let breathPhase = $state(0);
	let rafId = 0;
	let globalHueValue = $state(160);
	let breathIntensityValue = $state(1);

	function tick() {
		breathPhase += 0.008 * breathIntensityValue;
		navWave = Math.max(0, navWave - 0.05);
		rafId = requestAnimationFrame(tick);
	}

	function triggerNavWave() {
		navWave = 1;
		breathIntensity.set(1.5);
		setTimeout(() => breathIntensity.set(1), 800);
	}

	// ── Float particles ───────────────────────────────────────────────────────
	interface FloatParticle { 
		x: number; 
		baseY: number; 
		speed: number; 
		phase: number; 
		size: number; 
		opacity: number;
		reactivity: number; // How much particle reacts to global state
	}
	const floatParticles: FloatParticle[] = Array.from({ length: 24 }, (_, i) => ({
		x: (i / 24) * 100 + Math.random() * 5,
		baseY: 10 + Math.random() * 80,
		speed: 0.3 + Math.random() * 0.7,
		phase: Math.random() * Math.PI * 2,
		size: 2 + Math.random() * 6,
		opacity: 0.06 + Math.random() * 0.14,
		reactivity: 0.5 + Math.random() * 0.5,
	}));

	// ── Widget pulse ─────────────────────────────────────────────────────────
	interface Widget { id: string; label: string; value: string; icon: string; hue: number; }
	const widgets: Widget[] = [
		{ id: 'steps',   label: 'Skritt',    value: '7 840',      icon: '👣', hue: 200 },
		{ id: 'sleep',   label: 'Søvn',      value: '7t 12m',     icon: '🌙', hue: 260 },
		{ id: 'spend',   label: 'Forbruk',   value: '2 340 kr',   icon: '💳', hue: 30  },
		{ id: 'focus',   label: 'Fokus',     value: '3 sesjoner', icon: '🎯', hue: 140 },
	];
	let widgetPulse = $state<Record<string, number>>({});

	function pulseWidget(w: Widget) {
		widgetPulse = { ...widgetPulse, [w.id]: Date.now() };
		// Trigger ambient reaction
		breathIntensity.set(1.3);
		setTimeout(() => breathIntensity.set(1), 400);
		setTimeout(() => {
			widgetPulse = Object.fromEntries(Object.entries(widgetPulse).filter(([k]) => k !== w.id));
		}, 600);
	}

	// ── Goal circles ─────────────────────────────────────────────────────────
	interface Goal {
		id: string; label: string; hue: number; emoji: string;
		value: string; unit: string; progress: number; // 0–1
		// Sparkline data: last 7 days, normalised 0–1
		series: number[];
		seriesLabels: string[];
	}
	const goals: Goal[] = [
		{
			id: 'skritt', label: 'Skritt', hue: 160, emoji: '👣',
			value: '7 840', unit: '/ 10 000', progress: 0.784,
			series: [0.62, 0.91, 0.55, 0.78, 0.84, 0.70, 0.784],
			seriesLabels: ['man','tir','ons','tor','fre','lør','søn'],
		},
		{
			id: 'sovn', label: 'Søvn', hue: 260, emoji: '🌙',
			value: '7t 12m', unit: '/ 8t', progress: 0.90,
			series: [0.82, 0.75, 0.95, 0.88, 0.70, 0.92, 0.90],
			seriesLabels: ['man','tir','ons','tor','fre','lør','søn'],
		},
		{
			id: 'kalorier', label: 'Kalorier', hue: 30, emoji: '🥗',
			value: '1 820', unit: '/ 2 000 kcal', progress: 0.91,
			series: [0.95, 0.88, 0.72, 0.91, 0.85, 0.60, 0.91],
			seriesLabels: ['man','tir','ons','tor','fre','lør','søn'],
		},
		{
			id: 'fokus', label: 'Fokus', hue: 220, emoji: '🎯',
			value: '3 sesjoner', unit: '/ 4', progress: 0.75,
			series: [0.50, 1.0, 0.75, 0.25, 1.0, 0.50, 0.75],
			seriesLabels: ['man','tir','ons','tor','fre','lør','søn'],
		},
	];

	// ── Goal detail morph ─────────────────────────────────────────────────────
	interface GoalDetail {
		goal: Goal;
		// origin in phone-shell coords (center of the goal circle button)
		ox: number; oy: number;
	}
	let goalDetail = $state<GoalDetail | null>(null);
	let detailVisible = $state(false);

	let phoneShellRef: HTMLDivElement;
	let morphPathEl = $state<SVGPathElement | null>(null);
	let areaPathEl = $state<SVGPathElement | null>(null);

	// ── Path generation ───────────────────────────────────────────────────────
	//
	// Graph occupies the middle section of the 340×680 phone SVG
	// x: 20..320 (width 280), y: 180..500 (height 320)
	const GP = { x0: 20, x1: 320, y0: 180, y1: 500 };

	// Sample the graph curve at N evenly-spaced t values.
	// The series array has 7 values; we interpolate within that for smooth paths.
	function graphPoints(series: number[], N: number): [number, number][] {
		const pts: [number, number][] = [];
		for (let i = 0; i < N; i++) {
			const t = i / (N - 1);
			const seg = t * (series.length - 1);
			const lo = Math.floor(seg);
			const hi = Math.min(lo + 1, series.length - 1);
			const frac = seg - lo;
			const v = series[lo] + (series[hi] - series[lo]) * frac;
			const x = GP.x0 + t * (GP.x1 - GP.x0);
			const y = GP.y1 - v * (GP.y1 - GP.y0);
			pts.push([x, y]);
		}
		return pts;
	}

	// Sample a circle (center, radius) at N evenly-spaced angles.
	// Start at the same place as the ring's 12-o'clock (angle = -pi/2).
	function circlePoints(cx: number, cy: number, r: number, N: number): [number, number][] {
		const pts: [number, number][] = [];
		for (let i = 0; i < N; i++) {
			const angle = -Math.PI / 2 + (i / (N - 1)) * 2 * Math.PI;
			pts.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
		}
		return pts;
	}

	// Convert a list of [x,y] points into an SVG polyline d-string.
	// The last point is forced to close back to the first for smooth WAAPI morph.
	function pointsToD(pts: [number, number][], close = false): string {
		const parts = pts.map(([x, y], i) =>
			`${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
		);
		return parts.join(' ') + (close ? ' Z' : '');
	}

	// The area fill path: graph line + vertical closes to bottom
	function areaD(series: number[], N: number): string {
		const pts = graphPoints(series, N);
		const last = pts[pts.length - 1];
		const first = pts[0];
		return pointsToD(pts) +
			` L${last[0].toFixed(2)},${GP.y1.toFixed(2)}` +
			` L${first[0].toFixed(2)},${GP.y1.toFixed(2)} Z`;
	}

	function areaCircleD(cx: number, cy: number, r: number, N: number): string {
		const pts = circlePoints(cx, cy, r, N);
		const last = pts[pts.length - 1];
		const first = pts[0];
		return pointsToD(pts) +
			` L${last[0].toFixed(2)},${GP.y1.toFixed(2)}` +
			` L${first[0].toFixed(2)},${GP.y1.toFixed(2)} Z`;
	}

	// N evenly-spaced points along a horizontal line across the graph x-range at height y.
	function linePoints(y: number, N: number): [number, number][] {
		const pts: [number, number][] = [];
		for (let i = 0; i < N; i++) {
			const t = i / (N - 1);
			pts.push([GP.x0 + t * (GP.x1 - GP.x0), y]);
		}
		return pts;
	}

	// Flat area path: horizontal top edge + close down to baseline.
	function flatAreaD(y: number, N: number): string {
		const pts = linePoints(y, N);
		const last = pts[pts.length - 1];
		const first = pts[0];
		return pointsToD(pts) +
			` L${last[0].toFixed(2)},${GP.y1.toFixed(2)}` +
			` L${first[0].toFixed(2)},${GP.y1.toFixed(2)} Z`;
	}

	const MORPH_N = 60; // number of points — higher = smoother curve

	function openGoalDetail(goal: Goal, event: MouseEvent) {
		if (!phoneShellRef) return;
		const rect = phoneShellRef.getBoundingClientRect();
		const el = event.currentTarget as HTMLElement;
		const elR = el.getBoundingClientRect();
		const ox = elR.left - rect.left + elR.width / 2;
		const oy = elR.top  - rect.top  + elR.height / 2;

		globalHue.set(goal.hue);
		breathIntensity.set(1.6);
		setTimeout(() => breathIntensity.set(1), 500);

		goalDetail = { goal, ox, oy };

		// Give Svelte one tick to mount the SVG elements, then fire WAAPI
		requestAnimationFrame(() => requestAnimationFrame(() => {
			detailVisible = true;
			if (!morphPathEl || !areaPathEl) return;

			// Ring center in the coordinate space of the morph-svg
			// The morph-svg is absolutely positioned inset:0 in phone-shell.
			// ox/oy are already phone-shell-relative.
			const r = 28;  // visual ring radius (matches .goal-ring-svg r=27 scaled to 64px → ≈28px)

			const fromLine = pointsToD(circlePoints(ox, oy, r, MORPH_N));
			const toLine   = pointsToD(graphPoints(goal.series, MORPH_N));
			const fromArea = areaCircleD(ox, oy, r, MORPH_N);
			const toArea   = areaD(goal.series, MORPH_N);

			// Intermediate: flat horizontal line at the data's mean y-value.
			const meanV  = goal.series.reduce((a, b) => a + b) / goal.series.length;
			const lineY  = GP.y1 - meanV * (GP.y1 - GP.y0);
			const midLine = pointsToD(linePoints(lineY, MORPH_N));
			const midArea = flatAreaD(lineY, MORPH_N);

			// Set initial d so paths are visible before animation starts.
			// WAAPI animates the CSS `d` property which requires path('...') syntax.
			morphPathEl.setAttribute('d', fromLine);
			areaPathEl.setAttribute('d', fromArea);

			// 3-stage morph: circle (0) → flat line (offset 0.4) → graph (1)
			morphPathEl.animate(
				[
					{ d: `path('${fromLine}')`, offset: 0,    easing: 'cubic-bezier(0.4,0,0.6,1)' },
					{ d: `path('${midLine}')`,  offset: 0.42, easing: 'cubic-bezier(0.2,0,0.2,1)' },
					{ d: `path('${toLine}')`,   offset: 1 },
				],
				{ duration: 960, fill: 'forwards' }
			);
			areaPathEl.animate(
				[
					{ d: `path('${fromArea}')`, offset: 0,    easing: 'cubic-bezier(0.4,0,0.6,1)' },
					{ d: `path('${midArea}')`,  offset: 0.42, easing: 'cubic-bezier(0.2,0,0.2,1)' },
					{ d: `path('${toArea}')`,   offset: 1 },
				],
				{ duration: 960, fill: 'forwards' }
			);
		}));
	}

	function closeGoalDetail() {
		// Reverse-animate back to the ring
		if (morphPathEl && areaPathEl && goalDetail) {
			const g = goalDetail.goal;
			const { ox, oy } = goalDetail;
			const r = 28;
			const fromLine = pointsToD(graphPoints(g.series, MORPH_N));
			const toLine   = pointsToD(circlePoints(ox, oy, r, MORPH_N));
			const fromArea = areaD(g.series, MORPH_N);
			const toArea   = areaCircleD(ox, oy, r, MORPH_N);

			const meanV  = g.series.reduce((a, b) => a + b) / g.series.length;
			const lineY  = GP.y1 - meanV * (GP.y1 - GP.y0);
			const midLine = pointsToD(linePoints(lineY, MORPH_N));
			const midArea = flatAreaD(lineY, MORPH_N);

			// Reverse 3-stage: graph → flat line → circle
			morphPathEl.animate(
				[
					{ d: `path('${fromLine}')`, offset: 0,    easing: 'cubic-bezier(0.4,0,0.6,1)' },
					{ d: `path('${midLine}')`,  offset: 0.5,  easing: 'cubic-bezier(0.2,0,0.4,1)' },
					{ d: `path('${toLine}')`,   offset: 1 },
				],
				{ duration: 580, fill: 'forwards' }
			);
			areaPathEl.animate(
				[
					{ d: `path('${fromArea}')`, offset: 0,    easing: 'cubic-bezier(0.4,0,0.6,1)' },
					{ d: `path('${midArea}')`,  offset: 0.5,  easing: 'cubic-bezier(0.2,0,0.4,1)' },
					{ d: `path('${toArea}')`,   offset: 1 },
				],
				{ duration: 580, fill: 'forwards' }
			);
			setTimeout(() => {
				detailVisible = false;
				goalDetail = null;
			}, 600);
		} else {
			detailVisible = false;
			goalDetail = null;
		}
	}

	// ── Theme options ────────────────────────────────────────────────────────
	interface Theme { id: string; label: string; hue: number; emoji: string; }
	let activeTheme = $state<Theme>({ id: 'helse', label: 'Helse', hue: 160, emoji: '💚' });
	const themes: Theme[] = [
		{ id: 'helse',    label: 'Helse',    hue: 160, emoji: '💚' },
		{ id: 'okonomi',  label: 'Økonomi',  hue: 42,  emoji: '💛' },
		{ id: 'trening',  label: 'Trening',  hue: 220, emoji: '💙' },
		{ id: 'mindset',  label: 'Mindset',  hue: 300, emoji: '💜' },
	];

	// ── Flood expand ─────────────────────────────────────────────────────────
	interface Flood { id: number; hue: number; cx: number; cy: number; r: number; }
	let flood = $state<Flood | null>(null);

	// ── Flying label ─────────────────────────────────────────────────────────
	interface FlyingLabel { hue: number; emoji: string; label: string; cx: number; cy: number; }
	let flyingLabel = $state<FlyingLabel | null>(null);
	let flyingActive = $state(false);

	function clickTheme(theme: Theme, event: MouseEvent) {
		if (!phoneShellRef) return;
		const rect = phoneShellRef.getBoundingClientRect();
		const cx = event.clientX - rect.left;
		const cy = event.clientY - rect.top;

		// Flood explosion from click position — fills screen before navigate
		flood = { id: Date.now(), hue: theme.hue, cx, cy, r: 20 };

		// Flying label: start at button, fly up to theme-hero
		flyingLabel = { hue: theme.hue, emoji: theme.emoji, label: theme.label, cx, cy };
		flyingActive = false;
		requestAnimationFrame(() => requestAnimationFrame(() => { flyingActive = true; }));

		globalHue.set(theme.hue);
		activeTheme = theme;
		breathIntensity.set(1.8);
		setTimeout(() => breathIntensity.set(1), 800);

		// Navigate while flood still covers screen (600ms), then fade flood to reveal new screen
		setTimeout(() => { navigate('theme'); }, 600);
		setTimeout(() => { flood = null; flyingLabel = null; flyingActive = false; }, 660);
	}

	// ── Theme screen tweened data (kept for chat nav) ───────────────────────
	const ringStore = tweened(0, { duration: 1400, easing: cubicOut });
	const bar0 = tweened(0, { duration: 1100, easing: quintOut });
	const bar1 = tweened(0, { duration: 1300, easing: quintOut });
	const bar2 = tweened(0, { duration: 1000, easing: quintOut });

	let bar0actual = $state(0);
	let bar1actual = $state(0);
	let bar2actual = $state(0);
	let ringActual = $state(0);

	function startThemeData() {
		ringStore.set(0.73); bar0.set(0.65); bar1.set(0.82); bar2.set(0.48);
	}

	// ── Chat simulation ───────────────────────────────────────────────────────
	interface ChatMsg { id: number; role: 'user' | 'ai'; text: string; }
	const chatScript: { role: 'user' | 'ai'; text: string; delay: number }[] = [
		{ role: 'user', text: 'Hvordan går det med helsemålene mine?', delay: 400 },
		{ role: 'ai',   text: 'Du har trent 4 av 5 dager denne uken — imponerende! 💪', delay: 1200 },
		{ role: 'user', text: 'Hva med søvnen?', delay: 700 },
		{ role: 'ai',   text: 'Snittsøvn er 7t 12m. Du er innenfor målet på 7 timer.', delay: 1100 },
		{ role: 'ai',   text: 'Vil du se detaljert analyse for i dag?', delay: 600 },
	];
	let chatVisible = $state<ChatMsg[]>([]);
	let chatTyping = $state(false);
	let chatInput = $state('');

	async function runChatScript() {
		chatVisible = [];
		let id = 0;
		for (const msg of chatScript) {
			await new Promise(r => setTimeout(r, msg.delay));
			if (msg.role === 'ai') {
				chatTyping = true;
				await new Promise(r => setTimeout(r, 700));
				chatTyping = false;
			}
			chatVisible = [...chatVisible, { id: id++, role: msg.role, text: msg.text }];
		}
	}

	// ── Lifecycle ─────────────────────────────────────────────────────────────
	$effect(() => {
		rafId = requestAnimationFrame(tick);

		const pulseInterval = setInterval(() => {
			const w = widgets[Math.floor(Math.random() * widgets.length)];
			pulseWidget(w);
		}, 1800);

		const ringUnsub = ringStore.subscribe(v => { ringActual = v; });
		const bar0Unsub = bar0.subscribe(v => { bar0actual = v; });
		const bar1Unsub = bar1.subscribe(v => { bar1actual = v; });
		const bar2Unsub = bar2.subscribe(v => { bar2actual = v; });
		const hueUnsub = globalHue.subscribe(v => { globalHueValue = v; });
		const breathUnsub = breathIntensity.subscribe(v => { breathIntensityValue = v; });

		return () => {
			cancelAnimationFrame(rafId);
			clearInterval(pulseInterval);
			ringUnsub(); bar0Unsub(); bar1Unsub(); bar2Unsub();
			hueUnsub(); breathUnsub();
		};
	});

	$effect(() => {
		if (screen === 'theme') startThemeData();
		if (screen === 'chat') runChatScript();
	});

	// ── Ambient position helpers ──────────────────────────────────────────────
	function orbX(i: number) { 
		return 30 + i * 20 + Math.sin(breathPhase + i * 2.1) * 18 * breathIntensityValue + navWave * 8;
	}
	function orbY(i: number) { 
		return 25 + i * 12 + Math.cos(breathPhase * 0.7 + i * 1.4) * 14 * breathIntensityValue - navWave * 6;
	}
	function partY(p: FloatParticle) { 
		return p.baseY + Math.sin(breathPhase * p.speed + p.phase) * 4 * breathIntensityValue * p.reactivity + navWave * 10 * p.reactivity;
	}
	function partX(p: FloatParticle) {
		return p.x + Math.cos(breathPhase * p.speed * 0.5 + p.phase) * 2 * p.reactivity;
	}
	function partOpacity(p: FloatParticle) {
		return p.opacity * (0.8 + breathIntensityValue * 0.4);
	}
</script>

<svelte:head>
	<title>Animation Exploration</title>
</svelte:head>

<div class="page-wrap">

	<div class="phone-shell" style="--hue:{globalHueValue}" bind:this={phoneShellRef}>

		{#if flood}
			<div
				class="tema-flood"
				style="--fhue:{flood.hue};left:{flood.cx}px;top:{flood.cy}px;--fr:{flood.r}px"
				out:fade={{ duration: 320 }}
			></div>
		{/if}

		{#if flyingLabel}
			<div
				class="flying-label"
				class:active={flyingActive}
				style="--lx:{flyingLabel.cx}px;--ly:{flyingLabel.cy}px;--lhue:{flyingLabel.hue}"
				out:fade={{ duration: 160 }}
			>
				<span class="fl-emoji">{flyingLabel.emoji}</span>
				<span class="fl-text">{flyingLabel.label}</span>
			</div>
		{/if}

		<!-- Goal morph: the ring SVG-path deforms into the graph curve -->
		{#if goalDetail}
			{@const g = goalDetail.goal}
			<div
				class="goal-morph-overlay"
				class:visible={detailVisible}
				style="--ghue:{g.hue}"
			>
				<!-- Full-screen SVG: ring morphs into graph curve in this coordinate space -->
				<svg class="morph-svg" viewBox="0 0 340 680" preserveAspectRatio="none">
					<defs>
						<linearGradient id="morph-area-grad" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0%" stop-color="hsl({g.hue} 70% 60%)" stop-opacity="0.22"/>
							<stop offset="100%" stop-color="hsl({g.hue} 70% 60%)" stop-opacity="0"/>
						</linearGradient>
					</defs>
					<!-- Grid lines: fade in once detailVisible -->
					{#if detailVisible}
						{#each [0.25, 0.5, 0.75] as frac}
							<line
								x1="{GP.x0}" x2="{GP.x1}"
								y1="{GP.y1 - frac * (GP.y1 - GP.y0)}"
								y2="{GP.y1 - frac * (GP.y1 - GP.y0)}"
								stroke="rgba(255,255,255,0.07)" stroke-width="1"
								style="opacity:0;animation:dot-in 0.3s 0.62s forwards"
							/>
						{/each}
					{/if}
					<!-- This path starts as a ring, morphs to area fill -->
					<path
						bind:this={areaPathEl}
						fill="url(#morph-area-grad)"
						stroke="none"
					/>
					<!-- This path starts as a ring stroke, morphs to the graph line -->
					<path
						bind:this={morphPathEl}
						fill="none"
						stroke="hsl({g.hue} 72% 62%)"
						stroke-width="2.5"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
					<!-- Data dots: fade in once morphed -->
					{#if detailVisible}
						{#each graphPoints(g.series, g.series.length) as [px, py], i}
							<circle cx="{px}" cy="{py}" r="4"
								fill="hsl({g.hue} 72% 62%)"
								style="opacity:0;animation:dot-in 0.2s {0.65 + i*0.06}s forwards"
							/>
						{/each}
					{/if}
				</svg>

				<!-- UI chrome: fades in after morph settles -->
				<div class="gmo-chrome" class:visible={detailVisible}>
					<button class="gd-back" onclick={closeGoalDetail}>←</button>
					<div class="gmo-header">
						<span class="gmo-emoji">{g.emoji}</span>
						<div>
							<h2>{g.label}</h2>
							<p class="gd-sub">{g.value} <span class="gd-unit">{g.unit}</span></p>
						</div>
					</div>
					<!-- X-axis labels positioned below graph area -->
					<div class="gmo-xlabels">
						{#each g.seriesLabels as lbl}<span>{lbl}</span>{/each}
					</div>
					<div class="gd-stats">
						<div class="gd-stat">
							<span class="gd-stat-val">{Math.round(g.series.reduce((a,b)=>a+b)/g.series.length*100)}%</span>
							<span class="gd-stat-lbl">snitt</span>
						</div>
						<div class="gd-stat">
							<span class="gd-stat-val">{Math.round(Math.max(...g.series)*100)}%</span>
							<span class="gd-stat-lbl">beste dag</span>
						</div>
						<div class="gd-stat">
							<span class="gd-stat-val">{g.series.filter(v=>v>=0.8).length}/7</span>
							<span class="gd-stat-lbl">over 80%</span>
						</div>
					</div>
				</div>
			</div>
		{/if}

		<div class="ambient-layer" aria-hidden="true">
			{#each [0,1,2] as i}
				<div class="orb orb-{i}"
					style="left:{orbX(i)}%;top:{orbY(i)}%;opacity:{0.18 + i*0.04};filter:blur({40 + navWave * 20}px) saturate({100 + breathIntensityValue * 30}%)"
				></div>
			{/each}
			{#each floatParticles as p}
				<div class="float-p"
					style="left:{partX(p)}%;top:{partY(p)}%;width:{p.size}px;height:{p.size}px;opacity:{partOpacity(p)}"
				></div>
			{/each}
		</div>

		<div class="screen-viewport">
			{#key screenKey}
				<div
					class="screen"
					in:fly={{ x: 60 * dir, duration: 320, easing: cubicOut }}
					out:fly={{ x: -60 * dir, duration: 240, easing: cubicOut }}
				>

					{#if screen === 'home'}
						<div class="s-home">
							<header class="home-header" in:fly={{ y: -20, duration: 500, delay: 60 }}>
								<span class="greeting">God morgen 👋</span>
								<span class="date-chip">Tors 10. apr</span>
							</header>

					<p class="section-label" in:fade={{ delay: 280 }}>Mål</p>
					<div class="goals-grid">
						{#each goals as g, i}
							<button
								class="goal-circle"
								style="--ghue:{g.hue}"
								in:scale={{ duration: 420, delay: 380 + i * 80, start: 0.5, easing: elasticOut }}
								onclick={(e) => openGoalDetail(g, e)}
							>
								<svg viewBox="0 0 60 60" class="goal-ring-svg">
									<circle cx="30" cy="30" r="27" class="gr-bg"/>
									<circle cx="30" cy="30" r="27"
										class="gr-fg"
										stroke-dasharray="{g.progress * 169.6} 169.6"
										stroke-linecap="round"
									/>
								</svg>
								<span class="goal-emoji">{g.emoji}</span>
								<span class="goal-pct">{Math.round(g.progress * 100)}%</span>
								<span class="goal-name">{g.label}</span>
							</button>
						{/each}
					</div>

					<p class="section-label" in:fade={{ delay: 500 }}>Tema</p>
					<div class="tema-pills">
						{#each themes as t, i}
							<button
								class="tema-btn"
								class:active={activeTheme.id === t.id}
								style="--thue:{t.hue}"
								in:fly={{ y: 20, duration: 380, delay: 560 + i * 60, easing: cubicOut }}
								onclick={(e) => clickTheme(t, e)}
							>
								<span class="tb-emoji">{t.emoji}</span>
								<span class="tb-label">{t.label}</span>
							</button>
						{/each}
						</div>

							<div
								class="chat-strip"
								in:fly={{ y: 16, duration: 340, delay: 700, easing: cubicOut }}
								onclick={() => navigate('chat')}
								role="button"
								tabindex="0"
								onkeydown={(e) => e.key === 'Enter' && navigate('chat')}
							>
								<span class="chat-icon">💬</span>
								<span>Spør om helsa di…</span>
							</div>
						</div>

					{:else if screen === 'theme'}
						<div class="s-theme">
							<button class="back-btn" onclick={() => navigate('home')}>← Hjem</button>

							<div class="theme-hero" in:fade={{ duration: 180, delay: 400 }}>
								<span class="hero-emoji">{activeTheme.emoji}</span>
								<h2>{activeTheme.label}</h2>
							</div>

							<div class="ring-wrap" in:scale={{ duration: 600, delay: 460, start: 0.7 }}>
								<svg viewBox="0 0 100 100" class="ring-svg">
									<circle cx="50" cy="50" r="38" class="ring-bg"/>
									<circle
										cx="50" cy="50" r="38"
										class="ring-fg"
										stroke-dasharray="{ringActual * 238.76} 238.76"
										stroke-linecap="round"
									/>
								</svg>
								<div class="ring-label">{Math.round(ringActual * 100)}%</div>
							</div>

							<div class="bars-section" in:fly={{ y: 20, duration: 400, delay: 620 }}>
								{#each [['Trening', bar0actual, 160], ['Søvn', bar1actual, 260], ['Kosthold', bar2actual, 30]] as [label, val, hue]}
									<div class="bar-row">
										<span class="bar-label">{label}</span>
										<div class="bar-track">
											<div class="bar-fill" style="width:{(val as number) * 100}%;background:hsl({hue} 70% 55%)"></div>
										</div>
										<span class="bar-pct">{Math.round((val as number)*100)}%</span>
									</div>
								{/each}
							</div>

							<button class="chat-cta" onclick={() => navigate('chat')} in:fly={{ y: 16, duration: 340, delay: 820 }}>
								Chat om {activeTheme.label.toLowerCase()} →
							</button>
						</div>

					{:else}
						<div class="s-chat">
							<button class="back-btn" onclick={() => navigate('theme')}>← {activeTheme.label}</button>
							<div class="chat-head" in:fly={{ y: -12, duration: 400, delay: 80 }}>
								<span class="ai-avatar">🤖</span>
								<span class="ai-name">Resonans</span>
							</div>
							<div class="chat-messages">
								{#each chatVisible as msg (msg.id)}
									<div
										class="bubble bubble-{msg.role}"
										in:fly={{ x: msg.role === 'user' ? 30 : -30, y: 8, duration: 340, easing: cubicOut }}
									>{msg.text}</div>
								{/each}
								{#if chatTyping}
									<div class="bubble bubble-ai typing" in:fade>
										<span></span><span></span><span></span>
									</div>
								{/if}
							</div>
							<div class="chat-input-row">
								<input
									class="chat-input"
									placeholder="Skriv…"
									bind:value={chatInput}
									onkeydown={(e) => { if (e.key === 'Enter' && chatInput.trim()) {
										chatVisible = [...chatVisible, { id: Date.now(), role: 'user', text: chatInput }];
										chatInput = '';
									}}}
								/>
							</div>
						</div>
					{/if}

				</div>
			{/key}
		</div>

		<div class="nav-dots">
			{#each screenOrder as s}
				<button
					class="nav-dot"
					class:active={screen === s}
					onclick={() => navigate(s)}
					aria-label={s}
				></button>
			{/each}
		</div>
	</div>

	<aside class="sidebar">
		<h3>Teknikker brukt</h3>
		<div class="anno-list">
			<div class="anno">
				<strong>clip-path circle morph</strong>
				<p>Målsirkel ekspanderer via clip-path: circle(0px → 120%) fra klikk-origo — ingen ekstra DOM-elementer, ren CSS-overgang.</p>
			</div>
			<div class="anno">
				<strong>SVG stroke-dashoffset draw</strong>
				<p>Linjegrafens polyline tegnes via stroke-dashoffset 0→0 animasjon — gir illusjonen av at linjen skrives live.</p>
			</div>
			<div class="anno">
				<strong>Global motion state</strong>
				<p>Ambient layer reagerer på all interaksjon — breathIntensity (spring) og navWave synkroniserer orber og partikler.</p>
			</div>
			<div class="anno">
				<strong>Hue morphing</strong>
				<p>tweened() globalHue flyter gjennom hele UI ved målbytte — ambient layer skifter farge i takt.</p>
			</div>
			<div class="anno">
				<strong>Staggered dot reveal</strong>
				<p>Datapunkter på grafen fadder inn med individuelt delay — visuell kaskade som forsterker drawing-effekten.</p>
			</div>
			<div class="anno">
				<strong>elasticOut ring entry</strong>
				<p>Målsirkler bruker elasticOut easing for entry — gir levende, fjærende følelse.</p>
			</div>
		</div>
	</aside>

</div>

<style>
	:global(body) { background: #0a0a0f; }

	.page-wrap {
		display: flex;
		gap: 3rem;
		align-items: flex-start;
		justify-content: center;
		min-height: 100vh;
		padding: 3rem 2rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.phone-shell {
		position: relative;
		width: 340px;
		height: 680px;
		background: #0e0e16;
		border-radius: 40px;
		border: none;
		overflow: hidden;
		box-shadow:
			0 0 0 1px rgba(0,0,0,0.6),
			0 32px 80px rgba(0,0,0,0.7);
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
	}

	.ambient-layer {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 0;
	}
	.orb {
		position: absolute;
		border-radius: 50%;
		background: hsl(var(--hue) 65% 50%);
		transform: translate(-50%, -50%);
		transition: background 0.8s ease-out, filter 0.6s ease-out;
	}
	.orb-0 { width: 200px; height: 200px; }
	.orb-1 { width: 140px; height: 140px; }
	.orb-2 { width: 100px; height: 100px; }

	.float-p {
		position: absolute;
		border-radius: 50%;
		background: white;
		transform: translate(-50%, -50%);
		pointer-events: none;
		transition: opacity 0.3s ease-out;
	}

	.tema-flood {
		position: absolute;
		border-radius: 50%;
		width: calc(var(--fr) * 2);
		height: calc(var(--fr) * 2);
		/* Dark, muted: barely a tint of the theme hue */
		background: hsl(var(--fhue) 38% 11%);
		z-index: 9998;
		pointer-events: none;
		transform: translate(-50%, -50%) scale(1);
		animation: flood-expand 0.65s cubic-bezier(0.2, 0, 0.4, 1) forwards;
	}
	@keyframes flood-expand {
		to { transform: translate(-50%, -50%) scale(80); }
	}

	.flying-label {
		position: absolute;
		left: var(--lx);
		top: var(--ly);
		transform: translate(-50%, -50%);
		z-index: 9999;
		pointer-events: none;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		color: hsl(var(--lhue) 70% 72%);
		font-size: 0.82rem;
		font-weight: 500;
		white-space: nowrap;
		transition:
			left 0.38s cubic-bezier(0.4, 0, 0.2, 1),
			top 0.38s cubic-bezier(0.4, 0, 0.2, 1),
			font-size 0.38s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.flying-label.active {
		/* Destination: center of theme-hero in .s-theme */
		left: 170px;
		top: 68px;
		font-size: 1.4rem;
		font-weight: 700;
	}
	.fl-emoji { font-size: 1.45em; }
	.fl-text { font-size: 1em; }

	.screen-viewport {
		position: relative;
		flex: 1;
		overflow: hidden;
		z-index: 1;
	}
	.screen {
		position: absolute;
		inset: 0;
		overflow-y: auto;
		scrollbar-width: none;
		padding: 1.25rem 1.2rem 0.5rem;
		color: #f0f0f8;
	}
	.screen::-webkit-scrollbar { display: none; }

	.nav-dots {
		display: flex;
		justify-content: center;
		gap: 6px;
		padding: 0.6rem 0 1rem;
		z-index: 2;
	}
	.nav-dot {
		width: 6px; height: 6px;
		border-radius: 50%;
		background: rgba(255,255,255,0.25);
		border: none;
		cursor: pointer;
		padding: 0;
		transition: background 0.25s, transform 0.2s;
	}
	.nav-dot.active {
		background: hsl(var(--hue) 70% 60%);
		transform: scale(1.4);
	}

	.s-home { display: flex; flex-direction: column; gap: 0.85rem; }
	.home-header { display: flex; justify-content: space-between; align-items: center; }
	.greeting { font-size: 1rem; font-weight: 600; }
	.date-chip {
		font-size: 0.72rem;
		background: rgba(255,255,255,0.08);
		border-radius: 20px;
		padding: 3px 10px;
		color: rgba(255,255,255,0.6);
	}

	.tema-pills {
		display: flex;
		gap: 0.55rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.tema-btn {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		background: rgba(255,255,255,0.06);
		border: 1px solid hsl(var(--thue) 40% 30% / 0.4);
		border-radius: 999px;
		padding: 0.42rem 0.9rem;
		color: hsl(var(--thue) 60% 72%);
		font-size: 0.78rem;
		font-weight: 500;
		cursor: pointer;
		position: relative;
		overflow: hidden;
		transition: background 0.2s, border-color 0.2s, transform 0.15s;
	}
	.tema-btn:active { transform: scale(0.94); }
	.tema-btn.active {
		background: hsl(var(--thue) 38% 18%);
		border-color: hsl(var(--thue) 55% 42%);
		color: hsl(var(--thue) 70% 80%);
	}
	.tb-emoji { font-size: 1rem; line-height: 1; }
	.tb-label { letter-spacing: 0.01em; }

	.section-label { font-size: 0.72rem; color: rgba(255,255,255,0.4); margin: 0; letter-spacing: 0.04em; text-transform: uppercase; }

	/* ── Goal circles ─────────────────────────────────────────────────────── */
	.goals-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.7rem;
	}
	.goal-circle {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.2rem;
		background: none;
		border: none;
		padding: 0.4rem 0;
		cursor: pointer;
		color: #f0f0f8;
		transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
	}
	.goal-circle:hover { transform: scale(1.07); }
	.goal-circle:active { transform: scale(0.95); transition-duration: 0.08s; }
	.goal-ring-svg {
		width: 64px; height: 64px;
		transform: rotate(-90deg);
	}
	.gr-bg {
		fill: none;
		stroke: rgba(255,255,255,0.07);
		stroke-width: 5;
	}
	.gr-fg {
		fill: none;
		stroke: hsl(var(--ghue) 70% 58%);
		stroke-width: 5;
		filter: drop-shadow(0 0 4px hsl(var(--ghue) 70% 50%));
		transition: stroke-dasharray 1s cubic-bezier(0.4,0,0.2,1);
	}
	.goal-emoji {
		font-size: 1.1rem;
		margin-top: -2px;
		/* sits visually inside the ring — absolutely positioned */
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, calc(-50% - 10px));
		pointer-events: none;
	}
	.goal-pct {
		font-size: 0.75rem;
		font-weight: 700;
		color: hsl(var(--ghue) 70% 65%);
	}
	.goal-name {
		font-size: 0.68rem;
		color: rgba(255,255,255,0.45);
	}

	/* ── Goal morph overlay ─────────────────────────────────────────────────── */
	.goal-morph-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		background: hsl(var(--ghue) 14% 8%);
		opacity: 0;
		transition: opacity 0.18s;
		pointer-events: none;
	}
	.goal-morph-overlay.visible {
		opacity: 1;
		pointer-events: auto;
	}
	.morph-svg {
		/* Fill the whole phone shell; coordinates match phone dimensions 340×680 */
		position: absolute;
		inset: 0;
		width: 100%; height: 100%;
	}

	/* UI chrome layered on top of the morph SVG */
	.gmo-chrome {
		position: absolute;
		inset: 0;
		padding: 1rem 1.15rem 0.8rem;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		color: #f0f0f8;
		opacity: 0;
		transition: opacity 0.25s 0.55s;
		pointer-events: none;
	}
	.gmo-chrome.visible {
		opacity: 1;
		pointer-events: auto;
	}
	.gd-back {
		background: none;
		border: none;
		color: rgba(255,255,255,0.45);
		cursor: pointer;
		font-size: 0.9rem;
		padding: 0;
		align-self: flex-start;
		transition: color 0.2s;
	}
	.gd-back:hover { color: rgba(255,255,255,0.9); }
	.gmo-header { display: flex; align-items: center; gap: 0.6rem; }
	.gmo-emoji { font-size: 1.5rem; }
	.gmo-header h2 { margin: 0; font-size: 1.1rem; font-weight: 700; color: hsl(var(--ghue) 70% 70%); }
	.gd-sub { margin: 0.1rem 0 0; font-size: 0.78rem; color: rgba(255,255,255,0.5); }
	.gd-unit { color: rgba(255,255,255,0.28); }

	/* X-axis labels: absolute, positioned below graph area (GP.padY=18, GP.h=140, start at 680-gp.padY-gp.h+content offset) */
	.gmo-xlabels {
		position: absolute;
		/* graph bottom = viewport height − (680 − GP.h − GP.padY) but we use flex flow,
		   so approximate: push to ~70% down the panel */
		bottom: 96px;
		left: 18px; right: 18px;
		display: flex;
		justify-content: space-between;
	}
	.gmo-xlabels span { font-size: 0.6rem; color: rgba(255,255,255,0.28); }

	.gd-stats {
		position: absolute;
		bottom: 22px;
		left: 18px; right: 18px;
		display: flex;
		justify-content: space-around;
	}
	.gd-stat { display: flex; flex-direction: column; align-items: center; gap: 0.15rem; }
	.gd-stat-val { font-size: 1.05rem; font-weight: 700; color: hsl(var(--ghue) 70% 65%); }
	.gd-stat-lbl { font-size: 0.62rem; color: rgba(255,255,255,0.32); text-transform: uppercase; letter-spacing: 0.04em; }

	@keyframes dot-in { from { opacity: 0; } to { opacity: 1; } }

	.chat-strip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: rgba(255,255,255,0.04);
		border: none;
		border-radius: 20px;
		padding: 0.6rem 1rem;
		cursor: pointer;
		font-size: 0.82rem;
		color: rgba(255,255,255,0.45);
		transition: background 0.2s;
		margin-bottom: 0.5rem;
	}
	.chat-strip:hover { background: rgba(255,255,255,0.08); }
	.chat-icon { font-size: 1rem; }

	.s-theme { display: flex; flex-direction: column; gap: 0.9rem; align-items: center; }
	.back-btn {
		align-self: flex-start;
		background: none;
		border: none;
		color: rgba(255,255,255,0.5);
		cursor: pointer;
		font-size: 0.82rem;
		padding: 0;
		transition: color 0.2s;
	}
	.back-btn:hover { color: rgba(255,255,255,0.9); }

	.theme-hero { display: flex; align-items: center; gap: 0.6rem; }
	.hero-emoji { font-size: 2rem; }
	.theme-hero h2 { margin: 0; font-size: 1.4rem; color: hsl(var(--hue) 70% 70%); font-weight: 700; }

	.ring-wrap {
		position: relative;
		width: 120px; height: 120px;
	}
	.ring-svg { width: 100%; height: 100%; transform: rotate(-90deg); }
	.ring-bg { fill: none; stroke: rgba(255,255,255,0.08); stroke-width: 8; }
	.ring-fg {
		fill: none;
		stroke: hsl(var(--hue) 70% 55%);
		stroke-width: 8;
		filter: drop-shadow(0 0 6px hsl(var(--hue) 70% 55%));
	}
	.ring-label {
		position: absolute; inset: 0;
		display: flex; align-items: center; justify-content: center;
		font-size: 1.3rem; font-weight: 700;
		color: hsl(var(--hue) 70% 70%);
	}

	.bars-section { width: 100%; display: flex; flex-direction: column; gap: 0.6rem; }
	.bar-row { display: flex; align-items: center; gap: 0.5rem; }
	.bar-label { font-size: 0.75rem; width: 62px; color: rgba(255,255,255,0.6); }
	.bar-track { flex: 1; height: 6px; background: rgba(255,255,255,0.08); border-radius: 3px; overflow: hidden; }
	.bar-fill { height: 100%; border-radius: 3px; }
	.bar-pct { font-size: 0.7rem; width: 30px; text-align: right; color: rgba(255,255,255,0.5); }

	.chat-cta {
		width: 100%;
		padding: 0.7rem;
		background: hsl(var(--hue) 62% 38%);
		border: none;
		border-radius: 14px;
		color: #fff;
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s, transform 0.15s;
	}
	.chat-cta:hover { background: hsl(var(--hue) 62% 44%); transform: translateY(-1px); }

	.s-chat { display: flex; flex-direction: column; height: 100%; gap: 0.5rem; }
	.chat-head { display: flex; align-items: center; gap: 0.5rem; }
	.ai-avatar { font-size: 1.4rem; }
	.ai-name { font-weight: 600; font-size: 0.9rem; }
	.chat-messages {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-bottom: 0.5rem;
		scrollbar-width: none;
	}
	.chat-messages::-webkit-scrollbar { display: none; }

	.bubble {
		max-width: 80%;
		padding: 0.55rem 0.85rem;
		border-radius: 16px;
		font-size: 0.82rem;
		line-height: 1.45;
	}
	.bubble-user {
		align-self: flex-end;
		background: hsl(var(--hue) 55% 40% / 0.5);
		border: none;
		color: hsl(var(--hue) 80% 88%);
	}
	.bubble-ai {
		align-self: flex-start;
		background: rgba(255,255,255,0.07);
		border: none;
		color: rgba(255,255,255,0.88);
	}
	.bubble.typing {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 0.65rem 0.9rem;
	}
	.bubble.typing span {
		width: 6px; height: 6px;
		border-radius: 50%;
		background: rgba(255,255,255,0.5);
		animation: bounce 1s infinite;
	}
	.bubble.typing span:nth-child(2) { animation-delay: 0.15s; }
	.bubble.typing span:nth-child(3) { animation-delay: 0.3s; }
	@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-5px)} }

	.chat-input-row { padding-bottom: 0.2rem; }
	.chat-input {
		width: 100%;
		background: rgba(255,255,255,0.06);
		border: 1px solid rgba(255,255,255,0.1);
		border-radius: 20px;
		padding: 0.55rem 1rem;
		color: #f0f0f8;
		font-size: 0.82rem;
		outline: none;
		box-sizing: border-box;
		transition: border-color 0.2s;
	}
	.chat-input:focus { border-color: hsl(var(--hue) 60% 55% / 0.6); }

	.sidebar {
		width: 260px;
		flex-shrink: 0;
		color: rgba(255,255,255,0.7);
	}
	.sidebar h3 {
		font-size: 0.78rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: rgba(255,255,255,0.3);
		margin: 0 0 1.2rem;
		font-weight: 500;
	}
	.anno-list { display: flex; flex-direction: column; gap: 1rem; }
	.anno {
		border-left: 2px solid hsl(var(--hue, 160) 60% 50% / 0.35);
		padding-left: 0.85rem;
	}
	.anno strong { font-size: 0.8rem; color: rgba(255,255,255,0.85); display: block; margin-bottom: 0.25rem; }
	.anno p { font-size: 0.73rem; margin: 0; line-height: 1.5; color: rgba(255,255,255,0.45); }

	@media (max-width: 720px) {
		.page-wrap { flex-direction: column; align-items: center; padding: 1.5rem 1rem; }
		.sidebar { width: 100%; max-width: 340px; }
	}
</style>
