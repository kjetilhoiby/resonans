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

	interface SickPayload {
		today: string;
		active: boolean;
		activePeriodId: string | null;
		/** Et gammelt nå-flagg uten periode. Unnskylder ikke streak-dager. */
		legacyFlagUntil: string | null;
		periods: SickPeriodView[];
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

	const active = $derived(data?.periods.find((p) => p.id === data?.activePeriodId) ?? null);
	const stale = $derived(data?.periods.find((p) => p.staleOpen) ?? null);
	const past = $derived(data?.periods.filter((p) => p.id !== data?.activePeriodId) ?? []);

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
		error = null;
	}

	const saveEdit = (id: string) =>
		call(`/api/helse/syk/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ startDate: editStart, endDate: editEnd || null })
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
						<div class="sick-edit-actions">
							<button class="sick-btn" type="button" disabled={busy} onclick={() => void saveEdit(p.id)}>Lagre</button>
							<button class="sick-link" type="button" onclick={() => (editingId = null)}>Avbryt</button>
						</div>
						<p class="sick-hint">Tom «Til» betyr syk inntil videre.</p>
					</div>
				{:else}
					<span class="sick-row-text" class:is-stale={p.staleOpen}>{p.text}</span>
					<button class="sick-link" type="button" aria-label="Rett {p.text}" onclick={() => startEdit(p)}>Rett</button>
					<button class="sick-link sick-link--danger" type="button" disabled={busy} aria-label="Slett {p.text}" onclick={() => void remove(p.id)}>Slett</button>
				{/if}
			</div>
		{/each}

		{#if (data?.periods.length ?? 0) === 0}
			<p class="sick-hint">Ingen registrerte sykeperioder.</p>
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
</style>
