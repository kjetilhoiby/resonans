<script lang="ts">
	import ProcedureSheet from '$lib/components/ui/ProcedureSheet.svelte';
	import WidgetConfigSheet from '$lib/components/ui/WidgetConfigSheet.svelte';
	import ChecklistSheet from '$lib/components/ui/ChecklistSheet.svelte';
	import FlowSheet from '$lib/components/flows/FlowSheet.svelte';
	import { FLOWS } from '$lib/flows/registry';
	import {
		procedureMock,
		mockProcedureSheetApi,
		widgetConfigMock,
		mockLoadFilterPreview,
		mockChecklistSheetApi,
		checklistSheetFixture,
		checklistSheetRoutines,
		checklistSheetDoneFixture,
		mockFlowSheetApi,
		slotCheckinFlow
	} from '../mocks';

	const noop = () => {};
</script>

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
