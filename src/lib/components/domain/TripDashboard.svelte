<!--
  TripDashboard — Oversikt for reise-tema.
  Viser: varsel (api.met.no), kart (MapLibre + OpenFreeMap), nedtelling, og overnattinger.
  Props:
    themeId      – tema-UUID
    tripProfile  – lagret reiseprofil fra DB (kan være null)
    onProfileSaved – callback etter lagring
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import TripDayCalendar from './TripDayCalendar.svelte';
	import TripBudget from './TripBudget.svelte';
	import TripHealthStats from './TripHealthStats.svelte';
	import Icon from '../ui/Icon.svelte';
	import type { Map as MapLibreMap } from 'maplibre-gl';

	export interface OvernightStay {
		id: string;
		name: string;
		checkIn: string;
		checkOut: string;
		refNumber?: string;
		lockCode?: string;
		address?: string;
		notes?: string;
	}

	export interface TripProfile {
		destination?: string;
		country?: string;
		lat?: number;
		lng?: number;
		startDate?: string;
		endDate?: string;
		accountIds?: string[];
		overnightStays?: OvernightStay[];
	}

	interface Props {
		themeId: string;
		themeEmoji?: string | null;
		tripProfile: TripProfile | null;
		onProfileSaved?: (profile: TripProfile) => void;
	}

	let { themeId, themeEmoji = null, tripProfile = $bindable(null), onProfileSaved }: Props = $props();

	/* ── Profil-state ─────────────────────────────── */
	let editMode = $state(false);
	let saving = $state(false);
	let saveError = $state('');

	// Available bank accounts
	interface BankAccount {
		id: string;
		name: string | null;
	}
	let availableAccounts = $state<BankAccount[]>([]);

	// Editable form fields
	let editDestination = $state('');
	let editStartDate = $state('');
	let editEndDate = $state('');
	let editAccountIds = $state<string[]>([]);
	let editStays = $state<OvernightStay[]>([]);

	function openEdit() {
		editDestination = tripProfile?.destination ?? '';
		editStartDate = tripProfile?.startDate ?? '';
		editEndDate = tripProfile?.endDate ?? '';
		editAccountIds = tripProfile?.accountIds ?? [];
		editStays = (tripProfile?.overnightStays ?? []).map((s) => ({ ...s }));
		editMode = true;
		void fetchAccounts(); // Load available accounts for selection
	}

	async function fetchAccounts() {
		if (availableAccounts.length > 0) return; // Already loaded
		try {
			const res = await fetch('/api/accounts');
			if (res.ok) {
				const data = (await res.json()) as { accounts: BankAccount[] };
				availableAccounts = data.accounts || [];
			}
		} catch {
			// Silently fail - account selection is optional
		}
	}

	function toggleAccount(accountId: string) {
		if (editAccountIds.includes(accountId)) {
			editAccountIds = editAccountIds.filter(id => id !== accountId);
		} else {
			editAccountIds = [...editAccountIds, accountId];
		}
	}

	function addStay() {
		editStays.push({
			id: crypto.randomUUID(),
			name: '',
			checkIn: editStartDate,
			checkOut: editEndDate
		});
	}

	function removeStay(id: string) {
		editStays = editStays.filter((s) => s.id !== id);
	}

	async function saveProfile() {
		saving = true;
		saveError = '';

		// Geocode if destination changed
		let lat = tripProfile?.lat;
		let lng = tripProfile?.lng;
		const destChanged = editDestination !== tripProfile?.destination;
		if (editDestination && destChanged) {
			try {
				const geoRes = await fetch(
					`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(editDestination)}&format=json&limit=1`,
					{ headers: { 'Accept-Language': 'nb,en' } }
				);
				const geoData: Array<{ lat: string; lon: string }> = await geoRes.json();
				if (geoData.length > 0) {
					lat = parseFloat(geoData[0].lat);
					lng = parseFloat(geoData[0].lon);
				}
			} catch {
				// geocoding best-effort; proceed without coordinates
			}
		}

		const updated: TripProfile = {
			destination: editDestination || undefined,
			lat,
			lng,
			startDate: editStartDate || undefined,
			endDate: editEndDate || undefined,
			accountIds: editAccountIds.length > 0 ? editAccountIds : undefined,
			overnightStays: editStays.length > 0 ? editStays : undefined
		};

		try {
			const res = await fetch(`/api/tema/${themeId}/trip`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(updated)
			});
			if (!res.ok) throw new Error('Lagring feilet');
			tripProfile = updated;
			if (weather === null && updated.lat !== undefined && updated.lng !== undefined) {
				void fetchWeather(updated.lat, updated.lng);
			}
			editMode = false;
			onProfileSaved?.(updated);
		} catch {
			saveError = 'Klarte ikke lagre. Prøv igjen.';
		} finally {
			saving = false;
		}
	}

	/* ── Vær (api.met.no) ────────────────────────── */
	interface WeatherData {
		temp: number;
		symbolCode: string;
		windspeed: number;
        }

        interface DayForecast {
                date: string;          // YYYY-MM-DD
                symbolCode: string;
                tempMin: number;
                tempMax: number;
                wind: number;          // max m/s for the day
                precipitation: number; // total mm
        }

        let weather = $state<WeatherData | null>(null);
        let dailyForecast = $state<DayForecast[]>([]);
        let weatherLoading = $state(false);
        let weatherError = $state('');

        // api.met.no symbol_code → emoji
        function metSymbolToEmoji(symbol: string): string {
                if (symbol.startsWith('clearsky')) return '☀️';
                if (symbol.startsWith('fair')) return '🌤️';
                if (symbol.startsWith('partlycloudy')) return '⛅';
                if (symbol.startsWith('cloudy')) return '☁️';
                if (symbol.startsWith('fog')) return '🌫️';
                if (symbol.includes('thunder')) return '⛈️';
                if (symbol.includes('snow') || symbol.includes('sleet')) return '❄️';
                if (symbol.includes('rain') || symbol.includes('shower')) return '🌧️';
                return '🌡️';
        }

        async function fetchWeather(lat: number, lng: number) {
                weatherLoading = true;
                weatherError = '';
                try {
                        const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`;
                        const res = await fetch(url, {
                                headers: { 'User-Agent': 'resonans/1.0 https://github.com/kjetilhoiby/resonans' }
                        });
                        if (!res.ok) throw new Error('weather_fetch');
                        const data = await res.json();
                        const timeseries: Array<{
                                time: string;
                                data: {
                                        instant: { details: { air_temperature: number; wind_speed: number } };
                                        next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
                                        next_6_hours?: { summary?: { symbol_code?: string }; details?: { air_temperature_max?: number; air_temperature_min?: number; precipitation_amount?: number } };
                                };
                        }> = data.properties.timeseries;

                        // Current conditions from first entry
                        const current = timeseries[0];
                        const instant = current.data.instant.details;
                        const next1h = current.data.next_1_hours?.summary?.symbol_code ?? 'cloudy';
                        weather = {
                                temp: Math.round(instant.air_temperature),
                                symbolCode: next1h,
                                windspeed: Math.round(instant.wind_speed)
                        };

                        // Build daily forecasts
                        type DayAgg = { temps: number[]; winds: number[]; precip: number; symbol?: string };
                        const dayMap = new Map<string, DayAgg>();

                        for (const entry of timeseries) {
                                const date = entry.time.slice(0, 10);
                                if (!dayMap.has(date)) dayMap.set(date, { temps: [], winds: [], precip: 0 });
                                const agg = dayMap.get(date)!;
                                const det = entry.data.instant.details;
                                if (det.air_temperature != null) agg.temps.push(det.air_temperature);
                                if (det.wind_speed != null) agg.winds.push(det.wind_speed);
                                // Use 1h precipitation to sum per-hour (avoids 6h overlap)
                                const p1 = entry.data.next_1_hours?.details?.precipitation_amount;
                                if (p1 != null) agg.precip += p1;
                                // Symbol: prefer the noon entry (next_6_hours gives best picture)
                                if (entry.time.includes('T12:00:00Z')) {
                                        agg.symbol =
                                                entry.data.next_6_hours?.summary?.symbol_code ??
                                                entry.data.next_1_hours?.summary?.symbol_code;
                                }
                                // Fallback: first entry of the day
                                if (!agg.symbol) {
                                        agg.symbol =
                                                entry.data.next_6_hours?.summary?.symbol_code ??
                                                entry.data.next_1_hours?.summary?.symbol_code;
                                }
                        }

                        dailyForecast = Array.from(dayMap.entries()).map(([date, agg]) => ({
                                date,
                                symbolCode: agg.symbol ?? 'cloudy',
                                tempMin: agg.temps.length ? Math.round(Math.min(...agg.temps)) : 0,
                                tempMax: agg.temps.length ? Math.round(Math.max(...agg.temps)) : 0,
                                wind: agg.winds.length ? Math.round(Math.max(...agg.winds)) : 0,
                                precipitation: Math.round(agg.precip * 10) / 10
                        }));
                } catch {
                        weatherError = 'Kunne ikke laste vær.';
                } finally {
                        weatherLoading = false;
                }
        }

	/* ── Nedtelling ───────────────────────────────── */
	const countdown = $derived.by(() => {
		if (!tripProfile?.startDate) return null;
		const start = new Date(tripProfile.startDate);
		const now = new Date();
		start.setHours(0, 0, 0, 0);
		now.setHours(0, 0, 0, 0);
		const diff = Math.ceil((start.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
		if (diff < 0 && tripProfile?.endDate) {
			const end = new Date(tripProfile.endDate);
			end.setHours(0, 0, 0, 0);
			const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
			if (daysLeft >= 0) return { state: 'ongoing' as const, days: daysLeft };
			return { state: 'past' as const, days: 0 };
		}
		if (diff === 0) return { state: 'today' as const, days: 0 };
		if (diff > 0) return { state: 'future' as const, days: diff };
		return { state: 'past' as const, days: 0 };
	});

	const tripDuration = $derived.by(() => {
		if (!tripProfile?.startDate || !tripProfile?.endDate) return null;
		const start = new Date(tripProfile.startDate);
		const end = new Date(tripProfile.endDate);
		return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
	});

	/* ── Kart (MapLibre + OpenFreeMap) ───────────── */
	let mapContainer = $state<HTMLDivElement | null>(null);
	let mapInstance: MapLibreMap | null = null;

	async function initMap(lat: number, lng: number) {
		if (!mapContainer || typeof window === 'undefined') return;
		// Lazy-load MapLibre to keep SSR safe
		const { Map, Marker } = await import('maplibre-gl');
		mapInstance?.remove();
		mapInstance = new Map({
			container: mapContainer,
			style: 'https://tiles.openfreemap.org/styles/liberty',
			center: [lng, lat],
			zoom: 10,
			attributionControl: { compact: true }
		});
		new Marker({ color: 'var(--tp-accent, #7c8ef5)' })
			.setLngLat([lng, lat])
			.addTo(mapInstance);
	}

	$effect(() => {
		const lat = tripProfile?.lat;
		const lng = tripProfile?.lng;
		if (mapContainer && lat != null && lng != null) {
			void initMap(lat, lng);
		}
	});

	/* ── Mount / destroy ─────────────────────────── */
	onMount(() => {
		if (tripProfile?.lat != null && tripProfile?.lng != null) {
			void fetchWeather(tripProfile.lat, tripProfile.lng);
		}
	});

	onDestroy(() => {
		mapInstance?.remove();
	});

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
	}
</script>

<div class="trip-dash">
	<!-- ── Header / setup ── -->
	{#if !tripProfile?.destination && !editMode}
		<div class="trip-setup-prompt">
			<div class="trip-setup-icon">🗺️</div>
			<p class="trip-setup-copy">Sett opp turdetaljene — destinasjon, datoer og overnattinger.</p>
			<button class="trip-btn-primary" onclick={openEdit}>Sett opp turen</button>
		</div>
	{:else if !editMode}
		<!-- ── Destinasjon + nedtelling ── -->
		<div class="trip-hero">
			<div class="trip-hero-left">
				<p class="trip-dest">{tripProfile?.destination}</p>
				{#if tripProfile?.startDate && tripProfile?.endDate}
					<p class="trip-dates">{fmtDate(tripProfile.startDate)} – {fmtDate(tripProfile.endDate)}</p>
					{#if tripDuration !== null}
						<p class="trip-duration">{tripDuration} {tripDuration === 1 ? 'dag' : 'dager'}</p>
					{/if}
				{/if}
			</div>
			<div class="trip-hero-right">
				{#if countdown !== null}
					{#if countdown.state === 'future'}
						<div class="trip-countdown">
							<span class="trip-countdown-num">{countdown.days}</span>
							<span class="trip-countdown-label">dager igjen</span>
						</div>
					{:else if countdown.state === 'today'}
						<div class="trip-countdown trip-countdown-today">
							<span class="trip-countdown-label">Avreise i dag! 🎉</span>
						</div>
					{:else if countdown.state === 'ongoing'}
						<div class="trip-countdown trip-countdown-ongoing">
							<span class="trip-countdown-num">{countdown.days}</span>
							<span class="trip-countdown-label">dager igjen av turen</span>
						</div>
					{:else}
						<div class="trip-countdown trip-countdown-past">
							<span class="trip-countdown-label">Tur avsluttet</span>
						</div>
					{/if}
				{/if}
			</div>
		</div>

		<!-- ── Vær ── -->
		<div class="trip-weather-row">
			{#if weatherLoading}
				<div class="trip-weather-loading">Laster vær…</div>
			{:else if weather}
                                <!-- Nåværende forhold -->
                                <div class="trip-weather-card">
                                        <span class="trip-weather-icon">{metSymbolToEmoji(weather.symbolCode)}</span>
                                        <span class="trip-weather-temp">{weather.temp}°</span>
                                        <span class="trip-weather-detail">💨 {weather.windspeed} m/s</span>
                                        <button class="trip-weather-refresh" onclick={() => tripProfile?.lat != null && tripProfile?.lng != null && fetchWeather(tripProfile.lat, tripProfile.lng)} title="Oppdater vær" aria-label="Oppdater vær">↻</button>
                                </div>
                                <!-- Dagsprognose-stripe -->
                                {#if dailyForecast.length > 0}
                                        {@const tripStart = tripProfile?.startDate ?? ''}
                                        {@const tripEnd = tripProfile?.endDate ?? ''}
                                        {@const tripDays = dailyForecast.filter((d) => d.date >= tripStart && d.date <= tripEnd)}
                                        {#if tripDays.length > 0}
                                        <div class="trip-forecast-strip">
                                                {#each tripDays as day}
                                                        {@const isToday = day.date === new Date().toISOString().slice(0, 10)}
                                                        <div class="trip-forecast-day" class:trip-forecast-today={isToday}>
                                                                <span class="tfd-weekday">{new Intl.DateTimeFormat('nb-NO', { weekday: 'short' }).format(new Date(day.date + 'T12:00:00Z'))}</span>
                                                                <span class="tfd-symbol">{metSymbolToEmoji(day.symbolCode)}</span>
                                                                <span class="tfd-temps"><span class="tfd-max">↑{day.tempMax}°</span><span class="tfd-min">↓{day.tempMin}°</span></span>
                                                                {#if day.precipitation > 0}
                                                                        <span class="tfd-precip">💧{day.precipitation}</span>
                                                                {/if}
                                                                <span class="tfd-wind">💨{day.wind}</span>
                                                        </div>
                                                {/each}
                                        </div>
                                        {/if}
                                {/if}
			{:else if weatherError}
				<p class="trip-weather-error">{weatherError}</p>
			{:else if !tripProfile?.lat}
				<p class="trip-weather-hint">Sett destinasjon for å se vær.</p>
			{/if}
		</div>

		<!-- ── Kart ── -->
		{#if tripProfile?.lat != null && tripProfile?.lng != null}
			<div class="trip-map-wrap">
				<div bind:this={mapContainer} class="trip-map"></div>

			</div>
		{/if}

		<!-- ── Overnattinger ── -->
		{#if (tripProfile?.overnightStays ?? []).length > 0}
			<div class="trip-stays">
				<h3 class="trip-section-title">🏨 Overnattinger</h3>
				{#each tripProfile!.overnightStays! as stay}
					<div class="stay-card">
						<div class="stay-header">
							<span class="stay-name">{stay.name || 'Overnatting'}</span>
							<span class="stay-dates">{fmtDate(stay.checkIn)} → {fmtDate(stay.checkOut)}</span>
						</div>
						{#if stay.address}
							<p class="stay-address">📍 {stay.address}</p>
						{/if}
						<div class="stay-codes">
							{#if stay.refNumber}
								<span class="stay-code-pill">🔖 Ref: <strong>{stay.refNumber}</strong></span>
							{/if}
							{#if stay.lockCode}
								<span class="stay-code-pill">🔑 Kode: <strong>{stay.lockCode}</strong></span>
							{/if}
						</div>
						{#if stay.notes}
							<p class="stay-notes">{stay.notes}</p>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if tripProfile?.startDate && tripProfile?.endDate}
			<div class="trip-calendar-section">
				<TripDayCalendar
					themeEmoji={themeEmoji}
					startDate={tripProfile.startDate}
					endDate={tripProfile.endDate}
					dailyWeather={dailyForecast}
				/>
			</div>
		{/if}

		{#if tripProfile?.startDate && tripProfile?.endDate}
			<div class="trip-budget-section">
				<TripBudget
					themeId={themeId}
					startDate={tripProfile.startDate}
					endDate={tripProfile.endDate}
					accountIds={tripProfile.accountIds}
				/>
			</div>
		{/if}

		{#if tripProfile?.startDate && tripProfile?.endDate}
			<div class="trip-health-section">
				<TripHealthStats themeId={themeId} />
			</div>
		{/if}

		<button class="trip-edit-btn" onclick={openEdit}><Icon name="settings" size={16} /> Rediger turdetaljer</button>
	{/if}

	<!-- ── Editér / onboarding ── -->
	{#if editMode}
		<div class="trip-edit-panel">
			<h2 class="trip-edit-title">Turdetaljer</h2>

			<label class="trip-field">
				<span class="trip-field-label">Destinasjon</span>
				<input
					class="trip-input"
					type="text"
					bind:value={editDestination}
					placeholder="f.eks. Tokyo, Japan"
					autocomplete="off"
				/>
			</label>

			<div class="trip-field-row">
				<label class="trip-field">
					<span class="trip-field-label">Avreisedato</span>
					<input class="trip-input" type="date" bind:value={editStartDate} />
				</label>
				<label class="trip-field">
					<span class="trip-field-label">Hjemkomst</span>
					<input class="trip-input" type="date" bind:value={editEndDate} />
				</label>
			</div>

			<!-- Bankkontoer for utgiftsfiltrering -->
			{#if availableAccounts.length > 0}
				<div class="trip-field">
					<span class="trip-field-label">Bankkontoer (valgfritt)</span>
					<p class="trip-field-help">Velg hvilke kontoer som skal inkluderes i utgiftsberegningen. Lar tomt for å inkludere alle.</p>
					<div class="account-selector">
						{#each availableAccounts as account}
							<label class="account-checkbox">
								<input 
									type="checkbox" 
									checked={editAccountIds.includes(account.id)}
									onchange={() => toggleAccount(account.id)}
								/>
								<span>{account.name || account.id}</span>
							</label>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Overnattinger -->
			<div class="trip-stays-edit">
				<div class="trip-stays-edit-header">
					<h3 class="trip-section-title">🏨 Overnattinger</h3>
					<button class="trip-add-stay-btn" type="button" onclick={addStay}>+ Legg til</button>
				</div>

				{#each editStays as stay, i}
					<div class="stay-edit-card">
						<div class="stay-edit-row">
							<label class="trip-field" style="flex: 2">
								<span class="trip-field-label">Navn</span>
								<input class="trip-input" type="text" bind:value={editStays[i].name} placeholder="Hotell / AirBnB / hytte…" />
							</label>
							<button class="stay-remove-btn" type="button" onclick={() => removeStay(stay.id)} aria-label="Fjern overnatting">✕</button>
						</div>
						<div class="trip-field-row">
							<label class="trip-field">
								<span class="trip-field-label">Innsjekk</span>
								<input class="trip-input" type="date" bind:value={editStays[i].checkIn} />
							</label>
							<label class="trip-field">
								<span class="trip-field-label">Utsjekk</span>
								<input class="trip-input" type="date" bind:value={editStays[i].checkOut} />
							</label>
						</div>
						<label class="trip-field">
							<span class="trip-field-label">Adresse</span>
							<input class="trip-input" type="text" bind:value={editStays[i].address} placeholder="Gateadresse" />
						</label>
						<div class="trip-field-row">
							<label class="trip-field">
								<span class="trip-field-label">Booking-ref</span>
								<input class="trip-input" type="text" bind:value={editStays[i].refNumber} placeholder="Referansenummer" />
							</label>
							<label class="trip-field">
								<span class="trip-field-label">Låsekode</span>
								<input class="trip-input" type="text" bind:value={editStays[i].lockCode} placeholder="PIN / nøkkelkode" />
							</label>
						</div>
						<label class="trip-field">
							<span class="trip-field-label">Notater</span>
							<input class="trip-input" type="text" bind:value={editStays[i].notes} placeholder="Gratis frokost, parkering, etc." />
						</label>
					</div>
				{/each}
			</div>

			{#if saveError}
				<p class="trip-save-error">{saveError}</p>
			{/if}

			<div class="trip-edit-actions">
				<button class="trip-btn-primary" type="button" onclick={saveProfile} disabled={saving}>
					{saving ? 'Lagrer…' : 'Lagre'}
				</button>
				<button class="trip-btn-secondary" type="button" onclick={() => { editMode = false; saveError = ''; }} disabled={saving}>
					Avbryt
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.trip-dash {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding-bottom: 24px;
	}

	/* Setup prompt */
	.trip-setup-prompt {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 40px 20px;
		text-align: center;
	}
	.trip-setup-icon { font-size: 2.4rem; }
	.trip-setup-copy {
		color: var(--tp-text-soft);
		font-size: 0.9rem;
		max-width: 280px;
	}

	/* Hero */
	.trip-hero {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		padding: 16px 16px 8px;
		gap: 12px;
	}
	.trip-hero-left { flex: 1; min-width: 0; }
	.trip-dest {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--tp-text);
		margin: 0 0 2px;
		letter-spacing: -0.02em;
	}
	.trip-dates {
		font-size: 0.8rem;
		color: var(--tp-text-soft);
		margin: 0;
	}
	.trip-duration {
		font-size: 0.75rem;
		color: var(--tp-text-muted);
		margin: 2px 0 0;
	}

	/* Countdown */
	.trip-countdown {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 0;
	}
	.trip-countdown-num {
		font-size: 2rem;
		font-weight: 800;
		color: var(--tp-accent);
		line-height: 1;
	}
	.trip-countdown-label {
		font-size: 0.68rem;
		color: var(--tp-text-muted);
		text-align: right;
	}
	.trip-countdown-today .trip-countdown-label,
	.trip-countdown-ongoing .trip-countdown-label { color: var(--tp-text-soft); }
	.trip-countdown-past .trip-countdown-label { color: var(--tp-text-muted); }

	/* Weather */
	.trip-weather-row {
		padding: 4px 16px 12px;
	}
	.trip-weather-card {
		display: flex;
		align-items: center;
		gap: 8px;
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 10px;
		padding: 10px 14px;
		font-size: 0.85rem;
	}
	.trip-weather-icon { font-size: 1.5rem; }
	.trip-weather-temp {
		font-size: 1.25rem;
		font-weight: 700;
		color: var(--tp-text);
	}
	.trip-weather-detail {
		color: var(--tp-text-muted);
		font-size: 0.75rem;
		flex: 1;
	}
	.trip-weather-refresh {
		background: none;
		border: none;
		color: var(--tp-text-muted);
		cursor: pointer;
		font-size: 1rem;
		padding: 2px 4px;
		border-radius: 4px;
	}
	.trip-weather-refresh:hover { color: var(--tp-accent); }
	.trip-weather-loading,
	.trip-weather-error,
	.trip-weather-hint {
		font-size: 0.8rem;
		color: var(--tp-text-muted);
		padding: 8px 0;
	}

        /* Daily forecast strip */
        .trip-forecast-strip {
                display: flex;
                overflow-x: auto;
                gap: 6px;
                padding: 8px 0 2px;
                scrollbar-width: none;
        }
        .trip-forecast-strip::-webkit-scrollbar { display: none; }
        .trip-forecast-day {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 2px;
                min-width: 52px;
                background: var(--tp-bg-2);
                border: 1px solid var(--tp-border);
                border-radius: 10px;
                padding: 7px 6px 6px;
                flex-shrink: 0;
        }
        .trip-forecast-today {
                border-color: var(--tp-accent);
                background: var(--tp-accent-bg);
        }
        .tfd-weekday {
                font-size: 0.65rem;
                text-transform: capitalize;
                color: var(--tp-text-muted);
                font-weight: 600;
        }
        .trip-forecast-today .tfd-weekday { color: var(--tp-accent); }
        .tfd-symbol { font-size: 1.2rem; line-height: 1; }
        .tfd-temps {
                display: flex;
                gap: 3px;
                font-size: 0.7rem;
                font-weight: 600;
        }
        .tfd-max { color: var(--tp-text); }
        .tfd-min { color: var(--tp-text-muted); }
        .tfd-precip {
                font-size: 0.62rem;
                color: #5b9bd8;
        }
        .tfd-wind {
                font-size: 0.62rem;
                color: var(--tp-text-muted);
        }

	/* Overnight stays (read) */
	.trip-stays {
		padding: 4px 16px 8px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.trip-section-title {
		font-size: 0.82rem;
		font-weight: 700;
		color: var(--tp-text-soft);
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin: 0 0 6px;
	}
	.stay-card {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 10px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.stay-header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px;
	}
	.stay-name {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--tp-text);
	}
	.stay-dates {
		font-size: 0.75rem;
		color: var(--tp-text-muted);
	}
	.stay-address {
		font-size: 0.8rem;
		color: var(--tp-text-soft);
		margin: 0;
	}
	.stay-codes {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.stay-code-pill {
		background: var(--tp-accent-bg);
		border: 1px solid var(--tp-border-strong);
		border-radius: 6px;
		padding: 3px 8px;
		font-size: 0.78rem;
		color: var(--tp-text-soft);
	}
	.stay-notes {
		font-size: 0.78rem;
		color: var(--tp-text-muted);
		margin: 0;
	}

	.trip-calendar-section {
		padding: 12px 16px 0;
	}

	.trip-budget-section {
		padding: 16px 16px 0;
		border-top: 1px solid var(--tp-border);
		margin-top: 12px;
	}

	.trip-health-section {
		padding: 16px 16px 0;
		border-top: 1px solid var(--tp-border);
		margin-top: 12px;
	}

	.trip-edit-btn {
		margin: 8px 16px 0;
		background: none;
		border: 1px solid var(--tp-border);
		border-radius: 8px;
		color: var(--tp-text-muted);
		font-size: 0.78rem;
		padding: 6px 12px;
		cursor: pointer;
		align-self: flex-start;
	}
	.trip-edit-btn:hover { border-color: var(--tp-border-strong); color: var(--tp-text-soft); }

	/* Edit panel */
	.trip-edit-panel {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.trip-edit-title {
		font-size: 1rem;
		font-weight: 700;
		color: var(--tp-text);
		margin: 0;
	}
	.trip-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
	}
	.trip-field-label {
		font-size: 0.75rem;
		color: var(--tp-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.trip-field-help {
		font-size: 0.75rem;
		color: var(--tp-text-muted);
		margin: 4px 0 8px 0;
	}
	.trip-input {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 8px;
		color: var(--tp-text);
		font-size: 0.88rem;
		padding: 8px 10px;
		outline: none;
		width: 100%;
		box-sizing: border-box;
	}
	.trip-input:focus { border-color: var(--tp-border-strong); }
	
	.account-selector {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 8px;
		padding: 12px;
	}
	.account-checkbox {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.88rem;
		cursor: pointer;
	}
	.account-checkbox input[type="checkbox"] {
		cursor: pointer;
	}
	
	.trip-field-row {
		display: flex;
		gap: 10px;
	}

	/* Stays edit */
	.trip-stays-edit { display: flex; flex-direction: column; gap: 10px; }
	.trip-stays-edit-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.trip-add-stay-btn {
		background: var(--tp-accent-bg);
		border: 1px solid var(--tp-border-strong);
		border-radius: 8px;
		color: var(--tp-accent);
		font-size: 0.8rem;
		padding: 5px 10px;
		cursor: pointer;
	}
	.stay-edit-card {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.stay-edit-row {
		display: flex;
		gap: 8px;
		align-items: flex-end;
	}
	.stay-remove-btn {
		background: none;
		border: 1px solid var(--tp-border);
		border-radius: 6px;
		color: var(--tp-text-muted);
		font-size: 0.82rem;
		padding: 6px 8px;
		cursor: pointer;
		align-self: flex-end;
		margin-bottom: 1px;
	}
	.stay-remove-btn:hover { border-color: #e07070; color: #e07070; }

	/* Actions */
	.trip-edit-actions {
		display: flex;
		gap: 10px;
	}
	.trip-btn-primary {
		background: var(--tp-accent);
		border: none;
		border-radius: 8px;
		color: hsl(var(--theme-hue) 20% 8%);
		font-size: 0.88rem;
		font-weight: 600;
		padding: 9px 18px;
		cursor: pointer;
	}
	.trip-btn-primary:disabled { opacity: 0.55; cursor: default; }
	.trip-btn-secondary {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 8px;
		color: var(--tp-text-soft);
		font-size: 0.88rem;
		padding: 9px 18px;
		cursor: pointer;
	}
	.trip-save-error {
		font-size: 0.8rem;
		color: #e07070;
		margin: 0;
	}
</style>
