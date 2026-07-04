<!--
  FerieExecutionView — «Gjennomfør»-visningen i FerieDashboard.

  Viser oppgaver, feriedagbok (skjema + innlegg), dag-kalender,
  helse-stats, budsjett og reiselenker.

  Props:
    themeId / themeEmoji – tema-identifikasjon
    startDate / endDate  – ferievinduet
    trips                – reiser (for lenker og oppgaver)
    gapCount             – udekket-teller (for oppgave-generering)
    onNavigate           – callback for navigasjon (view-bytte)
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { buildPeriods } from '$lib/utils/weather';
	import DateInput from '$lib/components/ui/DateInput.svelte';
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import DiaryImages from '../DiaryImages.svelte';
	import TripDayCalendar from '../TripDayCalendar.svelte';
	import TripHealthStats from '../TripHealthStats.svelte';
	import TripBudget from '../TripBudget.svelte';
	import TripMapStory from '../TripMapStory.svelte';
	import ActionPillRow from '../home/ActionPillRow.svelte';
	import type { ActionPillItem } from '../home/action-pill-types';
	import {
		tripApi,
		geocodeDiaryImages,
		type TripApi,
		type FerieTrip,
		type DiaryWeather,
		type DiaryEntry,
		type DiaryImage,
		type DayGeo,
		type ImagePin,
		type DriveRoutes
	} from '../trip-api';

	interface DayEntry {
		iso: string;
		weekday: string;
		dayMonth: string;
		week: number;
		isWeekend: boolean;
	}

	interface Props {
		themeId: string;
		themeEmoji?: string | null;
		startDate: string;
		endDate: string;
		days: DayEntry[];
		trips: FerieTrip[];
		gapCount: number;
		/** Antall udekkede barn-dager brukeren har avvist (skjuler påminnelsen til antallet endres). */
		gapAckCount?: number;
		/** Åpne dagboka for i dag automatisk (fra hjemskjerm-hurtighandling). */
		autoOpenDiary?: boolean;
		onDismissGap?: () => void;
		onNavigate: (view: 'rammer' | 'reiser' | 'gjennomfor') => void;
		api?: TripApi;
	}

	let {
		themeId, themeEmoji = null,
		startDate, endDate, days, trips, gapCount,
		gapAckCount,
		autoOpenDiary = false,
		onDismissGap,
		onNavigate,
		api = tripApi
	}: Props = $props();

	/* ── Hjelpefunksjoner ──────────────────────────────── */
	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}

	function toISO(d: Date): string {
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	function tripForDate(iso: string): FerieTrip | null {
		for (const t of trips) {
			if (t.startDate && t.endDate && iso >= t.startDate && iso <= t.endDate) return t;
		}
		return null;
	}

	/* ── Kartfortelling-tilstand ───────────────────────── */
	let tripGeoByDay = $state<Record<string, DayGeo>>({});
	let tripImagePins = $state<ImagePin[]>([]);
	let tripDriveRoutes = $state<DriveRoutes>({});
	let mapSection = $state<HTMLElement | null>(null);

	/* ── Dagbok-tilstand ───────────────────────────────── */
	let diaryEntries = $state<DiaryEntry[]>([]);
	let diaryLoading = $state(false);
	let diaryDate = $state('');
	let diaryPlace = $state('');
	let diaryText = $state('');
	let diaryWeather = $state<DiaryWeather | null>(null);
	let diaryImages = $state<DiaryImage[]>([]);
	let diarySaving = $state(false);
	let diaryFetchingWx = $state(false);
	let diaryError = $state('');
	let editorOpen = $state(false);

	function openEditor(date?: string) {
		const d = date ?? defaultDiaryDate();
		diaryDate = d;
		diaryError = '';
		loadFormForDate(d);
		editorOpen = true;
	}

	function closeEditor() {
		editorOpen = false;
	}

	function defaultDiaryDate(): string {
		const iso = toISO(new Date());
		if (startDate && endDate && iso >= startDate && iso <= endDate) return iso;
		return startDate || iso;
	}

	function loadFormForDate(date: string) {
		const existing = diaryEntries.find((e) => e.date === date);
		if (existing) {
			diaryText = existing.content;
			diaryPlace = existing.place ?? '';
			diaryWeather = existing.weather ?? null;
			diaryImages = existing.images ?? [];
		} else {
			diaryText = '';
			diaryWeather = null;
			diaryImages = [];
			const trip = tripForDate(date);
			diaryPlace = trip?.place ?? trip?.label ?? '';
		}
	}

	async function loadDiary() {
		diaryLoading = true;
		try {
			const entries = await api.getDiary(themeId);
			if (entries) diaryEntries = entries;
		} catch {
			// best-effort
		} finally {
			diaryLoading = false;
		}
	}

	function onDiaryDateChange() {
		diaryError = '';
		loadFormForDate(diaryDate);
	}

	async function fetchDiaryWeather() {
		if (!diaryPlace) return;
		diaryFetchingWx = true;
		diaryError = '';
		try {
			const geo = await api.geocode(diaryPlace);
			if (!geo) {
				diaryError = 'Fant ikke stedet.';
				return;
			}
			// 1) met.no-varsel for i dag/framover.
			const ts = await api.getMetForecast(geo.lat, geo.lon);
			if (ts) {
				const periods = buildPeriods(diaryDate, ts);
				const usable = periods.find((p) => p.key === 'middag' && p.emoji !== '—' && p.emoji !== '')
					?? periods.find((p) => p.emoji !== '—' && p.emoji !== '');
				if (usable) {
					diaryWeather = { emoji: usable.emoji, temp: usable.temp };
					return;
				}
			}
			// 2) Fallback: observert vær fra Open-Meteo når varselet er utløpt (passert dag).
			const hist = await api.getHistoricalWeather(geo.lat, geo.lon, diaryDate);
			if (hist) {
				diaryWeather = hist;
			} else {
				diaryError = 'Fant ikke værdata for denne datoen.';
			}
		} catch {
			diaryError = 'Klarte ikke hente vær.';
		} finally {
			diaryFetchingWx = false;
		}
	}

	async function saveDiaryEntry() {
		if (!diaryDate) return;
		diarySaving = true;
		diaryError = '';
		try {
			// Geokod stedet for kartfortellingen (bare når det er nytt/endret).
			const existing = diaryEntries.find((e) => e.date === diaryDate);
			const place = diaryPlace.trim();
			let geo = existing?.geo;
			if (place) {
				if (place !== existing?.place || !geo) {
					const g = await api.geocode(place);
					if (g) geo = { lat: g.lat, lon: g.lon };
				}
			} else {
				geo = undefined;
			}

			// Geokod bildesteder også, så bildene kan vises som nåler på kartet.
			const images = await geocodeDiaryImages(diaryImages, existing?.images, (q) => api.geocode(q));

			const ok = await api.putDiaryEntry(themeId, {
				date: diaryDate,
				content: diaryText,
				place: diaryPlace,
				weather: diaryWeather ?? undefined,
				images,
				geo
			});
			if (!ok) throw new Error('save failed');
			await loadDiary();
			closeEditor();
		} catch {
			diaryError = 'Klarte ikke lagre dagboknotat.';
		} finally {
			diarySaving = false;
		}
	}

	async function deleteDiaryEntry(date: string) {
		try {
			await api.putDiaryEntry(themeId, { date });
			await loadDiary();
			if (diaryDate === date) closeEditor();
		} catch {
			diaryError = 'Klarte ikke slette.';
		}
	}

	/* ── Oppgaver ──────────────────────────────────────── */
	interface FerieTask {
		id: string;
		kind: 'diary' | 'trip' | 'gap';
		label: string;
		date?: string;
	}

	const ferieTasks = $derived.by<FerieTask[]>(() => {
		const out: FerieTask[] = [];
		const todayIso = toISO(new Date());
		const entryDates = new Set(diaryEntries.map((e) => e.date));
		const recentPast = days.filter((d) => d.iso <= todayIso).slice(-7);
		for (const d of recentPast) {
			if (!entryDates.has(d.iso)) {
				out.push({ id: `diary-${d.iso}`, kind: 'diary', date: d.iso, label: `Skriv i dagboka for ${d.weekday} ${d.dayMonth}` });
			}
		}
		for (const t of trips) {
			if (!(t.participants && t.participants.length)) {
				out.push({ id: `trip-${t.id}`, kind: 'trip', label: `Legg til deltakere på «${t.label || 'reise'}»` });
			}
		}
		// Gap-påminnelsen skjules når brukeren har avvist akkurat dette antallet.
		if (gapCount > 0 && gapCount !== gapAckCount) {
			out.push({ id: 'gap', kind: 'gap', label: `${gapCount} barn-dager mangler fortsatt dekning` });
		}
		return out;
	});

	const TASK_ICON: Record<FerieTask['kind'], string> = { diary: '✍️', trip: '🧳', gap: '⚠️' };

	const MAP_PILL_ID = 'map-story';

	// Kartfortellingen har innhold når minst én dag er stedfestet eller det finnes bilde-nåler.
	const hasMapContent = $derived(diaryEntries.some((e) => e.geo) || tripImagePins.length > 0);

	// Oppgaver som pills for hurtigvalgstripa. Gap-pillen kan avvises; en
	// kartfortelling-inngang legges sist når det finnes noe å vise.
	const taskPills = $derived<ActionPillItem[]>([
		...ferieTasks.map((t) => ({
			id: t.id,
			icon: TASK_ICON[t.kind],
			label: t.label,
			done: false,
			dismissable: t.kind === 'gap'
		})),
		...(hasMapContent
			? [{ id: MAP_PILL_ID, icon: '🗺️', label: 'Kartfortelling', done: false }]
			: [])
	]);

	function onPillClick(id: string) {
		if (id === MAP_PILL_ID) {
			mapSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
			return;
		}
		const t = ferieTasks.find((task) => task.id === id);
		if (!t) return;
		if (t.kind === 'diary' && t.date) {
			openEditor(t.date);
		} else if (t.kind === 'trip') {
			onNavigate('reiser');
		} else if (t.kind === 'gap') {
			onNavigate('rammer');
		}
	}

	async function loadMapData() {
		try {
			const profile = await api.getTripProfile(themeId);
			if (profile) {
				tripGeoByDay = profile.geoByDay ?? {};
				tripImagePins = profile.imagePins ?? [];
				tripDriveRoutes = profile.driveRoutes ?? {};
			}
		} catch {
			// best-effort — kartfortellingen klarer seg uten reiseprofil
		}
	}

	/* ── Lifecycle ─────────────────────────────────────── */
	onMount(() => {
		void (async () => {
			await loadDiary();
			// Hurtighandling «Skriv feriedagbok» ber om dagens notat — åpnes etter
			// at eksisterende innlegg er lastet, så skjemaet kan forhåndsfylles.
			if (autoOpenDiary) openEditor();
		})();
		void loadMapData();
	});
</script>

{#if taskPills.length > 0}
	<section class="ferie-tasks">
		<h3>Oppgaver</h3>
		<ActionPillRow
			items={taskPills}
			ariaLabel="Ferieoppgaver"
			onItemClick={(item) => onPillClick(item.id)}
			onItemDismiss={() => onDismissGap?.()}
		/>
	</section>
{/if}

{#if editorOpen}
	<BottomSheet onclose={closeEditor} ariaLabel="Rediger feriedagbok">
		<div class="diary-sheet-head">
			<h3>Feriedagbok</h3>
			<button type="button" class="diary-sheet-close" aria-label="Lukk" onclick={closeEditor}>✕</button>
		</div>
		<div class="diary-sheet-body">
			<div class="diary-form-row">
				<label>
					<span>Dag</span>
					<DateInput bind:value={diaryDate} min={startDate} max={endDate} onChange={onDiaryDateChange} />
				</label>
				<label class="diary-place-field">
					<span>Sted</span>
					<input type="text" placeholder="Sted" bind:value={diaryPlace} />
				</label>
				<button type="button" class="ferie-btn" disabled={diaryFetchingWx || !diaryPlace} onclick={fetchDiaryWeather}>
					{diaryFetchingWx ? 'Henter…' : '🌤️ Hent vær'}
				</button>
				{#if diaryWeather}
					<span class="diary-wx">{diaryWeather.emoji} {diaryWeather.temp}°</span>
				{/if}
			</div>
			<textarea class="diary-text" rows="3" placeholder="Én setning om dagen…" bind:value={diaryText}></textarea>
			<DiaryImages bind:images={diaryImages} track="ferie-dagbok" />
		</div>
		<div class="diary-sheet-footer">
			{#if diaryError}<span class="ferie-error">{diaryError}</span>{/if}
			{#if diaryEntries.some((e) => e.date === diaryDate)}
				<button
					type="button"
					class="ferie-btn diary-delete-btn"
					disabled={diarySaving}
					onclick={() => deleteDiaryEntry(diaryDate)}
					data-track="ferie-dagbok:slett-dag"
				>Slett dag</button>
			{/if}
			<button type="button" class="ferie-btn ferie-btn-primary" disabled={diarySaving} onclick={saveDiaryEntry}>
				{diarySaving ? 'Lagrer…' : 'Lagre dag'}
			</button>
		</div>
	</BottomSheet>
{/if}

<div class="ferie-map-story" bind:this={mapSection}>
	<TripMapStory
		{themeId}
		geoByDay={tripGeoByDay}
		imagePins={tripImagePins}
		driveRoutes={tripDriveRoutes}
		diaryEntries={diaryEntries}
		{startDate}
		{endDate}
		onImagePinsChange={(p) => (tripImagePins = p)}
		onDriveRoutesChange={(r) => (tripDriveRoutes = r)}
		{api}
	/>
</div>

<section class="ferie-dash">
	<h3>Dag-for-dag</h3>
	<TripDayCalendar
		{themeEmoji}
		startDate={startDate}
		endDate={endDate}
		diaryEntries={diaryLoading ? [] : diaryEntries}
		onOpenDiary={(date) => openEditor(date)}
		{api}
	/>
</section>
<section class="ferie-dash">
	<h3>Trening &amp; helse</h3>
	<TripHealthStats {themeId} startDate={startDate} endDate={endDate} {api} />
</section>
<section class="ferie-dash">
	<h3>Økonomi</h3>
	<TripBudget {themeId} startDate={startDate} endDate={endDate} {api} />
</section>

{#if trips.some((t) => t.linkedThemeId)}
	<section class="ferie-dash">
		<h3>Reisene dine</h3>
		<ul class="trip-links">
			{#each trips.filter((t) => t.linkedThemeId) as t (t.id)}
				<li><a href={`/tema/${t.linkedThemeId}`}>{t.label || t.place || 'Reise'} &rarr;</a></li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	/* Oppgaver */
	.ferie-tasks {
		padding: 0.85rem;
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 12px;
	}
	.ferie-tasks h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}

	/* Feriedagbok (redigeringspanel) */
	.diary-form-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		align-items: flex-end;
	}
	.diary-form-row label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.8rem;
		color: var(--tp-text-soft);
	}
	.diary-place-field {
		flex: 1 1 140px;
	}
	.diary-place-field input {
		width: 100%;
	}
	.diary-wx {
		font-size: 0.95rem;
		padding: 0.3rem 0.5rem;
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		border-radius: 8px;
	}
	.diary-text {
		width: 100%;
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		color: var(--tp-text);
		border-radius: 8px;
		padding: 0.5rem;
		font-size: 0.9rem;
		font-family: inherit;
		resize: vertical;
	}
	/* Dagbok-bottompanel */
	.diary-sheet-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 1rem 0.5rem;
	}
	.diary-sheet-head h3 {
		margin: 0;
		font-size: 1.05rem;
		color: var(--tp-text);
	}
	.diary-sheet-close {
		background: none;
		border: none;
		color: var(--tp-text-muted);
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.2rem 0.4rem;
	}
	.diary-sheet-body {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0 1rem;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.diary-sheet-footer {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 0.6rem;
		padding: 0.75rem 1rem;
		padding-bottom: max(0.75rem, env(safe-area-inset-bottom, 0));
		border-top: 1px solid var(--tp-border);
		margin-top: 0.25rem;
	}
	.diary-delete-btn {
		margin-right: auto;
		color: var(--trip-danger, #f87171);
		border-color: var(--tp-border);
	}

	/* Delt knappestil */
	.ferie-btn {
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border-strong);
		color: var(--tp-text);
		border-radius: 8px;
		padding: 0.4rem 0.7rem;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.ferie-btn-primary {
		background: var(--tp-accent-bg);
	}
	.ferie-error {
		color: hsl(0 70% 70%);
		font-size: 0.85rem;
	}
	input[type='date'],
	input[type='text'] {
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		color: var(--tp-text);
		border-radius: 8px;
		padding: 0.4rem 0.55rem;
		font-size: 0.9rem;
	}

	/* Ferie-dashboards */
	.ferie-dash {
		padding: 0.85rem;
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 12px;
	}
	/* Kartfortelling: kort-ramme som de andre seksjonene, men TripMapStory eier
	   sin egen indre padding (topp/sider), så her trengs bare bunn-padding. */
	.ferie-map-story {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 12px;
		padding-bottom: 0.85rem;
		scroll-margin-top: 12px;
	}
	.ferie-dash h3 {
		margin: 0 0 0.6rem;
		font-size: 1rem;
	}
	.trip-links {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.trip-links a {
		color: var(--tp-accent);
		text-decoration: none;
	}
	.trip-links a:hover {
		text-decoration: underline;
	}
</style>
