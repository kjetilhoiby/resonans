<script lang="ts">
	import ThemeButtonGrid from '$lib/components/domain/home/ThemeButtonGrid.svelte';
	import PartnerOnboardingCard from '$lib/components/domain/home/PartnerOnboardingCard.svelte';
	import ReadinessChip from '$lib/components/domain/home/ReadinessChip.svelte';
	import ActionPillRow from '$lib/components/domain/home/ActionPillRow.svelte';
	import PagerDots from '$lib/components/ui/PagerDots.svelte';
	import { themeButtonsMock, actionPillsMock, readinessMock } from '../mocks';

	const noop = () => {};
</script>

<!-- ══ HJEMSKJERM-ELEMENTER ═══════════════════════════════════════════════ -->
<section id="hjem" class="section">
	<h2 class="section-heading">Hjemskjerm-elementer</h2>
	<p class="section-desc">
		Byggeklossene i hjemskjerm-sonene, trukket ut som props-drevne komponenter
		(<code>domain/home/</code>). Sonene selv er setContext-koblede orkestratorer og demoes ikke.
	</p>

	<h3 class="subsection">ThemeButtonGrid — tema-knappene</h3>
	<div class="demo-card demo-card--wide">
		<ThemeButtonGrid themes={themeButtonsMock} onSelect={noop} />
	</div>

	<h3 class="subsection">PartnerOnboardingCard — begge varianter</h3>
	<div class="demo-row">
		<div class="demo-card">
			<PartnerOnboardingCard
				variant="theme"
				kicker="Felles start"
				title="Planlegg sammen"
				body="Koble partneren til ukeplanen og temaene deres."
				actions={[
					{ label: 'Opprett partnertema', onClick: noop, primary: true },
					{ label: 'Åpne samtaler', onClick: noop }
				]}
			/>
		</div>
		<div class="demo-card">
			<PartnerOnboardingCard
				variant="widget"
				kicker="Partnermodus aktivert"
				title="Dere er koblet"
				body="Ukeplanen og sjekklistene deles nå med partneren din."
				actions={[{ label: 'Åpne ukeplan sammen', onClick: noop, primary: true }]}
			/>
		</div>
	</div>

	<h3 class="subsection">ReadinessChip + ActionPillRow — chat-sonens topp</h3>
	<div class="demo-stack">
		<ReadinessChip readiness={readinessMock} onClick={noop} />
		<ActionPillRow items={actionPillsMock} onItemClick={noop} />
	</div>

	<h3 class="subsection">PagerDots — side-indikator</h3>
	<div class="demo-stack" style="position: relative; height: 32px;">
		<PagerDots count={3} active={1} onSelect={noop} />
	</div>
</section>
