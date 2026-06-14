<script lang="ts">
	import { Button, PeriodPills, ChipStrip } from '$lib/components/ui';
</script>

<!-- ══ NAVIGASJON ═════════════════════════════════════════════════════════ -->
<section id="navigasjon" class="section">
	<h2 class="section-heading">Navigasjon</h2>

	<h3 class="subsection">PeriodPills — tidsvalg</h3>
	<div class="variant-grid" style="--min:200px">
		<div class="variant nav-demo">
			<PeriodPills options={['7d','30d','90d']} value="30d" />
			<span class="vname">Korttids</span>
		</div>
		<div class="variant nav-demo">
			<PeriodPills options={['uke','måned','kvartal','år']} value="kvartal" />
			<span class="vname">Periodisk</span>
		</div>
	</div>

	<h3 class="subsection">Tema-piller</h3>
	<div class="tema-rail-demo">
		{#each ['Trening & helse', 'Søvn', 'Økonomi', 'Jobb', 'Relasjoner'] as t}
			<Button variant="chip">{t}</Button>
		{/each}
	</div>

	<h3 class="subsection">ChipStrip — horisontalt scrollbånd</h3>
	<p class="section-desc">Wrapper for pill-rader som scroller horisontalt uten synlig scrollbar.</p>
	<div class="demo-card demo-card--wide">
		<ChipStrip ariaLabel="Demo-chips">
			{#each ['Trening', 'Søvn', 'Økonomi', 'Familie', 'Bøker', 'Egenfrekvens', 'Hjem', 'Jobb'] as c}
				<Button variant="chip">{c}</Button>
			{/each}
		</ChipStrip>
	</div>

	<h3 class="subsection">Subtabs</h3>
	<p class="section-desc">
		Global <code>.subtab</code>-klasse fra <code>app.css</code> — brukes til underfaner <em>inne i</em> dashboards
		(Økonomi, Familie). Temasidenes hovedfaner («Samtaler | Oversikt | Mål …») er en egen stil i
		<code>ThemePage.svelte</code> (<code>.tp-tab</code>) med kant-til-kant-bånd.
	</p>
	<div class="subtab-demo">
		{#each [['Chat','aktiv'], ['Data',''], ['Filer','']] as [lbl, st]}
			<button class="subtab" class:active={st === 'aktiv'}>{lbl}</button>
		{/each}
	</div>
</section>
