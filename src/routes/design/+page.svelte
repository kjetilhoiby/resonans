<script lang="ts">
	import GoalRing from '$lib/components/ui/GoalRing.svelte';
	import PeriodPills from '$lib/components/ui/PeriodPills.svelte';
	import StreakBadge from '$lib/components/ui/StreakBadge.svelte';
	import ChatBubble from '$lib/components/ui/ChatBubble.svelte';
	import RelationSparkline from '$lib/components/ui/RelationSparkline.svelte';

	const sections = [
		'Knapper',
		'Widgets',
		'Chat-bobler',
		'Input & skjema',
		'Navigasjon',
	] as const;

	// ── Widget-state ────────────────────────────────────────────────────────────
	let runPeriod = $state<'uke' | 'måned' | 'kvartal'>('kvartal');
	const runData: Record<string, { delta: string; pct: number }> = {
		uke:     { delta: '+3 km',  pct: 79 },
		måned:   { delta: '+8 km',  pct: 62 },
		kvartal: { delta: '+12 km', pct: 71 },
	};

	let weightPeriod = $state<'7d' | '30d' | '90d'>('30d');
	const weightData: Record<string, { delta: string; pct: number; col: string }> = {
		'7d':  { delta: '−0.4', pct: 40, col: '#5fa0a0' },
		'30d': { delta: '−1.1', pct: 55, col: '#5fa0a0' },
		'90d': { delta: '+2.7', pct: 22, col: '#e07070' },
	};

	// ── Chat-demo ───────────────────────────────────────────────────────────────
	let triageDecision = $state<'glem' | 'prosjekt' | null>(null);

	// ── Input-demo ──────────────────────────────────────────────────────────────
	let moodVal = $state(62);
	const moodLabel = $derived(
		moodVal < 22 ? 'Tung' :
		moodVal < 42 ? 'Flat' :
		moodVal < 62 ? 'OK'   :
		moodVal < 82 ? 'Bra' : 'Strålende'
	);
	const moodEmoji = $derived(
		moodVal < 22 ? '😔' :
		moodVal < 42 ? '😐' :
		moodVal < 62 ? '🙂' :
		moodVal < 82 ? '😊' : '🤩'
	);
	let moodSaved = $state(false);

	let pickedEmoji = $state<string | null>(null);
	const emojiSet = ['😔', '😐', '🙂', '😊', '🤩'];

	let energyVal = $state<number | null>(null);
</script>

<svelte:head>
	<title>Design</title>
</svelte:head>

<div class="page">

	<!-- ── Sidemeny ── -->
	<nav class="sidenav">
		{#each sections as s}
			<a class="sidenav-link" href="#{s}">{s}</a>
		{/each}
	</nav>

	<main class="content">

		<h1 class="page-title">Design</h1>
		<p class="page-sub">Levende dokumentasjon — faktiske komponenter med mock-data.</p>

		<!-- ══ KNAPPER ══════════════════════════════════════════════════════════ -->
		<section id="Knapper" class="section">
			<h2 class="section-heading">Knapper</h2>
			<div class="variant-grid" style="--min:100px">

				<div class="variant">
					<button class="btn-primary">Lagre</button>
					<span class="vname">Primær</span>
				</div>

				<div class="variant">
					<button class="btn-secondary">Avbryt</button>
					<span class="vname">Sekundær</span>
				</div>

				<div class="variant">
					<button class="btn-ghost">Mer</button>
					<span class="vname">Ghost</span>
				</div>

				<div class="variant">
					<button class="btn-chip">Trening</button>
					<span class="vname">Chip</span>
				</div>

				<div class="variant">
					<button class="btn-chip active">Søvn</button>
					<span class="vname">Chip · aktiv</span>
				</div>

				<div class="variant">
					<button class="btn-danger">Slett</button>
					<span class="vname">Destruktiv</span>
				</div>

			</div>
		</section>

		<!-- ══ WIDGETS ══════════════════════════════════════════════════════════ -->
		<section id="Widgets" class="section">
			<h2 class="section-heading">Widgets</h2>

			<!-- GoalRing -->
			<h3 class="subsection">GoalRing</h3>
			<p class="section-desc">
				Samme komponent — <code>GoalRing</code> — i alle varianter.
				Midtinnholdet er en snippet (children).
			</p>

			<div class="variant-grid">

				<!-- Todo 40% -->
				<div class="variant">
					<GoalRing pct={40} color="#f0b429" trackColor="#1e1a0e">
						<span class="rv-big" style="color:#f0b429">2/5</span>
						<span class="rv-unit">40%</span>
					</GoalRing>
					<span class="vname">Todo · 40%</span>
				</div>

				<!-- Løping + periodevalg -->
				<div class="variant">
					<GoalRing pct={runData[runPeriod].pct} color="#7c8ef5" trackColor="#1e1e2a">
						<span class="rv-big" style="color:#7c8ef5">{runData[runPeriod].delta}</span>
						<span class="rv-unit">foran plan</span>
					</GoalRing>
					<PeriodPills
						options={['uke','måned','kvartal']}
						value={runPeriod}
						onchange={(v) => runPeriod = v as typeof runPeriod}
					/>
					<span class="vname">Løping · periode</span>
				</div>

				<!-- Vekt-delta + periodevalg -->
				<div class="variant">
					<GoalRing
						pct={weightData[weightPeriod].pct}
						color={weightData[weightPeriod].col}
						trackColor="#1a1a1a"
					>
						<span class="rv-big" style="color:{weightData[weightPeriod].col}">{weightData[weightPeriod].delta}</span>
						<span class="rv-unit">kg</span>
					</GoalRing>
					<PeriodPills
						options={['7d','30d','90d']}
						value={weightPeriod}
						onchange={(v) => weightPeriod = v as typeof weightPeriod}
					/>
					<span class="vname">Vekt · delta</span>
				</div>

				<!-- Forbruk + pace-tick -->
				<div class="variant">
					<GoalRing pct={64} color="#5fa0a0" trackColor="#1a1a1a" pacePct={66.7}>
						<span class="rv-big" style="color:#5fa0a0">−320</span>
						<span class="rv-unit">kr vs pace</span>
					</GoalRing>
					<span class="vname">Forbruk · pace-tick</span>
				</div>

				<!-- Dobbelring aktivitet -->
				<div class="variant">
					<GoalRing
						pct={68} r={27} strokeWidth={4} color="#e07070" trackColor="#1e1e1e"
						pct2={75} r2={19} strokeWidth2={4} color2="#5fa0a0" trackColor2="#1a1a1a"
					>
						<span class="rv-big" style="color:#e07070">68%</span>
					</GoalRing>
					<span class="vname">Dobbel · aktivitet</span>
				</div>

				<!-- Søvnmål 97% -->
				<div class="variant">
					<GoalRing pct={97} color="#5fa0a0" trackColor="#1a1a1a">
						<span class="rv-big" style="color:#5fa0a0">7.8</span>
						<span class="rv-unit">/ 8 h</span>
					</GoalRing>
					<span class="vname">Søvnmål · 97%</span>
				</div>

			</div>

			<!-- StreakBadge -->
			<h3 class="subsection">StreakBadge</h3>
			<div class="variant-grid">

				<div class="variant">
					<StreakBadge count={12} label="Jogging" />
					<span class="vname">Standard</span>
				</div>

				<div class="variant">
					<StreakBadge count={3} color="#7c8ef5"
						weekDots={[false, false, false, false, true, true, true]}
						label="Meditasjon"
					/>
					<span class="vname">Lav streak · blå</span>
				</div>

				<div class="variant">
					<StreakBadge count={42} color="#d4829a"
						weekDots={[true, true, true, true, true, true, true]}
						label="Kobling"
					/>
					<span class="vname">Perfekt uke · rosa</span>
				</div>

			</div>

			<!-- RelationSparkline -->
			<h3 class="subsection">RelationSparkline</h3>
			<p class="section-desc">Dobbel-sparkline klippet til sirkel. Siste 7 registreringer på 1–5-skala.</p>
			<div class="variant-grid">

				<div class="variant">
					<RelationSparkline
						dataA={[3, 4, 3, 5, 4, 4, 5]}
						dataB={[4, 3, 4, 3, 4, 3, 4]}
					/>
					<span class="vname">Standard · widget</span>
				</div>

				<div class="variant">
					<RelationSparkline
						dataA={[3, 4, 3, 5, 4, 4, 5]}
						dataB={[4, 3, 4, 3, 4, 3, 4]}
						showLegend
						labelA="Kjetil"
						labelB="Partner"
						size={96}
					/>
					<span class="vname">Med legend · dashbord</span>
				</div>

				<div class="variant">
					<RelationSparkline
						dataA={[2, 2, 3, 2, 1, 2, 2]}
						dataB={[4, 3, 3, 4, 3, 4, 3]}
						size={96}
					/>
					<span class="vname">Asymmetrisk · signal</span>
				</div>

			</div>
		</section>

		<!-- ══ CHAT-BOBLER ══════════════════════════════════════════════════════ -->
		<section id="Chat-bobler" class="section">
			<h2 class="section-heading">Chat-bobler</h2>
			<p class="section-desc">
				<code>ChatBubble</code> — role: <code>'user'</code> | <code>'bot'</code>.
				Actions er valgfrie handlingsknapper under botmeldinger.
			</p>

			<div class="chat-demo">
				<ChatBubble role="user" text="Jeg veide 92 kg i dag" />
				<ChatBubble role="bot" text="✦ Registrert — ned 0.4 kg siden sist." />
				<ChatBubble role="user" text="Og jeg løp 6 km" />
				<ChatBubble
					role="bot"
					text="✦ Loggfører under Trening & helse."
					branch="Trening & helse"
				/>
				<ChatBubble role="user" text="Hva gjør jeg med den gamle sykkelen?" />
				<ChatBubble
					role="bot"
					text="✦ Vil du glemme det eller starte et prosjekt?"
					actions={[
						{ label: 'Glem det', onclick: () => triageDecision = 'glem' },
						{ label: 'Start prosjekt', onclick: () => triageDecision = 'prosjekt' },
					]}
				/>
				{#if triageDecision === 'glem'}
					<ChatBubble role="bot" text="✦ Notert — ingen videre oppfølging." />
				{:else if triageDecision === 'prosjekt'}
					<ChatBubble role="bot" text="✦ Prosjekt opprettet: Sykkelreparasjon." branch="Prosjekter" />
				{/if}
			</div>
		</section>

		<!-- ══ INPUT & SKJEMA ═══════════════════════════════════════════════════ -->
		<section id="Input & skjema" class="section">
			<h2 class="section-heading">Input & skjema</h2>

			<h3 class="subsection">Sinnstemningsslider</h3>
			<div class="input-demo">
				<div class="mood-display">
					<span class="mood-emoji">{moodEmoji}</span>
					<span class="mood-label">{moodLabel}</span>
				</div>
				<input
					type="range" min="0" max="100" step="1"
					class="ds-slider" style="--pct:{moodVal}%"
					bind:value={moodVal}
					onchange={() => { moodSaved = true; setTimeout(() => moodSaved = false, 1200); }}
				/>
				{#if moodSaved}
					<span class="saved-flash">✓ lagret</span>
				{/if}
			</div>

			<h3 class="subsection">Emoji-velger</h3>
			<div class="input-demo">
				<div class="emoji-row">
					{#each emojiSet as e}
						<button
							class="emoji-btn"
							class:picked={pickedEmoji === e}
							onclick={() => pickedEmoji = pickedEmoji === e ? null : e}
						>{e}</button>
					{/each}
				</div>
				{#if pickedEmoji}
					<span class="saved-flash">✓ {pickedEmoji} valgt</span>
				{/if}
			</div>

			<h3 class="subsection">Energiskala 1–5</h3>
			<div class="input-demo">
				<div class="energy-row">
					{#each [1, 2, 3, 4, 5] as n}
						<button
							class="energy-btn"
							class:active={energyVal === n}
							onclick={() => energyVal = energyVal === n ? null : n}
						>{n}</button>
					{/each}
				</div>
				{#if energyVal}
					<span class="saved-flash">✓ energi {energyVal}/5</span>
				{/if}
			</div>

			<h3 class="subsection">Tekstfelt</h3>
			<div class="input-demo">
				<input type="text" class="ds-input" placeholder="Hva tenker du på?" />
			</div>
		</section>

		<!-- ══ NAVIGASJON ═══════════════════════════════════════════════════════ -->
		<section id="Navigasjon" class="section">
			<h2 class="section-heading">Navigasjon</h2>

			<h3 class="subsection">PeriodPills — tidsvalg</h3>
			<div class="variant-grid" style="--min:200px">
				<div class="variant nav-demo">
					<PeriodPills options={['7d','30d','90d']} value="30d" />
					<span class="vname">Korttids</span>
				</div>
				<div class="variant nav-demo">
					<PeriodPills options={['uke','måned','kvartal','år']} value="kvartal" />
					<span class="vname">Periodisk</span>
				</div>
			</div>

			<h3 class="subsection">Tema-piller</h3>
			<div class="tema-rail-demo">
				{#each ['Trening & helse', 'Søvn', 'Økonomi', 'Jobb', 'Relasjoner'] as t}
					<button class="btn-chip">{t}</button>
				{/each}
			</div>

			<h3 class="subsection">Subtabs</h3>
			<div class="subtab-demo">
				{#each [['Chat','aktiv'], ['Data',''], ['Filer','']] as [lbl, st]}
					<button class="subtab" class:active={st === 'aktiv'}>{lbl}</button>
				{/each}
			</div>
		</section>

	</main>
</div>

<style>
	/* ── Layout ── */
	.page {
		display: flex;
		min-height: 100vh;
		background: #0f0f0f;
		color: #ccc;
		font-family: 'Inter', system-ui, sans-serif;
	}

	.sidenav {
		position: sticky;
		top: 0;
		height: 100vh;
		width: 160px;
		flex-shrink: 0;
		padding: 48px 0 24px 20px;
		border-right: 1px solid #1e1e1e;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.sidenav-link {
		font-size: 0.72rem;
		font-weight: 500;
		color: #555;
		text-decoration: none;
		padding: 4px 8px;
		border-radius: 6px;
		transition: color 0.12s, background 0.12s;
	}
	.sidenav-link:hover { color: #ccc; background: #1a1a1a; }

	.content {
		flex: 1;
		max-width: 860px;
		padding: 48px 40px 120px;
	}

	/* ── Overskrifter ── */
	.page-title {
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: #eee;
		margin: 0 0 6px;
	}

	.page-sub {
		font-size: 0.82rem;
		color: #555;
		margin: 0 0 48px;
	}

	.section {
		margin-bottom: 72px;
	}

	.section-heading {
		font-size: 1rem;
		font-weight: 700;
		color: #888;
		letter-spacing: -0.01em;
		margin: 0 0 20px;
		padding-bottom: 10px;
		border-bottom: 1px solid #1e1e1e;
	}

	.subsection {
		font-size: 0.72rem;
		font-weight: 700;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 28px 0 12px;
	}

	.section-desc {
		font-size: 0.78rem;
		color: #555;
		margin: -6px 0 16px;
		line-height: 1.5;
	}

	.section-desc code {
		font-size: 0.72rem;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		padding: 0 4px;
		color: #888;
	}

	/* ── Variant-grid ── */
	.variant-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(var(--min, 120px), 1fr));
		gap: 20px;
		align-items: start;
	}

	.variant {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
	}

	.vname {
		font-size: 0.62rem;
		color: #444;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* ── Ring-center-innhold (i snippets til GoalRing) ── */
	.rv-big {
		font-size: 0.9rem;
		font-weight: 800;
		line-height: 1;
		letter-spacing: -0.02em;
	}
	.rv-unit {
		font-size: 0.56rem;
		color: #555;
		text-transform: lowercase;
		text-align: center;
	}

	/* ── Knapper ── */
	.btn-primary {
		padding: 8px 18px;
		border-radius: 8px;
		border: none;
		background: #4a5af0;
		color: #fff;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.12s;
	}
	.btn-primary:hover { background: #3a4adf; }

	.btn-secondary {
		padding: 8px 18px;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #aaa;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 500;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
	}
	.btn-secondary:hover { border-color: #444; color: #eee; }

	.btn-ghost {
		padding: 8px 18px;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: #666;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		transition: color 0.12s;
	}
	.btn-ghost:hover { color: #ccc; }

	.btn-chip {
		padding: 5px 12px;
		border-radius: 999px;
		border: 1px solid #2a2a2a;
		background: transparent;
		color: #666;
		font: inherit;
		font-size: 0.75rem;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
		white-space: nowrap;
	}
	.btn-chip:hover,
	.btn-chip.active {
		border-color: #555;
		color: #ccc;
		background: #1a1a1a;
	}

	.btn-danger {
		padding: 8px 18px;
		border-radius: 8px;
		border: 1px solid #4a1a1a;
		background: transparent;
		color: #e07070;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
		transition: background 0.12s, border-color 0.12s;
	}
	.btn-danger:hover { background: #2a1010; border-color: #6a2a2a; }

	/* ── Chat-demo ── */
	.chat-demo {
		background: #111;
		border: 1px solid #1e1e1e;
		border-radius: 16px;
		padding: 16px;
		max-width: 360px;
		display: flex;
		flex-direction: column;
	}

	/* ── Input-demo ── */
	.input-demo {
		max-width: 320px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 8px;
	}

	.mood-display {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.mood-emoji { font-size: 1.6rem; line-height: 1; }
	.mood-label { font-size: 0.9rem; font-weight: 700; color: #ccc; }

	.ds-slider {
		-webkit-appearance: none;
		appearance: none;
		width: 100%;
		height: 4px;
		border-radius: 2px;
		background: linear-gradient(to right, #4a5af0 var(--pct, 62%), #2a2a2a var(--pct, 62%));
		outline: none;
		cursor: pointer;
	}
	.ds-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #ccc;
		border: 2px solid #0f0f0f;
		box-shadow: 0 0 0 2px #4a5af0;
		cursor: pointer;
	}

	.emoji-row {
		display: flex;
		gap: 8px;
	}
	.emoji-btn {
		font-size: 1.5rem;
		padding: 6px 8px;
		border-radius: 8px;
		border: 1px solid #2a2a2a;
		background: transparent;
		cursor: pointer;
		transition: border-color 0.12s, background 0.12s;
		line-height: 1;
	}
	.emoji-btn.picked {
		border-color: #555;
		background: #1a1a1a;
	}

	.energy-row {
		display: flex;
		gap: 8px;
	}
	.energy-btn {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 1px solid #2a2a2a;
		background: transparent;
		color: #555;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s, background 0.12s;
	}
	.energy-btn.active {
		border-color: #7c8ef5;
		color: #7c8ef5;
		background: #1e1e2a;
	}

	.saved-flash {
		font-size: 0.7rem;
		color: #5fa0a0;
	}

	.ds-input {
		width: 100%;
		padding: 10px 14px;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #111;
		color: #ccc;
		font: inherit;
		font-size: 0.82rem;
		outline: none;
		transition: border-color 0.12s;
	}
	.ds-input:focus { border-color: #444; }
	.ds-input::placeholder { color: #444; }

	/* ── Navigasjon-demo ── */
	.nav-demo {
		align-items: flex-start;
	}

	.tema-rail-demo {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 8px;
	}

	.subtab-demo {
		display: flex;
		gap: 0;
		background: #111;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		overflow: hidden;
		width: fit-content;
	}
	.subtab {
		padding: 7px 16px;
		border: none;
		background: transparent;
		color: #555;
		font: inherit;
		font-size: 0.75rem;
		font-weight: 500;
		cursor: pointer;
		transition: color 0.12s, background 0.12s;
		border-right: 1px solid #2a2a2a;
	}
	.subtab:last-child { border-right: none; }
	.subtab.active { color: #ccc; background: #1a1a1a; }
	.subtab:hover { color: #aaa; }
</style>
