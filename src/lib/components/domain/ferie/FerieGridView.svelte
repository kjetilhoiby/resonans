<!--
  FerieGridView — «Rammer»-visningen i FerieDashboard.

  Viser oppsett (ferievindu + medlemmer), kompakt ukeoversikt med
  ekspanderbare uker, og fullstendig redigeringskalender med palett,
  bulk-verktøy og celle-maling.

  Props:
    members / grid / trips / startDate / endDate / note – bindable tilstand
    days / childIds / adultIds / weekSummaries – avledede verdier fra forelder
    editing / editMembers – UI-tilstand (bindable)
    onWindowChange / onScheduleSave – callbacks for mutasjoner
-->
<script lang="ts">
	import type { FerieMember, FerieCell, FerieTrip } from '../FerieDashboard.svelte';

	type FerieRole = 'voksen' | 'barn';
	type StatusMeta = { value: string; label: string; emoji: string; short: string; role: FerieRole; cls: string };

	interface DayEntry {
		iso: string;
		weekday: string;
		dayMonth: string;
		week: number;
		isWeekend: boolean;
	}

	interface WeekSummary {
		week: number;
		dateRange: string;
		days: DayEntry[];
		members: Record<string, { gaps: number; covered: number; fills: number; trips: number; off: number; total: number }>;
	}

	interface PersonRow {
		id: string;
		name: string;
		kind: string;
		avatarEmoji?: string | null;
	}

	interface Props {
		members: FerieMember[];
		grid: Record<string, Record<string, FerieCell>>;
		trips: FerieTrip[];
		startDate: string;
		endDate: string;
		note: string;
		days: DayEntry[];
		childIds: string[];
		adultIds: string[];
		weekSummaries: WeekSummary[];
		gapCount: number;
		editing: boolean;
		editMembers: boolean;
		onStartDateChange: (value: string) => void;
		onEndDateChange: (value: string) => void;
		onNoteChange: (value: string) => void;
		onScheduleSave: () => void;
		onSetCell: (memberId: string, iso: string, status: string | null) => void;
		onApplyBulk: (status: string, from: string, to: string, target: string) => void;
		onAddPerson: (p: PersonRow) => void;
		onAddManualMember: (name: string, role: FerieRole) => void;
		onRemoveMember: (id: string) => void;
		onToggleMemberRole: (id: string) => void;
		onSetEditing: (value: boolean) => void;
		onSetEditMembers: (value: boolean) => void;
	}

	let {
		members, grid, trips, startDate, endDate, note,
		days, childIds, adultIds, weekSummaries, gapCount,
		editing, editMembers,
		onStartDateChange, onEndDateChange, onNoteChange,
		onScheduleSave, onSetCell, onApplyBulk,
		onAddPerson, onAddManualMember, onRemoveMember, onToggleMemberRole,
		onSetEditing, onSetEditMembers
	}: Props = $props();

	/* ── Status-definisjoner ────────────────────────────── */
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

	/* ── Lokal UI-tilstand ─────────────────────────────── */
	let activePaint = $state<string>('stengt');
	let bulkFrom = $state('');
	let bulkTo = $state('');
	let bulkTarget = $state<string>('barn');
	let expandedWeeks = $state<Set<number>>(new Set());
	let newMemberName = $state('');
	let newMemberRole = $state<FerieRole>('barn');

	/* Person-henting */
	let availablePersons = $state<PersonRow[]>([]);
	let personsLoaded = $state(false);

	/* Wizard */
	let wizardRanges = $state<Record<string, { from: string; to: string }>>({});

	/* ── Avledede ───────────────────────────────────────── */
	const hasWindow = $derived(days.length > 0);
	const paletteList = $derived(activePaint && STATUS_META[activePaint]?.role === 'voksen' ? ADULT_STATUSES : CHILD_STATUSES);

	/* ── Hjelpefunksjoner ──────────────────────────────── */
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

	function cellLabel(member: FerieMember, iso: string): string {
		const s = grid[member.id]?.[iso]?.status;
		if (!s) return '';
		return STATUS_META[s]?.short ?? s;
	}

	function initials(name: string): string {
		const parts = name.trim().split(/\s+/);
		if (parts.length === 1) return parts[0].slice(0, 2);
		return parts.map(p => p[0]).join('').toUpperCase();
	}

	function tripForDate(iso: string): FerieTrip | null {
		for (const t of trips) {
			if (t.startDate && t.endDate && iso >= t.startDate && iso <= t.endDate) return t;
		}
		return null;
	}

	function toggleWeek(week: number) {
		const next = new Set(expandedWeeks);
		if (next.has(week)) next.delete(week); else next.add(week);
		expandedWeeks = next;
	}

	function personIsAdded(id: string): boolean {
		return members.some((m) => m.personId === id);
	}

	function roleFromKind(kind: string): FerieRole {
		return kind === 'child' ? 'barn' : 'voksen';
	}

	/* ── Mutasjoner (delegert via callbacks) ────────────── */
	function paintCell(member: FerieMember, iso: string) {
		if (activePaint === 'clear') {
			onSetCell(member.id, iso, null);
			return;
		}
		const meta = STATUS_META[activePaint];
		if (!meta || meta.role !== member.role) return;
		if (grid[member.id]?.[iso]?.status === activePaint) {
			onSetCell(member.id, iso, null);
		} else {
			onSetCell(member.id, iso, activePaint);
		}
	}

	function lagHullet() {
		onApplyBulk('stengt', startDate, endDate, 'barn');
	}

	function applyBulkFromForm() {
		onApplyBulk(activePaint, bulkFrom || startDate, bulkTo || endDate, bulkTarget);
	}

	function handleAddManualMember() {
		const name = newMemberName.trim();
		if (!name) return;
		onAddManualMember(name, newMemberRole);
		newMemberName = '';
	}

	async function fetchPersons() {
		if (personsLoaded) return;
		try {
			const res = await fetch('/api/persons');
			if (res.ok) {
				const data = (await res.json()) as { persons: PersonRow[] };
				availablePersons = data.persons ?? [];
			}
		} catch {
			// valgfritt
		} finally {
			personsLoaded = true;
		}
	}

	function toggleEditMembers() {
		const next = !editMembers;
		onSetEditMembers(next);
		if (next) void fetchPersons();
	}

	/* ── Wizard ────────────────────────────────────────── */
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
			onApplyBulk(m.role === 'voksen' ? 'hjemme' : 'stengt', from, to, m.id);
		}
	}
</script>

{#if !hasWindow || members.length === 0 || editing}
<!-- Ferievindu + medlemmer (alltid synlig i redigering, eller ved tom tilstand) -->
<section class="ferie-setup">
	<div class="ferie-window">
		<label>
			<span>Fra</span>
			<input type="date" value={startDate} onchange={(e) => onStartDateChange(e.currentTarget.value)} />
		</label>
		<label>
			<span>Til</span>
			<input type="date" value={endDate} onchange={(e) => onEndDateChange(e.currentTarget.value)} />
		</label>
		<label class="ferie-note-field">
			<span>Foreløpig</span>
			<input
				type="text"
				placeholder="f.eks. Volda med Marte og David"
				value={note}
				onchange={(e) => onNoteChange(e.currentTarget.value)}
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
						onclick={() => onToggleMemberRole(m.id)}
					>{m.role === 'voksen' ? '🧑' : '🧒'}</button>
					<span class="member-name">{m.name}</span>
					<button type="button" class="member-remove" title="Fjern" onclick={() => onRemoveMember(m.id)}>×</button>
				</span>
			{/each}
			<button
				type="button"
				class="member-add-toggle"
				onclick={toggleEditMembers}
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
								onclick={() => onAddPerson(p)}
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
						onkeydown={(e) => { if (e.key === 'Enter') handleAddManualMember(); }}
					/>
					<select bind:value={newMemberRole}>
						<option value="barn">Barn</option>
						<option value="voksen">Voksen</option>
					</select>
					<button type="button" class="ferie-btn" onclick={handleAddManualMember}>Legg til</button>
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
		<button type="button" class="ferie-btn" class:ferie-btn-primary={editing} onclick={() => onSetEditing(!editing)}>
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
{/if}

<style>
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

	/* Reise — bortreist-celle */
	.cell.trip {
		background: hsl(265 40% 38%);
		color: hsl(265 25% 96%);
	}
	.sw.trip { background: hsl(265 40% 38%); }

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
</style>
