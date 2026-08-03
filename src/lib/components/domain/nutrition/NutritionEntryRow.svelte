<!--
  NutritionEntryRow — ett loggført måltid, med retting av tid og slot.

  Egen komponent fordi radens redigeringstilstand er lokal. Lå den i
  NutritionDayCard, måtte kortet holdt et kart av åpne rader.

  Retting av tidspunkt er hovedsaken: å spise kl. 11 og logge kl. 13 er normalen.
  Endrer du tiden og ikke har valgt slot selv, flytter serveren sloten med.
-->
<script lang="ts">
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { confidenceLabel } from '$lib/domain/nutrition/estimate';
	import { osloTimeLabel, type LoggedEntry } from '$lib/domain/nutrition/day-summary';
	import { MEAL_SLOTS, type MealSlotId } from '$lib/domain/nutrition/meal-slots';

	interface Props {
		entry: LoggedEntry;
		onChanged?: () => void;
	}

	let { entry, onChanged }: Props = $props();

	let editing = $state(false);
	let busy = $state(false);
	let error = $state('');

	let timeLocal = $state('');
	let slot = $state<MealSlotId | null>(null);

	function localInputValue(iso: string): string {
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) return '';
		const pad = (n: number) => String(n).padStart(2, '0');
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}

	function openEditor() {
		timeLocal = localInputValue(entry.timestamp);
		slot = entry.mealSlot;
		error = '';
		editing = true;
	}

	function nb(value: number): string {
		return value.toLocaleString('nb-NO');
	}

	async function send(body: Record<string, unknown>, method = 'PATCH') {
		busy = true;
		error = '';
		try {
			const res = await fetch(`/api/helse/ernaering/logg/${entry.id}`, {
				method,
				headers: { 'content-type': 'application/json' },
				body: method === 'DELETE' ? undefined : JSON.stringify(body)
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			editing = false;
			onChanged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function save() {
		const body: Record<string, unknown> = {};
		const parsed = new Date(timeLocal);
		if (!Number.isNaN(parsed.getTime()) && parsed.toISOString() !== entry.timestamp) {
			body.timestamp = parsed.toISOString();
		}
		// Bare send slot når den faktisk er endret — ellers ville en åpning og
		// lukking av editoren gjort en utledet slot til et brukervalg.
		if (slot && slot !== entry.mealSlot) body.mealSlot = slot;

		if (Object.keys(body).length === 0) {
			editing = false;
			return;
		}
		await send(body);
	}
</script>

<li class="entry">
	{#if entry.imageUrl}
		<img class="entry-thumb" src={entry.imageUrl} alt="" />
	{/if}

	<div class="entry-body">
		<span class="entry-label">{entry.label}</span>
		<span class="entry-meta">
			{osloTimeLabel(entry.timestamp)} · {nb(entry.macros.kcal)} kcal · {nb(entry.macros.proteinG)} g protein
			{#if entry.confidence > 0}
				· {confidenceLabel(entry.confidence)} sikkerhet
			{/if}
		</span>

		{#if editing}
			<div class="editor">
				<input
					class="editor-time"
					type="datetime-local"
					bind:value={timeLocal}
					max={localInputValue(new Date().toISOString())}
					aria-label="Tidspunkt for måltidet"
					data-track="ernaering:endre-tidspunkt"
				/>
				<div class="editor-slots" role="group" aria-label="Måltid">
					{#each MEAL_SLOTS as option (option.id)}
						<button
							type="button"
							class="slot"
							class:is-active={slot === option.id}
							aria-pressed={slot === option.id}
							onclick={() => (slot = option.id)}
							data-track={`ernaering:endre-slot-${option.id}`}
						>
							<span aria-hidden="true">{option.emoji}</span>
							{option.label}
						</button>
					{/each}
				</div>
				<div class="editor-actions">
					<button type="button" class="editor-save" onclick={() => void save()} disabled={busy} data-track="ernaering:lagre-endring">
						{busy ? 'Lagrer …' : 'Lagre'}
					</button>
					<button type="button" class="editor-cancel" onclick={() => (editing = false)} data-track="ernaering:avbryt-endring">
						Avbryt
					</button>
				</div>
				{#if error}
					<p class="editor-error">{error}</p>
				{/if}
			</div>
		{/if}
	</div>

	{#if !editing}
		<button
			type="button"
			class="entry-btn"
			aria-label={`Endre tid og måltid for ${entry.label}`}
			onclick={openEditor}
			data-track="ernaering:apne-endring"
		>
			✎
		</button>
		<button
			type="button"
			class="entry-btn"
			aria-label={`Slett ${entry.label}`}
			onclick={() => void send({}, 'DELETE')}
			disabled={busy}
			data-track="ernaering:slett-maltid"
		>
			{busy ? '…' : '✕'}
		</button>
	{/if}
</li>

{#if error && !editing}
	<li class="row-error">{error}</li>
{/if}

<style>
	.entry {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 12px;
		background: #141414;
	}

	.entry-thumb {
		width: 36px;
		height: 36px;
		object-fit: cover;
		border-radius: 8px;
		flex-shrink: 0;
	}

	.entry-body {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}

	.entry-label {
		font-size: 0.85rem;
		color: #eee;
		overflow-wrap: anywhere;
	}

	.entry-meta {
		font-size: 0.7rem;
		color: #777;
	}

	.entry-btn {
		background: none;
		border: none;
		color: #666;
		font: inherit;
		font-size: 0.85rem;
		padding: 4px 6px;
		cursor: pointer;
		flex-shrink: 0;
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}

	.editor-time {
		padding: 7px 8px;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #eee;
		font: inherit;
		font-size: 0.82rem;
	}

	/* Wrap framfor scroll: fem chips får ikke plass på 430 px, og en klippet
	   «Snacks» ser ut som en feil framfor noe man kan bla til. */
	.editor-slots {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.slot {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 6px 9px;
		border-radius: 999px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #999;
		font: inherit;
		font-size: 0.74rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.slot.is-active {
		border-color: #7c8ef5;
		color: #eee;
	}

	.editor-actions {
		display: flex;
		gap: 6px;
	}

	.editor-save,
	.editor-cancel {
		padding: 7px 12px;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}

	.editor-save {
		color: #82c882;
	}

	.editor-cancel {
		color: #888;
	}

	.editor-error,
	.row-error {
		margin: 0;
		font-size: 0.74rem;
		color: #e0776b;
		overflow-wrap: anywhere;
		list-style: none;
	}
</style>
