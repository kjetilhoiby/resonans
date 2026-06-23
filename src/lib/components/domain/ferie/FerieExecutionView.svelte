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
	import DiaryImages from '../DiaryImages.svelte';
	import TripDayCalendar from '../TripDayCalendar.svelte';
	import TripHealthStats from '../TripHealthStats.svelte';
	import TripBudget from '../TripBudget.svelte';
	import ActionPillRow from '../home/ActionPillRow.svelte';
	import type { ActionPillItem } from '../home/action-pill-types';
	import {
		tripApi,
		type TripApi,
		type FerieTrip,
		type DiaryWeather,
		type DiaryEntry
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
		onDismissGap?: () => void;
		onNavigate: (view: 'rammer' | 'reiser' | 'gjennomfor') => void;
		api?: TripApi;
	}

	let {
		themeId, themeEmoji = null,
		startDate, endDate, days, trips, gapCount,
		gapAckCount,
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

	function formatDiaryDate(iso: string): string {
		try {
			return new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: '2-digit', month: 'short' }).format(
				new Date(iso + 'T12:00:00')
			);
		} catch {
			return iso;
		}
	}

	/* ── Dagbok-tilstand ───────────────────────────────── */
	let diaryEntries = $state<DiaryEntry[]>([]);
	let diaryLoading = $state(false);
	let diaryDate = $state('');
	let diaryPlace = $state('');
	let diaryText = $state('');
	let diaryWeather = $state<DiaryWeather | null>(null);
	let diaryImages = $state<string[]>([]);
	let diarySaving = $state(false);
	let diaryFetchingWx = $state(false);
	let diaryError = $state('');

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
			const ok = await api.putDiaryEntry(themeId, {
				date: diaryDate,
				content: diaryText,
				place: diaryPlace,
				weather: diaryWeather ?? undefined,
				images: diaryImages
			});
			if (!ok) throw new Error('save failed');
			await loadDiary();
		} catch {
			diaryError = 'Klarte ikke lagre dagboknotat.';
		} finally {
			diarySaving = false;
		}
	}

	function editDiaryEntry(e: DiaryEntry) {
		diaryDate = e.date;
		diaryText = e.content;
		diaryPlace = e.place ?? '';
		diaryWeather = e.weather ?? null;
		diaryImages = e.images ?? [];
		diaryError = '';
	}

	async function deleteDiaryEntry(date: string) {
		try {
			await api.putDiaryEntry(themeId, { date });
			await loadDiary();
			if (diaryDate === date) loadFormForDate(date);
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

	// Oppgaver som pills for hurtigvalgstripa. Gap-pillen kan avvises.
	const taskPills = $derived<ActionPillItem[]>(
		ferieTasks.map((t) => ({
			id: t.id,
			icon: TASK_ICON[t.kind],
			label: t.label,
			done: false,
			dismissable: t.kind === 'gap'
		}))
	);

	function doTaskById(id: string) {
		const t = ferieTasks.find((task) => task.id === id);
		if (!t) return;
		if (t.kind === 'diary' && t.date) {
			diaryDate = t.date;
			loadFormForDate(t.date);
		} else if (t.kind === 'trip') {
			onNavigate('reiser');
		} else if (t.kind === 'gap') {
			onNavigate('rammer');
		}
	}

	/* ── Lifecycle ─────────────────────────────────────── */
	onMount(() => {
		void loadDiary().then(() => {
			if (!diaryDate) {
				diaryDate = defaultDiaryDate();
				loadFormForDate(diaryDate);
			}
		});
	});
</script>

{#if taskPills.length > 0}
	<section class="ferie-tasks">
		<h3>Oppgaver</h3>
		<ActionPillRow
			items={taskPills}
			ariaLabel="Ferieoppgaver"
			onItemClick={(item) => doTaskById(item.id)}
			onItemDismiss={() => onDismissGap?.()}
		/>
	</section>
{/if}

<section class="ferie-diary">
	<div class="trips-head">
		<h3>Feriedagbok</h3>
	</div>

	<div class="diary-form">
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
		<textarea class="diary-text" rows="2" placeholder="Én setning om dagen…" bind:value={diaryText}></textarea>
		<DiaryImages bind:images={diaryImages} track="ferie-dagbok" />
		<div class="diary-actions">
			<button type="button" class="ferie-btn ferie-btn-primary" disabled={diarySaving} onclick={saveDiaryEntry}>
				{diarySaving ? 'Lagrer…' : 'Lagre dag'}
			</button>
			{#if diaryError}<span class="ferie-error">{diaryError}</span>{/if}
		</div>
	</div>

	{#if diaryEntries.length > 0}
		<ul class="diary-list">
			{#each diaryEntries as e (e.date)}
				<li class="diary-entry">
					<button type="button" class="diary-entry-main" onclick={() => editDiaryEntry(e)}>
						<span class="diary-entry-head">
							<span class="diary-entry-date">{formatDiaryDate(e.date)}</span>
							{#if e.weather}<span class="diary-entry-wx">{e.weather.emoji} {e.weather.temp}°</span>{/if}
							{#if e.place}<span class="diary-entry-place">📍 {e.place}</span>{/if}
						</span>
						<span class="diary-entry-text">{e.content}</span>
						{#if e.images && e.images.length > 0}
							<span class="diary-entry-thumbs">
								{#each e.images as img (img)}
									<img src={img} alt="Dagbokbilde" loading="lazy" />
								{/each}
							</span>
						{/if}
					</button>
					<button type="button" class="trip-remove" title="Slett" onclick={() => deleteDiaryEntry(e.date)}>×</button>
				</li>
			{/each}
		</ul>
	{:else if !diaryLoading}
		<p class="trips-empty">Ingen dagboknotater ennå. Velg en dag, skriv én setning, og hent gjerne været.</p>
	{/if}
</section>

<section class="ferie-dash">
	<h3>Dag-for-dag</h3>
	<TripDayCalendar {themeEmoji} startDate={startDate} endDate={endDate} {api} />
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

	/* Feriedagbok */
	.ferie-diary {
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
	.diary-form {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
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
	.diary-actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}
	.diary-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.diary-entry {
		display: flex;
		align-items: flex-start;
		gap: 0.4rem;
		border-top: 1px solid var(--tp-border);
		padding-top: 0.4rem;
	}
	.diary-entry-main {
		flex: 1;
		background: none;
		border: none;
		color: var(--tp-text);
		text-align: left;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		padding: 0;
	}
	.diary-entry-head {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		font-size: 0.78rem;
		color: var(--tp-text-soft);
	}
	.diary-entry-date {
		font-weight: 600;
		text-transform: capitalize;
	}
	.diary-entry-text {
		font-size: 0.9rem;
	}
	.diary-entry-thumbs {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.2rem;
	}
	.diary-entry-thumbs img {
		width: 48px;
		height: 48px;
		object-fit: cover;
		border-radius: 6px;
		border: 1px solid var(--tp-border);
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
	.trip-remove {
		background: none;
		border: none;
		color: var(--tp-text-muted);
		font-size: 1.2rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.2rem;
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
