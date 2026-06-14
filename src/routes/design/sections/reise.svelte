<script lang="ts">
	import TripBudget from '$lib/components/domain/TripBudget.svelte';
	import TripDayCalendar from '$lib/components/domain/TripDayCalendar.svelte';
	import { mockTripApi, tripWeatherMock } from '../mocks';
</script>

<!-- ══ REISE ══════════════════════════════════════════════════════════════ -->
<section id="reise" class="section">
	<h2 class="section-heading">Reise</h2>
	<p class="section-desc">
		Reiseflatens komponenter (<code>domain/Trip*</code>/<code>ferie/</code>) — all IO bak
		<code>TripApi</code>-interfacet (mock her). FerieGridView og FerieExecutionView er props-drevne,
		men fixture-tunge — demoer kommer ved behov.
	</p>

	<h3 class="subsection">TripDayCalendar — dagskalender med vær og sjekklister</h3>
	<p class="section-desc">Fast demo-periode i fortid (1.–4. juni), så ingen «i dag»-markering drifter.</p>
	<div class="demo-card demo-card--wide">
		<TripDayCalendar
			themeEmoji="🏔"
			startDate="2026-06-01"
			endDate="2026-06-04"
			dailyWeather={tripWeatherMock}
			api={mockTripApi}
		/>
	</div>

	<h3 class="subsection">TripBudget — turforbruk</h3>
	<p class="section-desc">Transaksjoner og kontoer via mock-api. Klikk for å ekspandere listen.</p>
	<div class="demo-card demo-card--wide">
		<TripBudget themeId="demo" startDate="2026-06-01" endDate="2026-06-04" api={mockTripApi} />
	</div>
</section>
