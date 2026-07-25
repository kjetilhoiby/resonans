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
	<p class="section-desc">
		Ett visuelt språk for alle streaks — dager på rad, uker over en terskel og runder med
		periodisk vedlikehold. Teksten kommer fra <code>streakSublabel()</code> i
		<code>$lib/domain/streaks.ts</code>; badgen kjenner ingen regler selv.
	</p>
	<div class="variant-grid">
		<div class="variant">
			<StreakBadge count={12} unit="day"
				dots={[true, true, true, true, true, true, true]}
				label="Yoga"
			/>
			<span class="vname">Dager på rad</span>
		</div>
		<div class="variant">
			<StreakBadge count={3} unit="day" color="var(--accent-light)"
				dots={[false, false, false, false, true, true, false]}
				label="Lett styrke" sublabel="gjenstår i dag"
			/>
			<span class="vname">Forfaller i dag · blå</span>
		</div>
		<div class="variant">
			<StreakBadge count={5} unit="week" color="var(--success-text)"
				dots={[false, true, true, true, true, true, true]}
				label="Løping" sublabel="1/2 denne uka"
			/>
			<span class="vname">Uker over terskel</span>
		</div>
		<div class="variant">
			<StreakBadge count={4} unit="round" color="var(--accent-muted)"
				dots={[true, true, true, true]}
				label="Hårklipp" sublabel="forfaller om 2 dager"
			/>
			<span class="vname">Periodisk vedlikehold</span>
		</div>
		<div class="variant">
			<StreakBadge count={0} unit="round"
				dots={[true, true, false]}
				label="Badevask" sublabel="3 dager på overtid"
			/>
			<span class="vname">Brutt · dempet</span>
		</div>
		<div class="variant">
			<StreakBadge size="sm" count={12} unit="day"
				dots={[true, true, true, true, true, true, true]}
				label="🧘 Yoga" sublabel="gjenstår i dag"
			/>
			<span class="vname">Kompakt (widget-sonen)</span>
		</div>
	</div>
	<p class="section-desc">
		Den kompakte varianten (<code>size="sm"</code>) matcher <code>DynamicWidget</code> i mål — 90px
		bred med 64px ring — og brukes på streak-sidene i widget-sveipen på hjemmeskjermen.
	</p>

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
