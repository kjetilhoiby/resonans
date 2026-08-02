<!--
  NutritionLogger — logg et måltid med fritekst eller bilde.

  Flyten er to steg med vilje: estimer, se over, lagre. Det gir brukeren sjansen
  til å rette et tall før det havner i loggen, og det er også det som gjør
  «beskriv for å få mengde»-løkka mulig — når modellen måtte gjette mengde,
  spør den, og svaret sendes inn sammen med forrige estimat.

  Selve estimeringen bor på serveren (`/api/helse/ernaering/estimat`) fordi den
  trenger referansetabellen og OpenAI-nøkkelen.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import {
		confidenceLabel,
		describeItem,
		type NutritionEstimate
	} from '$lib/domain/nutrition/estimate';

	interface Props {
		/** Kalles etter lagring, slik at flaten kan hente loggen på nytt. */
		onLogged?: () => void;
	}

	let { onLogged }: Props = $props();

	let text = $state('');
	let followUp = $state('');
	let imageUrl = $state<string | null>(null);
	let estimate = $state<NutritionEstimate | null>(null);
	let descriptions = $state<string[]>([]);

	let busy = $state(false);
	let uploading = $state(false);
	let saving = $state(false);
	let error = $state('');

	let fileInput = $state<HTMLInputElement | null>(null);

	const canEstimate = $derived(text.trim().length > 0 || imageUrl !== null);
	const totals = $derived(estimate?.totals ?? null);

	function reset() {
		text = '';
		followUp = '';
		imageUrl = null;
		estimate = null;
		descriptions = [];
		error = '';
	}

	async function post(path: string, body: unknown): Promise<unknown> {
		const res = await fetch(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
		return res.json();
	}

	/**
	 * Første estimat. `prior` er null her — det settes bare i beskriv-runden,
	 * slik at modellen får se hva den gjettet forrige gang.
	 */
	async function runEstimate() {
		if (!canEstimate || busy) return;
		busy = true;
		error = '';
		try {
			const body = { text: text.trim() || null, imageUrl };
			const result = (await post('/api/helse/ernaering/estimat', body)) as { estimate: NutritionEstimate };
			estimate = result.estimate;
			descriptions = text.trim() ? [text.trim()] : [];
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	/** Beskriv-runden: samme måltid, ny opplysning, nytt komplett estimat. */
	async function refine() {
		const extra = followUp.trim();
		if (!extra || busy || !estimate) return;
		busy = true;
		error = '';
		try {
			const result = (await post('/api/helse/ernaering/estimat', {
				text: extra,
				imageUrl,
				prior: estimate
			})) as { estimate: NutritionEstimate };
			estimate = result.estimate;
			descriptions = [...descriptions, extra];
			followUp = '';
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			busy = false;
		}
	}

	async function handleFile(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploading = true;
		error = '';
		try {
			const form = new FormData();
			form.append('image', file);
			const res = await fetch('/api/upload-image', { method: 'POST', body: form });
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			const body = (await res.json()) as { url?: string; secure_url?: string };
			imageUrl = body.url ?? body.secure_url ?? null;
			if (!imageUrl) throw new Error('Opplastingen ga ingen bilde-URL.');
			// Estimer med en gang: brukeren tok bilde nettopp, og et ekstra
			// trykk før det skjer noe føles som at ingenting virket.
			await runEstimate();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			uploading = false;
			// Nullstill, ellers gir samme fil ingen change-hendelse neste gang.
			input.value = '';
		}
	}

	async function save() {
		if (!estimate || saving) return;
		saving = true;
		error = '';
		try {
			await post('/api/helse/ernaering/logg', { estimate, imageUrl, descriptions });
			reset();
			onLogged?.();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			saving = false;
		}
	}

	/** Redigering av makroene før lagring. Brukerens tall vinner over modellens. */
	function setTotal(field: 'kcal' | 'proteinG' | 'carbsG' | 'fatG', raw: string) {
		if (!estimate) return;
		const value = Number(raw.replace(',', '.'));
		if (!Number.isFinite(value) || value < 0) return;
		// Legges som én manuell vare, slik at summen fortsatt er summen av delene
		// — det er den regelen resten av koden hviler på.
		const adjusted = { ...estimate.totals, [field]: value };
		estimate = {
			...estimate,
			items: [
				{
					name: estimate.label,
					quantity: null,
					unit: null,
					macros: adjusted,
					referenceKey: null
				}
			],
			totals: adjusted,
			source: 'manual'
		};
	}
</script>

<section class="logger">
	<SectionLabel tag="h2">Logg måltid</SectionLabel>

	{#if !estimate}
		<div class="entry">
			<input
				class="entry-text"
				type="text"
				bind:value={text}
				placeholder="to knekkebrød med egg"
				data-track="ernaering:logg-tekst"
				onkeydown={(e) => {
					if (e.key === 'Enter') void runEstimate();
				}}
			/>
			<button
				type="button"
				class="entry-camera"
				aria-label="Ta bilde av måltidet"
				onclick={() => fileInput?.click()}
				disabled={uploading || busy}
				data-track="ernaering:logg-bilde"
			>
				{uploading ? '…' : '📷'}
			</button>
			<button
				type="button"
				class="entry-submit"
				onclick={() => void runEstimate()}
				disabled={!canEstimate || busy}
				data-track="ernaering:estimer"
			>
				{busy ? 'Regner …' : 'Estimer'}
			</button>
		</div>
		<p class="entry-hint">
			Skriv hva du spiste, eller ta bilde. Modellen anslår makroene mot en norsk
			referansetabell — du ser og kan rette tallene før de lagres.
		</p>
	{/if}

	<!-- capture="environment" åpner kameraet direkte på mobil. -->
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		capture="environment"
		class="file-hidden"
		onchange={handleFile}
		aria-hidden="true"
		tabindex="-1"
	/>

	{#if estimate && totals}
		<div class="estimate">
			<div class="estimate-head">
				<span class="estimate-label">{estimate.label}</span>
				<span class="estimate-confidence" data-level={confidenceLabel(estimate.confidence)}>
					{confidenceLabel(estimate.confidence)} sikkerhet
				</span>
			</div>

			{#if imageUrl}
				<img class="estimate-image" src={imageUrl} alt="Måltidet du logget" />
			{/if}

			{#if estimate.items.length > 0}
				<ul class="estimate-items">
					{#each estimate.items as item (item.name + (item.quantity ?? ''))}
						<li>
							<span class="item-name">{describeItem(item)}</span>
							<span class="item-kcal">{item.macros.kcal} kcal</span>
						</li>
					{/each}
				</ul>
			{/if}

			<div class="macros">
				{#each [['kcal', 'kcal', totals.kcal], ['proteinG', 'protein', totals.proteinG], ['carbsG', 'karbo', totals.carbsG], ['fatG', 'fett', totals.fatG]] as [field, label, value] (field)}
					<label class="macro">
						<span class="macro-label">{label}</span>
						<input
							class="macro-input"
							type="number"
							min="0"
							step="1"
							value={value}
							data-track={`ernaering:rett-${label}`}
							onchange={(e) => setTotal(field as 'kcal', e.currentTarget.value)}
						/>
					</label>
				{/each}
			</div>

			{#if estimate.needsQuantity}
				<div class="follow-up">
					<p class="follow-up-question">
						{estimate.question ?? 'Hvor mye var det?'}
					</p>
					<div class="follow-up-row">
						<input
							class="entry-text"
							type="text"
							bind:value={followUp}
							placeholder="én stor porsjon, ca. 2 dl"
							data-track="ernaering:beskriv-mengde"
							onkeydown={(e) => {
								if (e.key === 'Enter') void refine();
							}}
						/>
						<button
							type="button"
							class="entry-submit"
							onclick={() => void refine()}
							disabled={!followUp.trim() || busy}
							data-track="ernaering:regn-om"
						>
							{busy ? 'Regner …' : 'Regn om'}
						</button>
					</div>
				</div>
			{/if}

			{#if estimate.notes}
				<p class="estimate-notes">{estimate.notes}</p>
			{/if}

			<div class="estimate-actions">
				<button
					type="button"
					class="save"
					onclick={() => void save()}
					disabled={saving || estimate.items.length === 0}
					data-track="ernaering:lagre-maltid"
				>
					{saving ? 'Lagrer …' : 'Lagre'}
				</button>
				<button type="button" class="cancel" onclick={reset} data-track="ernaering:avbryt">
					Avbryt
				</button>
			</div>
		</div>
	{/if}

	{#if error}
		<p class="error">{error}</p>
	{/if}
</section>

<style>
	.logger {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.file-hidden {
		display: none;
	}

	.entry {
		display: flex;
		gap: 6px;
	}

	.entry-text {
		flex: 1;
		min-width: 0;
		padding: 10px 12px;
		border-radius: 12px;
		border: 1px solid #2a2a2a;
		background: #141414;
		color: #eee;
		font: inherit;
		font-size: 0.9rem;
	}

	.entry-text::placeholder {
		color: #666;
	}

	.entry-camera,
	.entry-submit,
	.save,
	.cancel {
		padding: 10px 14px;
		border-radius: 12px;
		border: 1px solid #2a2a2a;
		background: #1a1a1a;
		color: #7c8ef5;
		font: inherit;
		font-size: 0.85rem;
		white-space: nowrap;
		cursor: pointer;
	}

	.entry-camera {
		font-size: 1rem;
		padding: 10px 12px;
	}

	.entry-camera:disabled,
	.entry-submit:disabled,
	.save:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.entry-hint {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.5;
		color: #777;
	}

	.estimate {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px;
		border-radius: 16px;
		background: #141414;
	}

	.estimate-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
	}

	.estimate-label {
		font-size: 0.95rem;
		font-weight: 700;
		color: #eee;
	}

	.estimate-confidence {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		white-space: nowrap;
		color: #777;
	}

	.estimate-confidence[data-level='god'] {
		color: #82c882;
	}

	.estimate-confidence[data-level='lav'] {
		color: #f0b429;
	}

	.estimate-image {
		width: 100%;
		max-height: 180px;
		object-fit: cover;
		border-radius: 12px;
	}

	.estimate-items {
		margin: 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.estimate-items li {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		font-size: 0.8rem;
		color: #aaa;
	}

	.item-kcal {
		color: #777;
		white-space: nowrap;
	}

	.macros {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 6px;
	}

	.macro {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.macro-label {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
	}

	.macro-input {
		width: 100%;
		min-width: 0;
		padding: 7px 8px;
		border-radius: 10px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #eee;
		font: inherit;
		font-size: 0.85rem;
	}

	.follow-up {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px;
		border-radius: 12px;
		border: 1px solid #33301f;
		background: #17150e;
	}

	.follow-up-question {
		margin: 0;
		font-size: 0.82rem;
		color: #f0b429;
	}

	.follow-up-row {
		display: flex;
		gap: 6px;
	}

	.estimate-notes {
		margin: 0;
		font-size: 0.74rem;
		line-height: 1.5;
		color: #777;
	}

	.estimate-actions {
		display: flex;
		gap: 6px;
	}

	.save {
		color: #82c882;
	}

	.cancel {
		color: #888;
	}

	.error {
		margin: 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #e0776b;
		overflow-wrap: anywhere;
	}
</style>
