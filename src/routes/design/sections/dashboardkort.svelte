<script lang="ts">
	import ProjectCard from '$lib/components/composed/ProjectCard.svelte';
	import ScreenTimeCard from '$lib/components/composed/ScreenTimeCard.svelte';
	import LoadBalanceCard from '$lib/components/composed/LoadBalanceCard.svelte';
	import FormCard from '$lib/components/composed/FormCard.svelte';
	import WeeklyEffortCard from '$lib/components/composed/WeeklyEffortCard.svelte';
	import MetricCard from '$lib/components/visualizations/MetricCard.svelte';
	import { StreakCard } from '$lib/components/ui';
	import HealthSubthemeStrip from '$lib/components/domain/health/HealthSubthemeStrip.svelte';
	import HealthSignalSection from '$lib/components/domain/health/HealthSignalSection.svelte';
	import NutritionDayCard from '$lib/components/domain/nutrition/NutritionDayCard.svelte';
	import SleepDisturbanceList from '$lib/components/domain/sleep/SleepDisturbanceList.svelte';
	import Vo2maxCard from '$lib/components/domain/training/Vo2maxCard.svelte';
	import HrRecoveryCard from '$lib/components/domain/training/HrRecoveryCard.svelte';
	import HrvCard from '$lib/components/domain/sleep/HrvCard.svelte';
	import MacroSplitBar from '$lib/components/domain/nutrition/MacroSplitBar.svelte';
	import WeightStatusCard from '$lib/components/domain/weight/WeightStatusCard.svelte';
	import WeightMilestonesCard from '$lib/components/domain/weight/WeightMilestonesCard.svelte';
	import WeightTrendChart from '$lib/components/domain/weight/WeightTrendChart.svelte';
	import {
		healthSubthemeTiles,
		healthSignals,
		nutritionToday,
		nutritionTargets,
		nutritionAverage,
		sleepDisturbanceNights,
		vo2maxEstimated,
		vo2maxShaky,
		vo2maxMeasured,
		hrRecoveryGood,
		hrRecoveryLateAnchor,
		hrRecoveryWeak,
		hrvNormal,
		hrvUnder,
		hrvBuilding,
		breathingMild,
		macroSplitTypical,
		macroSplitHighProtein,
		macroSplitUnaccounted,
		weightDays,
		weightLatest,
		weightComposition,
		weightCompositionMuscleGain,
		weightMilestones,
		weightMilestonesQualified,
		weightMilestonesStale,
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
		metricRunning,
		metricWeight,
		metricSleep,
		metricSteps,
		metricGrocery
	} from '../mocks';
</script>

<!-- ══ DASHBOARD-KORT ═════════════════════════════════════════════════════ -->
<section id="dashboardkort" class="section">
	<h2 class="section-heading">Dashboard-kort</h2>
	<p class="section-desc">
		Sammensatte kort fra <code>composed/</code> slik de brukes i helse-, skjermtid- og prosjektsidene.
		Alle er rent props-drevne og rendres her med mock-data.
	</p>

	<h3 class="subsection">StreakCard — streaks</h3>
	<p class="section-desc">
		Ett uttrykk for alle tre streak-regler: dager på rad, perioder over en terskel og runder med
		periodisk vedlikehold. Brukt på <code>/plan/rutiner</code> og på streak-sidene i widget-sveipen
		på hjemmeskjermen. Bredt kort framfor smal badge fordi titlene er brukerskrevne setninger som
		brekker stygt i en kolonne. Metalinjen kommer fra <code>streakLabel()</code> +
		<code>streakSublabel()</code> — kortet kjenner ingen regler selv.
	</p>
	<div class="streak-card-demo">
		<StreakCard count={6} title="Løpe minst 15 minutter hver dag" emoji="🏃"
			meta="6 dager på rad · gjenstår i dag"
			dots={[true, true, false, true, true, true, false]}
		/>
		<StreakCard count={3} title="Uker med minst to løpeturer" emoji="🏃"
			color="var(--success-text)"
			meta="3 uker på rad · 1/2 denne uka"
			dots={[false, true, true, true, true, true, true]}
		/>
		<StreakCard count={4} title="Hårklipp" emoji="💈"
			color="var(--accent-muted)"
			meta="4 runder på rad · forfaller om 2 dager"
			dots={[true, true, true, true]}
		/>
		<StreakCard count={0} title="Badevask" emoji="🛁"
			meta="3 dager på overtid"
			dots={[true, true, false]}
		/>
	</div>

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

	<h3 class="subsection">LoadBalanceCard + FormCard — treningsbelastning</h3>
	<p class="section-desc">Begge leser samme <code>TrainingLoadPoint[]</code>-serie (CTL/ATL/TSB).</p>
	<div class="demo-row">
		<div class="demo-card"><LoadBalanceCard series={loadSeries} /></div>
		<div class="demo-card"><FormCard series={loadSeries} windowDays={120} /></div>
	</div>

	<h3 class="subsection">HealthSubthemeStrip — undertemaene av Helse</h3>
	<p class="section-desc">
		Ett tall per gren. Siste flis viser tomtilstanden for et undertema som ikke er
		opprettet ennå — den er dempet, men fortsatt klikkbar.
	</p>
	<div class="demo-card demo-card--wide">
		<HealthSubthemeStrip tiles={healthSubthemeTiles} />
	</div>

	<h3 class="subsection">SignalCard — kryss-domene-signal</h3>
	<p class="section-desc">
		Tone fra <code>severity</code>, og kryss-lenker til de to temaene signalet
		forbinder. Generisk over domener, ikke bare helse.
	</p>
	<div class="demo-card demo-card--wide">
		<HealthSignalSection
			signals={healthSignals}
			themeIdsByName={{ Trening: 'demo-trening', Søvn: 'demo-sovn', Ernæring: 'demo-ernaering' }}
		/>
	</div>

	<h3 class="subsection">ScreenTimeCard — skjermtid</h3>
	<p class="section-desc">
		Full variant med ukesmål, dagsfordeling, akkumulert ukegraf og kategorisplitt — som på Skjermtid-undertemaet.
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
	<h3 class="subsection">NutritionDayCard — dagens inntak</h3>
	<p class="section-desc">
		Summer, andel av dagsmålet og de loggede måltidene. Sikkerheten står på hvert
		måltid, fordi tallene er estimater fra en modell — ikke målinger.
	</p>
	<div class="demo-card demo-card--wide">
		<NutritionDayCard day={nutritionToday} targets={nutritionTargets} average={nutritionAverage} />
	</div>

	<!-- NutritionLogger er bevisst ikke demonstrert her: /design er en public
	     path, og loggeren kaller /api/helse/ernaering/* som krever innlogging.
	     En demo ville bare vist 401-feil. -->

	<h3 class="subsection">SleepDisturbanceList — urolige netter</h3>
	<p class="section-desc">
		Gruppert per natt, ikke per hendelse: tre oppvåkninger samme natt er én dårlig
		natt. «Vet ikke» på minutter er et gyldig svar og vises da ikke.
	</p>
	<div class="demo-card demo-card--wide">
		<SleepDisturbanceList nights={sleepDisturbanceNights} />
	</div>

	<!-- SleepLogger er, som NutritionLogger, ikke demonstrert her: /design er en
	     public path og loggeren kaller /api/soevn/*, som krever innlogging. -->

	<h3 class="subsection">Vo2maxCard — oksygenopptak</h3>
	<p class="section-desc">
		Beste observasjon i vinduet, ikke siste: en rolig 10k gir lav VDOT og sier bare
		at du løp rolig. Kortet er eksplisitt om kilde og usikkerhet — et estimat fra en
		3k advarer om seg selv.
	</p>
	<div class="demo-card demo-card--wide"><Vo2maxCard metric={vo2maxEstimated} /></div>
	<div class="demo-card demo-card--wide"><Vo2maxCard metric={vo2maxShaky} /></div>
	<div class="demo-card demo-card--wide"><Vo2maxCard metric={vo2maxMeasured} /></div>

	<h3 class="subsection">HrRecoveryCard — pulsfall</h3>
	<p class="section-desc">
		Fallet det første minuttet etter hard innsats, ankret i pulsserien framfor i
		stoppknappen — toppulsen ligger typisk 17–105 sekunder før man trykker stopp.
		Beste økt i vinduet, av samme grunn som VO2max. De to advarslene kortet kan gi:
		et anker godt under toppen betyr at tallet er et gulv, og et svakt fall kan
		skyldes at man fortsatte å bevege seg.
	</p>
	<div class="demo-card demo-card--wide"><HrRecoveryCard metric={hrRecoveryGood} /></div>
	<div class="demo-card demo-card--wide"><HrRecoveryCard metric={hrRecoveryLateAnchor} /></div>
	<div class="demo-card demo-card--wide"><HrRecoveryCard metric={hrRecoveryWeak} /></div>

	<h3 class="subsection">HrvCard — hjerterytmevariasjon</h3>
	<p class="section-desc">
		Motsatt retning av kortene over: her er <em>siste</em> måling det interessante,
		ikke den beste. HRV svarer på hvordan det står til nå. Absoluttverdien står med,
		men avviket fra egen baseline er hovedtallet — SDNN varierer for mye mellom folk
		til at et tall uten baseline betyr noe, og det finnes ingen normtabell å plassere
		folk i. Med for få netter sier kortet «bygger baseline» framfor å vise et avvik
		det ikke har grunnlag for. Pust og snorking henger under, flagget over klinisk
		grense på fem pustestopp i timen.
	</p>
	<div class="demo-card demo-card--wide"><HrvCard metric={hrvNormal} /></div>
	<div class="demo-card demo-card--wide"><HrvCard metric={hrvUnder} breathing={breathingMild} /></div>
	<div class="demo-card demo-card--wide"><HrvCard metric={hrvBuilding} /></div>

	<h3 class="subsection">MacroSplitBar — hvor energien kom fra</h3>
	<p class="section-desc">
		Del-av-helhet med tre kategorier, altså en liggende stablet stolpe — ikke et
		kakediagram. Poenget er at gram ikke er sammenlignbare: fett har 9 kcal per gram
		mot 4 for de to andre, så i første eksempel har fett færrest gram og flest
		kalorier. Fargene er de tre første slottene fra den kategoriske paletten, tildelt
		i fast rekkefølge så et segment beholder fargen når et annet blir null (validert
		mot flaten: verste nabopar ΔE 9,4 deutan, 26,5 normalt syn). Identiteten ligger
		aldri i fargen alene — hvert segment er direkte merket, og legenden gjentar gram
		og kcal. Siste eksempel viser forklaringen når makroene og kcal-tallet spriker.
	</p>
	<div class="demo-card demo-card--wide"><MacroSplitBar split={macroSplitTypical} /></div>
	<div class="demo-card demo-card--wide"><MacroSplitBar split={macroSplitHighProtein} /></div>
	<div class="demo-card demo-card--wide"><MacroSplitBar split={macroSplitUnaccounted} /></div>

	<h3 class="subsection">WeightStatusCard — hvor vekta står nå</h3>
	<p class="section-desc">
		Nivået er overskriften, ikke endringen: «82,4» sier hvor du er, «−0,6» sier bare at noe
		skjedde. Kortet leder med den <em>målte</em> vekta og setter trenden ved siden av — et
		hovedtall brukeren ikke kjenner igjen fra badet er et hovedtall hun ikke stoler på.
		Fettandelen står der fordi vekta alene ikke kan skille et vekttap du vil ha fra et du ikke
		vil ha.
	</p>
	<div class="demo-card demo-card--wide">
		<WeightStatusCard
			latest={weightLatest}
			trendKg={81.9}
			composition={weightComposition}
			today="2026-08-05"
		/>
	</div>
	<div class="demo-card demo-card--wide">
		<WeightStatusCard
			latest={weightLatest}
			trendKg={81.9}
			composition={weightCompositionMuscleGain}
			today="2026-08-05"
		/>
	</div>

	<h3 class="subsection">WeightMilestonesCard — setningene historikken bærer</h3>
	<p class="section-desc">
		Alle setningene kommer ferdig formulert fra <code>buildWeightMilestones</code>; kortet setter
		ikke sammen tall selv, for da ville vaktene ligget et sted uten tester. Tonen bæres av prikk
		<em>og</em> ordlyd, aldri av farge alene. Andre eksempel viser den viktigste vakta: er over
		halve nedgangen muskel, avlyses feiringen og setningen sier det. Tredje viser at kortet
		heller forklarer stillheten enn å skjule seg — en seksjon som forsvinner ser ut som en
		funksjon som ikke finnes.
	</p>
	<div class="demo-card demo-card--wide">
		<WeightMilestonesCard
			milestones={weightMilestones}
			historyDays={517}
			weighIns={402}
			enoughHistory={true}
		/>
	</div>
	<div class="demo-card demo-card--wide">
		<WeightMilestonesCard
			milestones={weightMilestonesQualified}
			historyDays={517}
			weighIns={402}
			enoughHistory={true}
			milestonesReachBeyondChart={true}
		/>
	</div>
	<div class="demo-card demo-card--wide">
		<WeightMilestonesCard
			milestones={weightMilestonesStale}
			historyDays={517}
			weighIns={402}
			enoughHistory={true}
		/>
	</div>
	<div class="demo-card demo-card--wide">
		<WeightMilestonesCard milestones={[]} historyDays={12} weighIns={9} enoughHistory={false} />
	</div>

	<h3 class="subsection">WeightTrendChart — rå målinger og glidende trend</h3>
	<p class="section-desc">
		Punktene er sannheten, linja er signalet. Å vise bare trenden skjuler at målingene spriker et
		helt kilo på væske alene; å vise bare punktene gir et støybilde man ikke kan lese en retning
		ut av. Sammen lærer de hva som <em>er</em> støy. Én måling, altså én akse: trenden bærer
		appens vektfarge og de rå punktene samme farge dempet, mens mållinja er blå og stiplet fordi
		den er en referanse og ikke en måling. Aksen har et gulv, så en rolig måned ikke tegnes som
		et stup — samme lærdom som vektaksen i ernæringshistorikken. x-aksen er tidsproporsjonal, så
		et hull i veiingene blir et tomrom og ikke to punkter ved siden av hverandre.
	</p>
	<div class="demo-card demo-card--wide">
		<WeightTrendChart days={weightDays} goalKg={80} />
	</div>
	<div class="demo-card demo-card--wide">
		<WeightTrendChart days={weightDays.slice(-24)} initialRange="30d" />
	</div>

</section>

<style>
	.streak-card-demo {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 8px;
		max-width: 720px;
	}
</style>
