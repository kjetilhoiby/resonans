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
	// Ferie-typene bor i trip-api.ts — re-eksporteres her for bakoverkompatibilitet.
	export type {
		FerieRole,
		FerieMember,
		FerieTripStop,
		FerieTrip,
		FerieCell,
		FerieProfile
	} from './trip-api';
</script>

<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import TripPlanningSection from './ferie/TripPlanningSection.svelte';
	import FerieGridView from './ferie/FerieGridView.svelte';
	import FerieExecutionView from './ferie/FerieExecutionView.svelte';
	import {
		tripApi,
		type TripApi,
		type FerieRole,
		type FerieMember,
		type FerieTrip,
		type FerieCell,
		type FerieProfile,
		type PersonRow
	} from './trip-api';

	type FerieView = 'rammer' | 'reiser' | 'gjennomfor';

	interface Props {
		themeId: string;
		themeEmoji?: string | null;
		ferieProfile: FerieProfile | null;
		onProfileSaved?: (profile: FerieProfile) => void;
		api?: TripApi;
	}

	let { themeId, themeEmoji = null, ferieProfile = $bindable(null), onProfileSaved, api = tripApi }: Props = $props();

	/* ── Status-definisjoner (for gapCount-beregning) ──── */
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
	let gapAckCount = $state<number | undefined>(ferieProfile?.gapAckCount);

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

	function adultsHomeOn(iso: string): boolean {
		return adultIds.some((id) => {
			const s = grid[id]?.[iso]?.status;
			return (s === 'ferie' || s === 'hjemme') && !memberOnTrip(id, iso);
		});
	}

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

	const gapCount = $derived.by(() => {
		let n = 0;
		for (const day of days) {
			if (day.isWeekend) continue;
			for (const id of childIds) {
				if (memberOnTrip(id, day.iso)) continue;
				if (grid[id]?.[day.iso]?.status === 'stengt' && !adultsHomeOn(day.iso)) n++;
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
				let gaps = 0, covered = 0, fills = 0, tripDays = 0, off = 0;
				for (const d of wdays) {
					const cs = cellState(m, d.iso);
					if (cs === 'gap') gaps++;
					else if (cs === 'covered') covered++;
					else if (cs === 'fill') fills++;
					else if (cs === 'trip') tripDays++;
					else if (cs === 'adult-off') off++;
				}
				memberStats[m.id] = { gaps, covered, fills, trips: tripDays, off, total: wdays.length };
			}
			out.push({ week, dateRange: `${first.dayMonth}–${last.dayMonth}`, days: wdays, members: memberStats });
		}
		return out;
	});

	const hasWindow = $derived(days.length > 0);

	/* ── Mutasjoner ─────────────────────────────────────── */
	function setCell(memberId: string, iso: string, status: string | null) {
		const memberGrid = { ...(grid[memberId] ?? {}) };
		if (status === null) delete memberGrid[iso];
		else memberGrid[iso] = { status };
		grid = { ...grid, [memberId]: memberGrid };
		scheduleSave();
	}

	function applyBulk(status: string, from: string, to: string, target: string) {
		if (!from || !to) return;
		const STATUS_META: Record<string, { role: FerieRole }> = {
			stengt: { role: 'barn' }, sommerskole: { role: 'barn' }, fotballskole: { role: 'barn' },
			svommeskole: { role: 'barn' }, sommeraks: { role: 'barn' }, besteforeldre: { role: 'barn' },
			leir: { role: 'barn' }, annet: { role: 'barn' },
			ferie: { role: 'voksen' }, hjemme: { role: 'voksen' }
		};
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

	function handleTripsChanged() {
		scheduleSave();
	}

	/* ── Medlemmer ──────────────────────────────────────── */
	function roleFromKind(kind: string): FerieRole {
		return kind === 'child' ? 'barn' : 'voksen';
	}

	function addPerson(p: PersonRow) {
		if (members.some((m) => m.personId === p.id)) return;
		members = [...members, { id: p.id, personId: p.id, name: p.name, role: roleFromKind(p.kind) }];
		scheduleSave();
	}

	function addManualMember(name: string, role: FerieRole) {
		members = [...members, { id: crypto.randomUUID(), name, role }];
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

	/* ── Lagring (debounced) ────────────────────────────── */
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saving = $state(false);
	let saveError = $state('');
	let lastSavedAt = $state<string | null>(null);
	let pendingSave = false;

	function scheduleSave() {
		pendingSave = true;
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => void save(), 800);
	}

	function buildPayload() {
		return {
			startDate: startDate || null,
			endDate: endDate || null,
			note: note.trim() || null,
			members,
			grid,
			trips,
			gapAckCount: gapAckCount ?? null
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
			trips: trips.length > 0 ? trips : undefined,
			gapAckCount
		};
		try {
			const res = await api.saveFerieProfile(themeId, buildPayload(), {
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
		<FerieGridView
			{members}
			{grid}
			{trips}
			{startDate}
			{endDate}
			{note}
			{days}
			{childIds}
			{adultIds}
			{weekSummaries}
			{gapCount}
			{editing}
			{editMembers}
			onStartDateChange={(v) => { startDate = v; onWindowChange(); }}
			onEndDateChange={(v) => { endDate = v; onWindowChange(); }}
			onNoteChange={(v) => { note = v; onWindowChange(); }}
			onScheduleSave={scheduleSave}
			onSetCell={setCell}
			onApplyBulk={applyBulk}
			onAddPerson={addPerson}
			onAddManualMember={addManualMember}
			onRemoveMember={removeMember}
			onToggleMemberRole={toggleMemberRole}
			onSetEditing={(v) => (editing = v)}
			onSetEditMembers={(v) => (editMembers = v)}
			{api}
		/>
		{#if lastSavedAt && hasWindow && members.length > 0}
			<p class="ferie-saved-at">Sist lagret: {new Intl.DateTimeFormat('nb-NO', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(lastSavedAt))}</p>
		{/if}
	{:else if view === 'reiser'}
		{#if !hasWindow}
			<div class="ferie-empty"><p>Sett ferievinduet under «Rammer» først.</p></div>
		{:else}
			<TripPlanningSection
				{themeId}
				{members}
				bind:trips
				{startDate}
				{endDate}
				onTripsChanged={handleTripsChanged}
				{api}
			/>
		{/if}
	{:else}
		{#if !hasWindow}
			<div class="ferie-empty"><p>Sett ferievinduet under «Rammer» først.</p></div>
		{:else}
			<FerieExecutionView
				{themeId}
				{themeEmoji}
				{startDate}
				{endDate}
				{days}
				{trips}
				{gapCount}
				{gapAckCount}
				onDismissGap={() => { gapAckCount = gapCount; scheduleSave(); }}
				onNavigate={(v) => (view = v)}
				{api}
			/>
		{/if}
	{/if}
</div>

<style>
	.ferie {
		/* Reise-domenets palett — reskin-hook. Brukes som var(--trip-*, fallback)
		   i Trip- og Ferie-komponentene (fallback = samme verdi). */
		--trip-btn-border: #444;
		--trip-btn-text: #ccc;
		--trip-text-bright: #fff;
		--trip-precip: #5b9bd8;
		--trip-card-bg: #0f1419;
		--trip-card-border: #1a1f2e;
		--trip-border-strong: #2d3748;
		--trip-text-emphasis: #e2e8f0;
		--trip-text-strong: #cbd5e1;
		--trip-text-secondary: #94a3b8;
		--trip-text-muted: #64748b;
		--trip-text-faint: #475569;
		--trip-danger: #f87171;

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
</style>
