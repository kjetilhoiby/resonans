<script lang="ts">
	import SickEpisodeView from '$lib/components/domain/health/SickEpisodeView.svelte';
	import { sickEpisodeMock } from '../mocks';
</script>

<!-- ══ SYKDOMSFORLØP ══════════════════════════════════════════════════════ -->
<section id="sykdomsforlop" class="section">
	<h2 class="section-heading">Sykdomsforløp</h2>
	<p class="section-desc">
		<code>domain/health/SickEpisodeView</code> — én sykeperiode med felles tidsakse:
		selvrapportert nivå, vekt, dagpuls, sovepuls, søvn og temperatur over de samme dagene,
		med symptomene som bjelker under. Mocken er bygget med de ekte domenefunksjonene
		(<code>buildEpisodeTrack</code> m.fl.), ikke et håndskrevet objekt.
	</p>
	<p class="section-desc">
		Radene deler x-akse med vilje og har SEPARATE y-akser — kg, slag/min og timer har ingen
		felles skala. Det skraverte feltet er sykedagene; den stiplede linja er baselinen fra de
		fjorten dagene før.
	</p>
	<div class="demo-card demo-card--wide">
		<SickEpisodeView episode={sickEpisodeMock} />
	</div>
</section>
