<!--
  NapList — dupper, med retting og sletting per rad.

  Lista var tidligere en `CompactRecordList`: lesbar, men uten noen vei til å rette en
  dupp man loggførte feil. Å logge «25 min» når det var 45, eller kl. 13 når det var 11,
  er normalen — ikke kantfallet.

  **De to typene kan ikke gjøre det samme, og flaten sier hvorfor.**

  En *manuell* dupp er vår egen rad: varighet, tidspunkt og notat kan rettes, og raden kan
  slettes. En *oppdaget* dupp eies av Withings — den er en ekte måling av at du lå stille,
  og en slett-knapp ville løyet om hva den gjorde. Der er alternativet «var ikke en dupp»,
  som retter *klassifiseringen* framfor å påstå at målingen ikke skjedde.

  Redigeringsmønsteret er det samme som `NutritionEntryRow` på Ernæring, med vilje: dette
  er den andre loggen i appen man retter, og den skal ikke oppføre seg annerledes.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		napCapabilities,
		validateNapDuration,
		NAP_MAX_MINUTES,
		NAP_MIN_MINUTES
	} from '$lib/domain/sleep/nap-fields';

	interface Nap {
		id: string;
		start: string;
		durationMinutes: number;
		manual: boolean;
		note: string | null;
	}

	interface Props {
		naps: Nap[];
		/** Ber flaten hente dashboardet på nytt etter en endring. */
		onChanged?: () => void;
	}

	let { naps, onChanged }: Props = $props();

	let editingId = $state<string | null>(null);
	let busyId = $state<string | null>(null);
	let error = $state('');

	/**
	 * Sist omklassifiserte dupp, til å angre.
	 *
	 * «Ikke en dupp» er ett trykk, og raden forsvinner fra lista — uten dette var
	 * feiltrykket umulig å rette fra flaten, selv om endepunktet tar `isNap: true`.
	 * Holdes bare i denne økta: en angre-knapp som overlever en omlasting ville krevd at
	 * loaderen bar de bortklassifiserte radene, og det er en helt annen liste.
	 */
	let lastReclassified = $state<{ id: string; label: string } | null>(null);

	async function undoReclassify() {
		const target = lastReclassified;
		if (!target) return;
		busyId = target.id;
		error = '';
		try {
			const res = await fetch('/api/soevn/nap', {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ id: target.id, isNap: true })
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			lastReclassified = null;
			onChanged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busyId = null;
		}
	}

	// Utkast. `string | number` fordi bind:value mot type="number" gir et tall.
	let draftMinutes = $state<string | number>('');
	let draftTime = $state('');
	let draftNote = $state('');

	function localInputValue(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function openEditor(nap: Nap) {
		editingId = nap.id;
		draftMinutes = nap.durationMinutes;
		draftTime = localInputValue(nap.start);
		draftNote = nap.note ?? '';
		error = '';
	}

	function parsedMinutes(): number | null {
		const raw = draftMinutes;
		if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
		const value = Number(String(raw).trim().replace(',', '.'));
		return Number.isFinite(value) ? value : null;
	}

	const draftError = $derived.by(() => {
		if (editingId === null) return null;
		return validateNapDuration(parsedMinutes());
	});

	function timeLabel(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('nb-NO', {
			timeZone: 'Europe/Oslo',
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(date);
	}

	async function send(nap: Nap, body: Record<string, unknown>, method: 'PATCH' | 'DELETE') {
		busyId = nap.id;
		error = '';
		try {
			const url =
				method === 'DELETE'
					? `/api/soevn/nap?id=${encodeURIComponent(nap.id)}`
					: '/api/soevn/nap';
			const res = await fetch(url, {
				method,
				headers: method === 'DELETE' ? undefined : { 'content-type': 'application/json' },
				body: method === 'DELETE' ? undefined : JSON.stringify({ id: nap.id, ...body })
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			editingId = null;
			onChanged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busyId = null;
		}
	}

	async function save(nap: Nap) {
		if (draftError) {
			error = draftError;
			return;
		}
		const body: Record<string, unknown> = {};
		const minutes = parsedMinutes();
		if (minutes !== null && Math.round(minutes) !== nap.durationMinutes) {
			body.durationMinutes = Math.round(minutes);
		}
		const parsedTime = new Date(draftTime);
		if (!Number.isNaN(parsedTime.getTime()) && parsedTime.toISOString() !== nap.start) {
			body.at = parsedTime.toISOString();
		}
		// Tom streng sendes med vilje: den betyr «slett notatet», mens utelatt betyr
		// «ikke rørt». Se normalizeNapNote.
		if (draftNote.trim() !== (nap.note ?? '')) body.note = draftNote.trim();

		if (Object.keys(body).length === 0) {
			editingId = null;
			return;
		}
		await send(nap, body, 'PATCH');
	}
</script>

<section class="naps">
	<SectionLabel tag="h2">Dupper</SectionLabel>

	{#if naps.length === 0}
		<p class="empty">Ingen dupper registrert de siste 30 dagene.</p>
	{:else}
		<ul class="list">
			{#each naps as nap (nap.id)}
				{@const caps = napCapabilities(nap)}
				<li class="nap">
					<div class="row">
						<div class="body">
							<span class="duration">{nap.durationMinutes} min</span>
							<span class="meta">
								{timeLabel(nap.start)} · {nap.manual ? 'registrert selv' : 'oppdaget'}
							</span>
							{#if nap.note}
								<span class="note-text">{nap.note}</span>
							{/if}
						</div>

						{#if editingId !== nap.id}
							{#if caps.canEdit}
								<button
									type="button"
									class="btn"
									aria-label={`Endre duppen ${nap.durationMinutes} min`}
									onclick={() => openEditor(nap)}
									data-track="soevn:apne-endre-dupp"
								>
									✎
								</button>
							{/if}
							{#if caps.canDelete}
								<button
									type="button"
									class="btn"
									aria-label={`Slett duppen ${nap.durationMinutes} min`}
									disabled={busyId === nap.id}
									onclick={() => void send(nap, {}, 'DELETE')}
									data-track="soevn:slett-dupp"
								>
									{busyId === nap.id ? '…' : '✕'}
								</button>
							{/if}
							{#if caps.canReclassify}
								<button
									type="button"
									class="btn btn--wide"
									disabled={busyId === nap.id}
									onclick={() => {
										lastReclassified = { id: nap.id, label: `${nap.durationMinutes} min` };
										void send(nap, { isNap: false }, 'PATCH');
									}}
									data-track="soevn:ikke-en-dupp"
								>
									{busyId === nap.id ? '…' : 'Ikke en dupp'}
								</button>
							{/if}
						{/if}
					</div>

					{#if editingId === nap.id}
						<div class="editor">
							<label class="field">
								<span class="field-label">Varighet</span>
								<input
									class="input input--short"
									type="number"
									inputmode="numeric"
									min={NAP_MIN_MINUTES}
									max={NAP_MAX_MINUTES}
									bind:value={draftMinutes}
									data-track="soevn:endre-dupp-varighet"
								/>
								<span class="field-unit">min</span>
							</label>
							<label class="field">
								<span class="field-label">Tidspunkt</span>
								<input
									class="input"
									type="datetime-local"
									bind:value={draftTime}
									max={localInputValue(new Date().toISOString())}
									data-track="soevn:endre-dupp-tidspunkt"
								/>
							</label>
							<label class="field">
								<span class="field-label">Notat</span>
								<input
									class="input"
									type="text"
									placeholder="Valgfritt"
									bind:value={draftNote}
									data-track="soevn:endre-dupp-notat"
								/>
							</label>

							{#if draftError}
								<p class="row-error">{draftError}</p>
							{/if}

							<div class="actions">
								<button
									type="button"
									class="save"
									disabled={busyId === nap.id || Boolean(draftError)}
									onclick={() => void save(nap)}
									data-track="soevn:lagre-dupp"
								>
									{busyId === nap.id ? 'Lagrer …' : 'Lagre'}
								</button>
								<button
									type="button"
									class="cancel"
									onclick={() => (editingId = null)}
									data-track="soevn:avbryt-dupp"
								>
									Avbryt
								</button>
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>

		{#if naps.some((nap) => !nap.manual)}
			<p class="hint">
				Oppdagede dupper kommer fra Withings og kan ikke slettes — målingen skjedde. Var det
				ikke en dupp, retter «Ikke en dupp» klassifiseringen.
			</p>
		{/if}
	{/if}

	{#if lastReclassified}
		<p class="undo">
			{lastReclassified.label} er ikke lenger regnet som en dupp.
			<button
				type="button"
				class="undo-btn"
				disabled={busyId === lastReclassified.id}
				onclick={() => void undoReclassify()}
				data-track="soevn:angre-ikke-en-dupp"
			>
				{busyId === lastReclassified.id ? 'Angrer …' : 'Angre'}
			</button>
		</p>
	{/if}

	{#if error}
		<p class="row-error">{error}</p>
	{/if}
</section>

<style>
	.naps {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.list {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.nap {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 11px 12px;
		border-radius: 12px;
		background: var(--card-bg-subtle, #141414);
	}

	.row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.duration {
		font-size: 0.9rem;
		font-weight: 600;
		color: #eee;
	}

	.meta {
		font-size: 0.7rem;
		color: #777;
	}

	.note-text {
		font-size: 0.72rem;
		color: #999;
		overflow-wrap: anywhere;
	}

	.btn {
		flex-shrink: 0;
		padding: 4px 6px;
		font: inherit;
		font-size: 0.85rem;
		color: #666;
		background: none;
		border: none;
		cursor: pointer;
	}

	.btn--wide {
		padding: 5px 10px;
		font-size: 0.72rem;
		color: #999;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 999px;
		white-space: nowrap;
	}

	.btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}

	.field {
		display: flex;
		align-items: center;
		gap: 7px;
	}

	.field-label {
		flex: 0 0 4.6rem;
		font-size: 0.72rem;
		color: #888;
	}

	.field-unit {
		font-size: 0.72rem;
		color: #666;
	}

	.input {
		flex: 1;
		min-width: 0;
		padding: 7px 8px;
		font: inherit;
		font-size: 0.82rem;
		color: #eee;
		background: #0f0f0f;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
	}

	.input--short {
		flex: 0 0 5rem;
	}

	.actions {
		display: flex;
		gap: 6px;
	}

	.save,
	.cancel {
		padding: 7px 12px;
		font: inherit;
		font-size: 0.8rem;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		cursor: pointer;
	}

	.save {
		color: #82c882;
	}

	.save:disabled {
		opacity: 0.55;
		cursor: default;
	}

	.cancel {
		color: #888;
	}

	.empty,
	.hint {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.5;
		color: #777;
	}

	.row-error {
		margin: 0;
		font-size: 0.74rem;
		color: #e0776b;
		overflow-wrap: anywhere;
	}

	.undo {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 0.74rem;
		color: #999;
	}

	.undo-btn {
		padding: 4px 10px;
		font: inherit;
		font-size: 0.74rem;
		color: #9aa7f0;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 999px;
		cursor: pointer;
	}

	.undo-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
