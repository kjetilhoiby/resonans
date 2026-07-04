<script lang="ts">
	import MonthCalendar from '$lib/components/ui/MonthCalendar.svelte';
	import { chatMessageDaysMock } from '../mocks';

	const markedDays = Object.fromEntries(chatMessageDaysMock.map((d) => [d.day, d.count]));
	let valgtDag = $state('');
</script>

<!-- ══ KALENDER ═══════════════════════════════════════════════════════════ -->
<section id="kalender" class="section">
	<h2 class="section-heading">Kalender</h2>
	<p class="section-desc">
		<code>MonthCalendar</code> — gjenbrukbar månedskalender (man–søn) med ‹/›-navigasjon og
		markørprikk på dager med innhold. Kun markerte dager (og ikke fremtidige) kan velges.
		Brukes i dagbok-chattens kalender-sheet. Demoen er låst til juni 2026 med faste markører.
	</p>

	<div class="demo-stack" style="max-width: 340px;">
		<MonthCalendar
			initialMonth="2026-06"
			maxDay="2026-06-30"
			{markedDays}
			onSelectDay={(day) => (valgtDag = day)}
		/>
		{#if valgtDag}
			<p class="demo-caption">Valgt dag: {valgtDag}</p>
		{/if}
	</div>
</section>
