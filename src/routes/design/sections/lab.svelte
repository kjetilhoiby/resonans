<script lang="ts">
	import { StreakBadge, ChatBubble, RelationSparkline } from '$lib/components/ui';
	import DomainWheelChart from '$lib/components/visualizations/DomainWheelChart.svelte';
	import { demoDomains } from '../mocks';
</script>

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
