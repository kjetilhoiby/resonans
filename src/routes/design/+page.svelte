<script lang="ts">
	import {
		AppPage,
		PageSection,
		Button,
		IconButton,
		Input,
		Textarea,
		Select,
		Checkbox,
		StatusBadge,
		Skeleton,
		DateInput,
		TimeInput,
		PageHeader,
		Section,
		SectionLabel,
		CardTitle,
		SectionCard,
		ExpandableCard,
		CompactRecordList,
		ChecklistItemRow,
		GoalRing,
		PeriodPills,
		StreakBadge,
		ChatBubble,
		ChatInput,
		RelationSparkline,
		Icon
	} from '$lib/components/ui';
	import TriageCard from '$lib/components/composed/TriageCard.svelte';
	import ChecklistWidget from '$lib/components/composed/ChecklistWidget.svelte';
	import DynamicWidgetView from '$lib/components/composed/DynamicWidgetView.svelte';
	import ProjectCard from '$lib/components/composed/ProjectCard.svelte';
	import ScreenTimeCard from '$lib/components/composed/ScreenTimeCard.svelte';
	import BalanceCard from '$lib/components/composed/BalanceCard.svelte';
	import FormCard from '$lib/components/composed/FormCard.svelte';
	import WeeklyEffortCard from '$lib/components/composed/WeeklyEffortCard.svelte';
	import WeekGoals from '$lib/components/domain/ukeplan/WeekGoals.svelte';
	import WeekNote from '$lib/components/domain/ukeplan/WeekNote.svelte';
	import DaySection from '$lib/components/domain/ukeplan/DaySection.svelte';
	import WeekTasks from '$lib/components/domain/ukeplan/WeekTasks.svelte';
	import {
		KavalkadeStats,
		Ordsky,
		MonthTimeline,
		GreetingsList,
		InterviewAnswerList,
		ShowSlide
	} from '$lib/components/domain/kavalkade';
	import ProcedureSheet from '$lib/components/ui/ProcedureSheet.svelte';
	import WidgetConfigSheet from '$lib/components/ui/WidgetConfigSheet.svelte';
	import ChecklistSheet from '$lib/components/ui/ChecklistSheet.svelte';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import ChatMessages from '$lib/components/ui/ChatMessages.svelte';
	import MetricCard from '$lib/components/visualizations/MetricCard.svelte';
	import WeatherStrip from '$lib/components/ui/WeatherStrip.svelte';
	import TaskContextMenu from '$lib/components/ui/TaskContextMenu.svelte';
	import AutoCheckModal from '$lib/components/domain/ukeplan/AutoCheckModal.svelte';
	import LocationPickerModal from '$lib/components/ui/LocationPickerModal.svelte';
	import BreakdownModal from '$lib/components/ui/BreakdownModal.svelte';
	import ShareSheet from '$lib/components/domain/share/ShareSheet.svelte';
	import BookHeaderBar from '$lib/components/domain/BookHeaderBar.svelte';
	import BookFaktaTab from '$lib/components/domain/BookFaktaTab.svelte';
	import BookClipsTab from '$lib/components/domain/BookClipsTab.svelte';
	import BookContextTab from '$lib/components/domain/BookContextTab.svelte';
	import BookChatTab from '$lib/components/domain/BookChatTab.svelte';
	import ThemeButtonGrid from '$lib/components/domain/home/ThemeButtonGrid.svelte';
	import PartnerOnboardingCard from '$lib/components/domain/home/PartnerOnboardingCard.svelte';
	import ReadinessChip from '$lib/components/domain/home/ReadinessChip.svelte';
	import ActionPillRow from '$lib/components/domain/home/ActionPillRow.svelte';
	import PagerDots from '$lib/components/ui/PagerDots.svelte';
	import ConversationContextMenu from '$lib/components/ui/ConversationContextMenu.svelte';
	import { ChipStrip } from '$lib/components/ui';
	import type { SaveState } from '$lib/components/domain/ukeplan/types';
	import { THEME_HUES, type ThemeHueKey } from '$lib/domain/theme-hues';
	import DayWheelChart from '$lib/components/visualizations/DayWheelChart.svelte';
	import DomainWheelChart from '$lib/components/visualizations/DomainWheelChart.svelte';
	import {
		checklistEmpty,
		checklistHalf,
		checklistDone,
		checklistMonth,
		demoMonthDays,
		demoDomains,
		loadSeries,
		effortByDay,
		effortTotal,
		effortByFamily,
		effortBaseline,
		screenThisWeek,
		screenPrevWeek,
		screenGoals,
		screenWeekDays,
		screenCategoryLabels,
		screenCumulative,
		screenCumulativeRefs,
		projectActive,
		projectDone,
		widgetWeight,
		widgetSteps,
		widgetSpend,
		widgetSleep,
		weekGoalsVision,
		weekGoalsMock,
		daySectionFixture,
		weekTasksFixture,
		procedureMock,
		mockProcedureSheetApi,
		widgetConfigMock,
		mockLoadFilterPreview,
		mockChecklistSheetApi,
		checklistSheetFixture,
		checklistSheetRoutines,
		checklistSheetDoneFixture,
		mockFlowSheetApi,
		slotCheckinFlow,
		chatMessagesMock,
		metricRunning,
		metricWeight,
		metricSleep,
		metricSteps,
		metricGrocery,
		taskMenuAnchor,
		autoCheckPromptMock,
		geoCandidatesMock,
		weatherPeriodsMock,
		mockShareApi,
		mockLoadBreakdownSuggestions,
		kavalkadeCurrentYearMock,
		kavalkadePreviousYearMock,
		kavalkadeOrdskyMock,
		kavalkadeTimelineMock,
		kavalkadeGreetingsMock,
		kavalkadeInterviewAnswersMock,
		kavalkadeShowSlidesMock,
		bookMock,
		bookWithPackMock,
		bookClipsMock,
		bookChatMessagesMock,
		mockBookTabsApi,
		themeButtonsMock,
		actionPillsMock,
		readinessMock,
		conversationThemesMock,
		mockConversationMenuApi,
		checklistRowItems,
		checklistRowParent
	} from './mocks';

	const sections = [
		{ id: 'prinsipper', label: 'Designprinsipper' },
		{ id: 'typografi', label: 'Typografi' },
		{ id: 'blokktyper', label: 'Blokktyper' },
		{ id: 'oppgaverader', label: 'Oppgaverader' },
		{ id: 'layout', label: 'Layout & struktur' },
		{ id: 'knapper', label: 'Knapper' },
		{ id: 'ikoner', label: 'Ikoner & tema-hue' },
		{ id: 'ringer', label: 'Ringer & widgets' },
		{ id: 'dashboardkort', label: 'Dashboard-kort' },
		{ id: 'utvidbare-kort', label: 'Utvidbare kort' },
		{ id: 'chat', label: 'Chat' },
		{ id: 'skjema', label: 'Skjema' },
		{ id: 'navigasjon', label: 'Navigasjon' },
		{ id: 'ukeplan', label: 'Ukeplan' },
		{ id: 'kavalkade', label: 'Kavalkade' },
		{ id: 'hjem', label: 'Hjemskjerm-elementer' },
		{ id: 'boker', label: 'Bøker' },
		{ id: 'sheets', label: 'Sheets & paneler' },
		{ id: 'modaler', label: 'Menyer & modaler' },
		{ id: 'lab', label: 'Lab' }
	] as const;

	// ── GoalRing-demo ───────────────────────────────────────────────────────────
	let runPeriod = $state<'uke' | 'måned' | 'kvartal'>('kvartal');
	const runData: Record<string, { delta: string; pct: number }> = {
		uke:     { delta: '+3 km',  pct: 79 },
		måned:   { delta: '+8 km',  pct: 62 },
		kvartal: { delta: '+12 km', pct: 71 }
	};

	let weightPeriod = $state<'7d' | '30d' | '90d'>('30d');
	const weightData: Record<string, { delta: string; pct: number; col: string }> = {
		'7d':  { delta: '−0.4', pct: 40, col: '#5fa0a0' },
		'30d': { delta: '−1.1', pct: 55, col: '#5fa0a0' },
		'90d': { delta: '+2.7', pct: 22, col: '#e07070' }
	};

	// ── Chat-demo ──────────────────────────────────────────────────────────────
	let lastSent = $state('');
	const noop = () => {};

	// ── ExpandableCard-demo ──────────────────────────────────────────────────
	let expandedDemoCard = $state<string | null>('a');
	function toggleDemoCard(id: string) {
		expandedDemoCard = expandedDemoCard === id ? null : id;
	}

	// ── Oppgaverader-demo (ChecklistItemRow flat vs. bordered) ───────────────
	let rowItemsFlat = $state(checklistRowItems.map((i) => ({ ...i })));
	let rowItemsCard = $state(checklistRowItems.map((i) => ({ ...i })));
	let rowParentItems = $state(checklistRowParent.map((i) => ({ ...i })));
	let rowExpanded = $state<Set<string>>(new Set(['cp1']));
	function toggleRowExpand(id: string) {
		const next = new Set(rowExpanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		rowExpanded = next;
	}

	// ── WeekNote-demo ──────────────────────────────────────────────────────────
	let weekNoteSaveState = $state<SaveState>('idle');
	async function mockSaveWeekNote(): Promise<boolean> {
		await new Promise((r) => setTimeout(r, 600));
		return true;
	}

	// ── Skjema-demo ────────────────────────────────────────────────────────────
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

	// ── Ikon-lab ───────────────────────────────────────────────────────────────
	type DesignIconToken =
		| 'chat' | 'camera' | 'wave' | 'checkin' | 'file' | 'goals' | 'settings' | 'back'
		| 'forward' | 'search' | 'refresh' | 'close' | 'plus' | 'attach' | 'check' | 'calendar';

	const iconSpecs: Array<{ token: DesignIconToken; label: string; legacy: string }> = [
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
		{ token: 'close', label: 'Lukk', legacy: '✕ / ×' },
		{ token: 'plus', label: 'Legg til', legacy: '+' },
		{ token: 'attach', label: 'Vedlegg', legacy: '📎' },
		{ token: 'check', label: 'Bekreft', legacy: '✓' },
		{ token: 'calendar', label: 'Kalender', legacy: '📅' }
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
</script>

<svelte:head>
	<title>Design</title>
</svelte:head>

<AppPage>
	<PageSection>
	<div class="page">

	<!-- ── Sidemeny ── -->
	<nav class="sidenav">
		{#each sections as s}
			<a class="sidenav-link" href="#{s.id}">{s.label}</a>
		{/each}
	</nav>

	<main class="content">

		<h1 class="page-title">Design</h1>
		<p class="page-sub">
			Levende dokumentasjon: alle demoer rendrer appens faktiske komponenter med mock-data — ingen gjenskapt markup.
			Nye komponenter utvikles og tilpasses her (under «Lab») før de tas inn i appen.
		</p>

		<!-- ══ DESIGNPRINSIPPER ═══════════════════════════════════════════════════ -->
		<section id="prinsipper" class="section">
			<h2 class="section-heading">Designprinsipper</h2>
			<p class="section-desc">Kjerneverdier som styrer all UX-beslutning. Åpne appen skal føles som å puste ut, ikke inn.</p>

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

		<!-- ══ TYPOGRAFI ══════════════════════════════════════════════════════════ -->
		<section id="typografi" class="section">
			<h2 class="section-heading">Typografi</h2>
			<p class="section-desc">
				Fem størrelses-tokens definert i <code>AppPage.svelte</code>. Bruk tokens — aldri hardkodede font-sizes i nye komponenter.
			</p>

			<div class="type-scale">
				<div class="type-row"><code>--font-size-value</code><span class="type-val">1.9rem</span><span style="font-size: var(--font-size-value); font-weight: 700;">5t 38m</span></div>
				<div class="type-row"><code>--font-size-title</code><span class="type-val">1rem</span><span style="font-size: var(--font-size-title); font-weight: 600;">Korttittel</span></div>
				<div class="type-row"><code>--font-size-body</code><span class="type-val">0.9rem</span><span style="font-size: var(--font-size-body);">Brødtekst i kort og seksjoner.</span></div>
				<div class="type-row"><code>--font-size-label</code><span class="type-val">0.78rem</span><span style="font-size: var(--font-size-label); text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: 600;">Seksjonslabel</span></div>
				<div class="type-row"><code>--font-size-caption</code><span class="type-val">0.72rem</span><span style="font-size: var(--font-size-caption); color: #777;">Hint, delta, meta-tekst</span></div>
			</div>

			<h3 class="subsection">SectionLabel — «hva er denne blokken»</h3>
			<p class="section-desc">
				Alle seksjons-/diagramlabels bruker <code>SectionLabel</code>: uppercase, muted, 0.78rem.
				Velg <code>tag</code> etter overskriftshierarkiet. <code>nowrap</code> gir ellipsis i flex-rader med actions til høyre.
			</p>
			<div class="demo-stack">
				<SectionLabel>Treningsøkter</SectionLabel>
				<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; border: 1px dashed #2a2a2a; border-radius: 8px; padding: 8px;">
					<SectionLabel tag="span" nowrap>Akkumulert gjennom uka (nowrap i trang rad)</SectionLabel>
					<Button variant="chip">Toggle</Button>
				</div>
				<div style="--section-label-color: #8ba0f5;">
					<SectionLabel>Med fargeoverride</SectionLabel>
				</div>
			</div>

			<h3 class="subsection">CardTitle — «hva gjør dette kortet»</h3>
			<p class="section-desc">
				Kort-titler bruker <code>CardTitle</code>: 1rem, 600, hvit, normal case. («Ukesnotat», «Legg inn skjermbilder», …)
			</p>
			<div class="demo-stack">
				<CardTitle>Ukas oppgaver</CardTitle>
			</div>
		</section>

		<!-- ══ BLOKKTYPER ═════════════════════════════════════════════════════════ -->
		<section id="blokktyper" class="section">
			<h2 class="section-heading">Blokktyper</h2>
			<p class="section-desc">
				Fire kanoniske blokktyper, alle bygget på <code>--card-*</code>-tokens fra AppPage.
				Kontekster (temasider, ukeplan) overstyrer tokens — komponentene er like.
				<strong>Overskriftsregler:</strong> (1) overskrift inne i kortet, øverst, venstrejustert;
				(2) SectionLabel <em>over</em> kortgrupper når flere kort deler heading;
				(3) meta/actions til høyre i samme rad — aldri over eller under tittelen.
			</p>

			<h3 class="subsection">Card — SectionCard-tones</h3>
			<div class="demo-stack">
				<SectionCard title="Default" meta="tone=default">
					<p style="margin: 0; color: #888; font-size: var(--font-size-body);">--card-bg, ingen border.</p>
				</SectionCard>
				<SectionCard title="Subtle" tone="subtle" meta="tone=subtle">
					<p style="margin: 0; color: #888; font-size: var(--font-size-body);">--card-bg-subtle — dashboards-standarden.</p>
				</SectionCard>
				<SectionCard title="Bordered" tone="bordered" meta="tone=bordered">
					<p style="margin: 0; color: #888; font-size: var(--font-size-body);">--card-bg + 1px --card-border.</p>
				</SectionCard>
			</div>

			<h3 class="subsection">FlatSection — label over kortgruppe</h3>
			<div class="demo-stack" style="gap: 8px;">
				<SectionLabel>Prosjekter</SectionLabel>
				<SectionCard tone="subtle" compact>
					<p style="margin: 0; color: #888; font-size: var(--font-size-body);">Kort 1 i gruppen</p>
				</SectionCard>
				<SectionCard tone="subtle" compact>
					<p style="margin: 0; color: #888; font-size: var(--font-size-body);">Kort 2 i gruppen</p>
				</SectionCard>
			</div>

			<h3 class="subsection">InsetCard — nestet kort</h3>
			<div class="demo-stack">
				<SectionCard tone="subtle" title="Ytre kort">
					<div style="background: var(--card-bg-inset); border-radius: var(--radius-md); padding: 14px; color: #888; font-size: var(--font-size-body);">
						--card-bg-inset + --radius-md for kort-i-kort (mål-kort, oppholds-kort).
					</div>
				</SectionCard>
			</div>

			<h3 class="subsection">FeatureCard — kontekst-overstyrt skin</h3>
			<p class="section-desc">
				Gradient-/hue-kort er <em>token-overrides på kontekstnivå</em>, ikke egne komponenter.
				Ukeplan setter <code>--card-bg: linear-gradient(…)</code>; temasider setter <code>--card-bg: var(--tp-bg-2)</code>.
				Dette er mekanismen som senere kan re-skinne hele appen (f.eks. light mode): bytt tokens, ikke komponenter.
			</p>
			<div class="demo-stack" style="--card-bg: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95)); --card-radius: 14px; --card-padding: 12px;">
				<SectionCard title="Ukeplan-skin">
					<p style="margin: 0; color: #888; font-size: var(--font-size-body);">Samme komponent, ukeplan-kontekstens tokens.</p>
				</SectionCard>
			</div>
		</section>

		<!-- ══ OPPGAVERADER ═══════════════════════════════════════════════════════ -->
		<section id="oppgaverader" class="section">
			<h2 class="section-heading">Oppgaverader</h2>
			<p class="section-desc">
				Én kanonisk oppgave-/sjekklisterad for hele appen: <code>ChecklistItemRow</code> (ui/).
				Anatomi: <code>[utvid-pil?] [tekst + badges] [avkrysning]</code> — avkrysningen står
				<strong>til høyre</strong> («Hva har du fått til?»). Foreldre får utvid-pil og fremdriftsring;
				deloppgaver legges inline. Avkrysning er alltid <code>ChecklistCheckbox</code>, tekst alltid
				<code>TaskTitle</code>. Listene forenes mot denne — se changelog
				<code>2026-06-13-forene-oppgavelister.md</code>.
			</p>

			<h3 class="subsection">Flat (default) — transparent rad</h3>
			<p class="section-desc">
				Standardvarianten: ingen ramme, subtil hover. Brukes i tette lister (ukeplan, sjekklister).
			</p>
			<div class="demo-card demo-card--wide">
				<div class="demo-stack" style="gap: 2px;">
					{#each rowItemsFlat as it (it.id)}
						<ChecklistItemRow item={it} allItems={rowItemsFlat} showTime={false} showTravel={false} ontoggle={(t) => (t.checked = !t.checked)} />
					{/each}
				</div>
			</div>

			<h3 class="subsection">Bordered — «full bredde m/ramme» (kanonisk kort-rad)</h3>
			<p class="section-desc">
				<code>bordered</code>-prop gir kort-chrome via <code>--card-*</code>-tokens. Dette er den valgte
				kanoniske stilen oppgavelister forenes mot. Kontekster (tema-hue, ukeplan-gradient) re-skinner
				raden automatisk ved å overstyre <code>--card-bg</code>/<code>--card-border</code>.
			</p>
			<div class="demo-card demo-card--wide">
				<div class="demo-stack" style="gap: 6px;">
					{#each rowItemsCard as it (it.id)}
						<ChecklistItemRow item={it} allItems={rowItemsCard} bordered showTime={false} showTravel={false} ontoggle={(t) => (t.checked = !t.checked)} />
					{/each}
				</div>
			</div>

			<h3 class="subsection">Bordered + deloppgaver — utvid-pil og fremdriftsring</h3>
			<div class="demo-card demo-card--wide">
				<div class="demo-stack" style="gap: 6px;">
					{#each rowParentItems.filter((i) => !i.parentId) as it (it.id)}
						<ChecklistItemRow
							item={it}
							allItems={rowParentItems}
							bordered
							showTime={false}
							showTravel={false}
							expandedParentIds={rowExpanded}
							onexpand={(id) => toggleRowExpand(id)}
							ontoggle={(t) => (t.checked = !t.checked)}
						/>
					{/each}
				</div>
			</div>
		</section>

		<!-- ══ LAYOUT & STRUKTUR ══════════════════════════════════════════════════ -->
		<section id="layout" class="section">
			<h2 class="section-heading">Layout & struktur</h2>
			<p class="section-desc">
				Base-komponenter for sidestruktur. Hver side: <code>AppPage</code> → <code>PageSection</code> → <code>PageHeader</code> → innhold.
			</p>

			<h3 class="subsection">PageHeader</h3>
			<p class="section-desc">
				Standard sidetittel for hele appen — tittelen ER tilbakeknappen (<code>titleHref</code>/<code>onTitleClick</code>),
				støtter <code>emoji</code>, <code>subtitle</code> og morph-animasjon. Erstattet ScreenTitle og MorphTitle.
			</p>
			<div class="demo-stack">
				<PageHeader title="Helse" subtitle="Vekt, løping, søvn og aktivitet" emoji="🏃" titleHref="/design" />
			</div>

			<h3 class="subsection">Section</h3>
			<p class="section-desc">
				Standard contentwrapper bygget på <code>--card-*</code>-tokens, ingen border.
				Valgfri tittel og meta. For nye kort: vurder <code>SectionCard</code> (flere tones + actions).
			</p>
			<div class="demo-stack">
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
			</div>

			<h3 class="subsection">CompactRecordList</h3>
			<p class="section-desc">
				Kompakt liste med tittel, label og meta-info. Brukes for kilder, kontoer, siste transaksjoner osv.
			</p>
			<div class="demo-stack">
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

			<h3 class="subsection">Skeleton — lastetilstander</h3>
			<p class="section-desc">
				<code>Skeleton</code> har fire varianter. Bruk denne i stedet for ad-hoc «Laster …»-tekst.
			</p>
			<div class="demo-stack">
				<div style="display: flex; align-items: center; gap: 12px;">
					<Skeleton variant="circle" />
					<div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
						<Skeleton variant="line" width="60%" />
						<Skeleton variant="line" width="85%" />
					</div>
				</div>
				<Skeleton variant="card" />
				<Skeleton variant="pill" />
			</div>
		</section>

		<!-- ══ KNAPPER ════════════════════════════════════════════════════════════ -->
		<section id="knapper" class="section">
			<h2 class="section-heading">Knapper</h2>
			<p class="section-desc">
				<code>&lt;Button variant="…"&gt;</code> fra <code>ui/</code> er standard-API-et — komponenten bygger på de globale
				<code>.btn-*</code>-klassene i <code>app.css</code>, som kan brukes direkte der en komponent ikke passer.
				Ikon-knapper bruker <code>&lt;IconButton icon="…" ariaLabel="…"&gt;</code>.
			</p>
			<div class="variant-grid" style="--min:100px">

				<div class="variant">
					<Button variant="primary">Lagre</Button>
					<span class="vname">Primær<br><code>primary</code></span>
				</div>

				<div class="variant">
					<Button variant="secondary">Avbryt</Button>
					<span class="vname">Sekundær<br><code>secondary</code></span>
				</div>

				<div class="variant">
					<Button variant="ghost">Mer</Button>
					<span class="vname">Ghost<br><code>ghost</code></span>
				</div>

				<div class="variant">
					<Button variant="chip">Trening</Button>
					<span class="vname">Chip<br><code>chip</code></span>
				</div>

				<div class="variant">
					<Button variant="chip" className="active">Søvn</Button>
					<span class="vname">Chip · aktiv<br><code>chip + .active</code></span>
				</div>

				<div class="variant">
					<Button variant="danger">Slett</Button>
					<span class="vname">Destruktiv<br><code>danger</code></span>
				</div>

				<div class="variant">
					<Button variant="warning">Arkiver?</Button>
					<span class="vname">Advarsel<br><code>warning</code></span>
				</div>

				<div class="variant">
					<Button variant="primary" disabled>Lagre</Button>
					<span class="vname">Deaktivert<br><code>disabled</code></span>
				</div>

				<div class="variant">
					<IconButton icon="settings" ariaLabel="Innstillinger" size={16} />
					<span class="vname">Ikon<br><code>IconButton</code></span>
				</div>

				<div class="variant">
					<IconButton icon="close" ariaLabel="Slett" variant="danger" size={14} />
					<span class="vname">Ikon · slett<br><code>variant="danger"</code></span>
				</div>

			</div>
		</section>

		<!-- ══ IKONER & TEMA-HUE ══════════════════════════════════════════════════ -->
		<section id="ikoner" class="section">
			<h2 class="section-heading">Ikoner & tema-hue</h2>
			<p class="section-desc">
				Appens ikonsett (<code>ui/Icon.svelte</code>, 16 ikoner). Eget ikonsett brukes for handling og navigasjon; emoji beholdes for
				domene, stemning og personlig kontekst.
			</p>
			<p class="section-desc">
				Hue-mekanismen under er den samme som i produksjon: <code>getThemeHueStyle(temanavn)</code> setter
				<code>--theme-hue</code> per tema, og bakgrunn/border/forgrunn avledes som <code>hsl(hue, s, l)</code>-trinn.
				Slideren og light-modus er laboratorium for å teste nye hues og fremtidig re-skinning — appen er alltid mørk.
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

		<!-- ══ RINGER & WIDGETS ═══════════════════════════════════════════════════ -->
		<section id="ringer" class="section">
			<h2 class="section-heading">Ringer & widgets</h2>

			<h3 class="subsection">GoalRing</h3>
			<p class="section-desc">
				Samme komponent — <code>GoalRing</code> — i alle varianter. Midtinnholdet er en snippet (children).
				Brukes av ChecklistWidget, DynamicWidget og dashboards.
			</p>

			<div class="variant-grid">

				<div class="variant">
					<GoalRing pct={40} color="#f0b429" trackColor="#1e1a0e">
						<span class="rv-big" style="color:#f0b429">2/5</span>
						<span class="rv-unit">40%</span>
					</GoalRing>
					<span class="vname">Todo · 40%</span>
				</div>

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

				<div class="variant">
					<GoalRing pct={64} color="#5fa0a0" trackColor="#1a1a1a" pacePct={66.7}>
						<span class="rv-big" style="color:#5fa0a0">−320</span>
						<span class="rv-unit">kr vs pace</span>
					</GoalRing>
					<span class="vname">Forbruk · pace-tick</span>
				</div>

				<div class="variant">
					<GoalRing
						pct={68} r={27} strokeWidth={4} color="#e07070" trackColor="#1e1e1e"
						pct2={75} r2={19} strokeWidth2={4} color2="#5fa0a0" trackColor2="#1a1a1a"
					>
						<span class="rv-big" style="color:#e07070">68%</span>
					</GoalRing>
					<span class="vname">Dobbel · aktivitet</span>
				</div>

				<div class="variant">
					<GoalRing pct={97} color="#5fa0a0" trackColor="#1a1a1a">
						<span class="rv-big" style="color:#5fa0a0">7.8</span>
						<span class="rv-unit">/ 8 h</span>
					</GoalRing>
					<span class="vname">Søvnmål · 97%</span>
				</div>

			</div>

			<h3 class="subsection">ChecklistWidget — tilstander</h3>
			<p class="section-desc">
				Hjemskjermens sjekkliste-widget (<code>composed/ChecklistWidget</code>) — live komponent i tre fremdriftstilstander.
				Med <code>monthDayData</code> rendres et <code>DayWheelChart</code> i stedet for ring (måneds-sjekklister).
			</p>
			<div class="demo-row">
				<div class="variant">
					<ChecklistWidget checklist={checklistEmpty} />
					<span class="vname">0/8 · urørt</span>
				</div>
				<div class="variant">
					<ChecklistWidget checklist={checklistHalf} />
					<span class="vname">5/8 · underveis</span>
				</div>
				<div class="variant">
					<ChecklistWidget checklist={checklistDone} />
					<span class="vname">8/8 · fullført</span>
				</div>
				<div class="variant">
					<ChecklistWidget checklist={checklistMonth} monthDayData={demoMonthDays} monthWheelCycle={false} />
					<span class="vname">Måned · dagshjul</span>
				</div>
			</div>

			<h3 class="subsection">DynamicWidgetView — sensor-widget</h3>
			<p class="section-desc">
				Hjemskjermens dynamiske sensor-widget. <code>DynamicWidget</code> (container) henter data selv;
				<code>DynamicWidgetView</code> er presentasjonen og vises her med mock-data — inkludert loading- og
				feiltilstandene som ellers bare oppstår ved nettverksfeil. Long-press åpner widget-menyen.
			</p>
			<div class="demo-row">
				<div class="variant">
					<DynamicWidgetView title="Vekt" unit="kg" color="#5fa0a0" data={null} loading />
					<span class="vname">Loading</span>
				</div>
				<div class="variant">
					<DynamicWidgetView title="Vekt" unit="kg" color="#5fa0a0" data={null} error />
					<span class="vname">Feil</span>
				</div>
				<div class="variant">
					<DynamicWidgetView title="Vekt" unit="kg" color="#5fa0a0" data={widgetWeight} />
					<span class="vname">Ring · normal</span>
				</div>
				<div class="variant">
					<DynamicWidgetView title="Skritt" unit="skritt" color="#7c8ef5" data={widgetSteps} />
					<span class="vname">State · success</span>
				</div>
				<div class="variant">
					<DynamicWidgetView title="Dagligvare" unit="kr" color="#f0b429" data={widgetSpend} refreshing />
					<span class="vname">Warn · refreshing</span>
				</div>
				<div class="variant">
					<DynamicWidgetView title="Søvn" unit="timer søvn" color="#5fa0a0" data={widgetSleep} />
					<span class="vname">Uten mål · sirkel</span>
				</div>
			</div>

			<h3 class="subsection">DayWheelChart</h3>
			<p class="section-desc">
				Radial dagsprofil (<code>visualizations/DayWheelChart</code>): én sektor per dag, grå = planlagt, grønn = løst,
				normalisert mot månedens maks. Brukes i ChecklistWidget for måneds-sjekklister.
			</p>
			<div class="radial-row">
				<div class="radial-card">
					<DayWheelChart year={2026} month={6} days={demoMonthDays} size={220} cycle={false} />
					<p class="radial-caption">Demo: 20 dager bak oss, dag 21 = i dag (syklus-animasjonen er skrudd av her)</p>
				</div>
				<div class="radial-legend">
					<div class="radial-legend-item">
						<span class="radial-dot" style="background:rgba(255,255,255,0.18)"></span> Planlagte oppgaver
					</div>
					<div class="radial-legend-item">
						<span class="radial-dot" style="background:#5fa080"></span> Løste oppgaver
					</div>
					<hr class="radial-hr" />
					<div class="radial-dim"><strong>Radius</strong> = antall / maks planlagt i mnd.</div>
					<div class="radial-dim"><strong>Fremtid</strong> = ingen sektor</div>
				</div>
			</div>
		</section>

		<!-- ══ DASHBOARD-KORT ═════════════════════════════════════════════════════ -->
		<section id="dashboardkort" class="section">
			<h2 class="section-heading">Dashboard-kort</h2>
			<p class="section-desc">
				Sammensatte kort fra <code>composed/</code> slik de brukes i helse-, skjermtid- og prosjektsidene.
				Alle er rent props-drevne og rendres her med mock-data.
			</p>

			<h3 class="subsection">WeeklyEffortCard — relativ effort per uke</h3>
			<div class="demo-card">
				<WeeklyEffortCard
					total={effortTotal}
					byFamily={effortByFamily}
					byDay={effortByDay}
					hrCoveragePct={84}
					workoutCount={5}
					baseline={effortBaseline}
					weekLabel="Uke 24"
				/>
			</div>

			<h3 class="subsection">BalanceCard + FormCard — treningsbelastning</h3>
			<p class="section-desc">Begge leser samme <code>TrainingLoadPoint[]</code>-serie (CTL/ATL/TSB).</p>
			<div class="demo-row">
				<div class="demo-card"><BalanceCard series={loadSeries} /></div>
				<div class="demo-card"><FormCard series={loadSeries} windowDays={120} /></div>
			</div>

			<h3 class="subsection">ScreenTimeCard — skjermtid</h3>
			<p class="section-desc">
				Full variant med ukesmål, dagsfordeling, akkumulert ukegraf og kategorisplitt — som på <code>/skjermtid</code>.
			</p>
			<div class="demo-card demo-card--wide">
				<ScreenTimeCard
					thisWeek={screenThisWeek}
					prevWeek={screenPrevWeek}
					goals={screenGoals}
					weekDays={screenWeekDays}
					categoryLabels={screenCategoryLabels}
					cumulative={screenCumulative}
					cumulativeRefs={screenCumulativeRefs}
				/>
			</div>

			<h3 class="subsection">ProjectCard — prosjektstatus</h3>
			<div class="demo-row">
				<div class="demo-card"><ProjectCard {...projectActive} /></div>
				<div class="demo-card"><ProjectCard {...projectDone} /></div>
			</div>

			<h3 class="subsection">MetricCard — S/M/L-visualiseringer</h3>
			<p class="section-desc">
				Dispatch-laget for mål-fremdrift: gitt <code>metricId</code> + størrelse + datakontrakt velger den
				riktig visualisering (trajectory, target-zone, comparison-trend …). Brukes i WeekGoals og plan-sidene.
			</p>
			<div class="metric-demo">
				<div class="metric-row"><span class="metric-label">Løping (M)</span><MetricCard metricId="running_distance" size="M" data={metricRunning} animateOnMount={false} /></div>
				<div class="metric-row"><span class="metric-label">Vekt (M)</span><MetricCard metricId="weight_change" size="M" data={metricWeight} animateOnMount={false} /></div>
				<div class="metric-row"><span class="metric-label">Søvn (M)</span><MetricCard metricId="sleep_avg_night" size="M" data={metricSleep} animateOnMount={false} /></div>
				<div class="metric-row"><span class="metric-label">Skritt (M)</span><MetricCard metricId="steps_avg_day" size="M" data={metricSteps} animateOnMount={false} /></div>
				<div class="metric-row"><span class="metric-label">Dagligvarer (M)</span><MetricCard metricId="grocery_spend" size="M" data={metricGrocery} animateOnMount={false} /></div>
			</div>
			<h3 class="subsection">MetricCard — L (detaljgraf)</h3>
			<div class="demo-row">
				<div class="demo-card"><MetricCard metricId="running_distance" size="L" data={metricRunning} animateOnMount={false} /></div>
				<div class="demo-card"><MetricCard metricId="weight_change" size="L" data={metricWeight} animateOnMount={false} /></div>
			</div>
		</section>

		<!-- ══ UTVIDBARE KORT ═════════════════════════════════════════════════════ -->
		<section id="utvidbare-kort" class="section">
			<h2 class="section-heading">Utvidbare kort</h2>
			<p class="section-desc">
				<code>ExpandableCard</code> (ui/) er den delte byggeklossen for lister der hver rad
				utvides til detaljer/innstillinger: ren toggle-header (innhold + chevron) og et
				utvidet innhold. Chrome styres via CSS-variabler (<code>--ec-bg</code>,
				<code>--ec-border-expanded</code>, <code>--ec-header-pad</code>,
				<code>--ec-hover</code>, <code>--ec-chevron</code> …) så ulike kontekster beholder
				sitt uttrykk. Brukes av tema-lista (<code>/settings/themes</code>) og
				helse-aktivitetslista.
			</p>

			<h3 class="subsection">Standard (solid kort)</h3>
			<div class="demo-card demo-card--wide">
				<ExpandableCard
					expanded={expandedDemoCard === 'a'}
					onToggle={() => toggleDemoCard('a')}
					ariaLabel="Vis detaljer for Tur til Volda"
				>
					{#snippet header()}
						<span class="ec-demo-emoji">✈️</span>
						<span class="ec-demo-info">
							<span class="ec-demo-name">Tur til Volda</span>
							<span class="ec-demo-meta">Tur</span>
						</span>
					{/snippet}
					<div class="ec-demo-body">
						<p>Utvidet innhold — her ville et innstillingspanel eller detaljer ligget.</p>
					</div>
				</ExpandableCard>
			</div>

			<h3 class="subsection">Transparent variant (som helse-aktiviteter)</h3>
			<p class="section-desc">Samme komponent med overstyrt chrome via CSS-variabler.</p>
			<div class="demo-card demo-card--wide" style="background:#141414; border-radius:16px; padding:12px;">
				<ExpandableCard
					expanded={expandedDemoCard === 'b'}
					onToggle={() => toggleDemoCard('b')}
					ariaLabel="Vis detaljer for Løping"
					--ec-bg="transparent"
					--ec-border-expanded="#252525"
					--ec-header-pad="10px 8px"
					--ec-hover="#1a1a1a"
					--ec-chevron="#444"
					--ec-chevron-open="#7c8ef5"
				>
					{#snippet header()}
						<span class="ec-demo-emoji">🏃</span>
						<span class="ec-demo-info">
							<span class="ec-demo-name">Løping <span class="ec-demo-meta">· i går · 8,2 km · 42 min</span></span>
						</span>
					{/snippet}
					<div class="ec-demo-body" style="padding-left:44px;">
						<p>Detaljer, kart og splitt vises her i den faktiske helse-lista.</p>
					</div>
				</ExpandableCard>
			</div>
		</section>

		<!-- ══ CHAT ═══════════════════════════════════════════════════════════════ -->
		<section id="chat" class="section">
			<h2 class="section-heading">Chat</h2>
			<p class="section-desc">
				Bot-svar i chat-flatene (hjem, temasider) rendres som <code>TriageCard</code> — med tenketilstand,
				streaming, markdown og triage-handlinger. Under: live komponent i alle tilstander.
			</p>

			<h3 class="subsection">TriageCard — tilstander</h3>
			<div class="chat-demo">
				<TriageCard loading steps={['Henter vektdata fra Withings', 'Sammenligner med forrige måned']} />
			</div>
			<p class="demo-caption">Tenker — med ekspanderbare steg</p>

			<div class="chat-demo">
				<TriageCard streaming text="Du har veid deg 14 ganger siste 30 dager. Trenden er **−1,1 kg**, og du ligger" />
			</div>
			<p class="demo-caption">Streaming — markøren pulserer mens svaret kommer</p>

			<div class="chat-demo">
				<TriageCard
					text={'Du har veid deg 14 ganger siste 30 dager. Trenden er **−1,1 kg**, og du ligger litt bak planen mot 88 kg.\n\nVil du justere målet eller fortsette som nå?'}
					actions={[
						{ label: 'Fortsett som nå', onclick: noop },
						{ label: 'Juster målet', onclick: noop }
					]}
				/>
			</div>
			<p class="demo-caption">Ferdig svar med triage-handlinger</p>

			<div class="chat-demo">
				<TriageCard stopped text="Jeg begynte å hente treningsdataene dine, men ble" />
			</div>
			<p class="demo-caption">Avbrutt av brukeren</p>

			<h3 class="subsection">ChatMessages — meldingslisten</h3>
			<p class="section-desc">
				Den delte meldingslisten for alle chat-flater: brukerbobler, bot-svar (TriageCard), stjernemerking
				og handlingsknapper. Demoen viser også en pågående streaming-melding nederst.
			</p>
			<div class="chat-demo chat-demo--wide">
				<ChatMessages
					messages={chatMessagesMock}
					streamingText="Ser på treningsdataene dine — du har"
					onAction={noop}
					onStarMessage={noop}
				/>
			</div>

			<h3 class="subsection">ChatInput</h3>
			<p class="section-desc">
				Gjenbrukbar meldingsboks med auto-resize textarea — samme komponent som på hjemskjermen og temasidene.
			</p>
			<div class="demo-stack">
				<ChatInput
					placeholder="Skriv en melding…"
					onsubmit={(msg) => (lastSent = msg)}
				/>
				{#if lastSent}
					<p class="demo-caption">Sendt: «{lastSent}»</p>
				{/if}
			</div>
		</section>

		<!-- ══ SKJEMA ═════════════════════════════════════════════════════════════ -->
		<section id="skjema" class="section">
			<h2 class="section-heading">Skjema</h2>
			<p class="section-desc">
				Skjemakomponentene fra <code>ui/</code> — brukt i innstillinger, flows og dashboards.
			</p>

			<h3 class="subsection">Felt-komponenter</h3>
			<div class="input-demo">
				<Input placeholder="Hva tenker du på?" />
				<Textarea placeholder="Lengre notat…" />
				<Select value="uke">
					<option value="uke">Uke</option>
					<option value="måned">Måned</option>
					<option value="år">År</option>
				</Select>
				<label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: #aaa;">
					<Checkbox checked /> Aktivert
				</label>
			</div>

			<h3 class="subsection">DateInput + TimeInput — dato og klokkeslett</h3>
			<p class="section-desc">
				Appens dato- og tidsfelt — tynne wrappere over <code>.ds-input</code> med <code>color-scheme: dark</code>,
				så native kalender/tidvelger og ikonene deres er synlige på mørk bakgrunn.
				Bruk disse — aldri rå <code>&lt;input type="date"&gt;</code>.
			</p>
			<div class="demo-row" style="align-items: center;">
				<DateInput value="2026-06-11" ariaLabel="Dato" />
				<DateInput value="2026-06-11" min="2026-06-01" max="2026-06-30" ariaLabel="Dato med min/maks" />
				<DateInput disabled value="2026-06-11" ariaLabel="Deaktivert dato" />
				<TimeInput value="06:45" />
			</div>

			<h3 class="subsection">StatusBadge</h3>
			<p class="section-desc">Toner: <code>ok | warn | error | off</code> — som dot eller tekst.</p>
			<div class="demo-row" style="align-items: center;">
				<StatusBadge tone="ok" text="Tilkoblet" dot />
				<StatusBadge tone="warn" text="Utløper snart" dot />
				<StatusBadge tone="error" text="Feilet" dot />
				<StatusBadge tone="off" text="Ikke aktiv" dot />
				<StatusBadge tone="ok" text="Tilkoblet" />
			</div>

			<h3 class="subsection">Slider (flow-felttype)</h3>
			<p class="section-desc">
				Felttypen <code>slider</code> i <code>FlowFormStep</code> — brukes i egenfrekvens-sjekkin (1–5 med nivå-labels).
				Demoen bruker den globale <code>.ds-slider</code>-klassen.
			</p>
			<div class="input-demo">
				<div class="mood-display">
					<span class="mood-emoji">{moodEmoji}</span>
					<span class="mood-label">{moodLabel}</span>
				</div>
				<input
					type="range" min="0" max="100" step="1"
					class="ds-slider" style="--pct:{moodVal}%"
					bind:value={moodVal}
				/>
			</div>
		</section>

		<!-- ══ NAVIGASJON ═════════════════════════════════════════════════════════ -->
		<section id="navigasjon" class="section">
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
					<Button variant="chip">{t}</Button>
				{/each}
			</div>

			<h3 class="subsection">ChipStrip — horisontalt scrollbånd</h3>
			<p class="section-desc">Wrapper for pill-rader som scroller horisontalt uten synlig scrollbar.</p>
			<div class="demo-card demo-card--wide">
				<ChipStrip ariaLabel="Demo-chips">
					{#each ['Trening', 'Søvn', 'Økonomi', 'Familie', 'Bøker', 'Egenfrekvens', 'Hjem', 'Jobb'] as c}
						<Button variant="chip">{c}</Button>
					{/each}
				</ChipStrip>
			</div>

			<h3 class="subsection">Subtabs</h3>
			<p class="section-desc">
				Global <code>.subtab</code>-klasse fra <code>app.css</code> — brukes til underfaner <em>inne i</em> dashboards
				(Økonomi, Familie). Temasidenes hovedfaner («Samtaler | Oversikt | Mål …») er en egen stil i
				<code>ThemePage.svelte</code> (<code>.tp-tab</code>) med kant-til-kant-bånd.
			</p>
			<div class="subtab-demo">
				{#each [['Chat','aktiv'], ['Data',''], ['Filer','']] as [lbl, st]}
					<button class="subtab" class:active={st === 'aktiv'}>{lbl}</button>
				{/each}
			</div>
		</section>

		<!-- ══ UKEPLAN ════════════════════════════════════════════════════════════ -->
		<section id="ukeplan" class="section">
			<h2 class="section-heading">Ukeplan</h2>
			<p class="section-desc">
				Ukeplan-siden er bygget av <code>domain/ukeplan/</code>-komponentene WeekGoals, WeekNote, DaySection og WeekTasks —
				alle props-drevne og vist live under med mock-data. Se dem i full kontekst på <a href="/ukeplan">/ukeplan</a>.
			</p>

			<h3 class="subsection">WeekGoals — målbilde og sensor-fremdrift</h3>
			<p class="section-desc">
				Viser visjon + langtidsmål med sensor-beregnet fremdrift (vektmål med forventet kurve, løpsdistanse mot plan).
			</p>
			<div class="demo-card demo-card--wide">
				<WeekGoals vision={weekGoalsVision} longTermGoals={weekGoalsMock} />
			</div>

			<h3 class="subsection">WeekNote — ukesnotat med autosave</h3>
			<p class="section-desc">
				Lagrer på blur via <code>onSave</code>-callback (eieren gjør action-kallet). Skriv noe og klikk
				utenfor for å se saving → saved-syklusen på lagre-dotten.
			</p>
			<div class="demo-card demo-card--wide">
				<WeekNote
					weekNote="Anita reiser fredag og blir til mandag ettermiddag."
					saveState={weekNoteSaveState}
					onSaveStateChange={(s) => (weekNoteSaveState = s)}
					onSave={mockSaveWeekNote}
				/>
			</div>

			<h3 class="subsection">DaySection — dagvisning</h3>
			<p class="section-desc">
				Dagens sjekkliste med rutiner, gruppe-items, Spond-event, vær og dagnotis. Fast demo-uke
				(onsdag = «i dag»). Komponenten er props-drevet; callbacks her er noops, så avkryssing
				lagres ikke.
			</p>
			<div class="demo-card demo-card--wide">
				<DaySection {...daySectionFixture} />
			</div>

			<h3 class="subsection">WeatherStrip — værperioder</h3>
			<p class="section-desc">
				Vises i ChecklistSheet-headeren for dags-/ukelister med sted. Regn farger søylen blå etter mm.
			</p>
			<div class="demo-stack">
				<WeatherStrip periods={weatherPeriodsMock} />
			</div>

			<h3 class="subsection">WeekTasks — ukas oppgaver</h3>
			<p class="section-desc">
				Strukturerte oppgaver (intent-badges, fremdrifts-slots, oppskrift-badge) + fri ukeliste med composer.
				Nettverkslaget er en injisert <code>api</code>-prop — her en mock, så ingen kall går ut.
			</p>
			<div class="demo-card demo-card--wide">
				<WeekTasks {...weekTasksFixture} />
			</div>
		</section>

		<!-- ══ KAVALKADE ══════════════════════════════════════════════════════════ -->
		<section id="kavalkade" class="section">
			<h2 class="section-heading">Kavalkade</h2>
			<p class="section-desc">
				Bursdagsrigget fra <a href="/kavalkade">/kavalkade</a> — bygget av <code>domain/kavalkade/</code>-komponentene.
				Alle er rent props-drevne; AI-innslagene (spådom, hilsner) genereres server-side og vises her med faste fixtures.
				Utkast: <a href="/design/kavalkade-fest">festskinn — fulle farger som bakgrunn →</a>
			</p>

			<h3 class="subsection">KavalkadeStats — året i tall vs. i fjor</h3>
			<p class="section-desc">
				To ferdigberegnede årssummarier (i år / i fjor) fra <code>kavalkade-data</code>. Sportsrader med
				km eller økter, deretter skritt, bøker, søvn, vekt og skjermtid.
			</p>
			<div class="demo-card demo-card--wide">
				<KavalkadeStats current={kavalkadeCurrentYearMock} previous={kavalkadePreviousYearMock} />
			</div>

			<h3 class="subsection">Ordsky — året i ord</h3>
			<p class="section-desc">
				Vektet ordsky av årets sjekkliste-oppgaver. <code>weight</code> (0..1) styrer skriftstørrelse og opasitet;
				beregningen bor server-side i <code>$lib/server/ordsky</code>.
			</p>
			<div class="demo-card demo-card--wide">
				<Ordsky words={kavalkadeOrdskyMock} />
			</div>

			<h3 class="subsection">MonthTimeline — måned for måned</h3>
			<p class="section-desc">
				Toppsport, økter, skritt, bøker og månedens overskrift fra månedsplanen. Tomme måneder dempes («stille måned»).
			</p>
			<div class="demo-card demo-card--wide">
				<MonthTimeline months={kavalkadeTimelineMock} />
			</div>

			<h3 class="subsection">GreetingsList — hilsner fra bokhylla</h3>
			<p class="section-desc">
				AI-genererte bursdagshilsner fra romankarakterer i årets bøker, som sitatkort med attribusjon.
			</p>
			<div class="demo-card demo-card--wide">
				<GreetingsList greetings={kavalkadeGreetingsMock} />
			</div>

			<h3 class="subsection">InterviewAnswerList — bursdagsintervjuets svar</h3>
			<p class="section-desc">
				Svarene fra det årlige intervjuet i spørsmålsrekkefølgen fra <code>INTERVIEW_SECTIONS</code>.
				Samme komponent brukes for «Hvem er du i år?» og «Hvem var du i fjor?».
			</p>
			<div class="demo-card demo-card--wide">
				<InterviewAnswerList answers={kavalkadeInterviewAnswersMock} />
			</div>

			<h3 class="subsection">ShowSlide — fullskjerm-showet</h3>
			<p class="section-desc">
				Slides fra kavalkade-showet på <a href="/kavalkade/show">/kavalkade/show</a> — animert typografi
				(ord-for-ord-reveal, count-up-tall) over drivende gradient-blobs. Demoes med
				<code>animate=false</code> (frosset slutt-tilstand) pga. visuell regresjon; i appen styres
				de av <code>KavalkadeShow</code>-spilleren med story-progresjon og tap-navigasjon.
				<a href="/design/kavalkade-show">Spill av hele showet med mock-data →</a> (med Mørk/Fest-veksler for skin-utkastet)
			</p>
			<div class="demo-row">
				{#each kavalkadeShowSlidesMock as slide (slide.kind)}
					<div class="show-stage">
						<ShowSlide {slide} animate={false} />
					</div>
				{/each}
			</div>
		</section>

		<!-- ══ HJEMSKJERM-ELEMENTER ═══════════════════════════════════════════════ -->
		<section id="hjem" class="section">
			<h2 class="section-heading">Hjemskjerm-elementer</h2>
			<p class="section-desc">
				Byggeklossene i hjemskjerm-sonene, trukket ut som props-drevne komponenter
				(<code>domain/home/</code>). Sonene selv er setContext-koblede orkestratorer og demoes ikke.
			</p>

			<h3 class="subsection">ThemeButtonGrid — tema-knappene</h3>
			<div class="demo-card demo-card--wide">
				<ThemeButtonGrid themes={themeButtonsMock} onSelect={noop} />
			</div>

			<h3 class="subsection">PartnerOnboardingCard — begge varianter</h3>
			<div class="demo-row">
				<div class="demo-card">
					<PartnerOnboardingCard
						variant="theme"
						kicker="Felles start"
						title="Planlegg sammen"
						body="Koble partneren til ukeplanen og temaene deres."
						actions={[
							{ label: 'Opprett partnertema', onClick: noop, primary: true },
							{ label: 'Åpne samtaler', onClick: noop }
						]}
					/>
				</div>
				<div class="demo-card">
					<PartnerOnboardingCard
						variant="widget"
						kicker="Partnermodus aktivert"
						title="Dere er koblet"
						body="Ukeplanen og sjekklistene deles nå med partneren din."
						actions={[{ label: 'Åpne ukeplan sammen', onClick: noop, primary: true }]}
					/>
				</div>
			</div>

			<h3 class="subsection">ReadinessChip + ActionPillRow — chat-sonens topp</h3>
			<div class="demo-stack">
				<ReadinessChip readiness={readinessMock} onClick={noop} />
				<ActionPillRow items={actionPillsMock} onItemClick={noop} />
			</div>

			<h3 class="subsection">PagerDots — side-indikator</h3>
			<div class="demo-stack" style="position: relative; height: 32px;">
				<PagerDots count={3} active={1} onSelect={noop} />
			</div>
		</section>

		<!-- ══ BØKER ══════════════════════════════════════════════════════════════ -->
		<section id="boker" class="section">
			<h2 class="section-heading">Bøker</h2>
			<p class="section-desc">
				Bok-temaets komponenter (<code>domain/Book*</code>) — på <code>--book-*</code>-tokens og med
				injisert nettverkslag (<code>BookTabsApi</code>). Kontekst- og chat-taben demoes ikke ennå.
			</p>

			<h3 class="subsection">BookHeaderBar — bokheader med fremdrift</h3>
			<div class="demo-card demo-card--wide">
				<BookHeaderBar
					book={bookMock}
					progressEditorOpen={false}
					progressPage="148"
					posHours={4}
					posMins={23}
					totalDurHours={6}
					totalDurMins={52}
					progressSaving={false}
					progressError=""
					onClose={noop}
					onToggleEditor={noop}
					onSaveProgress={noop}
					onCancelEditor={noop}
					onProgressPageChange={noop}
					onPosHoursChange={noop}
					onPosMinsChange={noop}
				/>
			</div>

			<h3 class="subsection">BookHeaderBar — fremdriftseditor åpen</h3>
			<div class="demo-card demo-card--wide">
				<BookHeaderBar
					book={bookMock}
					progressEditorOpen={true}
					progressPage="148"
					posHours={4}
					posMins={23}
					totalDurHours={6}
					totalDurMins={52}
					progressSaving={false}
					progressError=""
					onClose={noop}
					onToggleEditor={noop}
					onSaveProgress={noop}
					onCancelEditor={noop}
					onProgressPageChange={noop}
					onPosHoursChange={noop}
					onPosMinsChange={noop}
				/>
			</div>

			<h3 class="subsection">BookFaktaTab — fremdriftsgraf, ETA og fakta</h3>
			<div class="demo-card demo-card--wide">
				<BookFaktaTab themeId="demo" book={bookMock} onBookUpdated={noop} onBookDeleted={noop} api={mockBookTabsApi} today={new Date('2026-06-12T12:00:00')} />
			</div>

			<h3 class="subsection">BookClipsTab — klipp med karaoke-spiller</h3>
			<p class="section-desc">
				Første klipp har ord-tidsstempler → AudioKaraokePlayer rendres (lyd-src er tom i demoen,
				så avspilling er inert men teksten og spillerlinja er live).
			</p>
			<div class="demo-card demo-card--wide">
				<BookClipsTab themeId="demo" book={bookMock} api={mockBookTabsApi} />
			</div>

			<h3 class="subsection">BookContextTab — kontekstpakke</h3>
			<div class="demo-card demo-card--wide">
				<BookContextTab book={bookWithPackMock} themeId="demo" onRefresh={async () => {}} api={mockBookTabsApi} />
			</div>

			<h3 class="subsection">BookChatTab — boksamtale</h3>
			<p class="section-desc">
				Chat om boka med klipp-referanser. Streaming/opplasting/transkripsjon går via api-prop — mock her.
			</p>
			<div class="demo-card demo-card--wide">
				<BookChatTab
					themeId="demo"
					book={bookMock}
					clips={bookClipsMock}
					chatMessages={bookChatMessagesMock}
					chatMessagesLoaded={true}
					onAutoProgress={noop}
					onClipAdded={noop}
					onChatMessage={noop}
					api={mockBookTabsApi}
				/>
			</div>
		</section>

		<!-- ══ SHEETS & PANELER ═══════════════════════════════════════════════════ -->
		<section id="sheets" class="section">
			<h2 class="section-heading">Sheets & paneler</h2>
			<p class="section-desc">
				Bottompaneler er <code>position: fixed</code>-overlays. Scenen under bruker CSS <code>transform</code>
				på rammen — det gjør rammen til containing block, så sheeten rendrer <em>inne i</em> rammen i stedet
				for over hele siden. Alle sheets har injisert nettverkslag (mock her).
			</p>

			<h3 class="subsection">ChecklistSheet — dagsliste</h3>
			<p class="section-desc">
				Panelet bak sjekkliste-widgetene: tidsatte punkter, morgenrutine, gruppe med underpunkter,
				«Hoppet over»-seksjon og ny-oppgave-felt. All IO (mutasjoner, vær, geolokasjon, stedsoppslag) går via
				<code>ChecklistSheetApi</code> — mocken kvitterer lokalt, så avkryssing og nye punkter fungerer live.
			</p>
			<div class="sheet-stage sheet-stage--tall">
				<ChecklistSheet
					checklist={checklistSheetFixture}
					routines={checklistSheetRoutines}
					onclose={noop}
					api={mockChecklistSheetApi}
				/>
			</div>

			<h3 class="subsection">ChecklistSheet — payoff</h3>
			<p class="section-desc">
				Når siste punkt krysses av vises payoff-animasjonen. Demoen starter ferdig avkrysset, så payoffen
				ligger over listen (trykk for å lukke den).
			</p>
			<div class="sheet-stage">
				<ChecklistSheet
					checklist={checklistSheetDoneFixture}
					onclose={noop}
					api={mockChecklistSheetApi}
				/>
			</div>

			<h3 class="subsection">ProcedureSheet — oppskrift</h3>
			<p class="section-desc">
				To faner (markdown-fremgangsmåte + sjekkliste-trinn), handlingsrad og redigeringsmodus.
				Lagring går via <code>api</code>-prop. Prøv fanene og «Rediger» — alt er live.
			</p>
			<div class="sheet-stage">
				<ProcedureSheet
					procedure={procedureMock}
					onclose={noop}
					onApply={noop}
					onStartChat={noop}
					api={mockProcedureSheetApi}
				/>
			</div>

			<h3 class="subsection">WidgetConfigSheet — widget-konfigurasjon</h3>
			<p class="section-desc">
				Konfigurasjonspanelet for hjemskjerm-widgets. Treff-previewen for beløpsfilter hentes via
				<code>loadPreview</code>-prop — mocken her returnerer et fast resultat (42 treff).
			</p>
			<div class="sheet-stage sheet-stage--tall">
				<WidgetConfigSheet
					widget={widgetConfigMock}
					open
					onclose={noop}
					onsave={noop}
					loadPreview={mockLoadFilterPreview}
				/>
			</div>

			<h3 class="subsection">FlowSheet — strukturert flerstegs-flyt</h3>
			<p class="section-desc">
				Skallet for flows fra <code>$lib/flows/registry</code> — her vektonboardingen (skjemasteg).
				Vær- og AI-forslags-kallene går via <code>api</code>-prop; chat-steg streamer via ChatState og
				demoes ikke her. Naviger gjennom stegene — alt er live.
			</p>
			<div class="sheet-stage sheet-stage--tall">
				<FlowSheet
					flow={FLOWS.health_weight_onboarding}
					onclose={noop}
					oncomplete={noop}
					api={mockFlowSheetApi}
				/>
			</div>

			<h3 class="subsection">FlowSheet i fokusmodus — slot-sjekkin</h3>
			<p class="section-desc">
				Den tidsstyrte fullskjerm-sjekkinen («Hvordan gikk …?») er FlowSheet med <code>focus: true</code> —
				bygget per tidsvindu av <code>buildEgenfrekvensSlotFlow</code>. Steg 1: 1–5-slider med nivå-labels og
				autoAdvance; steg 2: valgfri setning + «Fortsett i chat». <code>onComplete</code> er mocket.
			</p>
			<div class="sheet-stage sheet-stage--tall">
				<FlowSheet
					flow={slotCheckinFlow}
					onclose={noop}
					oncomplete={noop}
					onsecondaryaction={noop}
					api={mockFlowSheetApi}
				/>
			</div>
		</section>

		<!-- ══ MENYER & MODALER ═══════════════════════════════════════════════════ -->
		<section id="modaler" class="section">
			<h2 class="section-heading">Menyer & modaler</h2>
			<p class="section-desc">
				Interaksjons-overlays som ellers bare er synlige ved long-press eller spesifikke hendelser —
				her statisk åpne i scener. BreakdownModal og ShareSheet har injisert nettverkslag (mock).
			</p>

			<h3 class="subsection">TaskContextMenu — long-press-meny</h3>
			<div class="sheet-stage sheet-stage--short">
				<TaskContextMenu
					open
					anchor={taskMenuAnchor}
					itemText="Svømmehall"
					onClose={noop}
					onEdit={noop}
					onBreakdown={noop}
					onSnooze={noop}
					onSkip={noop}
					onDelete={noop}
					onStartChat={noop}
				/>
			</div>

			<h3 class="subsection">AutoCheckModal — auto-avkryssing</h3>
			<p class="section-desc">Foreslår avkryssing når et nytt punkt matcher en registrert treningsøkt.</p>
			<div class="sheet-stage sheet-stage--short">
				<AutoCheckModal prompt={autoCheckPromptMock} busy={false} onConfirm={noop} onDismiss={noop} />
			</div>

			<h3 class="subsection">LocationPickerModal — flertydig stedsnavn</h3>
			<div class="sheet-stage">
				<LocationPickerModal
					placeName="Håøya"
					candidates={geoCandidatesMock}
					onPick={noop}
					onKeepAsTyped={noop}
					onClose={noop}
				/>
			</div>

			<h3 class="subsection">BreakdownModal — AI-nedbrytning</h3>
			<p class="section-desc">AI-forslagene hentes via <code>loadSuggestionsFn</code>-prop — mock her.</p>
			<div class="sheet-stage">
				<BreakdownModal
					itemTitle="Male barnerommet"
					onClose={noop}
					onSave={async () => {}}
					loadSuggestionsFn={mockLoadBreakdownSuggestions}
				/>
			</div>

			<h3 class="subsection">ConversationContextMenu — samtale-meny</h3>
			<p class="section-desc">
				⋯-menyen på samtaler (stjerne, arkiver, flytt til tema, slett). Nettverk via <code>api</code>-prop;
				<code>initialOpen</code> holder den åpen i demoen.
			</p>
			<div class="sheet-stage sheet-stage--short" style="padding: 12px 12px 0 160px;">
				<ConversationContextMenu
					conversationId="demo"
					starred={true}
					archived={false}
					themes={conversationThemesMock}
					api={mockConversationMenuApi}
					initialOpen
				/>
			</div>

			<h3 class="subsection">ShareSheet — deling</h3>
			<p class="section-desc">Delingspanel for sjekklister/temalister. Nettverk via <code>api</code>-prop — mock viser én eksisterende deling.</p>
			<div class="sheet-stage sheet-stage--tall">
				<ShareSheet
					resourceType="checklist"
					resourceId="cls-1"
					resourceTitle="Bergenstur"
					open
					onClose={noop}
					api={mockShareApi}
				/>
			</div>
		</section>

		<!-- ══ LAB ════════════════════════════════════════════════════════════════ -->
		<section id="lab" class="section">
			<h2 class="section-heading">Lab — ikke i appen ennå</h2>
			<p class="section-desc">
				Komponenter som utvikles og tilpasses her før de eventuelt tas inn i appen.
				<strong>Ingen av disse brukes i produksjon i dag.</strong> Når en komponent tas i bruk,
				flyttes demoen opp i riktig seksjon; når den forkastes, slettes den herfra og fra <code>ui/</code>.
			</p>

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
			</div>

			<h3 class="subsection">ChatBubble</h3>
			<p class="section-desc">
				Enkel meldingsboble. Chat-flatene i appen bruker <code>TriageCard</code> — ChatBubble er kandidat for
				enkle meldingslister, men er ikke i bruk i dag.
			</p>
			<div class="chat-demo">
				<ChatBubble role="user" text="Jeg veide 92 kg i dag" />
				<ChatBubble role="bot" text="✦ Registrert — ned 0.4 kg siden sist." branch="Trening & helse" />
			</div>

			<h3 class="subsection">DomainWheelChart</h3>
			<p class="section-desc">
				Radial domeneprofil: radius = andel av månedsmål, opasitet = trend siste 7 dager.
				Tenkt som «livshjul»-widget på hjemskjermen.
			</p>
			<div class="radial-row">
				<div class="radial-card">
					<DomainWheelChart domains={demoDomains} size={220} />
					<p class="radial-caption">Helse ↑, Økonomi →, Mat ↓</p>
				</div>
				<div class="widget-mock">
					<div class="widget-mock-ring">
						<DomainWheelChart domains={demoDomains} size={70} showLabels={false} centerLabel="57%" centerSublabel="" />
					</div>
					<span class="widget-mock-label">Widget-størrelse</span>
				</div>
			</div>

			<h3 class="subsection">Udokumenterte ui-komponenter</h3>
			<p class="section-desc">
				Disse brukes i appen, men har ikke egen demo her ennå:
				<code>Radio</code>, <code>TabButton</code>, <code>ChipStrip</code>,
				<code>CollapsibleSection</code>, <code>Tooltip</code>, <code>TransactionList</code>,
				<code>PullToRefresh</code> og settings-provider-kortene.
				(TaskTitle, ChecklistItemRow/GroupRow/RoutineGroupRow og ChecklistCheckbox vises live
				inne i sjekkliste- og ukeplan-demoene.) Legg til demoer etter hvert som de berøres.
			</p>
		</section>

	</main>
	</div>
	</PageSection>
</AppPage>

<style>
	/* ── Layout ── */
	.page {
		display: flex;
		min-height: 100vh;
		background: var(--bg-primary, #0f0f0f);
		color: var(--text-secondary, #ccc);
		font-family: 'Inter', system-ui, sans-serif;
	}

	.sidenav {
		position: sticky;
		top: 0;
		height: 100vh;
		width: 160px;
		flex-shrink: 0;
		padding: 48px 0 24px 20px;
		border-right: 1px solid var(--border-subtle, #1e1e1e);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.sidenav-link {
		font-size: 0.72rem;
		font-weight: 500;
		color: var(--text-tertiary, #555);
		text-decoration: none;
		padding: 4px 8px;
		border-radius: 6px;
		transition: color 0.12s, background 0.12s;
	}
	.sidenav-link:hover { color: var(--text-primary, #ccc); background: var(--bg-card, #1a1a1a); }

	.content {
		flex: 1;
		max-width: 860px;
		min-width: 0;
		padding: 48px 40px 120px;
	}

	/* Smal skjerm: sidenav som statisk lenkerad øverst — unngår sticky/horisontal
	   overflow (som også smører kolonner inn i screenshot-stitchingen). */
	@media (max-width: 700px) {
		.page {
			flex-direction: column;
		}

		.sidenav {
			position: static;
			height: auto;
			width: auto;
			flex-direction: row;
			flex-wrap: wrap;
			gap: 2px 4px;
			padding: 16px 16px 10px;
			border-right: none;
			border-bottom: 1px solid var(--border-subtle, #1e1e1e);
		}

		.content {
			padding: 24px 16px 80px;
		}
	}

	/* ── Overskrifter ── */
	.page-title {
		font-size: 1.6rem;
		font-weight: 700;
		letter-spacing: -0.03em;
		color: var(--text-primary, #eee);
		margin: 0 0 6px;
	}

	.page-sub {
		font-size: 0.82rem;
		color: var(--text-tertiary, #555);
		margin: 0 0 48px;
		max-width: 560px;
		line-height: 1.6;
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
		border-bottom: 1px solid var(--border-subtle, #1e1e1e);
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
		max-width: 620px;
	}

	.section-desc code {
		font-size: 0.72rem;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		padding: 0 4px;
		color: #888;
	}

	.section-desc a {
		color: #8ba0f5;
	}

	/* ── Typografi ── */
	.type-scale {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 560px;
	}

	.type-row {
		display: grid;
		grid-template-columns: 170px 60px 1fr;
		align-items: baseline;
		gap: 12px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border-subtle, #1e1e1e);
	}

	.type-row code {
		font-size: 0.72rem;
		color: #8ba0f5;
	}

	.type-val {
		font-size: 0.72rem;
		color: #555;
	}

	/* ── Demo-wrappere ── */
	.demo-stack {
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.demo-row {
		display: flex;
		gap: 20px;
		flex-wrap: wrap;
		align-items: flex-start;
	}

	.demo-card {
		max-width: 420px;
		flex: 1 1 300px;
	}

	.demo-card--wide {
		max-width: 560px;
	}

	.demo-caption {
		font-size: 0.68rem;
		color: #555;
		margin: 6px 0 20px;
	}

	/* ── Sheet-scene ──
	   transform gjør rammen til containing block for position:fixed-barn,
	   så sheets rendrer inne i rammen i stedet for over hele siden. */
	/* Ramme for ShowSlide-demoer — sliden er position:absolute og fyller rammen */
	.show-stage {
		position: relative;
		flex: 1 1 240px;
		max-width: 280px;
		height: 440px;
		border: 1px solid #222;
		border-radius: 20px;
		overflow: hidden;
	}

	.sheet-stage {
		position: relative;
		transform: translateZ(0);
		width: 100%;
		max-width: 420px;
		height: 560px;
		border: 1px solid #222;
		border-radius: 20px;
		overflow: hidden;
		background: #08080a;
		margin-bottom: 12px;
	}

	.sheet-stage--tall {
		height: 720px;
	}

	.sheet-stage--short {
		height: 420px;
	}

	.chat-demo--wide {
		max-width: 440px;
	}

	/* ── MetricCard-demo ── */
	.metric-demo {
		max-width: 480px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.metric-row {
		display: grid;
		grid-template-columns: 110px 1fr;
		align-items: center;
		gap: 12px;
	}

	.metric-label {
		font-size: 0.68rem;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	/* Sheets bruker dvh-baserte max-heights — klamp til scenen. */
	.sheet-stage :global([role='dialog']) {
		max-height: 100%;
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

	/* ── Ikon-lab ── */
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

	/* ── Chat-demo ── */
	.chat-demo {
		background: #111;
		border: 1px solid #1e1e1e;
		border-radius: 16px;
		padding: 16px;
		max-width: 380px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	/* ── Skjema-demo ── */
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
		color: var(--accent-primary, #4a5af0);
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

	/* ── Radiale visualiseringer ── */
	.radial-row {
		display: flex;
		align-items: flex-start;
		gap: 32px;
		flex-wrap: wrap;
		margin: 16px 0 32px;
	}

	.radial-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		background: #111;
		border: 1px solid #222;
		border-radius: 16px;
		padding: 20px;
	}

	.radial-caption {
		font-size: 0.72rem;
		color: #555;
		margin: 0;
		text-align: center;
	}

	.radial-legend {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 4px;
	}

	.radial-legend-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8rem;
		color: #aaa;
	}

	.radial-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.radial-hr {
		border: none;
		border-top: 1px solid #222;
		margin: 4px 0;
	}

	.radial-dim {
		font-size: 0.75rem;
		color: #555;
	}

	/* Widget-mock (nøyaktig ChecklistWidget-dimensjoner) */
	.widget-mock {
		width: 90px;
		min-height: 106px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
	}

	.widget-mock-ring {
		width: 70px;
		height: 70px;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.widget-mock-label {
		font-size: 0.65rem;
		color: #888;
		text-align: center;
	}

	/* ExpandableCard-demo */
	.ec-demo-emoji {
		font-size: 1.25rem;
		flex-shrink: 0;
		width: 28px;
		text-align: center;
	}

	.ec-demo-info {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.ec-demo-name {
		font-weight: 500;
		color: var(--text-primary);
	}

	.ec-demo-meta {
		font-size: 0.72rem;
		color: var(--text-tertiary);
	}

	.ec-demo-body {
		padding: 0.25rem 0.9rem 0.9rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.ec-demo-body p {
		margin: 0;
	}
</style>
