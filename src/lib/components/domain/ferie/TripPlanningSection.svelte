<!--
  TripPlanningSection — reise-planlegger for ferie-tema.

  Viser reise-kort med stopp, deltakere, geocoding, vær og forfremming
  til eget reise-tema. Brukes inne i FerieDashboard «Reiser»-fanen.

  Props:
    themeId       – tema-UUID (for promote-API)
    members       – familiemedlemmer (for deltaker-valg)
    trips         – reiser-array (bindable)
    startDate     – ferievinduets start
    endDate       – ferievinduets slutt
    onTripsChanged – callback etter endring (så forelder kan lagre)
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchRawTimeseries, buildPeriods } from '$lib/utils/weather';
	import type { FerieMember, FerieTrip, FerieTripStop } from '../FerieDashboard.svelte';
	import DateInput from '$lib/components/ui/DateInput.svelte';

	interface Props {
		themeId: string;
		members: FerieMember[];
		trips: FerieTrip[];
		startDate: string;
		endDate: string;
		onTripsChanged?: (trips: FerieTrip[]) => void;
	}

	let { themeId, members, trips = $bindable(), startDate, endDate, onTripsChanged }: Props = $props();

	/* ── Hjelpefunksjoner ──────────────────────────────── */
	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}

	function toISO(d: Date): string {
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	function dayDiff(a: string, b: string): number {
		return Math.round(
			(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000
		);
	}

	function formatStopDates(start: string, end: string): string {
		const s = new Date(start + 'T12:00:00');
		const e = new Date(end + 'T12:00:00');
		const fmt = new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' });
		if (start === end) return fmt.format(s);
		return `${s.getDate()}.–${fmt.format(e)}`;
	}

	/* ── Intern tilstand ───────────────────────────────── */
	let promoting = $state<string | null>(null);
	let saveError = $state('');
	let stopInput = $state<Record<string, string>>({});
	let stopDate = $state<Record<string, string>>({});
	let stopGeocoding = $state<string | null>(null);

	/* ── Notifiser forelder om endring ─────────────────── */
	function notifyChanged() {
		onTripsChanged?.(trips);
	}

	/* ── Reise-operasjoner ─────────────────────────────── */
	function addTrip() {
		trips = [...trips, { id: crypto.randomUUID(), label: '', place: '', startDate: startDate || '', endDate: endDate || '' }];
		notifyChanged();
	}

	function updateTrip(id: string, patch: Partial<FerieTrip>) {
		trips = trips.map((t) => (t.id === id ? { ...t, ...patch } : t));
		notifyChanged();
	}

	function removeTrip(id: string) {
		trips = trips.filter((t) => t.id !== id);
		notifyChanged();
	}

	function toggleTripParticipant(tripId: string, memberId: string) {
		trips = trips.map((t) => {
			if (t.id !== tripId) return t;
			const cur = t.participants ?? [];
			const next = cur.includes(memberId) ? cur.filter((id) => id !== memberId) : [...cur, memberId];
			return { ...t, participants: next };
		});
		notifyChanged();
	}

	async function promoteTrip(t: FerieTrip) {
		promoting = t.id;
		saveError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/ferie/promote-trip`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ label: t.label, place: t.place, startDate: t.startDate, endDate: t.endDate })
			});
			if (!res.ok) throw new Error('promote failed');
			const data = (await res.json()) as { themeId: string };
			updateTrip(t.id, { linkedThemeId: data.themeId });
		} catch {
			saveError = 'Klarte ikke å lage reise-tema. Prøv igjen.';
		} finally {
			promoting = null;
		}
	}

	/* ── Geocoding og vær ──────────────────────────────── */
	async function geocodePlace(place: string): Promise<{ lat: number; lon: number } | null> {
		try {
			const res = await fetch(
				`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(place)}&format=json&limit=1`,
				{ headers: { 'Accept-Language': 'nb,en' } }
			);
			const geo = (await res.json()) as Array<{ lat: string; lon: string }>;
			if (geo.length > 0) return { lat: parseFloat(geo[0].lat), lon: parseFloat(geo[0].lon) };
		} catch { /* best-effort */ }
		return null;
	}

	const WEATHER_TTL_MS = 6 * 60 * 60 * 1000; // 6 timer

	async function fetchStopWeather(stop: FerieTripStop): Promise<boolean> {
		if (!stop.lat || !stop.lon) return false;
		try {
			const ts = await fetchRawTimeseries(stop.lat, stop.lon);
			if (!ts) return false;
			const todayStr = toISO(new Date());
			const repDate = (todayStr >= stop.startDate && todayStr <= stop.endDate) ? todayStr : stop.startDate;
			const periods = buildPeriods(repDate, ts);
			const usable = periods.find((p) => p.key === 'middag' && p.emoji !== '—' && p.emoji !== '')
				?? periods.find((p) => p.emoji !== '—' && p.emoji !== '');
			if (usable) {
				stop.weatherEmoji = usable.emoji;
				stop.weatherTemp = usable.temp;
				stop.weatherFetchedAt = new Date().toISOString();
				return true;
			}
		} catch { /* best-effort */ }
		return false;
	}

	function isWeatherStale(stop: FerieTripStop): boolean {
		if (!stop.weatherFetchedAt) return true;
		return Date.now() - new Date(stop.weatherFetchedAt).getTime() > WEATHER_TTL_MS;
	}

	async function refreshStaleStopWeather() {
		let changed = false;
		for (const trip of trips) {
			for (const stop of trip.stops ?? []) {
				if (stop.lat && stop.lon && isWeatherStale(stop)) {
					if (await fetchStopWeather(stop)) changed = true;
				}
			}
		}
		if (changed) {
			trips = [...trips];
			notifyChanged();
		}
	}

	/* ── Stopp-håndtering ──────────────────────────────── */
	async function addStop(tripId: string, place: string, date: string) {
		const trip = trips.find((t) => t.id === tripId);
		if (!trip) return;
		const existing = (trip.stops ?? []).find(
			(s) => s.place.toLowerCase() === place.toLowerCase() && dayDiff(s.endDate, date) >= 0 && dayDiff(s.endDate, date) <= 1
		);
		if (existing) {
			trips = trips.map((t) =>
				t.id === tripId
					? { ...t, stops: (t.stops ?? []).map((s) => (s.id === existing.id ? { ...s, endDate: date } : s)) }
					: t
			);
			notifyChanged();
			return;
		}
		stopGeocoding = tripId;
		const geo = await geocodePlace(place);
		const stop: FerieTripStop = {
			id: crypto.randomUUID(),
			place,
			lat: geo?.lat,
			lon: geo?.lon,
			startDate: date,
			endDate: date
		};
		if (geo) await fetchStopWeather(stop);
		trips = trips.map((t) =>
			t.id === tripId ? { ...t, stops: [...(t.stops ?? []), stop] } : t
		);
		stopGeocoding = null;
		notifyChanged();
	}

	function removeStop(tripId: string, stopId: string) {
		trips = trips.map((t) =>
			t.id === tripId ? { ...t, stops: (t.stops ?? []).filter((s) => s.id !== stopId) } : t
		);
		notifyChanged();
	}

	function handleStopInput(tripId: string) {
		let text = (stopInput[tripId] ?? '').trim();
		if (!text) return;
		const stedMatch = text.match(/^[Ss]ted:\s*(.+)/);
		if (stedMatch) text = stedMatch[1].trim();
		const date = stopDate[tripId] || toISO(new Date());
		void addStop(tripId, text, date);
		stopInput = { ...stopInput, [tripId]: '' };
	}

	onMount(() => {
		void refreshStaleStopWeather();
	});
</script>

<section class="ferie-trips">
	<div class="trips-head">
		<h3>Reiser i ferien</h3>
		<button type="button" class="ferie-btn" onclick={addTrip}>+ Reise</button>
	</div>
	{#if saveError}
		<span class="ferie-error">{saveError}</span>
	{/if}
	{#if trips.length === 0}
		<p class="trips-empty">
			Ingen reiser planlagt ennå. Legg til en grov blokk (sted + datoer) — du kan forfremme
			den til et fullt reise-tema (kart, vær, budsjett) når du er klar.
		</p>
	{:else}
		<div class="trips-list">
			{#each trips as t (t.id)}
				<div class="trip-card">
				<div class="trip-row">
					<input
						class="trip-label"
						placeholder="Navn"
						value={t.label}
						onchange={(e) => updateTrip(t.id, { label: e.currentTarget.value })}
					/>
					<input
						class="trip-place"
						placeholder="Sted"
						value={t.place ?? ''}
						onchange={(e) => updateTrip(t.id, { place: e.currentTarget.value })}
					/>
					<DateInput
						value={t.startDate ?? ''}
						min={startDate}
						max={endDate}
						onChange={(e) => updateTrip(t.id, { startDate: e.currentTarget.value })}
					/>
					<DateInput
						value={t.endDate ?? ''}
						min={startDate}
						max={endDate}
						onChange={(e) => updateTrip(t.id, { endDate: e.currentTarget.value })}
					/>
					{#if t.linkedThemeId}
						<a class="trip-link" href={`/tema/${t.linkedThemeId}`}>Åpne reise →</a>
					{:else}
						<button
							type="button"
							class="ferie-btn"
							disabled={promoting === t.id}
							onclick={() => promoteTrip(t)}
						>
							{promoting === t.id ? 'Lager…' : 'Forfrem til reise-tema'}
						</button>
					{/if}
					<button type="button" class="trip-remove" title="Fjern" onclick={() => removeTrip(t.id)}>×</button>
				</div>
				<div class="trip-participants">
					<span class="tp-label">Med:</span>
					{#each members as m (m.id)}
						<button
							type="button"
							class="tp-chip"
							class:on={t.participants?.includes(m.id)}
							onclick={() => toggleTripParticipant(t.id, m.id)}
						>
							{m.role === 'voksen' ? '🧑' : '🧒'} {m.name}
						</button>
					{/each}
					{#if members.length === 0}
						<span class="tp-empty">Legg til familiemedlemmer under «Rammer».</span>
					{/if}
				</div>
				<div class="trip-stops">
					{#if (t.stops ?? []).length > 0}
						<div class="trip-stops-list">
							{#each t.stops ?? [] as stop (stop.id)}
								<span class="trip-stop-chip">
									<span class="stop-place">📍 {stop.place}</span>
									<span class="stop-dates">{formatStopDates(stop.startDate, stop.endDate)}</span>
									{#if stop.weatherEmoji}<span class="stop-wx">{stop.weatherEmoji} {stop.weatherTemp}°</span>{/if}
									<button type="button" class="stop-remove" title="Fjern" onclick={() => removeStop(t.id, stop.id)}>×</button>
								</span>
							{/each}
						</div>
					{/if}
					<div class="trip-stop-composer">
						<input
							type="text"
							class="stop-input"
							placeholder="Sted: Trondheim"
							value={stopInput[t.id] ?? ''}
							oninput={(e) => { stopInput = { ...stopInput, [t.id]: e.currentTarget.value }; }}
							onkeydown={(e) => { if (e.key === 'Enter') handleStopInput(t.id); }}
						/>
						<DateInput
							value={stopDate[t.id] ?? toISO(new Date())}
							min={t.startDate}
							max={t.endDate}
							onChange={(e) => { stopDate = { ...stopDate, [t.id]: e.currentTarget.value }; }}
						/>
						<button type="button" class="ferie-btn" disabled={stopGeocoding === t.id} onclick={() => handleStopInput(t.id)}>
							{stopGeocoding === t.id ? '…' : '+'}
						</button>
					</div>
				</div>
				</div>
			{/each}
		</div>
	{/if}
</section>

<style>
	/* Reiser i ferien */
	.ferie-trips {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.85rem;
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 12px;
	}
	.trips-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.trips-head h3 {
		margin: 0;
		font-size: 1rem;
	}
	.trips-empty {
		margin: 0;
		font-size: 0.85rem;
		color: var(--tp-text-soft);
	}
	.trips-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ferie-btn {
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border-strong);
		color: var(--tp-text);
		border-radius: 8px;
		padding: 0.4rem 0.7rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.ferie-error {
		color: hsl(0 70% 70%);
		font-size: 0.85rem;
	}

	/* Reise-kort med deltakere */
	.trip-card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--tp-border);
	}
	.trip-card:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}
	.trip-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--tp-border);
	}
	.trip-row:last-child {
		border-bottom: none;
		padding-bottom: 0;
	}
	.trip-label {
		flex: 1 1 120px;
		min-width: 100px;
	}
	.trip-place {
		flex: 1 1 100px;
		min-width: 90px;
	}
	.trip-link {
		color: var(--tp-accent);
		font-size: 0.85rem;
		text-decoration: none;
		white-space: nowrap;
	}
	.trip-link:hover {
		text-decoration: underline;
	}
	.trip-remove {
		background: none;
		border: none;
		color: var(--tp-text-muted);
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.trip-participants {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		align-items: center;
	}
	.tp-label {
		font-size: 0.75rem;
		color: var(--tp-text-muted);
	}
	.tp-chip {
		border: 1px solid var(--tp-border);
		background: var(--tp-bg-1);
		color: var(--tp-text-soft);
		border-radius: 999px;
		padding: 0.15rem 0.55rem;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.tp-chip.on {
		background: hsl(265 40% 32%);
		border-color: hsl(265 45% 50%);
		color: hsl(265 25% 96%);
	}
	.tp-empty {
		font-size: 0.78rem;
		color: var(--tp-text-muted);
	}

	/* Stopp */
	.trip-stops {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.trip-stops-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}
	.trip-stop-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		border-radius: 999px;
		padding: 0.15rem 0.45rem;
		font-size: 0.75rem;
	}
	.stop-place {
		color: var(--tp-text-soft);
	}
	.stop-dates {
		color: var(--tp-text-muted);
		font-size: 0.68rem;
	}
	.stop-wx {
		font-size: 0.75rem;
	}
	.stop-remove {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--tp-text-muted);
		font-size: 0.85rem;
		line-height: 1;
		padding: 0 0.1rem;
	}
	.trip-stop-composer {
		display: flex;
		gap: 0.25rem;
		align-items: center;
	}
	.stop-input {
		flex: 1;
		min-width: 100px;
		font-size: 0.8rem;
		padding: 0.3rem 0.45rem;
	}
	.stop-date-input {
		width: auto;
		font-size: 0.8rem;
		padding: 0.3rem 0.35rem;
	}

	/* Shared input styles for this component */
	input[type='date'],
	input[type='text'] {
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		color: var(--tp-text);
		border-radius: 8px;
		padding: 0.4rem 0.55rem;
		font-size: 0.9rem;
	}
</style>
