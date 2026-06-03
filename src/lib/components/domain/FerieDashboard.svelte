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

	export interface FerieTrip {
		id: string;
		label: string;
		place?: string;
		startDate?: string;
		endDate?: string;
		linkedThemeId?: string;
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
		ferieProfile?.grid ? structuredClone(ferieProfile.grid) : {}
	);
	let trips = $state<FerieTrip[]>(ferieProfile?.trips ? [...ferieProfile.trips] : []);

	let activePaint = $state<string>('stengt');
	let editMembers = $state(false);

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

	function adultsHomeOn(iso: string): boolean {
		return adultIds.some((id) => {
			const s = grid[id]?.[iso]?.status;
			return s === 'ferie' || s === 'hjemme';
		});
	}

	// 'gap' | 'covered' | 'fill' | 'adult-off' | 'default'
	function cellState(member: FerieMember, iso: string): string {
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
				if (grid[id]?.[day.iso]?.status === 'stengt' && adultsHomeOn(day.iso)) n++;
			}
		}
		return n;
	});

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

	function personIsAdded(id: string): boolean {
		return members.some((m) => m.personId === id);
	}

	/* ── Lagring (debounced) ────────────────────────────── */
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saving = $state(false);
	let saveError = $state('');
	let lastSavedAt = $state<string | null>(null);

	function scheduleSave() {
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), 800);
	}

	async function save() {
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
				body: JSON.stringify(profile)
			});
			if (!res.ok) throw new Error('Lagring feilet');
			ferieProfile = profile;
			lastSavedAt = new Date().toISOString();
			onProfileSaved?.(profile);
		} catch {
			saveError = 'Klarte ikke lagre. Prøv igjen.';
		} finally {
			saving = false;
		}
	}

	function onWindowChange() {
		scheduleSave();
	}

	onDestroy(() => {
		if (saveTimer) clearTimeout(saveTimer);
	});

	const hasWindow = $derived(days.length > 0);
	const paletteList = $derived(activePaint && STATUS_META[activePaint]?.role === 'voksen' ? ADULT_STATUSES : CHILD_STATUSES);
</script>

<div class="ferie">
	<!-- Toppstatus -->
	<header class="ferie-head">
		<div class="ferie-head-title">
			<span class="ferie-emoji">{themeEmoji ?? '🏖️'}</span>
			<h2>Oppholdsplan</h2>
		</div>
		<div class="ferie-head-status">
			{#if saving}
				<span class="ferie-saving">Lagrer…</span>
			{:else if saveError}
				<span class="ferie-error">{saveError}</span>
			{/if}
		</div>
	</header>

	<!-- Ferievindu + medlemmer -->
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
	</section>

	{#if !hasWindow}
		<div class="ferie-empty">
			<p>Sett en startdato og sluttdato for ferien for å bygge oppholdsplanen.</p>
		</div>
	{:else if members.length === 0}
		<div class="ferie-empty">
			<p>Legg til familiemedlemmer (barn og voksne) for å begynne å planlegge dekningen.</p>
		</div>
	{:else}
		<!-- Hull-teller -->
		<section class="ferie-summary">
			<div class="summary-stat" class:has-gap={gapCount > 0}>
				<span class="summary-num">{gapCount}</span>
				<span class="summary-label">barn-dager mangler dekning</span>
			</div>
			{#if coveredByParentCount > 0}
				<div class="summary-stat covered">
					<span class="summary-num">{coveredByParentCount}</span>
					<span class="summary-label">dekkes av forelder hjemme</span>
				</div>
			{/if}
			{#if childIds.length > 0}
				<button type="button" class="ferie-btn ferie-btn-primary" onclick={lagHullet}>
					🚫 Lag hullet — marker stengt for alle barn i hele perioden
				</button>
			{/if}
		</section>

		<!-- Palett -->
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

		<!-- Bulk -->
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

		<!-- Dekningskalender -->
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

		<!-- Tegnforklaring -->
		<div class="ferie-legend">
			<span class="legend-item"><i class="sw gap"></i> Mangler dekning</span>
			<span class="legend-item"><i class="sw covered"></i> Dekket av forelder</span>
			<span class="legend-item"><i class="sw fill"></i> Alternativt tilbud</span>
			<span class="legend-item"><i class="sw adult-off"></i> Voksen ferie/hjemme</span>
			<span class="legend-item"><i class="sw default"></i> Normal dekning</span>
		</div>
		{#if lastSavedAt}
			<p class="ferie-saved-at">Sist lagret: {new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(lastSavedAt))}</p>
		{/if}
	{/if}

	{#if hasWindow}
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
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	{#if hasWindow}
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
		gap: 0.75rem;
		font-size: 0.75rem;
		color: var(--tp-text-soft);
	}
	.legend-item {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
	}
	.sw {
		width: 14px;
		height: 14px;
		border-radius: 3px;
		display: inline-block;
		border: 1px solid var(--tp-border);
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
</style>
