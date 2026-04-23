<script lang="ts">
	import { AppPage } from '$lib/components/ui';
	import GoalRing from '$lib/components/ui/GoalRing.svelte';
	import PeriodPills from '$lib/components/ui/PeriodPills.svelte';
	import StreakBadge from '$lib/components/ui/StreakBadge.svelte';
	import ChatBubble from '$lib/components/ui/ChatBubble.svelte';
	import ChatInput from '$lib/components/ui/ChatInput.svelte';
	import RelationSparkline from '$lib/components/ui/RelationSparkline.svelte';
	import Section from '$lib/components/ui/Section.svelte';
	import CompactRecordList from '$lib/components/ui/CompactRecordList.svelte';
	import ScreenTitle from '$lib/components/ui/ScreenTitle.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import { THEME_HUES, getThemeHueStyle, type ThemeHueKey } from '$lib/domain/theme-hues';

	const sections = [
		'Designprinsipper',
		'Layout & Structure',
		'Knapper',
		'Ikoner',
		'Widgets',
		'Chat-bobler',
		'Input & skjema',
		'Navigasjon',
		'Hjemskjerm',
		'Interaksjonsflyter',
		'Ukeplan',
		'Sjekkliste-flyt',
	] as const;

	// ── Interaksjonsflyt-state ──────────────────────────────────────────────────
	let homeZone = $state<'widgets' | 'tema' | 'input' | null>(null);

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

	type DesignIconToken =
		| 'chat'
		| 'camera'
		| 'wave'
		| 'checkin'
		| 'file'
		| 'goals'
		| 'settings'
		| 'back'
		| 'forward'
		| 'search'
		| 'refresh'
		| 'close';

	const iconSpecs: Array<{
		token: DesignIconToken;
		label: string;
		legacy: string;
	}> = [
		{ token: 'chat', label: 'Samtale', legacy: '◈ / 💬' },
		{ token: 'camera', label: 'Kamera', legacy: '◉' },
		{ token: 'wave', label: 'Lyd', legacy: '∿' },
		{ token: 'checkin', label: 'Sjekk inn', legacy: '◐' },
		{ token: 'file', label: 'Fil', legacy: '▣' },
		{ token: 'goals', label: 'Mål', legacy: '◎ / 🎯' },
		{ token: 'settings', label: 'Innstillinger', legacy: '⚙ / ⚙️' },
		{ token: 'back', label: 'Tilbake', legacy: '←' },
		{ token: 'forward', label: 'Frem', legacy: '→' },
		{ token: 'search', label: 'Søk', legacy: 'inline SVG' },
		{ token: 'refresh', label: 'Oppdater', legacy: 'inline SVG' },
		{ token: 'close', label: 'Lukk', legacy: '✕ / ×' }
	];

	let iconThemeHue = $state(THEME_HUES.default);
	let iconThemeMode = $state<'dark' | 'light'>('dark');
	const iconThemePresets: Array<{ key: ThemeHueKey; name: string; hue: number; note: string }> = [
		{ key: 'default', name: 'Default', hue: THEME_HUES.default, note: 'Base for hele appen' },
		{ key: 'relations', name: 'Relasjoner', hue: THEME_HUES.relations, note: 'Rolig grønn for parforhold' },
		{ key: 'health', name: 'Helse', hue: THEME_HUES.health, note: 'Kjølig grønn-blå' },
		{ key: 'economy', name: 'Økonomi', hue: THEME_HUES.economy, note: 'Strammere amber' },
		{ key: 'literature', name: 'Litteratur', hue: THEME_HUES.literature, note: 'Varm og rolig lesetone' },
		{ key: 'work', name: 'Arbeid', hue: THEME_HUES.work, note: 'Kjølig fokusfarge' }
	];

	// ── Ukeplan-demo ────────────────────────────────────────────────────────────
	let weekGoalChecks = $state([true, false, false]);
	const weekDays = [
		{ name: 'Mandag',  note: 'Sykkel hjem(?)',  todos: ['Matpakker', 'Viktigst', 'Tidlig seng', 'Sykkel hjem', 'Barnefri'] },
		{ name: 'Tirsdag', note: 'Første dukkert',  todos: ['Opp 05.00', 'Svømmehall', 'Levere rapport'] },
		{ name: 'Onsdag',  note: '',                todos: ['Knekkebrød', 'Pilates', 'Tidlig seng'] },
		{ name: 'Torsdag', note: 'Svøm?',           todos: ['Svømmehall', 'Jobb hjemmefra'] },
		{ name: 'Fredag',  note: 'Anita reiser',    todos: ['Skole og bhg', 'Sykkel hjem', 'Handle mat'] },
	];
	let dayChecks = $state([
		[false, false, true, false, true],
		[true, true, false],
		[false, false, false],
		[false, false],
		[false, false, false],
	]);
</script>

<svelte:head>
	<title>Design</title>
</svelte:head>

<AppPage width="full" padding="default" gap="sm" surface="default">
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

		<!-- ══ DESIGNPRINSIPPER ════════════════════════════════════════════════════════ -->
		<section id="Designprinsipper" class="section">
			<h2 class="section-heading">Designprinsipper</h2>
			<p class="section-desc">Kjerneverdier som styrer all UX-beslutning. Åpne appen skal føles som å puste ut, ikke inn.</p>

			<div class="principles-grid">

				<div class="principle-card">
					<span class="principle-icon">✓</span>
					<h3 class="principle-title">Hva har du fått til?</h3>
					<p class="principle-body">Hjemskjermen ser <em>bakover</em>. Sensordata feirer fremgang. Todos viser hva som er løst, ikke hva som gjenerstår.</p>
					<div class="principle-contrast">
						<span class="contrast-no">✘ «5 ting uført»</span>
						<span class="contrast-yes">✔ «7 av 12 fullført»</span>
					</div>
				</div>

				<div class="principle-card">
					<span class="principle-icon">⚡</span>
					<h3 class="principle-title">To sekunder å dumpe</h3>
					<p class="principle-body">Innfanging har null friksjon. Ingen kategorisering påkrevd. Bot sorterer etterpå — eller aldri. Bare skriv det ned.</p>
					<div class="principle-contrast">
						<span class="contrast-no">✘ Velg prosjekt, prioritet, frist…</span>
						<span class="contrast-yes">✔ «Husk å ringe lærer» → ferdig</span>
					</div>
				</div>

				<div class="principle-card">
					<span class="principle-icon">○</span>
					<h3 class="principle-title">KAN løses, ikke MÅ løses</h3>
					<p class="principle-body">Av 200 ting i systemet vises bare de som er relevante <em>i dag</em>. Backlog er usynlig med mindre du leter.</p>
					<div class="principle-contrast">
						<span class="contrast-no">✘ Liste på 87 åpne oppgaver</span>
						<span class="contrast-yes">✔ Her er de 4 tingene som gjør en forskjell i dag</span>
					</div>
				</div>

				<div class="principle-card">
					<span class="principle-icon">💬</span>
					<h3 class="principle-title">Samtale > skjema</h3>
					<p class="principle-body">All registrering kan skje som naturlig tekst. Bot tolker, strukturerer og bekrefter. Fyll aldri et felt du ikke forstår hvorfor finnes.</p>
					<div class="principle-contrast">
						<span class="contrast-no">✘ Tittel / beskrivelse / kategori / status / eier…</span>
						<span class="contrast-yes">✔ «Jeg svemte 30 min i dag»</span>
					</div>
				</div>

			</div>
		</section>

		<!-- ══ LAYOUT & STRUCTURE ══════════════════════════════════════════════════════ -->
		<section id="Layout & Structure" class="section">
			<h2 class="section-heading">Layout & Structure</h2>
			<p class="section-desc">
				Base komponenter for layout og struktur. Brukes på tvers av alle dashboards.
			</p>

			<!-- Section -->
			<h3 class="subsection">Section</h3>
			<p class="section-desc">
				Standard contentwrapper: <code>Section.svelte</code>. Mørkegrå bakgrunn (#141414), avrundet (18px), ingen border.
				Valgfri tittel og meta-info (f.eks. "3 items").
			</p>

			<div style="max-width: 420px; display: flex; flex-direction: column; gap: 12px;">
				<Section title="Eksempel uten innhold">
					<p style="margin: 0; color: #888; font-size: 0.82rem;">Dette er innholdet i seksjonen.</p>
				</Section>

				<Section title="Med metadata" meta="3 items">
					<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;">
						<li style="color: #aaa; font-size: 0.82rem;">• Item 1</li>
						<li style="color: #aaa; font-size: 0.82rem;">• Item 2</li>
						<li style="color: #aaa; font-size: 0.82rem;">• Item 3</li>
					</ul>
				</Section>

				<Section>
					<p style="margin: 0; color: #888; font-size: 0.82rem;">Seksjon uten tittel</p>
				</Section>
			</div>

			<!-- ScreenTitle -->
			<h3 class="subsection">ScreenTitle</h3>
			<p class="section-desc">
				Standard page header med tittel og valgfri undertekst: <code>ScreenTitle.svelte</code>
			</p>
			<div style="max-width: 420px;">
				<ScreenTitle title="Helse" subtitle="Vekt, løping, søvn og aktivitet" />
			</div>

			<!-- CompactRecordList -->
			<h3 class="subsection">CompactRecordList</h3>
			<p class="section-desc">
				Kompakt liste med tittel, label og meta-info: <code>CompactRecordList.svelte</code>.
				Brukes for kilder, kontoer, siste transaksjoner osv.
			</p>
			<div style="max-width: 420px;">
				<CompactRecordList
					title="Kilder"
					items={[
						{ id: '1', title: 'Withings Account', subtitle: 'withings', meta: 'Synket 30.3., 13:15' },
						{ id: '2', title: 'Apple Health', subtitle: 'apple', meta: 'Synket 29.3., 08:42' },
						{ id: '3', title: 'Strava', subtitle: 'strava', meta: 'Ikke synket' }
					]}
					emptyText="Ingen kilder ennå."
				/>
			</div>
		</section>

		<!-- ══ KNAPPER ══════════════════════════════════════════════════════════ -->
		<section id="Knapper" class="section">
			<h2 class="section-heading">Knapper</h2>
			<p class="section-desc">
				Alle klasser er globale — definert i <code>app.css</code>. Bruk dem direkte i alle ruter uten lokal CSS.
			</p>
			<div class="variant-grid" style="--min:100px">

				<div class="variant">
					<button class="btn-primary">Lagre</button>
					<span class="vname">Primær<br><code>.btn-primary</code></span>
				</div>

				<div class="variant">
					<button class="btn-secondary">Avbryt</button>
					<span class="vname">Sekundær<br><code>.btn-secondary</code></span>
				</div>

				<div class="variant">
					<button class="btn-ghost">Mer</button>
					<span class="vname">Ghost<br><code>.btn-ghost</code></span>
				</div>

				<div class="variant">
					<button class="btn-chip">Trening</button>
					<span class="vname">Chip<br><code>.btn-chip</code></span>
				</div>

				<div class="variant">
					<button class="btn-chip active">Søvn</button>
					<span class="vname">Chip · aktiv<br><code>.btn-chip.active</code></span>
				</div>

				<div class="variant">
					<button class="btn-danger">Slett</button>
					<span class="vname">Destruktiv<br><code>.btn-danger</code></span>
				</div>

				<div class="variant">
					<button class="btn-icon"><Icon name="settings" size={16} /></button>
					<span class="vname">Ikon<br><code>.btn-icon</code></span>
				</div>

				<div class="variant">
					<button class="btn-icon-danger"><Icon name="close" size={14} /></button>
					<span class="vname">Ikon · slett<br><code>.btn-icon-danger</code></span>
				</div>

			</div>
		</section>

		<!-- ══ IKONER ═══════════════════════════════════════════════════════════ -->
		<section id="Ikoner" class="section">
			<h2 class="section-heading">Ikoner</h2>
			<p class="section-desc">
				Forslag til Resonans v1 ikonsett. Eget ikonsett brukes for handling og navigasjon; emoji beholdes for
				domene, stemning og personlig kontekst.
			</p>
			<p class="section-desc">
				Theme-lab: Bakgrunn og forgrunn drives av <code>hsl(hue, saturation, lightness)</code>, der vi holder hue konstant
				per tema og justerer lyshet i trinn. Det gir myke overganger mellom temaer.
			</p>
			<p class="section-desc">
				Samme rigg skal ogsa kunne brukes i darkmode og lightmode: hue beholdes, mens lyshetsstigen for
				bakgrunn, border og tekst byttes per modus.
			</p>

			<div class="icon-theme-lab" class:light-mode={iconThemeMode === 'light'} style={`--icon-hue:${iconThemeHue};`}>
				<div class="icon-theme-controls">
					<div class="icon-hue-row">
						<label for="icon-hue" class="icon-hue-label">Tema-hue</label>
						<input id="icon-hue" type="range" min="0" max="360" step="1" bind:value={iconThemeHue} class="icon-hue-slider" />
						<span class="icon-hue-value">{iconThemeHue}°</span>
					</div>
					<div class="icon-mode-row" role="tablist" aria-label="Visningsmodus">
						<button
							type="button"
							class="icon-mode-btn"
							class:active={iconThemeMode === 'dark'}
							onclick={() => (iconThemeMode = 'dark')}
						>Dark</button>
						<button
							type="button"
							class="icon-mode-btn"
							class:active={iconThemeMode === 'light'}
							onclick={() => (iconThemeMode = 'light')}
						>Light</button>
					</div>
					<div class="icon-preset-row">
						{#each iconThemePresets as preset}
							<button
								type="button"
								class="icon-preset-btn"
								class:active={iconThemeHue === preset.hue}
								onclick={() => (iconThemeHue = preset.hue)}
							>
								<span>{preset.name}</span>
								<small>{preset.note}</small>
							</button>
						{/each}
					</div>
					<div class="icon-token-strip" aria-label="Fargetokens">
						<div class="icon-token-swatch">
							<span class="icon-token-dot icon-token-dot--bg0"></span>
							<span>bg-0</span>
						</div>
						<div class="icon-token-swatch">
							<span class="icon-token-dot icon-token-dot--bg1"></span>
							<span>bg-1</span>
						</div>
						<div class="icon-token-swatch">
							<span class="icon-token-dot icon-token-dot--bg2"></span>
							<span>bg-2</span>
						</div>
						<div class="icon-token-swatch">
							<span class="icon-token-dot icon-token-dot--border"></span>
							<span>border</span>
						</div>
						<div class="icon-token-swatch">
							<span class="icon-token-dot icon-token-dot--fg"></span>
							<span>fg</span>
						</div>
					</div>
				</div>

				<div class="icon-grid">
					{#each iconSpecs as icon}
						<article class="icon-card">
							<div class="icon-preview" aria-hidden="true">
								<Icon name={icon.token} size={24} />
							</div>
							<p class="icon-token">ri-{icon.token}</p>
							<p class="icon-label">{icon.label}</p>
							<p class="icon-legacy">Erstatter: {icon.legacy}</p>
						</article>
					{/each}
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

			<h3 class="subsection">ChatInput</h3>
			<p class="section-desc">
				<code>ChatInput.svelte</code> — gjenbrukbar meldingsboks med auto-resize textarea.
			</p>
			<div style="max-width: 420px;">
				<ChatInput
					placeholder="Skriv en melding…"
					onsubmit={(msg) => console.log('Sendt:', msg)}
				/>
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

		<!-- ══ HJEMSKJERM ════════════════════════════════════════════════════════ -->
		<section id="Hjemskjerm" class="section">
			<h2 class="section-heading">Hjemskjerm</h2>
			<p class="section-desc">Tre soner + tittel. Her utforsker vi forskjellige måter å prioritere plass på.</p>

			<h3 class="subsection">Layout-alternativer — høydefordeling</h3>
			<p class="section-desc">Hvilken balanse mellom widgets, tema og input gir best brukeropplevelse?</p>
			
			<div class="layout-compare">
				<!-- NÅVÆRENDE -->
				<div class="layout-option">
					<p class="layout-label">Nåværende (10/35/20/35)</p>
					<div class="hs-mockup">
						<div class="hs-zone hs-title" style="height: 10%">
							<span class="hs-zone-label">Tittel</span>
							<span class="hs-zone-pct">10%</span>
						</div>
						<div class="hs-zone hs-widgets" style="height: 35%">
							<span class="hs-zone-label">Widgets</span>
							<span class="hs-zone-pct">35%</span>
							<div class="hs-widget-dots">
								{#each [1,2,3,4,5,6] as _}
									<div class="hs-dot"></div>
								{/each}
							</div>
						</div>
						<div class="hs-zone hs-tema" style="height: 20%">
							<span class="hs-zone-label">Tema</span>
							<span class="hs-zone-pct">20%</span>
							<div class="hs-chips">
								{#each ['Trening', 'Økonomi'] as t}
									<span class="hs-chip">{t}</span>
								{/each}
							</div>
						</div>
						<div class="hs-zone hs-input" style="height: 35%">
							<span class="hs-zone-label">Input</span>
							<span class="hs-zone-pct">35%</span>
						</div>
					</div>
					<div class="layout-notes">
						<p class="note-item">✗ Widgets tar mye plass</p>
						<p class="note-item">✗ Tema får lite rom (2x1 maks)</p>
						<p class="note-item">✓ Input har god plass</p>
					</div>
				</div>

				<!-- BALANSERT -->
				<div class="layout-option">
					<p class="layout-label">Balansert (10/25/30/35)</p>
					<div class="hs-mockup">
						<div class="hs-zone hs-title" style="height: 10%">
							<span class="hs-zone-label">Tittel</span>
							<span class="hs-zone-pct">10%</span>
						</div>
						<div class="hs-zone hs-widgets" style="height: 25%">
							<span class="hs-zone-label">Widgets</span>
							<span class="hs-zone-pct">25%</span>
							<div class="hs-widget-dots">
								{#each [1,2,3,4] as _}
									<div class="hs-dot"></div>
								{/each}
							</div>
						</div>
						<div class="hs-zone hs-tema hs-tema-large" style="height: 30%">
							<span class="hs-zone-label">Tema</span>
							<span class="hs-zone-pct">30%</span>
							<div class="tema-grid-preview">
								{#each [1,2,3,4] as _}
									<div class="tema-box"></div>
								{/each}
							</div>
						</div>
						<div class="hs-zone hs-input" style="height: 35%">
							<span class="hs-zone-label">Input</span>
							<span class="hs-zone-pct">35%</span>
						</div>
					</div>
					<div class="layout-notes">
						<p class="note-item">✓ Widgets kompakte (4 viktigste)</p>
						<p class="note-item">✓ Tema 2x2 grid passer!</p>
<p class="note-item">✓ Input beholder viktighet</p>
					</div>
				</div>

				<!-- TEMA-FOKUSERT -->
				<div class="layout-option">
					<p class="layout-label">Tema-fokusert (10/20/35/35)</p>
					<div class="hs-mockup">
						<div class="hs-zone hs-title" style="height: 10%">
							<span class="hs-zone-label">Tittel</span>
							<span class="hs-zone-pct">10%</span>
						</div>
						<div class="hs-zone hs-widgets" style="height: 20%">
							<span class="hs-zone-label">Widgets</span>
							<span class="hs-zone-pct">20%</span>
							<div class="hs-widget-dots">
								{#each [1,2,3] as _}
									<div class="hs-dot"></div>
								{/each}
							</div>
						</div>
						<div class="hs-zone hs-tema hs-tema-large" style="height: 35%">
							<span class="hs-zone-label">Tema</span>
							<span class="hs-zone-pct">35%</span>
							<div class="tema-grid-preview">
								{#each [1,2,3,4,5,6] as _}
									<div class="tema-box"></div>
								{/each}
							</div>
						</div>
						<div class="hs-zone hs-input" style="height: 35%">
							<span class="hs-zone-label">Input</span>
							<span class="hs-zone-pct">35%</span>
						</div>
					</div>
					<div class="layout-notes">
						<p class="note-item">✓ Tema får maksimal vekt (2x3)</p>
						<p class="note-item">? Widgets minimale (3 prioriterte)</p>
						<p class="note-item">✓ Input uendret</p>
					</div>
				</div>
			</div>

			<h3 class="subsection" style="margin-top: 40px">Forbedrede komponenter (v2)</h3>
			<p class="section-desc">Store runde tema-knapper med hvite ikoner · input med felt + ikon-knapper</p>
			
			<!-- TEMA-KNAPPER V2 -->
			<div class="hs-v2-demo">
				<p class="demo-label">Tema-knapper — store runde med ikoner</p>
				
				<div class="tema-v3-grid">
					{#each [
						{emoji: '💪', name: 'Helse'},
						{emoji: '💰', name: 'Økonomi'},
						{emoji: '❤️', name: 'Partner'},
						{emoji: '🧘', name: 'Meditasjon'}
					] as t}
						<button class="tema-btn-v3" style={getThemeHueStyle(t.name)}>
							<span class="tema-btn-v3-icon">{t.emoji}</span>
							<span class="tema-btn-v3-label">{t.name}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- INPUT V3: FELT + IKON-KNAPPER -->
			<div class="hs-v2-demo">
				<p class="demo-label">Input — felt + tre ikon-knapper</p>
				<div class="input-v4">
					<div class="input-field-wrap">
						<input class="input-field-v4" type="text" placeholder="Hva tenker du på?" />
					</div>
					<button class="icon-btn-v4" aria-label="Send">
						<Icon name="forward" size={16} />
					</button>
					<button class="icon-btn-v4" aria-label="Legg ved">
						<Icon name="attach" size={16} />
					</button>
					<button class="icon-btn-v4" aria-label="Sjekk inn">
						<Icon name="checkin" size={16} />
					</button>
				</div>
			</div>
		</section>

		<!-- ══ INTERAKSJONSFLYTER ════════════════════════════════════════════════ -->
		<section id="Interaksjonsflyter" class="section">
			<h2 class="section-heading">Interaksjonsflyter</h2>
			<p class="section-desc">Tre overganger fra hjemskjerm — ingen tab-bar. Tap på en sone animerer den til fullskjerm; de andre forsvinner.</p>

			<!-- Flytoversikt -->
			<div class="flow-grid">

				<!-- Flyt 1: Widgets → Dashboard -->
				<div class="flow-card">
					<div class="flow-header">
						<span class="flow-num">01</span>
						<span class="flow-title">Widgets → Dashboard</span>
					</div>
					<div class="flow-steps">
						<div class="flow-step">
							<span class="step-icon">👆</span>
							<span>Tapp på widget-sonen</span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">📐</span>
							<span>Widget-sonen <strong>ekspanderer</strong> til fullskjerm — tema-rail og input-samling forsvinner opp/ned</span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">📊</span>
							<span>Innholdet morphes til et <strong>dashboard</strong> — nøkkeltall + grafer</span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">💬</span>
							<span>Chat-input tilgjengelig i bunn — kan stille spørsmål om dataene</span>
						</div>
					</div>
					<div class="flow-note">Ingen overlay. Ingen ny rute. Selve sonen <em>er</em> dashboardet.</div>
				</div>

				<!-- Flyt 2: Tema → Fullskjerm -->
				<div class="flow-card">
					<div class="flow-header">
						<span class="flow-num">02</span>
						<span class="flow-title">Tema → Fullskjerm</span>
					</div>
					<div class="flow-steps">
						<div class="flow-step">
							<span class="step-icon">👆</span>
							<span>Tapp på et tema-chip i tema-railen</span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">🚀</span>
							<span>Widget-samling <strong>forsvinner opp</strong>, input-samling <strong>forsvinner ned</strong></span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">🪟</span>
							<span>Valgt tema fyller hele skjermen — <strong>ThemePage</strong> med Chat / Data / Filer</span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">←</span>
							<span>Sveip ned / tilbake-knapp → hjemskjerm-animasjonen reverses</span>
						</div>
					</div>
					<div class="flow-note">Ingen tab-bar. Tre soner kollapser inn i en.</div>
				</div>

				<!-- Flyt 3: Input → Fullskjerm -->
				<div class="flow-card">
					<div class="flow-header">
						<span class="flow-num">03</span>
						<span class="flow-title">Input → Fullskjerm</span>
					</div>
					<div class="flow-steps">
						<div class="flow-step">
							<span class="step-icon">👆</span>
							<span>Tapp på et input-verktøy (chat, bilde, humør, energi…)</span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">🚀</span>
							<span>Input-samlingen <strong>ekspanderer</strong> til fullskjerm</span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">🎯</span>
							<span>Riktig input-verktøy er <strong>forhåndsvalgt</strong> og i fokus — chat åpner tastatur, humør viser slider, bilde åpner kamera</span>
						</div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step">
							<span class="step-icon">←</span>
							<span>Lagre / avbryt → tilbake til hjemskjerm</span>
						</div>
					</div>
					<div class="flow-note">Andre soner forsvinner ikke — de er bare skyvet ut av syne av den ekspanderte input-sonen.</div>
				</div>

			</div><!-- /flow-grid -->

			<h3 class="subsection" style="margin-top: 40px">Ny flyt: Spør om widget (chat-first)</h3>
			<p class="section-desc">Forslag i chat før opprettelse: preview, konfigurering, målsetting og eksplisitt bekreftelse.</p>

			<div class="wf-grid">
				<div class="wf-card">
					<div class="wf-head">
						<span class="wf-num">A</span>
						<span class="wf-title">1. Bruker beskriver widget</span>
					</div>
					<div class="wf-chat">
						<ChatBubble role="user" text="Lag en widget for dagligvareforbruk per dag siste 30 dager." />
						<ChatBubble role="bot" text="Skjønner. Jeg foreslår en widget med preview først før vi oppretter." />
						<div class="wf-actions wf-actions--compact">
							<button class="btn-primary">Opprett widget</button>
							<button class="btn-chip">Konfigurer</button>
							<button class="btn-ghost">Forkast</button>
						</div>
					</div>
				</div>

				<div class="wf-card">
					<div class="wf-head">
						<span class="wf-num">B</span>
						<span class="wf-title">2. Forslagskort med preview</span>
					</div>
					<div class="wf-preview">
						<ChatBubble role="bot" text="Slik ser forslaget ut. Vil du opprette, justere eller forkaste?" />
						<div class="wf-actions wf-actions--compact">
							<button class="btn-primary">Opprett widget</button>
							<button class="btn-chip">Konfigurer</button>
							<button class="btn-ghost">Forkast</button>
						</div>
						<div class="wf-preview-top">
							<span class="wf-chip">amount</span>
							<span class="wf-chip">sum</span>
							<span class="wf-chip">day</span>
							<span class="wf-chip">last30</span>
							<span class="wf-chip">dagligvare</span>
						</div>
						<div class="wf-preview-body">
							<div class="wf-ring-wrap">
								<GoalRing pct={71} size={74} strokeWidth={5} color="#f0b429" />
								<div class="wf-ring-value">17.7k</div>
							</div>
							<div class="wf-copy">
								<p class="wf-name">Dagligvareforbruk / dag</p>
								<p class="wf-meta">Preview basert på siste 30 dager</p>
							</div>
						</div>
						<div class="wf-actions">
							<button class="btn-primary">Opprett widget</button>
							<button class="btn-chip">Konfigurer</button>
							<button class="btn-ghost">Forkast</button>
						</div>

						<div class="wf-configurator">
							<div class="wf-config-head">Konfigurator (sheet)</div>
							<div class="wf-config-grid">
								<div class="wf-config-item">
									<span class="wf-config-label">Tittel</span>
									<span class="wf-config-value">Dagligvareforbruk / dag</span>
								</div>
								<div class="wf-config-item">
									<span class="wf-config-label">Metrikk</span>
									<span class="wf-config-value">amount</span>
								</div>
								<div class="wf-config-item">
									<span class="wf-config-label">Aggregation</span>
									<span class="wf-config-value">sum</span>
								</div>
								<div class="wf-config-item">
									<span class="wf-config-label">Periode / range</span>
									<span class="wf-config-value">day · last30</span>
								</div>
								<div class="wf-config-item">
									<span class="wf-config-label">Kategori</span>
									<span class="wf-config-value">dagligvare</span>
								</div>
								<div class="wf-config-item">
									<span class="wf-config-label">Mål</span>
									<span class="wf-config-value">ikke satt</span>
								</div>
							</div>
							<div class="wf-actions wf-actions--compact">
								<button class="btn-primary">Opprett widget</button>
								<button class="btn-chip">Konfigurer</button>
								<button class="btn-ghost">Forkast</button>
							</div>
						</div>
					</div>
				</div>

				<div class="wf-card">
					<div class="wf-head">
						<span class="wf-num">C</span>
						<span class="wf-title">3. Målsetting før opprett</span>
					</div>
					<div class="wf-chat">
						<ChatBubble role="bot" text="Hva er optimalt nivå for denne metrikken?" />
						<div class="wf-actions wf-actions--compact">
							<button class="btn-primary">Opprett widget</button>
							<button class="btn-chip">Konfigurer</button>
							<button class="btn-ghost">Forkast</button>
						</div>
						<ChatBubble role="user" text="Mindre enn snittet av forrige periode." />
						<ChatBubble role="bot" text="Notert: relativt mål < avg(prev_period). Klar til opprettelse." />
						<div class="wf-actions wf-actions--compact">
							<button class="btn-primary">Opprett widget</button>
							<button class="btn-chip">Konfigurer</button>
							<button class="btn-ghost">Forkast</button>
						</div>
					</div>
					<div class="wf-pill-row">
						<span class="wf-pill">target: relative_prev_period</span>
						<span class="wf-pill">operator: lt</span>
					</div>
				</div>
			</div>

			<div class="wf-state-row">
				<span class="wf-state">intent_detected</span>
				<span class="wf-state-arrow">→</span>
				<span class="wf-state">draft_created</span>
				<span class="wf-state-arrow">→</span>
				<span class="wf-state">preview_rendered</span>
				<span class="wf-state-arrow">→</span>
				<span class="wf-state">configure/refine</span>
				<span class="wf-state-arrow">→</span>
				<span class="wf-state wf-state-ok">confirm_create</span>
			</div>

			<h3 class="subsection" style="margin-top: 28px">Fullskjerm-konfigurator (forslag)</h3>
			<p class="section-desc">Sticky preview øverst + skrollbar seksjonsliste under. Nedtrekk for tekstvalg og sliders for tall.</p>
			<div class="wf-fullscreen">
				<div class="wf-fullscreen-preview">
					<div class="wf-fullscreen-preview-main">
						<div class="wf-ring-wrap">
							<GoalRing pct={71} size={82} strokeWidth={6} color="#f0b429" />
							<div class="wf-ring-value">17.7k</div>
						</div>
						<div>
							<p class="wf-name" style="font-size:0.82rem">Dagligvareforbruk / dag</p>
							<p class="wf-meta">Live preview oppdateres mens du justerer feltene</p>
						</div>
					</div>
					<div class="wf-actions wf-actions--compact">
						<button class="btn-primary">Opprett widget</button>
						<button class="btn-chip">Konfigurer</button>
						<button class="btn-ghost">Forkast</button>
					</div>
				</div>

				<div class="wf-fullscreen-body">
					<div class="wf-fullscreen-section">
						<div class="wf-fullscreen-title">Grunnoppsett</div>
						<div class="wf-form-grid">
							<label class="wf-field">
								<span>Tittel</span>
								<input value="Dagligvareforbruk / dag" readonly />
							</label>
							<label class="wf-field">
								<span>Metrikk</span>
								<select>
									<option selected>amount</option>
									<option>weight</option>
									<option>steps</option>
								</select>
							</label>
							<label class="wf-field">
								<span>Aggregation</span>
								<select>
									<option>avg</option>
									<option selected>sum</option>
									<option>latest</option>
								</select>
							</label>
							<label class="wf-field">
								<span>Kategori</span>
								<select>
									<option selected>dagligvare</option>
									<option>mat</option>
									<option>transport</option>
								</select>
							</label>
						</div>
					</div>

					<div class="wf-fullscreen-section">
						<div class="wf-fullscreen-title">Tid og oppløsning</div>
						<div class="wf-form-grid">
							<label class="wf-field">
								<span>Periode</span>
								<select>
									<option selected>day</option>
									<option>week</option>
									<option>month</option>
								</select>
							</label>
							<label class="wf-field">
								<span>Range</span>
								<select>
									<option>last7</option>
									<option>last14</option>
									<option selected>last30</option>
									<option>current_month</option>
								</select>
							</label>
						</div>
					</div>

					<div class="wf-fullscreen-section">
						<div class="wf-fullscreen-title">Mål og terskler</div>
						<div class="wf-form-grid">
							<label class="wf-field wf-field--full">
								<span>Måltype</span>
								<select>
									<option>ingen</option>
									<option>absolutt</option>
									<option selected>relativ mot forrige periode</option>
								</select>
							</label>
							<label class="wf-field wf-field--full">
								<span>Toleranse (%)</span>
								<input type="range" min="0" max="20" value="5" />
							</label>
							<label class="wf-field wf-field--full">
								<span>Varselgrense</span>
								<input type="range" min="0" max="100" value="60" />
							</label>
						</div>
					</div>

					<div class="wf-fullscreen-section">
						<div class="wf-fullscreen-title">Råverdier fra filter</div>
						<div class="wf-raw-head">
							<span class="wf-raw-count">47 treff</span>
							<div class="wf-raw-chips">
								<span class="wf-chip">kategori: dagligvare</span>
								<span class="wf-chip">range: last30</span>
								<span class="wf-chip">vis: matcher</span>
							</div>
						</div>
						<div class="wf-raw-list" role="table" aria-label="Råverdier som matcher filter">
							<div class="wf-raw-row wf-raw-row--head" role="row">
								<span>Dato</span>
								<span>Beskrivelse</span>
								<span>Beløp</span>
								<span>Match</span>
							</div>
							{#each [
								{ date: '31.03', desc: 'KIWI STORO', amount: '−289 kr', match: 'regel' },
								{ date: '30.03', desc: 'REMA 1000 Bjølsen', amount: '−412 kr', match: 'regel' },
								{ date: '29.03', desc: 'ODA AS', amount: '−1 084 kr', match: 'mapping' },
								{ date: '27.03', desc: 'MENY RINGNES PARK', amount: '−356 kr', match: 'regel' },
								{ date: '25.03', desc: 'COOP EXTRA SAGENE', amount: '−243 kr', match: 'regel' }
							] as row}
								<div class="wf-raw-row" role="row">
									<span>{row.date}</span>
									<span>{row.desc}</span>
									<span>{row.amount}</span>
									<span>{row.match}</span>
								</div>
							{/each}
						</div>
					</div>
				</div>
			</div>

			<!-- Animasjonsnotater -->
			<h3 class="subsection" style="margin-top: 40px">Animasjonsprinsipper</h3>
			<div class="anim-notes">
				<div class="anim-note">
					<span class="anim-tag">Widgets → Dashboard</span>
					<code>height: 35% → 100vh</code> + <code>border-radius: 18px → 0</code> + morph av innhold. Varighet ~300 ms, ease-out-quint.
				</div>
				<div class="anim-note">
					<span class="anim-tag">Tema-åpning</span>
					Widgets: <code>translateY(-100%)</code>, Inputs: <code>translateY(+100%)</code>. Tema-chip scales til full bredde. ~250 ms.
				</div>
				<div class="anim-note">
					<span class="anim-tag">Input-åpning</span>
					<code>height: 35% → 100vh</code> fra bunn. Tastatur triggers etter animasjon er ferdig (~280 ms).
				</div>
				<div class="anim-note">
					<span class="anim-tag">Ingen tab-bar</span>
					Navigasjon skjer utelukkende ved å interagere med sonene selv. Tilbake = sveip ned fra topp eller X-knapp øverst-venstre.
				</div>
			</div>

		</section>

		<!-- ══ UKEPLAN ══════════════════════════════════════════════════════════ -->
		<section id="Ukeplan" class="section">
			<h2 class="section-heading">Ukeplan</h2>
			<p class="section-desc">Hierarkisk planlegging og refleksjon — fra daglige todos til den episke årsrunden. Todo-liste som sensorwidget på hjemskjermen.</p>

			<!-- Periodestruktur -->
			<h3 class="subsection">Periodestruktur</h3>
			<div class="period-ladder">
				<div class="period-rung">
					<span class="period-rung-label">År</span>
					<span class="period-rung-desc">Livsambisjon · kavalkade · store vendepunkter</span>
				</div>
				<div class="period-connector">↓</div>
				<div class="period-rung">
					<span class="period-rung-label">Kvartal</span>
					<span class="period-rung-desc">1–2 prioriteringer · store prosjekter · kvartalsevaluering</span>
				</div>
				<div class="period-connector">↓</div>
				<div class="period-rung">
					<span class="period-rung-label">Måned</span>
					<span class="period-rung-desc">Fokusord · 3–5 nøkkelmål</span>
				</div>
				<div class="period-connector">↓</div>
				<div class="period-rung period-rung--highlight">
					<span class="period-rung-label">Uke</span>
					<span class="period-rung-desc">Ukemål · dagstodos · ett-setnings-intro · kontekst fra måned og kvartal</span>
				</div>
				<div class="period-connector">↓</div>
				<div class="period-rung">
					<span class="period-rung-label">Dag</span>
					<span class="period-rung-desc">Todo-liste · dagnotis · humør og energi</span>
				</div>
			</div>

			<!-- Ukeplan-format -->
			<h3 class="subsection">Ukeplan-format (interaktiv mockup)</h3>
			<div class="week-card">

				<div class="week-card-header">
					<span class="week-num">Uke 14 · 2026</span>
					<span class="week-headline">Anita reiser fredag og blir til mandag ettermiddag.</span>
				</div>

				<div class="week-context-bar">
					<div class="ctx-period">
						<span class="ctx-period-label">April</span>
						<span class="ctx-item">Planlegge og gjennomføre</span>
						<span class="ctx-item">Veie og trene</span>
						<span class="ctx-item">Knekkebrød og mindre sukker</span>
					</div>
					<div class="ctx-period">
						<span class="ctx-period-label">Q2</span>
						<span class="ctx-item">Ta hverdagene på alvor</span>
					</div>
				</div>

				<div class="week-goals">
					<span class="week-goals-label">Ukemål</span>
					{#each weekGoalChecks as checked, i}
						<button
							class="week-goal-item"
							class:done={checked}
							onclick={() => weekGoalChecks[i] = !weekGoalChecks[i]}
						>
							<span class="wg-check">{checked ? '✓' : '○'}</span>
							<span class="wg-lbl">{['Svømme en dag (torsdag morgen?)', 'Pilates to ganger', 'Sykkel om været vil'][i]}</span>
						</button>
					{/each}
				</div>

				<div class="week-days-row">
					{#each weekDays as day, di}
						<div class="day-col" class:today={di === 1}>
							<div class="day-name">{day.name}</div>
							{#if day.note}<div class="day-note">{day.note}</div>{/if}
							<div class="day-todos">
								{#each day.todos as todo, ti}
									<button
										class="day-todo-item"
										class:checked={dayChecks[di][ti]}
										onclick={() => dayChecks[di][ti] = !dayChecks[di][ti]}
									>
										<span class="todo-circle">{dayChecks[di][ti] ? '✓' : '○'}</span>
										<span class="todo-lbl" class:todo-done={dayChecks[di][ti]}>{todo}</span>
									</button>
								{/each}
							</div>
						</div>
					{/each}
				</div>

			</div>
			<p class="flow-note" style="margin-top: 8px">Interaktiv mockup — klikk for å toggle. Dager rulles horisontalt. Tirsdag (= i dag) er fremhevet.</p>

			<!-- Todo-widget -->
			<h3 class="subsection">Todo-widget (hjemskjerm)</h3>
			<p class="section-desc">Viser dagens fremdrift som en sensor-ring. Kan pinnes i widget-sonen på lik linje med vekt og søvn.</p>
			<div class="todo-widget-demo">
				<div class="tw-widget">
					<svg width="72" height="72" viewBox="0 0 72 72">
						<circle cx="36" cy="36" r="28" fill="none" stroke="#1e1e1e" stroke-width="5"/>
						<circle cx="36" cy="36" r="28" fill="none" stroke="#4a5af0" stroke-width="5"
							stroke-dasharray="175.9"
							stroke-dashoffset="73.3"
							stroke-linecap="round"
							transform="rotate(-90 36 36)"/>
						<text x="36" y="33" dominant-baseline="middle" text-anchor="middle" fill="#eee" font-size="14" font-weight="700">7</text>
						<text x="36" y="46" dominant-baseline="middle" text-anchor="middle" fill="#555" font-size="8">av 12</text>
					</svg>
					<span class="tw-label">Dagens todos</span>
				</div>
				<div class="tw-explainer">
					<div class="tw-row"><span class="tw-dot" style="background:#4a5af0"></span><span>7 av 12 fullført i dag (58 %)</span></div>
					<div class="tw-row"><span class="tw-dot" style="background:#1e1e1e; border: 1px solid #2a2a2a"></span><span>Sensor-ringen fylles proporsjonalt</span></div>
					<div class="tw-row"><span class="tw-dot" style="background:#5fa0a0"></span><span>Streakbadge vises ved 100 % ✓</span></div>
					<div class="tw-row"><span class="tw-dot" style="background:#e07070"></span><span>Rød ring hvis uka har nulldager</span></div>
				</div>
			</div>

			<!-- Planleggingsflyt -->
			<h3 class="subsection">Planleggingsflyt (chat-drevet)</h3>
			<div class="flow-grid">

				<div class="flow-card">
					<div class="flow-header">
						<span class="flow-num">01</span>
						<span class="flow-title">Ny uke → Ukeplan</span>
					</div>
					<div class="flow-steps">
						<div class="flow-step"><span class="step-icon">🏠</span><span>CTA på hjemskjerm: <strong>«Lag en ukeplan»</strong></span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">🤖</span><span>Bot henter måneds- og kvartalmål — gir kontekst uten at du gjentar deg</span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">💬</span><span>Bot spør: <em>«Hva vil du fokusere på? Hva overføres fra forrige uke?»</em></span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">📋</span><span>Bot foreslår 3 ukemål og dagstodos basert på historikk og mål</span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">✅</span><span>Ukeplan lagres · Todo-widget aktiveres · Tema «Uke 14» vises i tema-railen</span></div>
					</div>
				</div>

				<div class="flow-card">
					<div class="flow-header">
						<span class="flow-num">02</span>
						<span class="flow-title">Daglig innsjekk</span>
					</div>
					<div class="flow-steps">
						<div class="flow-step"><span class="step-icon">☀️</span><span>Morgenvarsling (valgfri): <em>«God morgen — 4 todos er satt for i dag»</em></span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">👆</span><span>Trykk på todo-widgeten → liste med dagens oppgaver</span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">✓</span><span>Huk av i listen eller via chat: <em>«Jeg leverte matpakkene»</em></span></div>
					</div>
					<div class="flow-note">Bot lytter passivt — kan registrere fullføring nevnt i samtale uten eksplisitt kommando.</div>
				</div>

				<div class="flow-card">
					<div class="flow-header">
						<span class="flow-num">03</span>
						<span class="flow-title">Refleksjon (flere nivåer)</span>
					</div>
					<div class="flow-steps">
						<div class="flow-step"><span class="step-icon">🌙</span><span><strong>Fredag kveld</strong> — bot: <em>«Uka er snart over. Vil du gjøre en mini-gjennomgang?»</em></span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">📅</span><span><strong>Månedsslutt</strong> — oppsummering av ukeplaner og hva som ble sagt om månedsmålene</span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">🏆</span><span><strong>Nyttår</strong> — den episke kavalkaden (se under)</span></div>
					</div>
				</div>

				<div class="flow-card">
					<div class="flow-header">
						<span class="flow-num">04</span>
						<span class="flow-title">Stressdump (~15 min)</span>
					</div>
					<div class="flow-steps">
						<div class="flow-step"><span class="step-icon">🏠</span><span>CTA på hjemskjerm eller ukeplan: <strong>«Noe kverner?»</strong></span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">🗣️</span><span>Fri samtale — bot lytter uten å avbryte. Ingen struktur påkrevd.</span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">🔍</span><span>Bot oppsummerer: hva er <em>akutt</em>, hva er <em>bekymring</em>, hva er <em>idé</em>?</span></div>
						<div class="flow-arrow">↓</div>
						<div class="flow-step"><span class="step-icon">📋</span><span>Foreslår: nye todos, temaer, eller lagrer bare som dagnotat. <strong>Du velger.</strong></span></div>
					</div>
					<div class="flow-note">Tungt hode → organisert eller akseptert. Ikke en GTD-seanse. Bare prat.</div>
				</div>

			</div>

			<!-- Årsrunden -->
			<h3 class="subsection" style="margin-top: 40px">Årsrunden — den episke kavalkaden</h3>
			<p class="section-desc">Et nyttårsbrev til deg selv. AI-generert, men basert på faktiske data fra hele året.</p>
			<div class="kavalkade-card">
				<div class="kav-year">2025</div>
				<div class="kav-headline">Du fullførte 2 534 oppgaver.</div>
				<div class="kav-stats">
					<div class="kav-stat"><span class="kav-stat-num">2 534</span><span class="kav-stat-lbl">Oppgaver fullført</span></div>
					<div class="kav-stat"><span class="kav-stat-num">48</span><span class="kav-stat-lbl">Ukeplaner skrevet</span></div>
					<div class="kav-stat"><span class="kav-stat-num">312</span><span class="kav-stat-lbl">Treningsøkter</span></div>
					<div class="kav-stat"><span class="kav-stat-num">−4.2 kg</span><span class="kav-stat-lbl">Vektendring</span></div>
				</div>
				<div class="kav-insights">
					<div class="kav-insight-row"><span class="kav-insight-icon">✅</span><span>Det du oftest lyktes med: <strong>Levere i barnehagen</strong></span></div>
					<div class="kav-insight-row"><span class="kav-insight-icon">🔄</span><span>Det du oftest avlyste: <strong>Joggetur</strong></span></div>
					<div class="kav-insight-row"><span class="kav-insight-icon">📈</span><span>Beste kvartal: <strong>Q2 — 72 % ukemål fullført</strong></span></div>
					<div class="kav-insight-row"><span class="kav-insight-icon">💬</span><span>Mest brukte tema: <strong>Familie · Trening · Jobb</strong></span></div>
				</div>
				<div class="kav-narrative">
					«Året begynte med knekkebrød og tidlig seng — og det hjalp faktisk. Du trente mer i Q1 enn noe annet år. Sommeren ble roligere enn planlagt, men det var kanskje akkurat det du trengte.»
				</div>
			</div>

			<!-- CTA-varianter -->
			<h3 class="subsection">CTA-varianter på hjemskjerm (tema-sonen)</h3>
			<p class="section-desc">Tema-sonen viser ulike tilstander avhengig av om brukeren har ukeplan, tema eller ingenting.</p>
			<div class="cta-variants">

				<div class="cta-variant-group">
					<span class="cta-state-label">Ingen temaer · ingen ukeplan</span>
					<button class="up-cta">
						<span class="up-cta-icon"><Icon name="goals" size={16} /></span>
						<span class="up-cta-text">Lag en ukeplan</span>
						<span class="up-cta-arrow"><Icon name="forward" size={16} /></span>
					</button>
				</div>

				<div class="cta-variant-group">
					<span class="cta-state-label">Ukeplan aktiv — i dag</span>
					<div class="up-active">
						<div class="up-active-left">
							<span class="up-active-day">Tirsdag</span>
							<span class="up-active-sub">3 av 5 todos</span>
						</div>
						<div class="up-active-right">
							<svg width="36" height="36" viewBox="0 0 36 36">
								<circle cx="18" cy="18" r="14" fill="none" stroke="#1e1e1e" stroke-width="3"/>
								<circle cx="18" cy="18" r="14" fill="none" stroke="#4a5af0" stroke-width="3"
									stroke-dasharray="87.96" stroke-dashoffset="35.2"
									stroke-linecap="round" transform="rotate(-90 18 18)"/>
							</svg>
						</div>
					</div>
				</div>

				<div class="cta-variant-group">
					<span class="cta-state-label">Fredag — refleksjonspåminnelse</span>
					<button class="up-cta up-cta--reflect">
						<span class="up-cta-icon">🌙</span>
						<span class="up-cta-text">Gjør ukens mini-gjennomgang</span>
						<span class="up-cta-arrow"><Icon name="forward" size={16} /></span>
					</button>
				</div>

			</div>

		</section>

		<!-- ── SJEKKLISTE-FLYT ─────────────────────────────────────────────── -->
		<section id="Sjekkliste-flyt" class="section">
			<h2 class="section-heading">Sjekkliste-flyt</h2>
			<p class="section-desc">Fra chat-input til sjekkliste-widget til fullskjerm-sheet — og payoff-animasjon når alt er ferdig. Opprettes via AI-tool <code>create_checklist</code>.</p>

			<!-- 1. Chat-flyt -->
			<h3 class="subsection">1. Chat → opprett sjekkliste</h3>
			<p class="section-desc">Brukeren skriver en naturlig setning om å forberede noe. AI gjenkjenner intensjon og kaller <code>create_checklist</code>-toolet.</p>
			<div class="cl-chat-demo">
				<div class="cl-bubble cl-bubble-user">Jeg skal på tur til Bergen neste helg, hjelp meg å pakke riktig 🏔</div>
				<div class="cl-bubble cl-bubble-ai">
					<p style="margin:0 0 8px">Jeg har laget en pakkeliste for deg! 🎒</p>
					<div class="cl-ai-list">
						{#each ['🧥 Regnjakke', '👟 Tursko', '🎽 Ullundertøy (x2)', '🧤 Hansker', '🗺 Kart/ruter lastet ned', '🔦 Hodelykt + batteri', '💊 Apotek-pakke', '🔌 Powerbank lada'] as item}
							<div class="cl-ai-item">✓ {item}</div>
						{/each}
					</div>
					<p style="margin:8px 0 0; font-size:0.75rem; color:#555">Sjekklisten "Bergenstur 🏔" er klar i widget-sonen.</p>
				</div>
			</div>

			<!-- 2. Widget-tilstander -->
			<h3 class="subsection" style="margin-top:40px">2. ChecklistWidget — tilstander</h3>
			<p class="section-desc">Samme SVG-ring-komponent som GoalRing, plassert i widget-sonen på hjemskjermen. Fargen går fra blå → grønn ved fullføring.</p>
			<div class="cl-widget-row">
				<!-- 0/8 -->
				<div class="cl-widget-demo">
					<div class="cl-ring-wrap">
						<svg viewBox="0 0 80 80" width="80" height="80">
							<circle cx="40" cy="40" r="32" fill="none" stroke="#1a1a2a" stroke-width="6"/>
							<circle cx="40" cy="40" r="32" fill="none" stroke="#7c8ef5" stroke-width="6"
								stroke-dasharray="0 201" stroke-linecap="round" transform="rotate(-90 40 40)"/>
						</svg>
						<div class="cl-ring-center">🏔</div>
					</div>
					<span class="cl-widget-count">0/8</span>
					<span class="cl-widget-title">Bergenstur</span>
				</div>
				<!-- 5/8 -->
				<div class="cl-widget-demo">
					<div class="cl-ring-wrap">
						<svg viewBox="0 0 80 80" width="80" height="80">
							<circle cx="40" cy="40" r="32" fill="none" stroke="#1a1a2a" stroke-width="6"/>
							<circle cx="40" cy="40" r="32" fill="none" stroke="#7c8ef5" stroke-width="6"
								stroke-dasharray="125.6 75.4" stroke-linecap="round" transform="rotate(-90 40 40)"/>
						</svg>
						<div class="cl-ring-center">🏔</div>
					</div>
					<span class="cl-widget-count">5/8</span>
					<span class="cl-widget-title">Bergenstur</span>
				</div>
				<!-- 8/8 komplett -->
				<div class="cl-widget-demo">
					<div class="cl-ring-wrap">
						<svg viewBox="0 0 80 80" width="80" height="80">
							<circle cx="40" cy="40" r="32" fill="none" stroke="#1a2a1a" stroke-width="6"/>
							<circle cx="40" cy="40" r="32" fill="none" stroke="#5fa080" stroke-width="6"
								stroke-dasharray="201 0" stroke-linecap="round" transform="rotate(-90 40 40)"/>
						</svg>
						<div class="cl-ring-center" style="color:#5fa080">✓</div>
					</div>
					<span class="cl-widget-count" style="color:#5fa080">8/8</span>
					<span class="cl-widget-title">Ferdig! 🎉</span>
				</div>
			</div>

			<!-- 3. Sheet -->
			<h3 class="subsection" style="margin-top:40px">3. ChecklistSheet — liste og avkryssing</h3>
			<p class="section-desc">Bottom-sheet-overlay. Glir opp fra bunnen ved trykk på widget. Viser alle punkter med avkryssings-UI, fremdriftsbar og «Legg til punkt»-input.</p>
			<div class="cl-sheet-demo">
				<div class="cl-sheet-header">
					<div style="display:flex;align-items:center;gap:10px">
						<span style="font-size:1.4rem">🏔</span>
						<div>
							<div style="font-size:0.95rem;font-weight:700;color:#eee">Bergenstur</div>
							<div style="font-size:0.7rem;color:#555">5 av 8 fullført</div>
						</div>
					</div>
					<div style="width:28px;height:28px;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#555;font-size:0.7rem">✕</div>
				</div>
				<div style="height:3px;background:#1e1e1e;margin:0 16px;border-radius:999px">
					<div style="width:62.5%;height:100%;background:#7c8ef5;border-radius:999px"></div>
				</div>
				<div class="cl-sheet-items">
					{#each [
						{ text: '🧥 Regnjakke', checked: true },
						{ text: '👟 Tursko', checked: true },
						{ text: '🎽 Ullundertøy (x2)', checked: true },
						{ text: '🧤 Hansker', checked: true },
						{ text: '🗺 Kart/ruter lastet ned', checked: true },
						{ text: '🔦 Hodelykt + batteri', checked: false },
						{ text: '💊 Apotek-pakke', checked: false },
						{ text: '🔌 Powerbank lada', checked: false },
					] as item}
						<div class="cl-sheet-item" class:cl-item-done={item.checked}>
							<div class="cl-sheet-cb" class:cl-cb-checked={item.checked}>
								{#if item.checked}<span style="color:white;font-size:0.65rem;font-weight:700">✓</span>{/if}
							</div>
							<span class="cl-sheet-item-text">{item.text}</span>
						</div>
					{/each}
				</div>
				<div style="display:flex;gap:8px;padding:10px 16px;border-top:1px solid #1a1a1a">
					<div style="flex:1;background:#161616;border:1px solid #2a2a2a;border-radius:8px;padding:7px 10px;font-size:0.8rem;color:#444">Legg til punkt…</div>
					<div style="width:34px;height:34px;background:#2a2a2a;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#555">＋</div>
				</div>
			</div>

			<!-- 4. Payoff -->
			<h3 class="subsection" style="margin-top:40px">4. Payoff — alt er klart!</h3>
			<p class="section-desc">Vises automatisk når siste punkt krysses av. Ring-animasjon + tekst + emoji. Trykk for å lukke. Designprinsipp: rask belønning, ingen modal-stack, ingen knapper å trykke.</p>
			<div class="cl-payoff-demo">
				<div class="cl-payoff-ring-wrap">
					<svg viewBox="0 0 100 100" width="100" height="100">
						<circle cx="50" cy="50" r="40" fill="none" stroke="#1a2a1a" stroke-width="8"/>
						<circle cx="50" cy="50" r="40" fill="none" stroke="#5fa080" stroke-width="8"
							stroke-dasharray="251 0" stroke-linecap="round" transform="rotate(-90 50 50)"/>
					</svg>
					<div class="cl-payoff-ring-inner">🏔</div>
				</div>
				<div style="font-size:1.3rem;font-weight:700;color:#eee;margin-top:12px">Alt er klart!</div>
				<div style="font-size:0.8rem;color:#888;margin-top:4px">Bergenstur</div>
				<div style="font-size:0.65rem;color:#444;margin-top:12px">Trykk hvor som helst for å lukke</div>
			</div>

			<!-- 5. Dataflyt -->
			<h3 class="subsection" style="margin-top:40px">5. Dataflyt og API</h3>
			<div class="cl-flow">
				<div class="cl-flow-step"><span class="cl-flow-icon">💬</span><span>Bruker: «Jeg skal på tur…»</span></div>
				<div class="cl-flow-arrow">↓</div>
				<div class="cl-flow-step"><span class="cl-flow-icon">🤖</span><span>AI kaller <code>create_checklist</code> — title, emoji, items[]</span></div>
				<div class="cl-flow-arrow">↓</div>
				<div class="cl-flow-step"><span class="cl-flow-icon">🗄</span><span>POST /api/checklists → INSERT checklists + checklist_items</span></div>
				<div class="cl-flow-arrow">↓</div>
				<div class="cl-flow-step"><span class="cl-flow-icon">🏠</span><span>HomeScreen refetcher /api/checklists → ChecklistWidget dukker opp</span></div>
				<div class="cl-flow-arrow">↓</div>
				<div class="cl-flow-step"><span class="cl-flow-icon">☑</span><span>Trykk widget → ChecklistSheet → PATCH /api/checklists/[id]/items/[itemId]</span></div>
				<div class="cl-flow-arrow">↓</div>
				<div class="cl-flow-step" style="border-color:#5fa080"><span class="cl-flow-icon">🎉</span><span>Alle krysset av → completedAt settes → Payoff-animasjon</span></div>
			</div>

		</section>

	</main>
	</div>
</AppPage>

<style>
	/* ── Layout ── */
	.page {
		/* Tving mørkt tema uavhengig av systemvalg — design-siden er alltid mørk */
		--bg-primary: #0f0f0f;
		--bg-card: #1a1a1a;
		--bg-hover: #222;
		--border-color: #2a2a2a;
		--border-subtle: #1e1e1e;
		--text-primary: #eee;
		--text-secondary: #aaa;
		--text-tertiary: #555;
		--accent-primary: #4a5af0;
		--accent-hover: #3a4adf;
		--error-bg: rgba(224, 112, 112, 0.08);
		--error-text: #e07070;
		--error-border: #6a2a2a;

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
		line-height: 1.7;
	}
	.vname code {
		display: block;
		font-size: 0.65rem;
		font-family: 'SF Mono', 'Fira Mono', monospace;
		color: #5a6adb;
		background: #14192a;
		border-radius: 4px;
		padding: 1px 5px;
		text-transform: none;
		letter-spacing: 0;
		white-space: nowrap;
	}

	/* ── Ikon-grid ── */
	.icon-theme-lab {
		--icon-bg-0: hsl(var(--icon-hue) 100% 5%);
		--icon-bg-1: hsl(var(--icon-hue) 58% 8%);
		--icon-bg-2: hsl(var(--icon-hue) 44% 12%);
		--icon-border: hsl(var(--icon-hue) 26% 28%);
		--icon-border-strong: hsl(var(--icon-hue) 42% 40%);
		--icon-fg: hsl(var(--icon-hue) 92% 78%);
		--icon-fg-soft: hsl(var(--icon-hue) 62% 74%);
		--icon-text: hsl(var(--icon-hue) 26% 90%);
		--icon-muted: hsl(var(--icon-hue) 20% 68%);
		--icon-subtle: hsl(var(--icon-hue) 14% 52%);
		display: flex;
		flex-direction: column;
		gap: 14px;
		transition: background-color 260ms ease, border-color 260ms ease, color 260ms ease;
	}

	.icon-theme-lab.light-mode {
		--icon-bg-0: hsl(var(--icon-hue) 70% 98%);
		--icon-bg-1: hsl(var(--icon-hue) 46% 96%);
		--icon-bg-2: hsl(var(--icon-hue) 30% 92%);
		--icon-border: hsl(var(--icon-hue) 20% 78%);
		--icon-border-strong: hsl(var(--icon-hue) 34% 58%);
		--icon-fg: hsl(var(--icon-hue) 42% 30%);
		--icon-fg-soft: hsl(var(--icon-hue) 50% 38%);
		--icon-text: hsl(var(--icon-hue) 22% 18%);
		--icon-muted: hsl(var(--icon-hue) 16% 34%);
		--icon-subtle: hsl(var(--icon-hue) 14% 44%);
	}

	.icon-theme-controls {
		display: flex;
		flex-direction: column;
		gap: 12px;
		background: var(--icon-bg-1);
		border: 1px solid var(--icon-border);
		border-radius: 12px;
		padding: 12px;
	}

	.icon-hue-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 10px;
	}

	.icon-hue-label {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--icon-muted);
	}

	.icon-hue-slider {
		width: 100%;
		accent-color: var(--icon-fg-soft);
	}

	.icon-hue-value {
		font-size: 0.72rem;
		color: var(--icon-fg-soft);
		font-family: 'SF Mono', 'Fira Mono', monospace;
	}

	.icon-mode-row {
		display: inline-flex;
		gap: 6px;
		align-self: flex-start;
		background: var(--icon-bg-0);
		border: 1px solid var(--icon-border);
		border-radius: 999px;
		padding: 4px;
	}

	.icon-mode-btn {
		padding: 5px 10px;
		border: none;
		background: transparent;
		color: var(--icon-muted);
		border-radius: 999px;
		font: inherit;
		font-size: 0.72rem;
		cursor: pointer;
		transition: background-color 220ms ease, color 220ms ease;
	}

	.icon-mode-btn.active {
		background: var(--icon-bg-2);
		color: var(--icon-fg);
	}

	.icon-preset-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.icon-preset-btn {
		padding: 8px 10px;
		border-radius: 12px;
		border: 1px solid var(--icon-border);
		background: var(--icon-bg-0);
		color: var(--icon-muted);
		font: inherit;
		font-size: 0.7rem;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		cursor: pointer;
		transition: background-color 220ms ease, border-color 220ms ease, color 220ms ease;
	}

	.icon-preset-btn small {
		font-size: 0.62rem;
		color: var(--icon-subtle);
	}

	.icon-preset-btn:hover {
		border-color: var(--icon-border-strong);
		color: var(--icon-fg-soft);
	}

	.icon-preset-btn.active {
		border-color: var(--icon-border-strong);
		background: var(--icon-bg-2);
		color: var(--icon-fg);
	}

	.icon-token-strip {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
	}

	.icon-token-swatch {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.68rem;
		color: var(--icon-muted);
	}

	.icon-token-dot {
		width: 12px;
		height: 12px;
		border-radius: 999px;
		border: 1px solid var(--icon-border);
		display: inline-block;
	}

	.icon-token-dot--bg0 { background: var(--icon-bg-0); }
	.icon-token-dot--bg1 { background: var(--icon-bg-1); }
	.icon-token-dot--bg2 { background: var(--icon-bg-2); }
	.icon-token-dot--border { background: var(--icon-border); border-color: var(--icon-border-strong); }
	.icon-token-dot--fg { background: var(--icon-fg); border-color: transparent; }

	.icon-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 14px;
	}

	.icon-card {
		background: var(--icon-bg-1);
		border: 1px solid var(--icon-border);
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		transition: border-color 240ms ease, background-color 240ms ease;
	}

	.icon-card:hover {
		border-color: var(--icon-border-strong);
		background: var(--icon-bg-2);
	}

	/* ── Widget flow demo ── */
	.wf-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
		gap: 14px;
	}

	.wf-card {
		background: #141414;
		border: 1px solid #232323;
		border-radius: 14px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wf-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.wf-num {
		width: 20px;
		height: 20px;
		border-radius: 999px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #1f2a56;
		color: #9fb0ff;
		font-size: 0.68rem;
		font-weight: 700;
	}

	.wf-title {
		font-size: 0.76rem;
		font-weight: 650;
		color: #b7b7b7;
	}

	.wf-chat {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.wf-preview {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wf-preview-top {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.wf-chip {
		font-size: 0.62rem;
		padding: 3px 7px;
		border-radius: 999px;
		background: #1d1d1d;
		border: 1px solid #2c2c2c;
		color: #777;
	}

	.wf-preview-body {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.wf-ring-wrap {
		position: relative;
		width: 74px;
		height: 74px;
		flex-shrink: 0;
	}

	.wf-ring-value {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.78rem;
		font-weight: 700;
		color: #ddd;
	}

	.wf-name {
		margin: 0;
		font-size: 0.76rem;
		color: #cfcfcf;
	}

	.wf-meta {
		margin: 3px 0 0;
		font-size: 0.68rem;
		color: #666;
	}

	.wf-actions {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.wf-actions--compact :global(button) {
		padding: 7px 10px;
		font-size: 0.72rem;
	}

	.wf-configurator {
		margin-top: 4px;
		padding: 10px;
		border: 1px solid #2b2b2b;
		border-radius: 12px;
		background: #111111;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wf-config-head {
		font-size: 0.68rem;
		font-weight: 700;
		color: #8d8d8d;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.wf-config-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}

	.wf-config-item {
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 9px;
		padding: 7px 8px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.wf-config-label {
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #666;
	}

	.wf-config-value {
		font-size: 0.74rem;
		color: #c4c4c4;
	}

	.wf-pill-row {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.wf-pill {
		font-size: 0.64rem;
		padding: 4px 8px;
		border-radius: 8px;
		background: #171717;
		border: 1px solid #2a2a2a;
		color: #8c8c8c;
	}

	.wf-state-row {
		margin-top: 12px;
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}

	.wf-state {
		font-size: 0.64rem;
		padding: 5px 8px;
		border-radius: 7px;
		background: #171717;
		border: 1px solid #292929;
		color: #7c7c7c;
	}

	.wf-state-ok {
		border-color: #355f45;
		color: #86b99a;
	}

	.wf-state-arrow {
		color: #4d4d4d;
		font-size: 0.72rem;
	}

	.wf-fullscreen {
		margin-top: 10px;
		height: min(78vh, 680px);
		border: 1px solid #262626;
		border-radius: 14px;
		overflow: hidden;
		background: #101010;
		display: flex;
		flex-direction: column;
	}

	.wf-fullscreen-preview {
		position: sticky;
		top: 0;
		z-index: 2;
		background: #111111;
		border-bottom: 1px solid #242424;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wf-fullscreen-preview-main {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.wf-fullscreen-body {
		overflow: auto;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.wf-fullscreen-section {
		background: #141414;
		border: 1px solid #252525;
		border-radius: 12px;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.wf-fullscreen-title {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #7a7a7a;
		font-weight: 700;
	}

	.wf-form-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.wf-field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}

	.wf-field--full {
		grid-column: 1 / -1;
	}

	.wf-field span {
		font-size: 0.64rem;
		color: #6d6d6d;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.wf-field input,
	.wf-field select {
		height: 34px;
		border-radius: 8px;
		border: 1px solid #2b2b2b;
		background: #0f0f0f;
		color: #d3d3d3;
		padding: 0 10px;
		font-size: 0.76rem;
	}

	.wf-field input[type='range'] {
		height: auto;
		padding: 0;
		accent-color: #4a5af0;
	}

	.wf-raw-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.wf-raw-count {
		font-size: 0.72rem;
		font-weight: 650;
		color: #9b9b9b;
	}

	.wf-raw-chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.wf-raw-list {
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		overflow: hidden;
	}

	.wf-raw-row {
		display: grid;
		grid-template-columns: 62px 1fr 86px 68px;
		gap: 8px;
		padding: 8px 10px;
		font-size: 0.72rem;
		color: #b8b8b8;
		border-top: 1px solid #212121;
	}

	.wf-raw-row:first-child {
		border-top: none;
	}

	.wf-raw-row--head {
		background: #121212;
		font-size: 0.62rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #6f6f6f;
		font-weight: 700;
	}

	.icon-preview {
		width: 44px;
		height: 44px;
		border-radius: 12px;
		display: grid;
		place-items: center;
		background: var(--icon-bg-0);
		border: 1px solid var(--icon-border);
		color: var(--icon-fg);
		transition: border-color 260ms ease, background-color 260ms ease, color 260ms ease;
	}

	.icon-token {
		margin: 0;
		font-family: 'SF Mono', 'Fira Mono', monospace;
		font-size: 0.68rem;
		color: var(--icon-fg-soft);
		transition: color 260ms ease;
	}

	.icon-label {
		margin: 0;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--icon-text);
		transition: color 260ms ease;
	}

	.icon-legacy {
		margin: 0;
		font-size: 0.67rem;
		color: var(--icon-subtle);
		line-height: 1.35;
		transition: color 260ms ease;
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

	/* ── Knapper — definert globalt i app.css (.btn-primary, .btn-secondary, .btn-ghost, .btn-chip, .btn-danger, .btn-icon) ── */

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

	/* ds-input — definert globalt i app.css */

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
	/* .subtab — definert globalt i app.css */

	/* ── Seksjons-intro ── */
	.section-desc {
		font-size: 0.8rem;
		color: #555;
		margin: -10px 0 28px;
		line-height: 1.6;
	}

	/* ── Hjemskjerm-mockup ── */
	.layout-compare {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
		margin-bottom: 40px;
	}

	.layout-option {
		flex: 1;
		min-width: 240px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.layout-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #888;
		text-align: center;
	}

	.layout-notes {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.7rem;
		padding: 8px;
		background: #0d0d0d;
		border-radius: 8px;
	}

	.note-item {
		margin: 0;
		color: #666;
		line-height: 1.4;
	}

	.hs-mockup {
		display: flex;
		flex-direction: column;
		width: 220px;
		height: 440px;
		border: 1px solid #2a2a2a;
		border-radius: 28px;
		overflow: hidden;
		background: #111;
	}

	.hs-zone {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 10px 16px;
		position: relative;
		gap: 8px;
	}
	.hs-zone + .hs-zone { border-top: 1px solid #1e1e1e; }

	.hs-title  { height: 10%; background: #0f0f0f; }
	.hs-widgets { height: 35%; background: #121212; }
	.hs-tema   { height: 20%; background: #111; }
	.hs-input  { height: 35%; background: #0d0d0d; }

	.hs-zone-label {
		font-size: 0.68rem;
		font-weight: 600;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	.hs-zone-pct {
		position: absolute;
		top: 8px;
		right: 12px;
		font-size: 0.65rem;
		color: #444;
	}

	.hs-widget-dots {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.hs-dot {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: #1e1e1e;
		border: 1px solid #2a2a2a;
	}

	.hs-chips {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

	.hs-chip {
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid #2a2a2a;
		background: transparent;
		color: #666;
		font-size: 0.65rem;
	}

	.hs-tema-large {
		background: #0f0f14 !important;
	}

	.tema-grid-preview {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 6px;
		flex: 1;
	}

	.tema-box {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		aspect-ratio: 1;
	}

	/* ── Interaksjonsflyter ── */
	.flow-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 20px;
	}

	.flow-card {
		background: #111;
		border: 1px solid #222;
		border-radius: 14px;
		padding: 20px;
	}

	.flow-header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 16px;
	}

	.flow-num {
		font-size: 0.65rem;
		font-weight: 700;
		color: #444;
		letter-spacing: 0.08em;
	}

	.flow-title {
		font-size: 0.82rem;
		font-weight: 600;
		color: #ccc;
	}

	.flow-steps {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.flow-step {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		background: #161616;
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 0.75rem;
		color: #999;
		line-height: 1.45;
	}
	.flow-step strong { color: #ccc; }

	.step-icon {
		flex-shrink: 0;
		font-size: 0.85rem;
		margin-top: 1px;
	}

	.flow-arrow {
		text-align: center;
		color: #333;
		font-size: 0.75rem;
	}

	.flow-note {
		margin-top: 12px;
		font-size: 0.7rem;
		color: #555;
		font-style: italic;
		line-height: 1.5;
	}

	/* ── Animasjonsnotater ── */
	.anim-notes {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.anim-note {
		background: #111;
		border: 1px solid #222;
		border-radius: 10px;
		padding: 12px 16px;
		font-size: 0.76rem;
		color: #888;
		line-height: 1.55;
	}
	.anim-note code {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 0.72rem;
		color: #9ba8f5;
	}

	.anim-tag {
		display: inline-block;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		padding: 2px 8px;
		font-size: 0.68rem;
		font-weight: 600;
		color: #ccc;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 6px;
	}

	/* ── Designprinsipper ── */

	.principles-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 16px;
	}

	.principle-card {
		background: #111;
		border: 1px solid #1e1e1e;
		border-radius: 14px;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.principle-icon {
		font-size: 1.2rem;
		line-height: 1;
		color: #4a5af0;
	}

	.principle-title {
		font-size: 0.88rem;
		font-weight: 700;
		color: #ccc;
		letter-spacing: -0.01em;
		margin: 0;
	}

	.principle-body {
		font-size: 0.76rem;
		color: #666;
		line-height: 1.55;
		margin: 0;
		flex: 1;
	}

	.principle-body em { color: #888; font-style: italic; }

	.principle-contrast {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 10px;
		border-top: 1px solid #1a1a1a;
	}

	.contrast-no {
		font-size: 0.7rem;
		color: #6a2a2a;
	}

	.contrast-yes {
		font-size: 0.7rem;
		color: #3a5a30;
	}

	/* ── Ukeplan ── */

	.period-ladder {
		display: flex;
		flex-direction: column;
		gap: 0;
		max-width: 480px;
		margin-bottom: 40px;
	}

	.period-rung {
		display: flex;
		align-items: baseline;
		gap: 12px;
		background: #111;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		padding: 10px 14px;
	}

	.period-rung--highlight {
		background: #14192a;
		border-color: #2a3060;
	}

	.period-rung-label {
		font-size: 0.72rem;
		font-weight: 700;
		color: #ccc;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		min-width: 64px;
		flex-shrink: 0;
	}

	.period-rung--highlight .period-rung-label {
		color: #7c8ef5;
	}

	.period-rung-desc {
		font-size: 0.75rem;
		color: #555;
		line-height: 1.5;
	}

	.period-connector {
		padding: 2px 0 2px 22px;
		font-size: 0.7rem;
		color: #333;
	}

	/* Week card */
	.week-card {
		background: #111;
		border: 1px solid #2a2a2a;
		border-radius: 16px;
		padding: 20px 20px 0;
		max-width: 680px;
		overflow: hidden;
	}

	.week-card-header {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 14px;
	}

	.week-num {
		font-size: 1.25rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.02em;
	}

	.week-headline {
		font-size: 0.82rem;
		font-style: italic;
		color: #666;
	}

	.week-context-bar {
		display: flex;
		gap: 20px;
		padding: 10px 0;
		border-top: 1px solid #1e1e1e;
		border-bottom: 1px solid #1e1e1e;
		margin-bottom: 14px;
		flex-wrap: wrap;
	}

	.ctx-period {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.ctx-period-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #444;
		margin-bottom: 2px;
	}

	.ctx-item {
		font-size: 0.72rem;
		color: #666;
	}

	.week-goals {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 14px;
	}

	.week-goals-label {
		font-size: 0.65rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #444;
		margin-bottom: 4px;
	}

	.week-goal-item {
		display: flex;
		align-items: center;
		gap: 8px;
		background: transparent;
		border: none;
		padding: 4px 0;
		cursor: pointer;
		color: inherit;
		font: inherit;
		text-align: left;
	}

	.wg-check {
		font-size: 0.8rem;
		color: #444;
		width: 16px;
		text-align: center;
	}

	.week-goal-item.done .wg-check { color: #4a5af0; }

	.wg-lbl {
		font-size: 0.82rem;
		color: #888;
	}

	.week-goal-item.done .wg-lbl {
		text-decoration: line-through;
		color: #555;
	}

	/* Day columns */
	.week-days-row {
		display: flex;
		gap: 0;
		overflow-x: auto;
		border-top: 1px solid #1e1e1e;
		margin: 0 -20px;
		padding: 0 20px;
		-webkit-overflow-scrolling: touch;
	}

	.day-col {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px 16px 16px;
		min-width: 130px;
		border-left: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.day-col:first-child { border-left: none; }

	.day-col.today {
		background: #14192a;
		border-color: #2a3060;
	}

	.day-name {
		font-size: 0.72rem;
		font-weight: 700;
		color: #aaa;
		margin-bottom: 2px;
	}

	.day-col.today .day-name { color: #7c8ef5; }

	.day-note {
		font-size: 0.7rem;
		font-style: italic;
		color: #555;
		margin-bottom: 6px;
	}

	.day-todos {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.day-todo-item {
		display: flex;
		align-items: baseline;
		gap: 6px;
		background: transparent;
		border: none;
		padding: 2px 0;
		cursor: pointer;
		color: inherit;
		font: inherit;
		text-align: left;
	}

	.todo-circle {
		font-size: 0.65rem;
		color: #444;
		flex-shrink: 0;
		width: 12px;
		text-align: center;
	}

	.day-todo-item.checked .todo-circle { color: #4a5af0; }

	.todo-lbl {
		font-size: 0.75rem;
		color: #777;
		line-height: 1.4;
	}

	.todo-done {
		text-decoration: line-through;
		color: #444;
	}

	/* Todo widget demo */
	.todo-widget-demo {
		display: flex;
		align-items: center;
		gap: 28px;
		margin-bottom: 40px;
	}

	.tw-widget {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
	}

	.tw-label {
		font-size: 0.65rem;
		color: #555;
		text-align: center;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.tw-explainer {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.tw-row {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.76rem;
		color: #888;
	}

	.tw-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	/* Kavalkade */
	.kavalkade-card {
		background: #0a0a0f;
		border: 1px solid #2a3060;
		border-radius: 18px;
		padding: 28px;
		max-width: 520px;
		margin-bottom: 40px;
	}

	.kav-year {
		font-size: 0.72rem;
		font-weight: 700;
		color: #4a5af0;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		margin-bottom: 6px;
	}

	.kav-headline {
		font-size: 1.5rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.02em;
		margin-bottom: 20px;
	}

	.kav-stats {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 12px;
		margin-bottom: 20px;
	}

	.kav-stat {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: #111;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		padding: 10px 14px;
	}

	.kav-stat-num {
		font-size: 1.1rem;
		font-weight: 700;
		color: #eee;
		letter-spacing: -0.02em;
	}

	.kav-stat-lbl {
		font-size: 0.68rem;
		color: #555;
	}

	.kav-insights {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-bottom: 18px;
	}

	.kav-insight-row {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 0.78rem;
		color: #888;
		line-height: 1.5;
	}

	.kav-insight-row strong { color: #ccc; }

	.kav-insight-icon {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.kav-narrative {
		font-size: 0.82rem;
		font-style: italic;
		color: #666;
		line-height: 1.65;
		border-top: 1px solid #1e1e1e;
		padding-top: 14px;
	}

	/* CTA-varianter */
	.cta-variants {
		display: flex;
		flex-wrap: wrap;
		gap: 20px;
		align-items: flex-start;
	}

	.cta-variant-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.cta-state-label {
		font-size: 0.65rem;
		color: #555;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.07em;
	}

	.up-cta {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 10px 14px;
		cursor: pointer;
		width: 220px;
		color: #888;
		font-size: 0.82rem;
		transition: background 0.15s, border-color 0.15s;
	}

	.up-cta:hover { background: #222; border-color: #4a5af0; color: #aaa; }

	.up-cta--reflect { border-color: #2a3020; background: #111a10; }
	.up-cta--reflect:hover { border-color: #5fa080; }

	.up-cta-icon { font-size: 1rem; color: #4a5af0; }
	.up-cta--reflect .up-cta-icon { color: #5fa080; }
	.up-cta-text { flex: 1; text-align: left; }
	.up-cta-arrow { color: #444; }

	.up-active {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: #14192a;
		border: 1px solid #2a3060;
		border-radius: 10px;
		padding: 10px 14px;
		width: 220px;
	}

	.up-active-left {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.up-active-day {
		font-size: 0.82rem;
		font-weight: 600;
		color: #ccc;
	}

	.up-active-sub {
		font-size: 0.7rem;
		color: #555;
	}

        /* ── Sjekkliste-flyt ── */
        .cl-chat-demo {
                display: flex;
                flex-direction: column;
                gap: 10px;
                max-width: 360px;
        }

        .cl-bubble {
                padding: 10px 14px;
                border-radius: 14px;
                font-size: 0.85rem;
                line-height: 1.5;
        }

        .cl-bubble-user {
                background: #4a5af0;
                color: #eee;
                align-self: flex-end;
                border-bottom-right-radius: 4px;
        }

        .cl-bubble-ai {
                background: #1a1a1a;
                border: 1px solid #2a2a2a;
                color: #ccc;
                align-self: flex-start;
                border-bottom-left-radius: 4px;
        }

        .cl-ai-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
        }

        .cl-ai-item {
                font-size: 0.78rem;
                color: #888;
                padding: 2px 0;
        }

        .cl-widget-row {
                display: flex;
                gap: 16px;
                flex-wrap: wrap;
                align-items: flex-start;
        }

        .cl-widget-demo {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 4px;
        }

        .cl-ring-wrap {
                position: relative;
                width: 80px;
                height: 80px;
        }

        .cl-ring-center {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.3rem;
                font-weight: 700;
        }

        .cl-widget-count {
                font-size: 0.72rem;
                color: #555;
                font-variant-numeric: tabular-nums;
        }

        .cl-widget-title {
                font-size: 0.72rem;
                color: #888;
                max-width: 80px;
                text-align: center;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
        }

        .cl-sheet-demo {
                background: #111;
                border: 1px solid #222;
                border-radius: 16px;
                max-width: 340px;
                overflow: hidden;
        }

        .cl-sheet-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 16px 16px 10px;
        }

        .cl-sheet-items {
                padding: 8px 16px;
                display: flex;
                flex-direction: column;
                gap: 2px;
        }

        .cl-sheet-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 7px 8px;
                border-radius: 8px;
        }

        .cl-sheet-cb {
                width: 20px;
                height: 20px;
                border-radius: 50%;
                border: 2px solid #333;
                flex-shrink: 0;
                display: flex;
                align-items: center;
                justify-content: center;
        }

        .cl-cb-checked {
                border-color: #5fa080;
                background: #5fa080;
        }

        .cl-sheet-item-text {
                font-size: 0.82rem;
                color: #ccc;
        }

        .cl-item-done .cl-sheet-item-text {
                color: #444;
                text-decoration: line-through;
        }

        .cl-payoff-demo {
                background: rgba(0, 10, 0, 0.6);
                border: 1px solid #1a2a1a;
                border-radius: 16px;
                max-width: 240px;
                padding: 32px 24px;
                display: flex;
                flex-direction: column;
                align-items: center;
                text-align: center;
        }

        .cl-payoff-ring-wrap {
                position: relative;
                width: 100px;
                height: 100px;
        }

        .cl-payoff-ring-inner {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 2rem;
        }

        .cl-flow {
                display: flex;
                flex-direction: column;
                gap: 0;
                max-width: 480px;
        }

        .cl-flow-step {
                display: flex;
                align-items: center;
                gap: 10px;
                background: #141414;
                border: 1px solid #222;
                border-radius: 8px;
                padding: 10px 14px;
                font-size: 0.82rem;
                color: #aaa;
        }

        .cl-flow-icon {
                font-size: 1rem;
                width: 24px;
                text-align: center;
                flex-shrink: 0;
        }

        .cl-flow-arrow {
                text-align: center;
                color: #333;
                font-size: 0.9rem;
                padding: 2px 0;
                padding-left: 19px;
        }

	/* ── Hjemskjerm v2 demos ── */
	.hs-v2-demo {
		margin-bottom: 32px;
	}

	.demo-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #888;
		margin-bottom: 12px;
	}

	/* Tema v3 (store runde knapper med hvite ikoner) */
	.tema-v3-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 14px;
		max-width: 400px;
	}

	.tema-btn-v3 {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 20px;
		padding: 28px 16px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.tema-btn-v3:hover {
		background: #222;
	}

	.tema-btn-v3-icon {
		font-size: 2rem;
	}

	.tema-btn-v3-label {
		font-size: 0.85rem;
		color: #ccc;
		font-weight: 500;
	}

	/* Input v4 (felt + tre ikon-knapper) */
	.input-v4 {
		display: flex;
		gap: 10px;
		align-items: center;
		max-width: 500px;
	}

	.input-v4 .input-field-wrap {
		flex: 1;
	}

	.input-field-v4 {
		flex: 1;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 14px;
		padding: 12px 16px;
		color: #ccc;
		font: inherit;
		font-size: 0.88rem;
		outline: none;
		transition: border-color 0.15s;
	}

	.input-field-v4:focus {
		border-color: #3c4f9f;
	}

	.input-field-v4::placeholder {
		color: #555;
	}

	.icon-btn-v4 {
		width: 42px;
		height: 42px;
		border-radius: 12px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #ccc;
		font-size: 1.1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 0.15s, color 0.15s;
		flex-shrink: 0;
	}

	.icon-btn-v4:hover {
		background: #222;
		color: #fff;
	}

	.icon-btn-v4:active {
		transform: scale(0.95);
	}

</style>

