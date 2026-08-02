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
	import {
		healthSubthemeTiles,
		healthSignals,
		nutritionToday,
		nutritionTargets,
		nutritionAverage,
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

</section>

<style>
	.streak-card-demo {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 8px;
		max-width: 720px;
	}
</style>
