<script lang="ts">
	import { GoalRing, PeriodPills } from '$lib/components/ui';
	import ChecklistWidget from '$lib/components/composed/ChecklistWidget.svelte';
	import DynamicWidgetView from '$lib/components/composed/DynamicWidgetView.svelte';
	import DayWheelChart from '$lib/components/visualizations/DayWheelChart.svelte';
	import {
		checklistEmpty,
		checklistHalf,
		checklistDone,
		checklistMonth,
		demoMonthDays,
		widgetWeight,
		widgetSteps,
		widgetSpend,
		widgetSleep
	} from '../mocks';

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
</script>

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
