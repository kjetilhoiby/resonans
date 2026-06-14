<script lang="ts">
	import { ChecklistItemRow } from '$lib/components/ui';
	import { checklistRowItems, checklistRowParent } from '../mocks';

	let rowItemsFlat = $state(checklistRowItems.map((i) => ({ ...i })));
	let rowItemsCard = $state(checklistRowItems.map((i) => ({ ...i })));
	let rowParentItems = $state(checklistRowParent.map((i) => ({ ...i })));
	let rowExpanded = $state<Set<string>>(new Set(['cp1']));
	function toggleRowExpand(id: string) {
		const next = new Set(rowExpanded);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		rowExpanded = next;
	}
</script>

<!-- ══ OPPGAVERADER ═══════════════════════════════════════════════════════ -->
<section id="oppgaverader" class="section">
	<h2 class="section-heading">Oppgaverader</h2>
	<p class="section-desc">
		Én kanonisk oppgave-/sjekklisterad for hele appen: <code>ChecklistItemRow</code> (ui/).
		Anatomi: <code>[utvid-pil?] [tekst + badges] [avkrysning]</code> — avkrysningen står
		<strong>til høyre</strong> («Hva har du fått til?»). Foreldre får utvid-pil og fremdriftsring;
		deloppgaver legges inline. Avkrysning er alltid <code>ChecklistCheckbox</code>, tekst alltid
		<code>TaskTitle</code>. Listene forenes mot denne — se changelog
		<code>2026-06-13-forene-oppgavelister.md</code>.
	</p>

	<h3 class="subsection">Flat (default) — transparent rad</h3>
	<p class="section-desc">
		Standardvarianten: ingen ramme, subtil hover. Brukes i tette lister (ukeplan, sjekklister).
	</p>
	<div class="demo-card demo-card--wide">
		<div class="demo-stack" style="gap: 2px;">
			{#each rowItemsFlat as it (it.id)}
				<ChecklistItemRow item={it} allItems={rowItemsFlat} showTime={false} showTravel={false} ontoggle={(t) => (t.checked = !t.checked)} />
			{/each}
		</div>
	</div>

	<h3 class="subsection">Bordered — «full bredde m/ramme» (kanonisk kort-rad)</h3>
	<p class="section-desc">
		<code>bordered</code>-prop gir kort-chrome via <code>--card-*</code>-tokens. Dette er den valgte
		kanoniske stilen oppgavelister forenes mot. Kontekster (tema-hue, ukeplan-gradient) re-skinner
		raden automatisk ved å overstyre <code>--card-bg</code>/<code>--card-border</code>.
	</p>
	<div class="demo-card demo-card--wide">
		<div class="demo-stack" style="gap: 6px;">
			{#each rowItemsCard as it (it.id)}
				<ChecklistItemRow item={it} allItems={rowItemsCard} bordered showTime={false} showTravel={false} ontoggle={(t) => (t.checked = !t.checked)} />
			{/each}
		</div>
	</div>

	<h3 class="subsection">Bordered + deloppgaver — utvid-pil og fremdriftsring</h3>
	<div class="demo-card demo-card--wide">
		<div class="demo-stack" style="gap: 6px;">
			{#each rowParentItems.filter((i) => !i.parentId) as it (it.id)}
				<ChecklistItemRow
					item={it}
					allItems={rowParentItems}
					bordered
					showTime={false}
					showTravel={false}
					expandedParentIds={rowExpanded}
					onexpand={(id) => toggleRowExpand(id)}
					ontoggle={(t) => (t.checked = !t.checked)}
				/>
			{/each}
		</div>
	</div>
</section>
