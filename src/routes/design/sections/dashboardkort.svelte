<script lang="ts">
	import ProjectCard from '$lib/components/composed/ProjectCard.svelte';
	import ScreenTimeCard from '$lib/components/composed/ScreenTimeCard.svelte';
	import BalanceCard from '$lib/components/composed/BalanceCard.svelte';
	import FormCard from '$lib/components/composed/FormCard.svelte';
	import WeeklyEffortCard from '$lib/components/composed/WeeklyEffortCard.svelte';
	import MetricCard from '$lib/components/visualizations/MetricCard.svelte';
	import {
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
