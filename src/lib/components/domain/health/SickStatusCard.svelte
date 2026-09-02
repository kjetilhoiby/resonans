<script lang="ts">
	/**
	 * «Jeg er syk» — inngangen på Helse-flaten.
	 *
	 * Kortet er bevisst lite når ingenting er galt: én knapp. Er du syk, tar det
	 * plass og sier hva det gjør — at streaks pauses, at ukas plan senkes, at
	 * coachen vet det. Et flagg som virker i det stille er ikke til å stole på.
	 *
	 * Historikken ligger bak en <details> fordi retting er sjeldent, men den MÅ
	 * finnes: en periode registrert med feil dato ville ellers unnskyldt dager du
	 * faktisk trente, uten en vei til å angre.
	 */
	import DateInput from '$lib/components/ui/DateInput.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';

	interface SickPeriodView {
		id: string;
		startDate: string;
		endDate: string | null;
		note: string | null;
		effectiveEnd: string;
		open: boolean;
		staleOpen: boolean;
		activeToday: boolean;
		days: number;
		text: string;
	}

	interface SymptomView {
		id: string;
		label: string;
		kind: 'luftveier' | 'mage' | 'muskel_skjelett' | 'annet';
		severity: 'litt' | 'merkbart' | 'mye';
		startDate: string;
		endDate: string | null;
		limiting: boolean;
		note: string | null;
		ongoing: boolean;
		days: number;
		text: string;
	}

	interface SickPayload {
		today: string;
		active: boolean;
		activePeriodId: string | null;
		/** Et gammelt nå-flagg uten periode. Unnskylder ikke streak-dager. */
		legacyFlagUntil: string | null;
		periods: (SickPeriodView & { symptomIds: string[] })[];
		symptoms: SymptomView[];
		symptomSummary: string | null;
		temperature: {
			coreText: string | null;
			skinText: string | null;
			latestCoreC: number | null;
			highestCoreC: number | null;
			skinDeviationC: number | null;
		} | null;
		hint: { since: string; nights: number; observations: string[]; text: string } | null;
	}

	interface Props {
		initial?: SickPayload | null;
	}

	let { initial = null }: Props = $props();

	let data = $state<SickPayload | null>(initial);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let expanded = $state(false);
	let editingId = $state<string | null>(null);
	let editStart = $state('');
	let editEnd = $state('');
	let editNote = $state('');

	const active = $derived(data?.periods.find((p) => p.id === data?.activePeriodId) ?? null);
	const stale = $derived(data?.periods.find((p) => p.staleOpen) ?? null);
	const past = $derived(data?.periods.filter((p) => p.id !== data?.activePeriodId) ?? []);
	const ongoingSymptoms = $derived(data?.symptoms.filter((s) => s.ongoing) ?? []);
	const pastSymptoms = $derived(data?.symptoms.filter((s) => !s.ongoing) ?? []);

	// Nytt symptom
	let newLabel = $state('');
	let newSeverity = $state<SymptomView['severity']>('merkbart');
	let newKind = $state<SymptomView['kind']>('annet');
	let newLimiting = $state(false);
	let addingSymptom = $state(false);

	const SEVERITIES: SymptomView['severity'][] = ['litt', 'merkbart', 'mye'];
	const KIND_LABELS: Record<SymptomView['kind'], string> = {
		luftveier: 'Luftveier',
		mage: 'Mage',
		muskel_skjelett: 'Muskel/skjelett',
		annet: 'Annet'
	};

	async function call(url: string, init: RequestInit) {
		if (busy) return;
		busy = true;
		error = null;
		try {
			const res = await fetch(url, {
				headers: { 'Content-Type': 'application/json' },
				...init
			});
			if (!res.ok) {
				// Meldingen fra serveren er skrevet for å leses. En generisk tekst her
				// gjør en avvist dato uløselig for brukeren.
				error = extractApiErrorMessage(res.status, await res.text());
				return;
			}
			data = await res.json();
			editingId = null;
			const { invalidateAll } = await import('$app/navigation');
			await invalidateAll();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Klarte ikke å lagre.';
		} finally {
			busy = false;
		}
	}

	async function load() {
		if (data) return;
		const res = await fetch('/api/helse/syk');
		if (res.ok) data = await res.json();
	}
	void load();

	const markSick = () =>
		call('/api/helse/syk', { method: 'POST', body: JSON.stringify({}) });

	const recover = (id: string) =>
		call(`/api/helse/syk/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'end' }) });

	const remove = (id: string) => call(`/api/helse/syk/${id}`, { method: 'DELETE' });

	function startEdit(p: SickPeriodView) {
		editingId = p.id;
		editStart = p.startDate;
		editEnd = p.endDate ?? '';
		editNote = p.note ?? '';
		error = null;
	}

	const saveEdit = (id: string) =>
		call(`/api/helse/syk/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({
				startDate: editStart,
				endDate: editEnd || null,
				// Tom tekst er en SLETTING av notatet, ikke «ingen endring» —
				// samme skille som i ernæringsmålene.
				note: editNote.trim() || null
			})
		});

	const dismissHint = () =>
		call('/api/helse/syk', { method: 'POST', body: JSON.stringify({ action: 'dismissHint' }) });

	/** «Ja, jeg er syk» på forslaget — backdatert til natta avviket startet. */
	const acceptHint = (since: string) =>
		call('/api/helse/syk', { method: 'POST', body: JSON.stringify({ startDate: since }) });

	async function addSymptom() {
		const label = newLabel.trim();
		if (!label) return;
		await call('/api/helse/symptomer', {
			method: 'POST',
			body: JSON.stringify({
				label,
				severity: newSeverity,
				kind: newKind,
				limiting: newLimiting
			})
		});
		if (!error) {
			newLabel = '';
			newLimiting = false;
			addingSymptom = false;
		}
	}

	const endSymptom = (id: string) =>
		call(`/api/helse/symptomer/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ action: 'end' })
		});

	const removeSymptom = (id: string) =>
		call(`/api/helse/symptomer/${id}`, { method: 'DELETE' });

	/** Retningssvaret oppfølgingen ber om: verre/bedre justerer alvorligheten. */
	function shiftSeverity(current: SymptomView['severity'], dir: -1 | 1): SymptomView['severity'] {
		const i = SEVERITIES.indexOf(current);
		return SEVERITIES[Math.min(SEVERITIES.length - 1, Math.max(0, i + dir))];
	}

	const setSeverity = (id: string, severity: SymptomView['severity']) =>
		call(`/api/helse/symptomer/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ severity })
		});

	const setLimiting = (id: string, limiting: boolean) =>
		call(`/api/helse/symptomer/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ limiting })
		});
</script>

<div class="sick-card" class:is-sick={!!active}>
	<div class="sick-head">
		<span class="sick-icon" aria-hidden="true">{active ? '🤒' : '🩺'}</span>
		<div class="sick-head-text">
			<h3>{active ? active.text : 'Syk?'}</h3>
			<p class="sick-sub">
				{#if active}
					Streaks pauses, ukas plan er senket, og coachen vet det.
				{:else}
					Meld deg syk, så pauses streaks og ukeplanen slutter å telle dagene mot deg.
				{/if}
			</p>
		</div>
		{#if active}
			<button
				class="sick-btn sick-btn--primary"
				type="button"
				disabled={busy}
				data-track="helse-syk:friskmeld"
				onclick={() => void recover(active.id)}
			>Frisk igjen</button>
		{:else}
			<button
				class="sick-btn"
				type="button"
				disabled={busy}
				data-track="helse-syk:meld-syk"
				onclick={() => void markSick()}
			>Jeg er syk</button>
		{/if}
	</div>

	{#if error}
		<p class="sick-error" role="alert">{error}</p>
	{/if}

	{#if stale}
		<!-- En åpen periode som passerte taket. Den unnskylder ingenting lenger, og
		     det skal sies — ikke oppdages ved at streaks plutselig ryker. -->
		<p class="sick-warn">
			{stale.text}
			<button class="sick-link" type="button" onclick={() => startEdit(stale)}>Sett sluttdato</button>
		</p>
	{/if}

	{#if data?.legacyFlagUntil && !active}
		<p class="sick-warn">
			Et gammelt syk-flagg står til {data.legacyFlagUntil}. Det pauser readiness, men ikke
			streaks — meld deg syk på nytt for å få med dagene.
		</p>
	{/if}

	{#if data?.hint && !active}
		<!-- Spørsmålet tallene stiller. Backdateres til natta avviket startet, så
		     streaks repareres bakover med det samme. -->
		<div class="sick-hint">
			<p class="sick-hint-text">{data.hint.text}</p>
			<div class="sick-hint-actions">
				<button
					class="sick-btn sick-btn--primary"
					type="button"
					disabled={busy}
					data-track="helse-syk:godta-forslag"
					onclick={() => void acceptHint(data!.hint!.since)}
				>Ja — syk siden {data.hint.since.slice(8)}.</button>
				<button
					class="sick-link"
					type="button"
					disabled={busy}
					data-track="helse-syk:avvis-forslag"
					onclick={() => void dismissHint()}
				>Nei, bare trening</button>
			</div>
		</div>
	{/if}

	{#if data?.temperature?.coreText || data?.temperature?.skinText}
		<!-- To signaler, holdt fra hverandre: termometeret er absolutt, klokka er
		     et avvik fra ditt eget snitt. Se $lib/domain/health/temperature.ts. -->
		<div class="sick-temps">
			{#if data.temperature.coreText}
				<span class="sick-temp"><span class="sick-temp-src">Termometer</span> {data.temperature.coreText}</span>
			{/if}
			{#if data.temperature.skinText}
				<span class="sick-temp"><span class="sick-temp-src">Klokka</span> {data.temperature.skinText}</span>
			{/if}
		</div>
	{/if}

	<!-- Symptomene: egne liv, egne datoer. Ett av dem kan være grunnen til at du
	     står over, og det er `limiting` som sier hvilket. -->
	<div class="sick-symptoms">
		{#if ongoingSymptoms.length > 0}
			<p class="sick-sec-label">Hva som er galt nå</p>
			{#each ongoingSymptoms as sym (sym.id)}
				<div class="sym-row" class:is-limiting={sym.limiting}>
					<div class="sym-main">
						<span class="sym-label">{sym.label}</span>
						<span class="sym-meta">
							{sym.severity} · {sym.days} {sym.days === 1 ? 'dag' : 'dager'} · {KIND_LABELS[sym.kind]}
						</span>
					</div>
					<div class="sym-actions">
						<!-- Retningssvaret oppfølgingen ber om, som to trykk. -->
						<button
							class="sym-chip"
							type="button"
							disabled={busy || sym.severity === 'litt'}
							aria-label="{sym.label}: bedre"
							data-track="helse-symptom:bedre"
							onclick={() => void setSeverity(sym.id, shiftSeverity(sym.severity, -1))}
						>↓</button>
						<button
							class="sym-chip"
							type="button"
							disabled={busy || sym.severity === 'mye'}
							aria-label="{sym.label}: verre"
							data-track="helse-symptom:verre"
							onclick={() => void setSeverity(sym.id, shiftSeverity(sym.severity, 1))}
						>↑</button>
						<button
							class="sym-chip"
							class:is-on={sym.limiting}
							type="button"
							disabled={busy}
							aria-label="{sym.label}: {sym.limiting ? 'ikke grunnen' : 'dette er grunnen til at jeg står over'}"
							data-track="helse-symptom:begrensende"
							onclick={() => void setLimiting(sym.id, !sym.limiting)}
						>🛑</button>
						<button
							class="sick-link"
							type="button"
							disabled={busy}
							aria-label="{sym.label} er over"
							data-track="helse-symptom:over"
							onclick={() => void endSymptom(sym.id)}
						>Over</button>
					</div>
				</div>
			{/each}
		{/if}

		{#if addingSymptom}
			<div class="sym-new">
				<input
					class="sym-input"
					type="text"
					placeholder="F.eks. vondt i halsen"
					maxlength="80"
					bind:value={newLabel}
					data-track="helse-symptom:nytt-navn"
				/>
				<div class="sym-new-row">
					<select bind:value={newSeverity} aria-label="Alvorlighet" data-track="helse-symptom:alvorlighet">
						{#each SEVERITIES as sev}<option value={sev}>{sev}</option>{/each}
					</select>
					<select bind:value={newKind} aria-label="Type" data-track="helse-symptom:type">
						{#each Object.entries(KIND_LABELS) as [value, label]}
							<option {value}>{label}</option>
						{/each}
					</select>
					<label class="sym-check">
						<input type="checkbox" bind:checked={newLimiting} data-track="helse-symptom:er-grunnen" />
						<span>Grunnen til at jeg står over</span>
					</label>
				</div>
				<div class="sym-new-actions">
					<button class="sick-btn" type="button" disabled={busy || !newLabel.trim()} onclick={() => void addSymptom()}>Legg til</button>
					<button class="sick-link" type="button" onclick={() => (addingSymptom = false)}>Avbryt</button>
				</div>
			</div>
		{:else}
			<button
				class="sick-link"
				type="button"
				data-track="helse-symptom:legg-til"
				onclick={() => (addingSymptom = true)}
			>+ Legg til symptom</button>
		{/if}
	</div>

	<details class="sick-history" bind:open={expanded}>
		<summary>Sykeperioder{past.length > 0 ? ` (${past.length})` : ''}</summary>

		<p class="sick-hint">
			Var du syk tidligere? Legg inn perioden i etterkant — streaks regnes fra hendelser,
			så rekka repareres bakover.
		</p>

		{#each data?.periods ?? [] as p (p.id)}
			<div class="sick-row">
				{#if editingId === p.id}
					<div class="sick-edit">
						<label>
							<span>Fra</span>
							<DateInput value={editStart} onChange={(e) => (editStart = e.currentTarget.value)} />
						</label>
						<label>
							<span>Til</span>
							<DateInput value={editEnd} onChange={(e) => (editEnd = e.currentTarget.value)} />
						</label>
						<label class="sick-note-label">
							<span>Notat</span>
							<input
								class="sym-input"
								type="text"
								placeholder="F.eks. holdt senga, ringte legevakta"
								maxlength="200"
								bind:value={editNote}
								data-track="helse-syk:periodenotat"
							/>
						</label>
						<div class="sick-edit-actions">
							<button class="sick-btn" type="button" disabled={busy} onclick={() => void saveEdit(p.id)}>Lagre</button>
							<button class="sick-link" type="button" onclick={() => (editingId = null)}>Avbryt</button>
						</div>
						<p class="sick-hint">Tom «Til» betyr syk inntil videre.</p>
					</div>
				{:else}
					<span class="sick-row-text" class:is-stale={p.staleOpen}>
						{p.text}{#if p.note}<span class="sick-row-note">{p.note}</span>{/if}
					</span>
					<button class="sick-link" type="button" aria-label="Rett {p.text}" onclick={() => startEdit(p)}>Rett</button>
					<button class="sick-link sick-link--danger" type="button" disabled={busy} aria-label="Slett {p.text}" onclick={() => void remove(p.id)}>Slett</button>
				{/if}
			</div>
		{/each}

		{#if (data?.periods.length ?? 0) === 0}
			<p class="sick-hint">Ingen registrerte sykeperioder.</p>
		{/if}

		{#if pastSymptoms.length > 0}
			<p class="sick-sec-label">Symptomer som er over</p>
			{#each pastSymptoms as sym (sym.id)}
				<div class="sick-row">
					<span class="sick-row-text">{sym.text}</span>
					<button class="sick-link sick-link--danger" type="button" disabled={busy} aria-label="Slett {sym.label}" onclick={() => void removeSymptom(sym.id)}>Slett</button>
				</div>
			{/each}
		{/if}

		{#if editingId === null}
			<button
				class="sick-link"
				type="button"
				data-track="helse-syk:legg-til-periode"
				onclick={() => startEdit({
					id: 'new', startDate: data?.today ?? '', endDate: null, note: null,
					effectiveEnd: '', open: true, staleOpen: false, activeToday: false, days: 0, text: ''
				})}
			>+ Legg til en periode</button>
		{/if}
	</details>
</div>

<style>
	.sick-card {
		background: var(--bg-card, #141414);
		border: 1px solid var(--border-color, #2a2a2a);
		border-radius: 14px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.sick-card.is-sick {
		border-color: var(--accent-warning, #b8863b);
		background: linear-gradient(180deg, rgba(184, 134, 59, 0.09), transparent 70%),
			var(--bg-card, #141414);
	}

	.sick-head {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.sick-icon { font-size: 22px; line-height: 1; }
	.sick-head-text { flex: 1; min-width: 0; }
	.sick-head-text h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.sick-sub {
		margin: 2px 0 0;
		font-size: 12px;
		line-height: 1.4;
		color: var(--text-tertiary);
	}

	.sick-btn {
		flex-shrink: 0;
		background: var(--bg-input, #111);
		border: 1px solid var(--border-color, #2a2a2a);
		color: var(--text-secondary);
		border-radius: 999px;
		padding: 7px 14px;
		font-size: 13px;
		cursor: pointer;
	}
	.sick-btn:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent-primary); }
	.sick-btn:disabled { opacity: 0.5; cursor: default; }
	.sick-btn--primary {
		border-color: var(--accent-warning, #b8863b);
		color: var(--text-primary);
	}

	.sick-error {
		margin: 0;
		font-size: 12px;
		color: var(--accent-danger, #d9534f);
	}
	.sick-warn {
		margin: 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--accent-warning, #d8a24a);
	}

	.sick-history { font-size: 13px; }
	.sick-history summary {
		cursor: pointer;
		color: var(--text-tertiary);
		font-size: 12px;
		padding: 2px 0;
	}
	.sick-hint {
		margin: 6px 0;
		font-size: 12px;
		line-height: 1.45;
		color: var(--text-tertiary);
	}

	.sick-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 0;
		border-top: 1px solid var(--border-color, #2a2a2a);
	}
	.sick-row-text { flex: 1; min-width: 0; color: var(--text-secondary); }
	.sick-row-text.is-stale { color: var(--accent-warning, #d8a24a); }

	.sick-link {
		background: none;
		border: none;
		padding: 2px 0;
		font-size: 12px;
		color: var(--text-tertiary);
		cursor: pointer;
		text-decoration: underline;
	}
	.sick-link:hover:not(:disabled) { color: var(--text-primary); }
	.sick-link--danger:hover:not(:disabled) { color: var(--accent-danger, #d9534f); }
	.sick-link:disabled { opacity: 0.5; cursor: default; }

	.sick-edit {
		flex: 1;
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: flex-end;
	}
	.sick-edit label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 11px;
		color: var(--text-tertiary);
	}
	.sick-edit-actions { display: flex; gap: 10px; align-items: center; }

	/* ── Forslaget ─────────────────────────────────────────────── */
	.sick-hint {
		border: 1px dashed var(--border-color, #2a2a2a);
		border-radius: 10px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.sick-hint-text {
		margin: 0;
		font-size: 13px;
		line-height: 1.45;
		color: var(--text-secondary);
	}
	.sick-hint-actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }

	/* ── Temperatur ────────────────────────────────────────────── */
	.sick-temps {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 16px;
		font-size: 12px;
		color: var(--text-secondary);
	}
	.sick-temp-src {
		color: var(--text-tertiary);
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.04em;
		margin-right: 4px;
	}

	/* ── Symptomer ─────────────────────────────────────────────── */
	.sick-symptoms { display: flex; flex-direction: column; gap: 6px; }
	.sick-sec-label {
		margin: 4px 0 0;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary);
	}

	.sym-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 8px;
		border-radius: 8px;
		background: var(--bg-input, #111);
	}
	/* Det begrensende symptomet er svaret på «hvorfor står du over», så det
	   skal skille seg ut uten å bli et varsel. */
	.sym-row.is-limiting {
		box-shadow: inset 2px 0 0 var(--accent-warning, #b8863b);
	}
	.sym-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
	.sym-label {
		font-size: 13px;
		color: var(--text-primary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sym-meta { font-size: 11px; color: var(--text-tertiary); }

	.sym-actions { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
	.sym-chip {
		width: 28px;
		height: 28px;
		border-radius: 8px;
		border: 1px solid var(--border-color, #2a2a2a);
		background: transparent;
		color: var(--text-secondary);
		font-size: 13px;
		line-height: 1;
		cursor: pointer;
	}
	.sym-chip:hover:not(:disabled) { color: var(--text-primary); border-color: var(--accent-primary); }
	.sym-chip:disabled { opacity: 0.3; cursor: default; }
	.sym-chip.is-on {
		border-color: var(--accent-warning, #b8863b);
		background: rgba(184, 134, 59, 0.12);
	}

	.sym-new {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		border-radius: 8px;
		background: var(--bg-input, #111);
	}
	.sym-input,
	.sym-new select {
		background: var(--bg-card, #141414);
		border: 1px solid var(--border-color, #2a2a2a);
		border-radius: 6px;
		color: var(--text-primary);
		padding: 7px 9px;
		font-size: 13px;
		font-family: inherit;
	}
	.sym-input:focus,
	.sym-new select:focus { outline: none; border-color: var(--accent-primary); }
	.sym-new-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
	.sym-check {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-tertiary);
		cursor: pointer;
	}
	.sym-new-actions { display: flex; gap: 12px; align-items: center; }
	.sick-note-label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 11px;
		color: var(--text-tertiary);
		flex: 1 1 100%;
	}
	.sick-row-note {
		display: block;
		font-size: 11px;
		color: var(--text-tertiary);
		margin-top: 1px;
	}
</style>
