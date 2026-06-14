<script lang="ts">
	import { SectionLabel, SectionCard } from '$lib/components/ui';
</script>

<!-- ══ BLOKKTYPER ═════════════════════════════════════════════════════════ -->
<section id="blokktyper" class="section">
	<h2 class="section-heading">Blokktyper</h2>
	<p class="section-desc">
		Fire kanoniske blokktyper, alle bygget på <code>--card-*</code>-tokens fra AppPage.
		Kontekster (temasider, ukeplan) overstyrer tokens — komponentene er like.
		<strong>Overskriftsregler:</strong> (1) overskrift inne i kortet, øverst, venstrejustert;
		(2) SectionLabel <em>over</em> kortgrupper når flere kort deler heading;
		(3) meta/actions til høyre i samme rad — aldri over eller under tittelen.
	</p>

	<h3 class="subsection">Card — SectionCard-tones</h3>
	<div class="demo-stack">
		<SectionCard title="Default" meta="tone=default">
			<p style="margin: 0; color: #888; font-size: var(--font-size-body);">--card-bg, ingen border.</p>
		</SectionCard>
		<SectionCard title="Subtle" tone="subtle" meta="tone=subtle">
			<p style="margin: 0; color: #888; font-size: var(--font-size-body);">--card-bg-subtle — dashboards-standarden.</p>
		</SectionCard>
		<SectionCard title="Bordered" tone="bordered" meta="tone=bordered">
			<p style="margin: 0; color: #888; font-size: var(--font-size-body);">--card-bg + 1px --card-border.</p>
		</SectionCard>
	</div>

	<h3 class="subsection">FlatSection — label over kortgruppe</h3>
	<div class="demo-stack" style="gap: 8px;">
		<SectionLabel>Prosjekter</SectionLabel>
		<SectionCard tone="subtle" compact>
			<p style="margin: 0; color: #888; font-size: var(--font-size-body);">Kort 1 i gruppen</p>
		</SectionCard>
		<SectionCard tone="subtle" compact>
			<p style="margin: 0; color: #888; font-size: var(--font-size-body);">Kort 2 i gruppen</p>
		</SectionCard>
	</div>

	<h3 class="subsection">InsetCard — nestet kort</h3>
	<div class="demo-stack">
		<SectionCard tone="subtle" title="Ytre kort">
			<div style="background: var(--card-bg-inset); border-radius: var(--radius-md); padding: 14px; color: #888; font-size: var(--font-size-body);">
				--card-bg-inset + --radius-md for kort-i-kort (mål-kort, oppholds-kort).
			</div>
		</SectionCard>
	</div>

	<h3 class="subsection">FeatureCard — kontekst-overstyrt skin</h3>
	<p class="section-desc">
		Gradient-/hue-kort er <em>token-overrides på kontekstnivå</em>, ikke egne komponenter.
		Ukeplan setter <code>--card-bg: linear-gradient(…)</code>; temasider setter <code>--card-bg: var(--tp-bg-2)</code>.
		Dette er mekanismen som senere kan re-skinne hele appen (f.eks. light mode): bytt tokens, ikke komponenter.
	</p>
	<div class="demo-stack" style="--card-bg: linear-gradient(180deg, rgba(9, 11, 17, 0.95), rgba(8, 10, 15, 0.95)); --card-radius: 14px; --card-padding: 12px;">
		<SectionCard title="Ukeplan-skin">
			<p style="margin: 0; color: #888; font-size: var(--font-size-body);">Samme komponent, ukeplan-kontekstens tokens.</p>
		</SectionCard>
	</div>
</section>
