<script lang="ts">
	import {
		KavalkadeStats,
		Ordsky,
		MonthTimeline,
		GreetingsList,
		InterviewAnswerList,
		PhotoGallery,
		LoopCard,
		ShowSlide
	} from '$lib/components/domain/kavalkade';
	import {
		kavalkadeCurrentYearMock,
		kavalkadePreviousYearMock,
		kavalkadeOrdskyMock,
		kavalkadeTimelineMock,
		kavalkadeGreetingsMock,
		kavalkadeInterviewAnswersMock,
		kavalkadePhotosMock,
		kavalkadeLoopMock,
		kavalkadeShowSlidesMock
	} from '../mocks';
</script>

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

	<h3 class="subsection">PhotoGallery — årets bilder</h3>
	<p class="section-desc">
		Bildene som lastes opp i selvangivelsen, som mosaikk med bildetekst. (Demo: fargede
		placeholder-bilder.)
	</p>
	<div class="demo-card demo-card--wide">
		<PhotoGallery photos={kavalkadePhotosMock} />
	</div>

	<h3 class="subsection">LoopCard — dette ville du i fjor</h3>
	<p class="section-desc">
		Fjorårets bursdagsmål + spådom holdt opp mot hva som faktisk skjedde, med ærlige
		status-merker (oppnådd / ikke nådd / uvisst).
	</p>
	<div class="demo-card demo-card--wide">
		<LoopCard loop={kavalkadeLoopMock} />
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
