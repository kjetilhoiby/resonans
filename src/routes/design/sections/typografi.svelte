<script lang="ts">
	import { Button, SectionLabel, CardTitle } from '$lib/components/ui';
</script>

<!-- ══ TYPOGRAFI ══════════════════════════════════════════════════════════ -->
<section id="typografi" class="section">
	<h2 class="section-heading">Typografi</h2>
	<p class="section-desc">
		Fem størrelses-tokens definert i <code>AppPage.svelte</code>. Bruk tokens — aldri hardkodede font-sizes i nye komponenter.
	</p>

	<div class="type-scale">
		<div class="type-row"><code>--font-size-value</code><span class="type-val">1.9rem</span><span style="font-size: var(--font-size-value); font-weight: 700;">5t 38m</span></div>
		<div class="type-row"><code>--font-size-title</code><span class="type-val">1rem</span><span style="font-size: var(--font-size-title); font-weight: 600;">Korttittel</span></div>
		<div class="type-row"><code>--font-size-body</code><span class="type-val">0.9rem</span><span style="font-size: var(--font-size-body);">Brødtekst i kort og seksjoner.</span></div>
		<div class="type-row"><code>--font-size-label</code><span class="type-val">0.78rem</span><span style="font-size: var(--font-size-label); text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; font-weight: 600;">Seksjonslabel</span></div>
		<div class="type-row"><code>--font-size-caption</code><span class="type-val">0.72rem</span><span style="font-size: var(--font-size-caption); color: #777;">Hint, delta, meta-tekst</span></div>
	</div>

	<h3 class="subsection">SectionLabel — «hva er denne blokken»</h3>
	<p class="section-desc">
		Alle seksjons-/diagramlabels bruker <code>SectionLabel</code>: uppercase, muted, 0.78rem.
		Velg <code>tag</code> etter overskriftshierarkiet. <code>nowrap</code> gir ellipsis i flex-rader med actions til høyre.
	</p>
	<div class="demo-stack">
		<SectionLabel>Treningsøkter</SectionLabel>
		<div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; border: 1px dashed #2a2a2a; border-radius: 8px; padding: 8px;">
			<SectionLabel tag="span" nowrap>Akkumulert gjennom uka (nowrap i trang rad)</SectionLabel>
			<Button variant="chip">Toggle</Button>
		</div>
		<div style="--section-label-color: #8ba0f5;">
			<SectionLabel>Med fargeoverride</SectionLabel>
		</div>
	</div>

	<h3 class="subsection">CardTitle — «hva gjør dette kortet»</h3>
	<p class="section-desc">
		Kort-titler bruker <code>CardTitle</code>: 1rem, 600, hvit, normal case. («Ukesnotat», «Legg inn skjermbilder», …)
	</p>
	<div class="demo-stack">
		<CardTitle>Ukas oppgaver</CardTitle>
	</div>
</section>
