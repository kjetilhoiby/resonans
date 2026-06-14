<script lang="ts">
	import WeekGoals from '$lib/components/domain/ukeplan/WeekGoals.svelte';
	import WeekNote from '$lib/components/domain/ukeplan/WeekNote.svelte';
	import DaySection from '$lib/components/domain/ukeplan/DaySection.svelte';
	import WeekTasks from '$lib/components/domain/ukeplan/WeekTasks.svelte';
	import WeatherStrip from '$lib/components/ui/WeatherStrip.svelte';
	import type { SaveState } from '$lib/components/domain/ukeplan/types';
	import {
		weekGoalsVision,
		weekGoalsMock,
		daySectionFixture,
		weekTasksFixture,
		weatherPeriodsMock
	} from '../mocks';

	let weekNoteSaveState = $state<SaveState>('idle');
	async function mockSaveWeekNote(): Promise<boolean> {
		await new Promise((r) => setTimeout(r, 600));
		return true;
	}
</script>

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
