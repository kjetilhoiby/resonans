<script lang="ts">
	import { ExpandableCard } from '$lib/components/ui';

	let expandedDemoCard = $state<string | null>('a');
	function toggleDemoCard(id: string) {
		expandedDemoCard = expandedDemoCard === id ? null : id;
	}
</script>

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
