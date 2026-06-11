<script lang="ts">
	import DateInput from '$lib/components/ui/DateInput.svelte';

	interface SignalFlagDisplay {
		flag: 'red' | 'yellow' | 'green' | 'unknown';
		label: string;
	}

	interface ReadinessSignals {
		sleep?: { score: number | null; nights: Array<{ date: string; score: number | null }>; flag: string };
		egenfrekvens?: { level: number | null; balance: number | null; loggedAt: string | null; flag: string };
		sick?: { active: boolean; until: string | null };
		crunch?: { active: boolean; until: string | null };
		trip?: { active: boolean; themeId: string | null; destination: string | null; endDate: string | null };
	}

	interface AlternativeExercise {
		exerciseName: string;
		sets: number;
		repsTarget?: number;
		durationSecondsTarget?: number;
		notes?: string;
	}

	interface Alternative {
		kind: 'strength' | 'run' | 'rest';
		name: string;
		summary: string;
		plannedRun?: {
			runType: string;
			targetDistanceMeters?: number;
			targetDurationSeconds?: number;
			paceHintSecPerKm?: number;
			hrZoneHint?: string;
			notes?: string;
		};
		plannedExercises?: AlternativeExercise[];
		rationale: string;
	}

	interface ReadinessProps {
		readinessState: 'klar' | 'lett' | 'easy' | 'rest';
		reasons: string[];
		signals: ReadinessSignals;
		alternative: Alternative | null;
		hasPlannedSession: boolean;
		programId: string;
		date: string;
		userChoice?: 'alternative' | 'original' | null;
		onChoiceMade?: (choice: 'alternative' | 'original') => void;
	}

	let {
		readinessState,
		reasons,
		signals,
		alternative,
		hasPlannedSession,
		programId,
		date,
		userChoice = null,
		onChoiceMade
	}: ReadinessProps = $props();

	let savingChoice = $state(false);
	let localChoice = $state<'alternative' | 'original' | null>(userChoice);

	let editingFlags = $state(false);
	let savingFlags = $state(false);
	let localSick = $state<{ active: boolean; until: string | null }>(signals.sick ?? { active: false, until: null });
	let localCrunch = $state<{ active: boolean; until: string | null }>(signals.crunch ?? { active: false, until: null });

	function defaultUntil(daysAhead: number): string {
		const d = new Date();
		d.setDate(d.getDate() + daysAhead);
		return d.toISOString().slice(0, 10);
	}

	function toggleSick() {
		if (localSick.active) {
			localSick = { active: false, until: null };
		} else {
			localSick = { active: true, until: defaultUntil(5) };
		}
	}
	function toggleCrunch() {
		if (localCrunch.active) {
			localCrunch = { active: false, until: null };
		} else {
			localCrunch = { active: true, until: defaultUntil(7) };
		}
	}

	async function saveFlags() {
		if (savingFlags) return;
		savingFlags = true;
		try {
			const body = {
				sickUntil: localSick.active ? localSick.until : null,
				crunchUntil: localCrunch.active ? localCrunch.until : null
			};
			const res = await fetch('/api/tilstand/flag', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				editingFlags = false;
				// Reload data slik at readiness rekjøres med nye flagg
				const { invalidateAll } = await import('$app/navigation');
				await invalidateAll();
			}
		} finally {
			savingFlags = false;
		}
	}

	const stateMeta = $derived.by(() => {
		switch (readinessState) {
			case 'klar':
				return { dot: '🟢', label: 'Klar', tone: 'klar' };
			case 'lett':
				return { dot: '🟡', label: 'Lett på', tone: 'lett' };
			case 'easy':
				return { dot: '🟠', label: 'Easy-dag', tone: 'easy' };
			case 'rest':
				return { dot: '🔴', label: 'Hvile', tone: 'rest' };
		}
	});

	function pillLabel(flag: string | undefined): SignalFlagDisplay {
		switch (flag) {
			case 'red':
				return { flag: 'red', label: 'rød' };
			case 'yellow':
				return { flag: 'yellow', label: 'gul' };
			case 'green':
				return { flag: 'green', label: 'grønn' };
			default:
				return { flag: 'unknown', label: '–' };
		}
	}

	const sleepPill = $derived(pillLabel(signals.sleep?.flag));
	const egenPill = $derived(pillLabel(signals.egenfrekvens?.flag));

	function fmtMeters(m?: number): string {
		if (!m) return '';
		return `${(m / 1000).toFixed(1)} km`;
	}
	function fmtSeconds(s?: number): string {
		if (!s) return '';
		const min = Math.round(s / 60);
		return `${min} min`;
	}
	function fmtPace(s?: number): string {
		if (!s) return '';
		const m = Math.floor(s / 60);
		const r = Math.round(s - m * 60);
		return `${m}:${r.toString().padStart(2, '0')}/km`;
	}

	async function setChoice(choice: 'alternative' | 'original') {
		if (savingChoice || localChoice === choice) return;
		savingChoice = true;
		try {
			const res = await fetch(`/api/apps/programs/${programId}/readiness-choice`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ choice, date })
			});
			if (res.ok) {
				localChoice = choice;
				onChoiceMade?.(choice);
			}
		} finally {
			savingChoice = false;
		}
	}
</script>

<section class="readiness-strip tone-{stateMeta.tone}" aria-label="Tilstand for dagens økt">
	<header class="head">
		<div class="state-tag">
			<span class="dot">{stateMeta.dot}</span>
			<span class="state-label">I dag: {stateMeta.label}</span>
		</div>
		<div class="pills">
			{#if signals.sleep && signals.sleep.score !== null}
				<span class="pill pill-{sleepPill.flag}">
					Søvn {signals.sleep.score}
				</span>
			{:else}
				<span class="pill pill-unknown">Søvn –</span>
			{/if}
			{#if signals.egenfrekvens && signals.egenfrekvens.level !== null}
				<span class="pill pill-{egenPill.flag}">
					Egenfrekvens {signals.egenfrekvens.level}/5
				</span>
			{:else}
				<span class="pill pill-unknown">Egenfrekvens –</span>
			{/if}
			{#if signals.sick?.active}
				<span class="pill pill-sick">Syk t.o.m. {signals.sick.until}</span>
			{/if}
			{#if signals.crunch?.active}
				<span class="pill pill-crunch">Crunch t.o.m. {signals.crunch.until}</span>
			{/if}
			{#if signals.trip?.active && signals.trip.destination}
				<span class="pill pill-trip">📍 {signals.trip.destination}</span>
			{/if}
		</div>
	</header>

	{#if reasons.length > 0}
		<p class="reasons">{reasons.join(' · ')}</p>
	{/if}

	<div class="flags-row">
		{#if !editingFlags}
			<button class="flags-edit" onclick={() => (editingFlags = true)}>
				{signals.sick?.active || signals.crunch?.active ? 'Endre tilstand-flagg' : 'Sett syk / crunch'}
			</button>
		{:else}
			<div class="flags-editor">
				<label class="flag-row">
					<input type="checkbox" checked={localSick.active} onchange={toggleSick} />
					<span>Syk</span>
					{#if localSick.active}
						<DateInput
							value={localSick.until ?? ''}
							onChange={(e) => (localSick = { active: true, until: e.currentTarget.value })}
							min={new Date().toISOString().slice(0, 10)}
						/>
					{/if}
				</label>
				<label class="flag-row">
					<input type="checkbox" checked={localCrunch.active} onchange={toggleCrunch} />
					<span>Crunch-periode</span>
					{#if localCrunch.active}
						<DateInput
							value={localCrunch.until ?? ''}
							onChange={(e) => (localCrunch = { active: true, until: e.currentTarget.value })}
							min={new Date().toISOString().slice(0, 10)}
						/>
					{/if}
				</label>
				<div class="flags-actions">
					<button class="flags-save" onclick={saveFlags} disabled={savingFlags}>Lagre</button>
					<button class="flags-cancel" onclick={() => (editingFlags = false)} disabled={savingFlags}>
						Avbryt
					</button>
				</div>
			</div>
		{/if}
	</div>

	{#if alternative && readinessState !== 'klar'}
		<div class="alternative">
			<div class="alt-head">
				<span class="alt-icon">↻</span>
				<div>
					<h4>{alternative.name}</h4>
					<p>{alternative.summary}</p>
				</div>
			</div>

			{#if alternative.kind === 'run' && alternative.plannedRun}
				<div class="alt-detail">
					{#if alternative.plannedRun.targetDistanceMeters}
						<span>{fmtMeters(alternative.plannedRun.targetDistanceMeters)}</span>
					{/if}
					{#if alternative.plannedRun.targetDurationSeconds}
						<span>{fmtSeconds(alternative.plannedRun.targetDurationSeconds)}</span>
					{/if}
					{#if alternative.plannedRun.paceHintSecPerKm}
						<span class="alt-pill">{fmtPace(alternative.plannedRun.paceHintSecPerKm)}</span>
					{/if}
					{#if alternative.plannedRun.hrZoneHint}
						<span class="alt-pill">{alternative.plannedRun.hrZoneHint}</span>
					{/if}
				</div>
			{:else if alternative.kind === 'strength' && alternative.plannedExercises?.length}
				<ul class="alt-exercises">
					{#each alternative.plannedExercises as ex}
						<li>
							<span>{ex.exerciseName}</span>
							<span class="alt-ex-meta">
								{ex.sets} × {ex.repsTarget ?? `${ex.durationSecondsTarget}s`}
							</span>
						</li>
					{/each}
				</ul>
			{/if}

			<p class="rationale">{alternative.rationale}</p>

			{#if hasPlannedSession}
				<div class="choice-row">
					<button
						class="choice"
						class:active={localChoice === 'alternative'}
						disabled={savingChoice}
						onclick={() => setChoice('alternative')}
					>
						{localChoice === 'alternative' ? '✓ ' : ''}Velg byttet
					</button>
					<button
						class="choice secondary"
						class:active={localChoice === 'original'}
						disabled={savingChoice}
						onclick={() => setChoice('original')}
					>
						{localChoice === 'original' ? '✓ ' : ''}Kjør original likevel
					</button>
				</div>
			{/if}
		</div>
	{:else if readinessState === 'klar' && hasPlannedSession}
		<p class="all-clear">Alt klart. Kjør på.</p>
	{:else if readinessState === 'klar' && !hasPlannedSession}
		<p class="all-clear">Hviledag. Søvn og tilstand ser bra ut — klar for neste økt.</p>
	{/if}
</section>

<style>
	.readiness-strip {
		padding: 14px 16px;
		border-radius: 14px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		margin-bottom: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.readiness-strip.tone-klar {
		border-left: 4px solid #34d399;
	}
	.readiness-strip.tone-lett {
		border-left: 4px solid #fbbf24;
	}
	.readiness-strip.tone-easy {
		border-left: 4px solid #fb923c;
	}
	.readiness-strip.tone-rest {
		border-left: 4px solid #f87171;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 16px;
		flex-wrap: wrap;
	}
	.state-tag {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.dot {
		font-size: 16px;
	}
	.state-label {
		font-size: 14px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.pill {
		padding: 3px 9px;
		border-radius: 999px;
		font-size: 11px;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.pill-red {
		background: color-mix(in oklab, #f87171 25%, transparent);
		color: #fca5a5;
	}
	.pill-yellow {
		background: color-mix(in oklab, #fbbf24 22%, transparent);
		color: #fcd34d;
	}
	.pill-green {
		background: color-mix(in oklab, #34d399 22%, transparent);
		color: #6ee7b7;
	}
	.pill-sick,
	.pill-crunch {
		background: color-mix(in oklab, #f87171 18%, transparent);
		color: #fca5a5;
	}
	.pill-trip {
		background: color-mix(in oklab, #60a5fa 18%, transparent);
		color: #93c5fd;
	}
	.reasons {
		margin: 0;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.all-clear {
		margin: 0;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.alternative {
		padding: 12px;
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.alt-head {
		display: flex;
		gap: 10px;
		align-items: flex-start;
	}
	.alt-icon {
		font-size: 16px;
		color: var(--accent-primary);
		flex-shrink: 0;
		margin-top: 2px;
	}
	.alt-head h4 {
		margin: 0;
		font-size: 14px;
		color: var(--text-primary);
	}
	.alt-head p {
		margin: 2px 0 0;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.alt-detail {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 13px;
		color: var(--text-secondary);
	}
	.alt-pill {
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-tertiary);
		font-variant-numeric: tabular-nums;
	}
	.alt-exercises {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.alt-exercises li {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
		color: var(--text-primary);
	}
	.alt-ex-meta {
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
	.rationale {
		margin: 0;
		font-size: 12px;
		color: var(--text-tertiary);
		font-style: italic;
	}
	.choice-row {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-top: 4px;
	}
	.choice {
		padding: 7px 14px;
		border-radius: 999px;
		font-size: 12px;
		cursor: pointer;
		background: var(--accent-primary);
		color: white;
		border: 1px solid var(--accent-primary);
	}
	.choice:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.choice.secondary {
		background: transparent;
		color: var(--text-secondary);
		border-color: var(--border-subtle);
	}
	.choice.active {
		background: color-mix(in oklab, var(--accent-primary) 80%, white 20%);
	}
	.choice.secondary.active {
		background: var(--bg-tertiary);
		color: var(--text-primary);
	}
	.flags-row {
		margin-top: 4px;
	}
	.flags-edit {
		font-size: 11px;
		color: var(--text-tertiary);
		background: transparent;
		border: 1px dashed var(--border-subtle);
		border-radius: 6px;
		padding: 4px 10px;
		cursor: pointer;
	}
	.flags-edit:hover {
		color: var(--text-secondary);
		border-color: var(--text-tertiary);
	}
	.flags-editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		background: var(--bg-primary);
		border: 1px solid var(--border-subtle);
		border-radius: 8px;
	}
	.flag-row {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--text-primary);
		flex-wrap: wrap;
	}
	.flag-row input[type='date'] {
		font-size: 12px;
		padding: 3px 6px;
		background: var(--bg-tertiary);
		border: 1px solid var(--border-subtle);
		color: var(--text-primary);
		border-radius: 4px;
	}
	.flags-actions {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}
	.flags-save,
	.flags-cancel {
		font-size: 12px;
		padding: 5px 12px;
		border-radius: 999px;
		cursor: pointer;
		border: 1px solid var(--border-subtle);
	}
	.flags-save {
		background: var(--accent-primary);
		color: white;
		border-color: var(--accent-primary);
	}
	.flags-cancel {
		background: transparent;
		color: var(--text-secondary);
	}
</style>
