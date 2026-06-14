<script lang="ts">
	import { PageHeader, Section, CompactRecordList, Skeleton } from '$lib/components/ui';
</script>

<!-- ══ LAYOUT & STRUKTUR ══════════════════════════════════════════════════ -->
<section id="layout" class="section">
	<h2 class="section-heading">Layout & struktur</h2>
	<p class="section-desc">
		Base-komponenter for sidestruktur. Hver side: <code>AppPage</code> → <code>PageSection</code> → <code>PageHeader</code> → innhold.
	</p>

	<h3 class="subsection">PageHeader</h3>
	<p class="section-desc">
		Standard sidetittel for hele appen — tittelen ER tilbakeknappen (<code>titleHref</code>/<code>onTitleClick</code>),
		støtter <code>emoji</code>, <code>subtitle</code> og morph-animasjon. Erstattet ScreenTitle og MorphTitle.
	</p>
	<div class="demo-stack">
		<PageHeader title="Helse" subtitle="Vekt, løping, søvn og aktivitet" emoji="🏃" titleHref="/design" />
	</div>

	<h3 class="subsection">Section</h3>
	<p class="section-desc">
		Standard contentwrapper bygget på <code>--card-*</code>-tokens, ingen border.
		Valgfri tittel og meta. For nye kort: vurder <code>SectionCard</code> (flere tones + actions).
	</p>
	<div class="demo-stack">
		<Section title="Eksempel uten innhold">
			<p style="margin: 0; color: #888; font-size: 0.82rem;">Dette er innholdet i seksjonen.</p>
		</Section>
		<Section title="Med metadata" meta="3 items">
			<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px;">
				<li style="color: #aaa; font-size: 0.82rem;">• Item 1</li>
				<li style="color: #aaa; font-size: 0.82rem;">• Item 2</li>
				<li style="color: #aaa; font-size: 0.82rem;">• Item 3</li>
			</ul>
		</Section>
	</div>

	<h3 class="subsection">CompactRecordList</h3>
	<p class="section-desc">
		Kompakt liste med tittel, label og meta-info. Brukes for kilder, kontoer, siste transaksjoner osv.
	</p>
	<div class="demo-stack">
		<CompactRecordList
			title="Kilder"
			items={[
				{ id: '1', title: 'Withings Account', subtitle: 'withings', meta: 'Synket 30.3., 13:15' },
				{ id: '2', title: 'Apple Health', subtitle: 'apple', meta: 'Synket 29.3., 08:42' },
				{ id: '3', title: 'Strava', subtitle: 'strava', meta: 'Ikke synket' }
			]}
			emptyText="Ingen kilder ennå."
		/>
	</div>

	<h3 class="subsection">Skeleton — lastetilstander</h3>
	<p class="section-desc">
		<code>Skeleton</code> har fire varianter. Bruk denne i stedet for ad-hoc «Laster …»-tekst.
	</p>
	<div class="demo-stack">
		<div style="display: flex; align-items: center; gap: 12px;">
			<Skeleton variant="circle" />
			<div style="flex: 1; display: flex; flex-direction: column; gap: 8px;">
				<Skeleton variant="line" width="60%" />
				<Skeleton variant="line" width="85%" />
			</div>
		</div>
		<Skeleton variant="card" />
		<Skeleton variant="pill" />
	</div>
</section>
