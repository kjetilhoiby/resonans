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
	let interactionRipples = $state<{ id: number; x: number; y: number; hue: number }[]>([]);
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

	// ── Theme options ─────────────────────────────────────────────────────────
	interface Theme { id: string; label: string; hue: number; emoji: string; }
	const themes: Theme[] = [
		{ id: 'helse',   label: 'Helse',   hue: 160, emoji: '💚' },
		{ id: 'okonomi', label: 'Økonomi', hue: 45,  emoji: '💛' },
		{ id: 'fokus',   label: 'Fokus',   hue: 220, emoji: '💙' },
		{ id: 'energi',  label: 'Energi',  hue: 350, emoji: '❤️' },
	];
	let activeTheme = $state<Theme>(themes[0]);

	// ── Burst overlay ─────────────────────────────────────────────────────────
	interface Burst { id: number; hue: number; x: number; y: number; }
	let bursts = $state<Burst[]>([]);
	let phoneShellRef: HTMLDivElement;

	function triggerBurst(theme: Theme, event?: MouseEvent | PointerEvent) {
		let x = 50;
		let y = 50;
		
		if (event && phoneShellRef) {
			const rect = phoneShellRef.getBoundingClientRect();
			x = ((event as MouseEvent).clientX - rect.left) / rect.width * 100;
			y = ((event as MouseEvent).clientY - rect.top) / rect.height * 100;
		}
		
		const b: Burst = {
			id: Date.now(),
			hue: theme.hue,
			x,
			y,
		};
		bursts = [...bursts, b];
		activeTheme = theme;
		
		// Global hue transition
		globalHue.set(theme.hue);
		
		// Interaction ripple
		const ripple = { id: Date.now(), x: b.x, y: b.y, hue: theme.hue };
		interactionRipples = [...interactionRipples, ripple];
		setTimeout(() => {
			interactionRipples = interactionRipples.filter(r => r.id !== ripple.id);
		}, 1200);
		
		// Breath surge
		breathIntensity.set(2);
		setTimeout(() => breathIntensity.set(1), 600);
		
		setTimeout(() => { bursts = bursts.filter(x => x.id !== b.id); }, 700);
		setTimeout(() => navigate('theme'), 300);
	}

	// ── Theme screen tweened data ─────────────────────────────────────────────
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

		{#each interactionRipples as r (r.id)}
			<div
				class="ripple-overlay"
				style="--rx:{r.x}%;--ry:{r.y}%;--rhue:{r.hue}"
				in:scale={{ duration: 1200, start: 0, easing: cubicOut }}
				out:fade={{ duration: 100 }}
			></div>
		{/each}

		{#each bursts as b (b.id)}
			<div
				class="burst-overlay"
				style="--bx:{b.x}%;--by:{b.y}%;--bhue:{b.hue}"
				in:scale={{ duration: 600, start: 0 }}
				out:fade={{ duration: 200 }}
			></div>
		{/each}

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

							<div class="widgets-grid">
								{#each widgets as w, i}
									<div
										class="widget-card"
										class:pulsing={widgetPulse[w.id]}
										style="--whue:{w.hue};animation-delay:{i*80}ms"
										in:fly={{ y: 28, duration: 420, delay: 120 + i * 80, easing: cubicOut }}
									>
										<span class="w-icon">{w.icon}</span>
										<span class="w-val">{w.value}</span>
										<span class="w-label">{w.label}</span>
									</div>
								{/each}
							</div>

							<p class="section-label" in:fade={{ delay: 500 }}>Utforsk tema</p>
							<div class="tema-grid">
								{#each themes as t, i}
									<button
										class="tema-btn"
										style="--thue:{t.hue};animation-delay:{i*60}ms"
										in:fly={{ y: 20, duration: 380, delay: 400 + i * 70, easing: cubicOut }}
										onclick={(e) => triggerBurst(t, e)}
									>
										<span class="t-emoji">{t.emoji}</span>
										<span class="t-label">{t.label}</span>
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

							<div class="theme-hero" in:fly={{ y: -16, duration: 500, delay: 80 }}>
								<span class="hero-emoji">{activeTheme.emoji}</span>
								<h2>{activeTheme.label}</h2>
							</div>

							<div class="ring-wrap" in:scale={{ duration: 600, delay: 200, start: 0.7 }}>
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

							<div class="bars-section" in:fly={{ y: 20, duration: 400, delay: 400 }}>
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

							<button class="chat-cta" onclick={() => navigate('chat')} in:fly={{ y: 16, duration: 340, delay: 700 }}>
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
				<strong>Global motion state</strong>
				<p>Ambient layer reagerer på all interaksjon — breathIntensity (spring) og navWave synkroniserer orber og partikler.</p>
			</div>
			<div class="anno">
				<strong>Hue morphing</strong>
				<p>tweened() globalHue flyter gjennom hele UI ved tema-bytte — ikke bare lokal fargeendring.</p>
			</div>
			<div class="anno">
				<strong>Interaction ripples</strong>
				<p>Radial wave overlay med lengre duration (1200ms) sprer seg fra klikk — separat fra burst.</p>
			</div>
			<div class="anno">
				<strong>Particle reactivity</strong>
				<p>24 partikler med individuell reactivity-faktor — noen reagerer kraftigere på global state.</p>
			</div>
			<div class="anno">
				<strong>Breath intensity</strong>
				<p>Spring-animert pust som surger ved interaksjon — påvirker amplitude på alle orber og partikler.</p>
			</div>
			<div class="anno">
				<strong>Nav wave</strong>
				<p>Transient 0→1 wave ved skjermbytte som forskyver hele ambient layer — decay via rAF.</p>
			</div>
			<div class="anno">
				<strong>Widget→ambient sync</strong>
				<p>Widget-puls trigger breathIntensity surge — lokal effekt sprer seg til hele systemet.</p>
			</div>
			<div class="anno">
				<strong>Staggered entry</strong>
				<p>Hvert element har fly transition med incrementelt delay for cascading effekt.</p>
			</div>
			<div class="anno">
				<strong>Tweened data</strong>
				<p>tweened() store — tallene teller opp visuelt når temaside åpnes.</p>
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
			0 32px 80px rgba(0,0,0,0.7),
			inset 0 1px 0 rgba(255,255,255,0.04),
			inset 0 0 0 1px hsl(var(--hue) 60% 50% / 0.15);
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		transition: box-shadow 0.8s ease-out;
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
		background: radial-gradient(circle, hsl(var(--hue) 75% 55%) 0%, transparent 70%);
		transform: translate(-50%, -50%);
		transition: filter 0.6s ease-out;
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

	.ripple-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 9998;
		background: radial-gradient(
			circle at var(--rx) var(--ry),
			hsl(var(--rhue) 70% 50% / 0.2) 0%,
			hsl(var(--rhue) 80% 60% / 0.08) 30%,
			transparent 65%
		);
	}

	.burst-overlay {
		position: absolute;
		inset: 0;
		pointer-events: none;
		z-index: 9999;
		background: radial-gradient(circle at var(--bx) var(--by), hsl(var(--bhue) 80% 60% / 0.55) 0%, transparent 60%);
	}

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

	.widgets-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.6rem;
	}
	.widget-card {
		background: rgba(255,255,255,0.05);
		border: none;
		border-radius: 16px;
		padding: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
		position: relative;
		overflow: hidden;
		transition: transform 0.25s, box-shadow 0.3s;
		animation: card-in 0.42s both;
	}
	.widget-card.pulsing {
		animation: widget-pulse 0.6s ease-out;
	}
	@keyframes card-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: none; } }
	@keyframes widget-pulse {
		0% { transform: scale(1); }
		40% { 
			transform: scale(1.06) translateY(-2px);
			box-shadow: 0 0 24px hsl(var(--whue) 70% 55% / 0.6), 0 4px 16px hsl(var(--whue) 70% 45% / 0.3);
		}
		100% { 
			transform: scale(1);
			box-shadow: 0 0 0 transparent;
		}
	}

	.w-icon { font-size: 1.2rem; }
	.w-val { font-size: 1rem; font-weight: 700; color: hsl(var(--whue) 70% 70%); }
	.w-label { font-size: 0.68rem; color: rgba(255,255,255,0.45); }

	.section-label { font-size: 0.72rem; color: rgba(255,255,255,0.4); margin: 0; letter-spacing: 0.04em; text-transform: uppercase; }

	.tema-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.5rem;
	}
	.tema-btn {
		background: rgba(255,255,255,0.04);
		border: none;
		border-radius: 12px;
		padding: 0.7rem 0.5rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
		cursor: pointer;
		color: #f0f0f8;
		font-size: 0.82rem;
		font-weight: 500;
		transition: all 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
		animation: card-in 0.4s both;
	}
	.tema-btn:hover {
		background: hsl(var(--thue) 60% 50% / 0.18);
		transform: translateY(-3px) scale(1.02);
		box-shadow: 
			0 6px 20px hsl(var(--thue) 60% 50% / 0.35),
			inset 0 1px 0 hsl(var(--thue) 80% 70% / 0.2);
	}
	.tema-btn:active {
		transform: translateY(-1px) scale(0.98);
		transition-duration: 0.1s;
	}
	.t-emoji { font-size: 1.1rem; }
	.t-label { font-size: 0.8rem; }

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
		background: hsl(var(--hue) 60% 45% / 0.25);
		border: 1px solid hsl(var(--hue) 60% 55% / 0.4);
		border-radius: 14px;
		color: hsl(var(--hue) 70% 75%);
		font-size: 0.88rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.2s, transform 0.15s;
	}
	.chat-cta:hover { background: hsl(var(--hue) 60% 45% / 0.4); transform: translateY(-1px); }

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
