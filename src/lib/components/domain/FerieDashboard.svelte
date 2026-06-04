<!--
  FerieDashboard — Oppholdsplan for ferie-tema.

  Subtraktiv modell: hver celle (familiemedlem × dag) er enten
    • blank   = normal dekning (barn: skole/bhg/aks åpen — voksen: på jobb)
    • 'stengt' = hull (negativt oppholdstilbud, må dekkes)
    • positivt tilbud (sommerskole, fotballskole, besteforeldre …) = fylt hull
  Voksne kan stå 'ferie'/'hjemme' og dekker da barnas hull den dagen.

  Arbeidsflyt: lag det store hullet (marker stengt for alle barn i perioden),
  fyll det med alternativt tilbud, og se gjenstående udekkede barn-dager (rødt).

  Props:
    themeId       – tema-UUID
    themeEmoji    – valgfri emoji
    ferieProfile  – lagret ferieprofil fra DB (bindable, kan være null)
    onProfileSaved – callback etter lagring
-->
<script lang="ts" module>
	export type FerieRole = 'voksen' | 'barn';

	export interface FerieMember {
		id: string;
		personId?: string;
		name: string;
		role: FerieRole;
	}

	export interface FerieTripStop {
		id: string;
		place: string;
		lat?: number;
		lon?: number;
		startDate: string;
		endDate: string;
		weatherEmoji?: string;
		weatherTemp?: number;
	}

	export interface FerieTrip {
		id: string;
		label: string;
		place?: string;
		startDate?: string;
		endDate?: string;
		linkedThemeId?: string;
		participants?: string[];
		stops?: FerieTripStop[];
	}

	export interface FerieCell {
		status: string;
		label?: string;
	}

	export interface FerieProfile {
		startDate?: string;
		endDate?: string;
		note?: string;
		members?: FerieMember[];
		grid?: Record<string, Record<string, FerieCell>>;
		trips?: FerieTrip[];
	}
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { fetchRawTimeseries, buildPeriods } from '$lib/utils/weather';
	import TripDayCalendar from './TripDayCalendar.svelte';
	import TripHealthStats from './TripHealthStats.svelte';
	import TripBudget from './TripBudget.svelte';

	type FerieView = 'rammer' | 'reiser' | 'gjennomfor';

	interface Props {
		themeId: string;
		themeEmoji?: string | null;
		ferieProfile: FerieProfile | null;
		onProfileSaved?: (profile: FerieProfile) => void;
	}

	let { themeId, themeEmoji = null, ferieProfile = $bindable(null), onProfileSaved }: Props = $props();

	/* ── Status-definisjoner ────────────────────────────── */
	type StatusMeta = { value: string; label: string; emoji: string; short: string; role: FerieRole; cls: string };

	const CHILD_STATUSES: StatusMeta[] = [
		{ value: 'stengt', label: 'Stengt', emoji: '🚫', short: 'Stengt', role: 'barn', cls: 'hole' },
		{ value: 'sommerskole', label: 'Sommerskole', emoji: '🎒', short: 'Sommerskole', role: 'barn', cls: 'fill' },
		{ value: 'fotballskole', label: 'Fotballskole', emoji: '⚽', short: 'Fotball', role: 'barn', cls: 'fill' },
		{ value: 'svommeskole', label: 'Svømmeskole', emoji: '🏊', short: 'Svømming', role: 'barn', cls: 'fill' },
		{ value: 'sommeraks', label: 'Sommer-AKS', emoji: '🏫', short: 'Sommer-AKS', role: 'barn', cls: 'fill' },
		{ value: 'besteforeldre', label: 'Besteforeldre', emoji: '👵', short: 'Besteforeldre', role: 'barn', cls: 'fill' },
		{ value: 'leir', label: 'Leir', emoji: '🏕️', short: 'Leir', role: 'barn', cls: 'fill' },
		{ value: 'annet', label: 'Annet tilbud', emoji: '✨', short: 'Annet', role: 'barn', cls: 'fill' }
	];

	const ADULT_STATUSES: StatusMeta[] = [
		{ value: 'ferie', label: 'Ferie', emoji: '🌴', short: 'Ferie', role: 'voksen', cls: 'adult-off' },
		{ value: 'hjemme', label: 'Hjemme', emoji: '🏠', short: 'Hjemme', role: 'voksen', cls: 'adult-off' }
	];

	const STATUS_META: Record<string, StatusMeta> = Object.fromEntries(
		[...CHILD_STATUSES, ...ADULT_STATUSES].map((s) => [s.value, s])
	);

	const WEEKDAYS = ['Søn', 'Man', 'Tir', 'Ons', 'Tor', 'Fre', 'Lør'];

	/* ── Arbeidstilstand (initialisert fra lagret profil) ── */
	let startDate = $state(ferieProfile?.startDate ?? '');
	let endDate = $state(ferieProfile?.endDate ?? '');
	let note = $state(ferieProfile?.note ?? '');
	let members = $state<FerieMember[]>(ferieProfile?.members ? [...ferieProfile.members] : []);
	let grid = $state<Record<string, Record<string, FerieCell>>>(
		ferieProfile?.grid ? $state.snapshot(ferieProfile.grid) : {}
	);
	let trips = $state<FerieTrip[]>(ferieProfile?.trips ? [...ferieProfile.trips] : []);

	let activePaint = $state<string>('stengt');
	let editMembers = $state(false);
	let editing = $state(false);
	let view = $state<FerieView>('rammer');

	/* ── Avledede verdier ───────────────────────────────── */
	const adultIds = $derived(members.filter((m) => m.role === 'voksen').map((m) => m.id));
	const childIds = $derived(members.filter((m) => m.role === 'barn').map((m) => m.id));

	function pad(n: number): string {
		return String(n).padStart(2, '0');
	}

	function toISO(d: Date): string {
		return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
	}

	function getISOWeek(date: Date): number {
		const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
		const dayNum = (d.getUTCDay() + 6) % 7;
		d.setUTCDate(d.getUTCDate() - dayNum + 3);
		const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
		const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
		firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
		return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86400000));
	}

	interface DayEntry {
		iso: string;
		weekday: string;
		dayMonth: string;
		week: number;
		isWeekend: boolean;
	}

	const days = $derived.by<DayEntry[]>(() => {
		if (!startDate || !endDate) return [];
		const start = new Date(startDate + 'T00:00:00');
		const end = new Date(endDate + 'T00:00:00');
		if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return [];
		const out: DayEntry[] = [];
		const cursor = new Date(start);
		// Sikkerhetstak: maks ~400 dager
		let guard = 0;
		while (cursor <= end && guard < 400) {
			const dow = cursor.getDay();
			out.push({
				iso: toISO(cursor),
				weekday: WEEKDAYS[dow],
				dayMonth: `${pad(cursor.getDate())}.${pad(cursor.getMonth() + 1)}`,
				week: getISOWeek(cursor),
				isWeekend: dow === 0 || dow === 6
			});
			cursor.setDate(cursor.getDate() + 1);
			guard++;
		}
		return out;
	});

	// Er medlemmet med på en reise som dekker datoen?
	function memberOnTrip(memberId: string, iso: string): boolean {
		return trips.some(
			(t) =>
				(t.participants?.includes(memberId) ?? false) &&
				t.startDate &&
				t.endDate &&
				iso >= t.startDate &&
				iso <= t.endDate
		);
	}

	// En voksen «hjemme» dekker barn kun hvis hen ikke selv er bortreist på en reise.
	function adultsHomeOn(iso: string): boolean {
		return adultIds.some((id) => {
			const s = grid[id]?.[iso]?.status;
			return (s === 'ferie' || s === 'hjemme') && !memberOnTrip(id, iso);
		});
	}

	// 'gap' | 'covered' | 'fill' | 'adult-off' | 'trip' | 'default'
	function cellState(member: FerieMember, iso: string): string {
		if (memberOnTrip(member.id, iso)) return 'trip';
		const s = grid[member.id]?.[iso]?.status;
		if (member.role === 'barn') {
			if (s === 'stengt') return adultsHomeOn(iso) ? 'covered' : 'gap';
			if (s) return 'fill';
			return 'default';
		}
		if (s === 'ferie' || s === 'hjemme') return 'adult-off';
		return 'default';
	}

	function cellLabel(member: FerieMember, iso: string): string {
		const s = grid[member.id]?.[iso]?.status;
		if (!s) return '';
		return STATUS_META[s]?.short ?? s;
	}

	const gapCount = $derived.by(() => {
		let n = 0;
		for (const day of days) {
			if (day.isWeekend) continue;
			for (const id of childIds) {
				if (memberOnTrip(id, day.iso)) continue; // bortreist = dekket
				if (grid[id]?.[day.iso]?.status === 'stengt' && !adultsHomeOn(day.iso)) n++;
			}
		}
		return n;
	});

	const coveredByParentCount = $derived.by(() => {
		let n = 0;
		for (const day of days) {
			if (day.isWeekend) continue;
			for (const id of childIds) {
				if (memberOnTrip(id, day.iso)) continue;
				if (grid[id]?.[day.iso]?.status === 'stengt' && adultsHomeOn(day.iso)) n++;
			}
		}
		return n;
	});

	interface WeekSummary {
		week: number;
		dateRange: string;
		days: DayEntry[];
		members: Record<string, { gaps: number; covered: number; fills: number; trips: number; off: number; total: number }>;
	}

	const weekSummaries = $derived.by<WeekSummary[]>(() => {
		const weekMap = new Map<number, DayEntry[]>();
		for (const d of days) {
			if (d.isWeekend) continue;
			const list = weekMap.get(d.week) ?? [];
			list.push(d);
			weekMap.set(d.week, list);
		}
		const out: WeekSummary[] = [];
		for (const [week, wdays] of weekMap) {
			const first = wdays[0], last = wdays[wdays.length - 1];
			const memberStats: WeekSummary['members'] = {};
			for (const m of members) {
				let gaps = 0, covered = 0, fills = 0, trips = 0, off = 0;
				for (const d of wdays) {
					const cs = cellState(m, d.iso);
					if (cs === 'gap') gaps++;
					else if (cs === 'covered') covered++;
					else if (cs === 'fill') fills++;
					else if (cs === 'trip') trips++;
					else if (cs === 'adult-off') off++;
				}
				memberStats[m.id] = { gaps, covered, fills, trips, off, total: wdays.length };
			}
			out.push({ week, dateRange: `${first.dayMonth}–${last.dayMonth}`, days: wdays, members: memberStats });
		}
		return out;
	});

	let expandedWeeks = $state<Set<number>>(new Set());

	function toggleWeek(week: number) {
		const next = new Set(expandedWeeks);
		if (next.has(week)) next.delete(week); else next.add(week);
		expandedWeeks = next;
	}

	function initials(name: string): string {
		const parts = name.trim().split(/\s+/);
		if (parts.length === 1) return parts[0].slice(0, 2);
		return parts.map(p => p[0]).join('').toUpperCase();
	}

	/* ── Mutasjoner ─────────────────────────────────────── */
	function setCell(memberId: string, iso: string, status: string | null) {
		const memberGrid = { ...(grid[memberId] ?? {}) };
		if (status === null) delete memberGrid[iso];
		else memberGrid[iso] = { status };
		grid = { ...grid, [memberId]: memberGrid };
		scheduleSave();
	}

	function paintCell(member: FerieMember, iso: string) {
		if (activePaint === 'clear') {
			setCell(member.id, iso, null);
			return;
		}
		const meta = STATUS_META[activePaint];
		if (!meta || meta.role !== member.role) return; // ignorer inkompatibel maling
		// Klikk på samme status igjen = visk ut (toggle)
		if (grid[member.id]?.[iso]?.status === activePaint) {
			setCell(member.id, iso, null);
		} else {
			setCell(member.id, iso, activePaint);
		}
	}

	/* ── Bulk: lag hullet / fyll periode ────────────────── */
	let bulkFrom = $state('');
	let bulkTo = $state('');
	let bulkTarget = $state<string>('barn'); // 'barn' | 'voksen' | <memberId>

	function applyBulk(status: string, from: string, to: string, target: string) {
		if (!from || !to) return;
		const targets =
			target === 'barn' ? childIds : target === 'voksen' ? adultIds : [target];
		const range = days.filter((d) => d.iso >= from && d.iso <= to && !d.isWeekend);
		if (targets.length === 0 || range.length === 0) return;
		const newGrid = { ...grid };
		for (const id of targets) {
			const member = members.find((m) => m.id === id);
			if (!member) continue;
			if (status !== 'clear' && STATUS_META[status]?.role !== member.role) continue;
			const mg = { ...(newGrid[id] ?? {}) };
			for (const d of range) {
				if (status === 'clear') delete mg[d.iso];
				else mg[d.iso] = { status };
			}
			newGrid[id] = mg;
		}
		grid = newGrid;
		scheduleSave();
	}

	function lagHullet() {
		// Ett klikk: marker hele perioden 'stengt' for alle barn.
		applyBulk('stengt', startDate, endDate, 'barn');
	}

	function applyBulkFromForm() {
		applyBulk(activePaint, bulkFrom || startDate, bulkTo || endDate, bulkTarget);
	}

	/* ── Reiser i ferien (Fase 2) ───────────────────────── */
	let promoting = $state<string | null>(null);

	function addTrip() {
		trips = [...trips, { id: crypto.randomUUID(), label: '', place: '', startDate: startDate || '', endDate: endDate || '' }];
		scheduleSave();
	}

	function updateTrip(id: string, patch: Partial<FerieTrip>) {
		trips = trips.map((t) => (t.id === id ? { ...t, ...patch } : t));
		scheduleSave();
	}

	function removeTrip(id: string) {
		trips = trips.filter((t) => t.id !== id);
		scheduleSave();
	}

	function toggleTripParticipant(tripId: string, memberId: string) {
		trips = trips.map((t) => {
			if (t.id !== tripId) return t;
			const cur = t.participants ?? [];
			const next = cur.includes(memberId) ? cur.filter((id) => id !== memberId) : [...cur, memberId];
			return { ...t, participants: next };
		});
		scheduleSave();
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
			updateTrip(t.id, { linkedThemeId: data.themeId }); // lagrer lenken via scheduleSave
		} catch {
			saveError = 'Klarte ikke å lage reise-tema. Prøv igjen.';
		} finally {
			promoting = null;
		}
	}

	// Reise-blokk som dekker en gitt dato (for kalender-overlay).
	function tripForDate(iso: string): FerieTrip | null {
		for (const t of trips) {
			if (t.startDate && t.endDate && iso >= t.startDate && iso <= t.endDate) return t;
		}
		return null;
	}

	/* ── Stopp på reiser ────────────────────────────────── */
	let stopInput = $state<Record<string, string>>({});
	let stopDate = $state<Record<string, string>>({});
	let stopGeocoding = $state<string | null>(null);

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

	async function fetchStopWeather(stop: FerieTripStop): Promise<void> {
		if (!stop.lat || !stop.lon) return;
		try {
			const ts = await fetchRawTimeseries(stop.lat, stop.lon);
			if (!ts) return;
			const todayStr = toISO(new Date());
			const repDate = (todayStr >= stop.startDate && todayStr <= stop.endDate) ? todayStr : stop.startDate;
			const periods = buildPeriods(repDate, ts);
			const usable = periods.find((p) => p.key === 'middag' && p.emoji !== '—' && p.emoji !== '')
				?? periods.find((p) => p.emoji !== '—' && p.emoji !== '');
			if (usable) {
				stop.weatherEmoji = usable.emoji;
				stop.weatherTemp = usable.temp;
			}
		} catch { /* best-effort */ }
	}

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
			scheduleSave();
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
		scheduleSave();
	}

	function removeStop(tripId: string, stopId: string) {
		trips = trips.map((t) =>
			t.id === tripId ? { ...t, stops: (t.stops ?? []).filter((s) => s.id !== stopId) } : t
		);
		scheduleSave();
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

	/* ── Feriedagbok (Fase 3) ───────────────────────────── */
	interface DiaryWeather {
		emoji?: string;
		temp?: number;
		symbol?: string;
	}
	interface DiaryEntry {
		date: string;
		content: string;
		place?: string;
		weather?: DiaryWeather;
	}

	let diaryEntries = $state<DiaryEntry[]>([]);
	let diaryLoading = $state(false);
	let diaryDate = $state('');
	let diaryPlace = $state('');
	let diaryText = $state('');
	let diaryWeather = $state<DiaryWeather | null>(null);
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
		} else {
			diaryText = '';
			diaryWeather = null;
			const trip = tripForDate(date);
			diaryPlace = trip?.place ?? trip?.label ?? '';
		}
	}

	async function loadDiary() {
		diaryLoading = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/ferie/diary`);
			if (res.ok) {
				const data = (await res.json()) as { entries: DiaryEntry[] };
				diaryEntries = data.entries ?? [];
			}
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
			const geoRes = await fetch(
				`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(diaryPlace)}&format=json&limit=1`,
				{ headers: { 'Accept-Language': 'nb,en' } }
			);
			const geo = (await geoRes.json()) as Array<{ lat: string; lon: string }>;
			if (!geo.length) {
				diaryError = 'Fant ikke stedet.';
				return;
			}
			const ts = await fetchRawTimeseries(parseFloat(geo[0].lat), parseFloat(geo[0].lon));
			if (!ts) {
				diaryError = 'Fikk ikke værdata.';
				return;
			}
			const periods = buildPeriods(diaryDate, ts);
			const usable = periods.find((p) => p.key === 'middag' && p.emoji !== '—' && p.emoji !== '')
				?? periods.find((p) => p.emoji !== '—' && p.emoji !== '');
			if (usable) {
				diaryWeather = { emoji: usable.emoji, temp: usable.temp };
			} else {
				diaryError = 'Ingen værvarsel for denne datoen (met.no gir kun ~9 dager fram).';
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
			const res = await fetch(`/api/tema/${themeId}/ferie/diary`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					date: diaryDate,
					content: diaryText,
					place: diaryPlace,
					weather: diaryWeather ?? undefined
				})
			});
			if (!res.ok) throw new Error('save failed');
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
		diaryError = '';
	}

	async function deleteDiaryEntry(date: string) {
		try {
			await fetch(`/api/tema/${themeId}/ferie/diary`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ date })
			});
			await loadDiary();
			if (diaryDate === date) loadFormForDate(date);
		} catch {
			diaryError = 'Klarte ikke slette.';
		}
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

	/* ── Oppgaver (Gjennomfør) ──────────────────────────── */
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
		// «Skriv i dagboka» for passerte dager (siste 7) i vinduet uten notat
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
		if (gapCount > 0) {
			out.push({ id: 'gap', kind: 'gap', label: `${gapCount} barn-dager mangler fortsatt dekning` });
		}
		return out;
	});

	function doTask(t: FerieTask) {
		if (t.kind === 'diary' && t.date) {
			diaryDate = t.date;
			loadFormForDate(t.date);
		} else if (t.kind === 'trip') {
			view = 'reiser';
		} else if (t.kind === 'gap') {
			view = 'rammer';
		}
	}

	onMount(() => {
		void loadDiary().then(() => {
			if (!diaryDate) {
				diaryDate = defaultDiaryDate();
				loadFormForDate(diaryDate);
			}
		});
	});

	/* ── Medlemmer ──────────────────────────────────────── */
	let newMemberName = $state('');
	let newMemberRole = $state<FerieRole>('barn');

	interface PersonRow {
		id: string;
		name: string;
		kind: string;
		avatarEmoji?: string | null;
	}
	let availablePersons = $state<PersonRow[]>([]);
	let personsLoaded = $state(false);

	async function fetchPersons() {
		if (personsLoaded) return;
		try {
			const res = await fetch('/api/persons');
			if (res.ok) {
				const data = (await res.json()) as { persons: PersonRow[] };
				availablePersons = data.persons ?? [];
			}
		} catch {
			// valgfritt — kan legge til medlemmer manuelt
		} finally {
			personsLoaded = true;
		}
	}

	function roleFromKind(kind: string): FerieRole {
		return kind === 'child' ? 'barn' : 'voksen';
	}

	function addPerson(p: PersonRow) {
		if (members.some((m) => m.personId === p.id)) return;
		members = [...members, { id: p.id, personId: p.id, name: p.name, role: roleFromKind(p.kind) }];
		scheduleSave();
	}

	function addManualMember() {
		const name = newMemberName.trim();
		if (!name) return;
		members = [...members, { id: crypto.randomUUID(), name, role: newMemberRole }];
		newMemberName = '';
		scheduleSave();
	}

	function removeMember(id: string) {
		members = members.filter((m) => m.id !== id);
		const { [id]: _removed, ...rest } = grid;
		grid = rest;
		scheduleSave();
	}

	function toggleMemberRole(id: string) {
		members = members.map((m) => (m.id === id ? { ...m, role: m.role === 'barn' ? 'voksen' : 'barn' } : m));
		scheduleSave();
	}

	function updateMemberName(id: string, name: string) {
		members = members.map((m) => (m.id === id ? { ...m, name } : m));
		scheduleSave();
	}

	function personIsAdded(id: string): boolean {
		return members.some((m) => m.personId === id);
	}

	/* ── Wizard: punch de groveste rammene ──────────────── */
	// Per medlem: når er de hjemme (voksen = tilgjengelig til å dekke, barn = hjemme
	// uten tilbud = trenger dekning). «Generer» maler grid-en fra disse periodene.
	let wizardRanges = $state<Record<string, { from: string; to: string }>>({});

	function wizFrom(id: string): string {
		return wizardRanges[id]?.from ?? startDate;
	}
	function wizTo(id: string): string {
		return wizardRanges[id]?.to ?? endDate;
	}
	function setWiz(id: string, field: 'from' | 'to', value: string) {
		const cur = wizardRanges[id] ?? { from: startDate, to: endDate };
		wizardRanges[id] = { ...cur, [field]: value };
	}

	function generateFromWizard() {
		for (const m of members) {
			const from = wizFrom(m.id);
			const to = wizTo(m.id);
			if (!from || !to) continue;
			// Voksen hjemme = tilgjengelig (hjemme). Barn hjemme = stengt (trenger dekning).
			applyBulk(m.role === 'voksen' ? 'hjemme' : 'stengt', from, to, m.id);
		}
	}

	/* ── Lagring (debounced) ────────────────────────────── */
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saving = $state(false);
	let saveError = $state('');
	let lastSavedAt = $state<string | null>(null);
	let pendingSave = false; // det finnes uskrevne endringer

	function scheduleSave() {
		pendingSave = true;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), 800);
	}

	function buildPayload() {
		// Send alle feltene eksplisitt (null = tøm) så serverens felt-vis merge
		// kan både oppdatere og tømme felter korrekt.
		return {
			startDate: startDate || null,
			endDate: endDate || null,
			note: note.trim() || null,
			members,
			grid,
			trips
		};
	}

	async function save(opts?: { keepalive?: boolean }) {
		if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
		saving = true;
		saveError = '';
		const profile: FerieProfile = {
			startDate: startDate || undefined,
			endDate: endDate || undefined,
			note: note.trim() || undefined,
			members,
			grid,
			trips: trips.length > 0 ? trips : undefined
		};
		try {
			const res = await fetch(`/api/tema/${themeId}/ferie`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(buildPayload()),
				keepalive: opts?.keepalive
			});
			if (!res.ok) {
				let msg = `Lagring feilet (${res.status})`;
				try {
					const j = await res.json();
					if (j?.error) msg = j.error;
				} catch {
					/* ignorer parse-feil, behold statuskoden */
				}
				throw new Error(msg);
			}
			pendingSave = false;
			ferieProfile = profile;
			lastSavedAt = new Date().toISOString();
			onProfileSaved?.(profile);
		} catch (e) {
			saveError = e instanceof Error ? `Klarte ikke lagre: ${e.message}` : 'Klarte ikke lagre. Prøv igjen.';
		} finally {
			saving = false;
		}
	}

	// Flush en ventende debounced lagring umiddelbart. `keepalive` lar requesten
	// fullføre selv om komponenten/siden rives ned (fane-bytte, tilbake-navigasjon,
	// lukking) — uten dette forkastet onDestroy en endring gjort innen 800 ms.
	function flushPendingSave() {
		if (!pendingSave) return;
		if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
		void save({ keepalive: true });
	}

	function onWindowChange() {
		scheduleSave();
	}

	onMount(() => {
		const onHidden = () => {
			if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flushPendingSave();
		};
		document.addEventListener('visibilitychange', onHidden);
		window.addEventListener('pagehide', flushPendingSave);
		return () => {
			document.removeEventListener('visibilitychange', onHidden);
			window.removeEventListener('pagehide', flushPendingSave);
		};
	});

	onDestroy(() => {
		flushPendingSave();
	});

	const hasWindow = $derived(days.length > 0);
	const paletteList = $derived(activePaint && STATUS_META[activePaint]?.role === 'voksen' ? ADULT_STATUSES : CHILD_STATUSES);
</script>

<div class="ferie">
	<!-- Toppstatus -->
	<header class="ferie-head">
		<div class="ferie-head-title">
			<span class="ferie-emoji">{themeEmoji ?? '🏖️'}</span>
			<h2>Ferieplan</h2>
		</div>
		<div class="ferie-head-status">
			{#if saving}
				<span class="ferie-saving">Lagrer…</span>
			{:else if saveError}
				<span class="ferie-error">{saveError}</span>
			{:else if lastSavedAt}
				<span class="ferie-saved">Lagret ✓</span>
			{/if}
		</div>
	</header>

	<nav class="view-switch">
		<button class:active={view === 'rammer'} onclick={() => (view = 'rammer')}>1 · Rammer</button>
		<button class:active={view === 'reiser'} onclick={() => (view = 'reiser')}>2 · Reiser</button>
		<button class:active={view === 'gjennomfor'} onclick={() => (view = 'gjennomfor')}>3 · Gjennomfør</button>
	</nav>

	{#if view === 'rammer'}
	{#if !hasWindow || members.length === 0 || editing}
	<!-- Ferievindu + medlemmer (alltid synlig i redigering, eller ved tom tilstand) -->
	<section class="ferie-setup">
		<div class="ferie-window">
			<label>
				<span>Fra</span>
				<input type="date" bind:value={startDate} onchange={onWindowChange} />
			</label>
			<label>
				<span>Til</span>
				<input type="date" bind:value={endDate} onchange={onWindowChange} />
			</label>
			<label class="ferie-note-field">
				<span>Foreløpig</span>
				<input
					type="text"
					placeholder="f.eks. Volda med Marte og David"
					bind:value={note}
					onchange={onWindowChange}
				/>
			</label>
		</div>

		<div class="ferie-members">
			<div class="ferie-members-row">
				{#each members as m (m.id)}
					<span class="member-chip" class:adult={m.role === 'voksen'}>
						<button
							type="button"
							class="member-role"
							title="Bytt rolle (voksen/barn)"
							onclick={() => toggleMemberRole(m.id)}
						>{m.role === 'voksen' ? '🧑' : '🧒'}</button>
						<span class="member-name">{m.name}</span>
						<button type="button" class="member-remove" title="Fjern" onclick={() => removeMember(m.id)}>×</button>
					</span>
				{/each}
				<button
					type="button"
					class="member-add-toggle"
					onclick={() => { editMembers = !editMembers; if (editMembers) void fetchPersons(); }}
				>
					{editMembers ? 'Lukk' : '+ Medlem'}
				</button>
			</div>

			{#if editMembers}
				<div class="member-editor">
					{#if availablePersons.length > 0}
						<p class="member-editor-label">Fra familien</p>
						<div class="person-list">
							{#each availablePersons as p (p.id)}
								<button
									type="button"
									class="person-pick"
									class:added={personIsAdded(p.id)}
									disabled={personIsAdded(p.id)}
									onclick={() => addPerson(p)}
								>
									<span>{p.avatarEmoji ?? (p.kind === 'child' ? '🧒' : '🧑')}</span>
									{p.name}
								</button>
							{/each}
						</div>
					{/if}
					<p class="member-editor-label">Legg til manuelt</p>
					<div class="member-manual">
						<input
							type="text"
							placeholder="Navn"
							bind:value={newMemberName}
							onkeydown={(e) => { if (e.key === 'Enter') addManualMember(); }}
						/>
						<select bind:value={newMemberRole}>
							<option value="barn">Barn</option>
							<option value="voksen">Voksen</option>
						</select>
						<button type="button" class="ferie-btn" onclick={addManualMember}>Legg til</button>
					</div>
				</div>
			{/if}
		</div>
		{#if members.length > 0 && editing}
			<div class="wizard">
				<div class="wizard-head">
					<span class="wizard-title">Hjemme-perioder (rammer)</span>
					<button type="button" class="ferie-btn ferie-btn-primary" onclick={generateFromWizard}>
						Generer dekningsplan
					</button>
				</div>
				<table class="wizard-table">
					<thead>
						<tr><th>Hvem</th><th>Hjemme fra</th><th>Hjemme til</th></tr>
					</thead>
					<tbody>
						{#each members as m (m.id)}
							<tr>
								<td><span class="wiz-role">{m.role === 'voksen' ? '🧑' : '🧒'}</span> {m.name}</td>
								<td><input type="date" value={wizFrom(m.id)} min={startDate} max={endDate} onchange={(e) => setWiz(m.id, 'from', e.currentTarget.value)} /></td>
								<td><input type="date" value={wizTo(m.id)} min={startDate} max={endDate} onchange={(e) => setWiz(m.id, 'to', e.currentTarget.value)} /></td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="wizard-hint">
					Voksen hjemme = kan dekke. Barn hjemme = trenger dekning. «Generer» maler kalenderen fra
					periodene — finjuster i grid-en under.
				</p>
			</div>
		{/if}
	</section>
	{/if}

	{#if !hasWindow}
		<div class="ferie-empty">
			<p>Sett en startdato og sluttdato for ferien for å bygge oppholdsplanen.</p>
		</div>
	{:else if members.length === 0}
		<div class="ferie-empty">
			<p>Legg til familiemedlemmer (barn og voksne) for å begynne å planlegge dekningen.</p>
		</div>
	{:else}
		<section class="ferie-summary">
			<button type="button" class="ferie-btn" class:ferie-btn-primary={editing} onclick={() => (editing = !editing)}>
				{editing ? 'Ferdig' : 'Rediger'}
			</button>
		</section>

		{#if !editing}
			<div class="compact-grid-wrap">
				<table class="compact-grid">
					<thead>
						<tr>
							<th class="compact-week-col"></th>
							{#each members as m (m.id)}
								<th class="compact-member-col" class:adult={m.role === 'voksen'}>{initials(m.name)}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each weekSummaries as ws (ws.week)}
							{@const isExpanded = expandedWeeks.has(ws.week)}
							<tr class="compact-week-row" class:expanded={isExpanded} onclick={() => toggleWeek(ws.week)}>
								<td class="compact-week-col">
									<span class="compact-week-num">{ws.week}</span>
								</td>
								{#each members as m (m.id)}
									<td class="compact-cell">
										<div class="day-bars">
											{#each ws.days as day (day.iso)}
												<span class="day-bar {cellState(m, day.iso)}"></span>
											{/each}
										</div>
									</td>
								{/each}
							</tr>
							{#if isExpanded}
								{#each ws.days as day, di (day.iso)}
									<tr class="expanded-day-row">
										<td class="compact-week-col expanded-day-label">{day.weekday.slice(0, 2)}</td>
										{#each members as m, mi (m.id)}
											<td class="expanded-cell"><span class="day-pill {cellState(m, day.iso)}">{#if mi === 0}<span class="day-date-overlay">{day.dayMonth}</span>{/if}</span></td>
										{/each}
									</tr>
								{/each}
							{/if}
						{/each}
					</tbody>
				</table>
			</div>

			<div class="ferie-legend">
				<span class="legend-item"><i class="sw gap"></i> Udekket</span>
				<span class="legend-item"><i class="sw covered"></i> Forelder</span>
				<span class="legend-item"><i class="sw fill"></i> Tilbud</span>
				<span class="legend-item"><i class="sw trip"></i> Reise</span>
				<span class="legend-item"><i class="sw adult-off"></i> Fri</span>
			</div>
		{:else}
			<!-- Full redigering -->
			{#if childIds.length > 0}
				<button type="button" class="ferie-btn ferie-btn-primary" onclick={lagHullet}>
					🚫 Lag hullet — marker stengt for alle barn i hele perioden
				</button>
			{/if}

			<section class="ferie-palette">
				<div class="palette-group">
					<span class="palette-title">Mal med:</span>
					<button type="button" class="paint-chip clear" class:active={activePaint === 'clear'} onclick={() => (activePaint = 'clear')}>
						🧽 Viske ut
					</button>
					{#each paletteList as s (s.value)}
						<button
							type="button"
							class="paint-chip {s.cls}"
							class:active={activePaint === s.value}
							onclick={() => (activePaint = s.value)}
						>
							{s.emoji} {s.label}
						</button>
					{/each}
				</div>
				<div class="palette-switch">
					<button type="button" class:active={paletteList === CHILD_STATUSES} onclick={() => (activePaint = 'stengt')}>Barn</button>
					<button type="button" class:active={paletteList === ADULT_STATUSES} onclick={() => (activePaint = 'ferie')}>Voksen</button>
				</div>
			</section>

			<details class="ferie-bulk">
				<summary>Marker en periode i bulk</summary>
				<div class="bulk-form">
					<label><span>Fra</span><input type="date" bind:value={bulkFrom} min={startDate} max={endDate} /></label>
					<label><span>Til</span><input type="date" bind:value={bulkTo} min={startDate} max={endDate} /></label>
					<label>
						<span>For</span>
						<select bind:value={bulkTarget}>
							<option value="barn">Alle barn</option>
							<option value="voksen">Alle voksne</option>
							{#each members as m (m.id)}
								<option value={m.id}>{m.name}</option>
							{/each}
						</select>
					</label>
					<button type="button" class="ferie-btn" onclick={applyBulkFromForm}>
						Sett «{activePaint === 'clear' ? 'blank' : STATUS_META[activePaint]?.label ?? activePaint}»
					</button>
				</div>
			</details>

			<div class="ferie-grid-wrap">
				<table class="ferie-grid">
					<thead>
						<tr>
							<th class="col-date sticky-col">Dag</th>
							{#each members as m (m.id)}
								<th class="col-member" class:adult={m.role === 'voksen'}>
									<span class="th-role">{m.role === 'voksen' ? '🧑' : '🧒'}</span>
									<span class="th-name">{m.name}</span>
								</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each days as day, i (day.iso)}
							{@const trip = tripForDate(day.iso)}
							{#if i === 0 || days[i - 1].week !== day.week}
								<tr class="week-row">
									<td colspan={members.length + 1}>Uke {day.week}</td>
								</tr>
							{/if}
							<tr class:weekend={day.isWeekend} class:has-trip={trip}>
								<td class="col-date sticky-col">
									<span class="date-day">{day.weekday}</span>
									<span class="date-num">{day.dayMonth}</span>
									{#if trip}<span class="date-trip" title={trip.label || trip.place || 'Reise'}>✈️</span>{/if}
								</td>
								{#each members as m (m.id)}
									<td
										class="cell {cellState(m, day.iso)}"
										title={cellLabel(m, day.iso) || (day.isWeekend ? 'Helg' : 'Normal dekning')}
										onclick={() => paintCell(m, day.iso)}
									>
										{cellLabel(m, day.iso)}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<div class="ferie-legend">
				<span class="legend-item"><i class="sw gap"></i> Mangler dekning</span>
				<span class="legend-item"><i class="sw covered"></i> Dekket av forelder</span>
				<span class="legend-item"><i class="sw fill"></i> Alternativt tilbud</span>
				<span class="legend-item"><i class="sw trip"></i> Bortreist (reise)</span>
				<span class="legend-item"><i class="sw adult-off"></i> Voksen ferie/hjemme</span>
				<span class="legend-item"><i class="sw default"></i> Normal dekning</span>
			</div>
		{/if}
		{#if lastSavedAt}
			<p class="ferie-saved-at">Sist lagret: {new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(lastSavedAt))}</p>
		{/if}
	{/if}
	{:else if view === 'reiser'}
		{#if !hasWindow}
			<div class="ferie-empty"><p>Sett ferievinduet under «Rammer» først.</p></div>
		{:else}
		<section class="ferie-trips">
			<div class="trips-head">
				<h3>Reiser i ferien</h3>
				<button type="button" class="ferie-btn" onclick={addTrip}>+ Reise</button>
			</div>
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
							<input
								type="date"
								value={t.startDate ?? ''}
								min={startDate}
								max={endDate}
								onchange={(e) => updateTrip(t.id, { startDate: e.currentTarget.value })}
							/>
							<input
								type="date"
								value={t.endDate ?? ''}
								min={startDate}
								max={endDate}
								onchange={(e) => updateTrip(t.id, { endDate: e.currentTarget.value })}
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
								<input
									type="date"
									class="stop-date-input"
									value={stopDate[t.id] ?? toISO(new Date())}
									min={t.startDate}
									max={t.endDate}
									oninput={(e) => { stopDate = { ...stopDate, [t.id]: e.currentTarget.value }; }}
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
		{/if}
	{:else}
		{#if !hasWindow}
			<div class="ferie-empty"><p>Sett ferievinduet under «Rammer» først.</p></div>
		{:else}
		{#if ferieTasks.length > 0}
			<section class="ferie-tasks">
				<h3>Oppgaver</h3>
				<ul class="task-list">
					{#each ferieTasks as task (task.id)}
						<li>
							<button type="button" class="task-item {task.kind}" onclick={() => doTask(task)}>{task.label}</button>
						</li>
					{/each}
				</ul>
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
						<input type="date" bind:value={diaryDate} min={startDate} max={endDate} onchange={onDiaryDateChange} />
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
			<TripDayCalendar {themeEmoji} startDate={startDate} endDate={endDate} />
		</section>
		<section class="ferie-dash">
			<h3>Trening &amp; helse</h3>
			<TripHealthStats {themeId} startDate={startDate} endDate={endDate} />
		</section>
		<section class="ferie-dash">
			<h3>Økonomi</h3>
			<TripBudget {themeId} startDate={startDate} endDate={endDate} />
		</section>

		{#if trips.some((t) => t.linkedThemeId)}
			<section class="ferie-dash">
				<h3>Reisene dine</h3>
				<ul class="trip-links">
					{#each trips.filter((t) => t.linkedThemeId) as t (t.id)}
						<li><a href={`/tema/${t.linkedThemeId}`}>{t.label || t.place || 'Reise'} →</a></li>
					{/each}
				</ul>
			</section>
		{/if}
		{/if}
	{/if}
</div>

<style>
	.ferie {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		color: var(--tp-text);
	}

	.ferie-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.ferie-head-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.ferie-head-title h2 {
		margin: 0;
		font-size: 1.15rem;
	}
	.ferie-emoji {
		font-size: 1.4rem;
	}
	.ferie-saving {
		color: var(--tp-text-muted);
		font-size: 0.85rem;
	}
	.ferie-error {
		color: hsl(0 70% 70%);
		font-size: 0.85rem;
	}
	.ferie-saved {
		color: hsl(150 50% 65%);
		font-size: 0.85rem;
	}

	/* Oppsett */
	.ferie-setup {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.85rem;
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 12px;
	}
	.ferie-window {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.ferie-note-field {
		flex: 1 1 220px;
	}
	.ferie-note-field input {
		width: 100%;
	}
	.ferie-window label,
	.bulk-form label {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		font-size: 0.8rem;
		color: var(--tp-text-soft);
	}
	input[type='date'],
	input[type='text'],
	select {
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		color: var(--tp-text);
		border-radius: 8px;
		padding: 0.4rem 0.55rem;
		font-size: 0.9rem;
	}

	.ferie-members-row {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.member-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		border-radius: 999px;
		padding: 0.2rem 0.5rem 0.2rem 0.3rem;
		font-size: 0.85rem;
	}
	.member-chip.adult {
		border-color: var(--tp-border-strong);
	}
	.member-role,
	.member-remove {
		background: none;
		border: none;
		cursor: pointer;
		color: var(--tp-text-soft);
		padding: 0;
		font-size: 0.95rem;
		line-height: 1;
	}
	.member-remove {
		font-size: 1.1rem;
		color: var(--tp-text-muted);
	}
	.member-add-toggle {
		background: var(--tp-accent-bg);
		border: 1px solid var(--tp-border-strong);
		color: var(--tp-text);
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.member-editor {
		margin-top: 0.6rem;
		padding-top: 0.6rem;
		border-top: 1px solid var(--tp-border);
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.member-editor-label {
		margin: 0.2rem 0 0;
		font-size: 0.75rem;
		color: var(--tp-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.person-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.person-pick {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		color: var(--tp-text);
		border-radius: 999px;
		padding: 0.25rem 0.6rem;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.person-pick.added {
		opacity: 0.45;
		cursor: default;
	}
	.member-manual {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
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
	.ferie-btn-primary {
		background: var(--tp-accent-bg);
	}

	/* Sammendrag */
	.ferie-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: center;
	}
	.summary-stat {
		display: flex;
		flex-direction: column;
		padding: 0.5rem 0.85rem;
		border-radius: 10px;
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		min-width: 90px;
	}
	.summary-stat.has-gap {
		background: hsl(0 45% 22%);
		border-color: hsl(0 55% 40%);
	}
	.summary-stat.covered {
		background: hsl(35 45% 22%);
		border-color: hsl(35 55% 40%);
	}
	.summary-num {
		font-size: 1.4rem;
		font-weight: 700;
		line-height: 1;
	}
	.summary-label {
		font-size: 0.75rem;
		color: var(--tp-text-soft);
	}

	/* Palett */
	.ferie-palette {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.75rem;
		flex-wrap: wrap;
	}
	.palette-group {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.palette-title {
		font-size: 0.8rem;
		color: var(--tp-text-muted);
	}
	.paint-chip {
		border: 1px solid var(--tp-border);
		background: var(--tp-bg-1);
		color: var(--tp-text);
		border-radius: 999px;
		padding: 0.28rem 0.65rem;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.paint-chip.active {
		outline: 2px solid var(--tp-accent);
		outline-offset: 1px;
	}
	.paint-chip.hole {
		border-color: hsl(0 55% 45%);
	}
	.paint-chip.fill {
		border-color: hsl(140 45% 42%);
	}
	.paint-chip.adult-off {
		border-color: hsl(205 55% 50%);
	}
	.palette-switch {
		display: inline-flex;
		border: 1px solid var(--tp-border);
		border-radius: 8px;
		overflow: hidden;
	}
	.palette-switch button {
		background: var(--tp-bg-1);
		border: none;
		color: var(--tp-text-soft);
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.palette-switch button.active {
		background: var(--tp-accent-bg);
		color: var(--tp-text);
	}

	/* Bulk */
	.ferie-bulk summary {
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--tp-text-soft);
	}
	.bulk-form {
		display: flex;
		gap: 0.6rem;
		flex-wrap: wrap;
		align-items: flex-end;
		margin-top: 0.6rem;
	}

	/* Kalender-grid */
	.ferie-grid-wrap {
		overflow-x: auto;
		border: 1px solid var(--tp-border);
		border-radius: 12px;
	}
	.ferie-grid {
		border-collapse: collapse;
		width: 100%;
		font-size: 0.82rem;
	}
	.ferie-grid th,
	.ferie-grid td {
		border-bottom: 1px solid var(--tp-border);
		border-right: 1px solid var(--tp-border);
		padding: 0.3rem 0.4rem;
		text-align: center;
		white-space: nowrap;
	}
	.col-member {
		min-width: 84px;
		color: var(--tp-text-soft);
		font-weight: 600;
	}
	.col-member.adult {
		background: var(--tp-bg-2);
	}
	.th-role {
		margin-right: 0.2rem;
	}
	.sticky-col {
		position: sticky;
		left: 0;
		z-index: 1;
		background: var(--tp-bg-2);
		text-align: left;
		min-width: 72px;
	}
	thead .sticky-col {
		z-index: 2;
	}
	.col-date {
		display: flex;
		flex-direction: column;
		line-height: 1.1;
	}
	.date-day {
		color: var(--tp-text-soft);
	}
	.date-num {
		font-size: 0.72rem;
		color: var(--tp-text-muted);
	}
	.week-row td {
		background: var(--tp-bg-1);
		text-align: left;
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--tp-text-muted);
		padding: 0.2rem 0.5rem;
	}
	tr.weekend td {
		background: hsl(150 22% 16%);
	}
	tr.weekend .sticky-col {
		background: hsl(150 22% 16%);
	}
	.cell {
		cursor: pointer;
		min-width: 84px;
		font-size: 0.72rem;
	}
	.cell.gap {
		background: hsl(0 55% 40%);
		color: hsl(0 30% 96%);
	}
	.cell.covered {
		background: hsl(35 55% 38%);
		color: hsl(35 30% 96%);
	}
	.cell.fill {
		background: hsl(140 40% 32%);
		color: hsl(140 25% 96%);
	}
	.cell.adult-off {
		background: hsl(205 45% 36%);
		color: hsl(205 25% 96%);
	}
	.cell.default {
		background: transparent;
	}
	.cell:hover {
		outline: 2px solid var(--tp-accent);
		outline-offset: -2px;
	}

	/* Tegnforklaring */
	.ferie-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.6rem;
		font-size: 0.6rem;
		color: var(--tp-text-muted);
		letter-spacing: 0.02em;
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.2rem;
	}
	.sw {
		width: 10px;
		height: 10px;
		border-radius: 2px;
		display: inline-block;
	}
	.sw.gap { background: hsl(0 55% 40%); }
	.sw.covered { background: hsl(35 55% 38%); }
	.sw.fill { background: hsl(140 40% 32%); }
	.sw.adult-off { background: hsl(205 45% 36%); }
	.sw.default { background: var(--tp-bg-1); }

	.ferie-empty {
		padding: 1.5rem;
		text-align: center;
		color: var(--tp-text-soft);
		background: var(--tp-bg-2);
		border: 1px dashed var(--tp-border);
		border-radius: 12px;
	}
	.ferie-saved-at {
		font-size: 0.75rem;
		color: var(--tp-text-muted);
		margin: 0;
	}

	/* Kompakt oversikt */
	.compact-grid-wrap {
		overflow-x: auto;
	}
	.compact-grid {
		border-collapse: collapse;
		width: 100%;
		table-layout: fixed;
		font-size: 0.78rem;
	}
	.compact-grid th,
	.compact-grid td {
		padding: 0.3rem 0.15rem;
		text-align: center;
		white-space: nowrap;
	}
	.compact-week-col {
		text-align: left;
		white-space: nowrap;
		background: var(--tp-bg-2);
		position: sticky;
		left: 0;
		z-index: 1;
		padding: 0.3rem 0.35rem;
		width: 2.2rem;
		overflow: hidden;
	}
	.compact-week-num {
		font-weight: 500;
		font-size: 0.75rem;
		color: var(--tp-text-soft);
		font-variant-numeric: tabular-nums;
	}
	.expanded-day-label {
		text-align: center !important;
		font-size: 0.6rem;
		font-weight: 400;
		color: var(--tp-text-muted);
		letter-spacing: 0.02em;
		opacity: 0.7;
	}
	.day-date-overlay {
		font-size: 0.5rem;
		font-weight: 400;
		font-variant-numeric: tabular-nums;
		color: rgba(255, 255, 255, 0.35);
		pointer-events: none;
	}
	.compact-member-col {
		font-weight: 400;
		color: var(--tp-text-muted);
		font-size: 0.65rem;
		letter-spacing: 0.03em;
		text-transform: uppercase;
		padding: 0.25rem 0.15rem 0.4rem;
	}
	.compact-member-col.adult {
		color: var(--tp-text-muted);
	}
	.compact-cell {
		padding: 0.3rem 0.15rem;
	}
	.day-bars {
		display: flex;
		gap: 1px;
		height: 18px;
	}
	.day-bar {
		flex: 1;
		border-radius: 2px;
	}
	.day-bar.gap { background: hsl(0 55% 45%); }
	.day-bar.covered { background: hsl(35 55% 42%); }
	.day-bar.fill { background: hsl(140 40% 36%); }
	.day-bar.trip { background: hsl(265 40% 42%); }
	.day-bar.adult-off { background: hsl(205 45% 40%); }
	.day-bar.default { background: var(--tp-bg-1); }

	.compact-week-row {
		cursor: pointer;
	}
	.compact-week-row:hover .compact-week-num {
		color: var(--tp-accent);
	}
	.expanded-day-row td {
		font-size: 0.72rem;
		padding: 0.1rem 0.15rem;
		min-width: 0;
	}
	.expanded-cell {
		padding: 0.1rem 0.2rem;
	}
	.day-pill {
		display: block;
		height: 18px;
		border-radius: 3px;
		line-height: 18px;
	}
	.day-pill.gap { background: hsl(0 55% 45%); }
	.day-pill.covered { background: hsl(35 55% 42%); }
	.day-pill.fill { background: hsl(140 40% 36%); }
	.day-pill.trip { background: hsl(265 40% 42%); }
	.day-pill.adult-off { background: hsl(205 45% 40%); }
	.day-pill.default { background: var(--tp-bg-1); }
	/* Reise-overlay i kalenderen */
	.date-trip {
		margin-left: 0.25rem;
		font-size: 0.75rem;
	}
	tr.has-trip .sticky-col {
		box-shadow: inset 3px 0 0 var(--tp-accent);
	}

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

	/* View-bryter (faser) */
	.view-switch {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--tp-border);
	}
	.view-switch button {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--tp-text-soft);
		padding: 0.5rem 0.75rem;
		font: inherit;
		font-size: 0.9rem;
		cursor: pointer;
	}
	.view-switch button.active {
		color: var(--tp-text);
		border-bottom-color: var(--tp-accent);
	}

	/* Wizard */
	.wizard {
		border-top: 1px solid var(--tp-border);
		padding-top: 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.wizard-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}
	.wizard-title {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--tp-text-soft);
	}
	.wizard-table {
		border-collapse: collapse;
		font-size: 0.82rem;
	}
	.wizard-table th {
		text-align: left;
		font-weight: 600;
		color: var(--tp-text-muted);
		font-size: 0.72rem;
		padding: 0.2rem 0.4rem;
	}
	.wizard-table td {
		padding: 0.2rem 0.4rem;
	}
	.wiz-role {
		margin-right: 0.2rem;
	}
	.wizard-hint {
		margin: 0;
		font-size: 0.75rem;
		color: var(--tp-text-muted);
	}

	/* Reise — bortreist-celle */
	.cell.trip {
		background: hsl(265 40% 38%);
		color: hsl(265 25% 96%);
	}
	.sw.trip { background: hsl(265 40% 38%); }

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
	.task-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.task-item {
		width: 100%;
		text-align: left;
		background: var(--tp-bg-1);
		border: 1px solid var(--tp-border);
		color: var(--tp-text);
		border-radius: 8px;
		padding: 0.45rem 0.6rem;
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.task-item.gap {
		border-color: hsl(0 55% 45%);
	}
	.task-item.diary::before {
		content: '✍️ ';
	}
	.task-item.trip::before {
		content: '🧳 ';
	}

	/* Ferie-dashboards (Gjennomfør) */
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
