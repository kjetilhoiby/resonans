<!--
  PantryItemSheet — én vare i lageret: mengde, når den sist ble bekreftet,
  «✓ Stemmer», fast vare og ønsket buffer («ett brød i fryseren»).
  Handlelista stoler ikke på en beholdning eldre enn PANTRY_STALE_DAYS, og fyller
  opp til bufferen. Se docs/changelog/2026-11-24-middagsplanen-som-fasit.md.
-->
<script lang="ts">
	import BottomSheet from '../../ui/BottomSheet.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { describeStockAge, isStockStale } from '$lib/domains/food/shopping-needs';

	export type PantrySheetItem = {
		id: string;
		name: string;
		quantity: string | number | null;
		unit: string | null;
		isStaple?: boolean;
		targetQuantity?: string | number | null;
		confirmedAt?: string | null;
	};

	interface Props {
		item: PantrySheetItem;
		onchanged: () => void;
		onclose: () => void;
	}

	let { item, onchanged, onclose }: Props = $props();

	const asText = (v: string | number | null | undefined) => (v == null ? '' : String(v).replace('.', ','));

	let quantity = $state(asText(item.quantity));
	let unit = $state(item.unit ?? '');
	let isStaple = $state(item.isStaple ?? false);
	let target = $state(asText(item.targetQuantity));
	let busy = $state(false);
	let error = $state('');

	const now = new Date();
	const stale = $derived(isStockStale(item.confirmedAt ?? null, now));

	function parse(text: string): number | null {
		const t = text.trim().replace(',', '.');
		if (!t) return null;
		const n = Number(t);
		return Number.isFinite(n) && n >= 0 ? n : NaN;
	}

	async function patch(body: Record<string, unknown>) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const res = await fetch('/api/food/pantry', {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ id: item.id, ...body })
			});
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			onchanged();
			onclose();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Lagringen feilet.';
		} finally {
			busy = false;
		}
	}

	function save() {
		const q = parse(quantity);
		const t = parse(target);
		if (Number.isNaN(q) || Number.isNaN(t)) {
			error = 'Mengden må være et tall.';
			return;
		}
		const body: Record<string, unknown> = { isStaple, targetQuantity: isStaple ? t : null };
		// Mengden sendes bare når den er endret: en sendt mengde er en bekreftelse.
		if (q !== parse(asText(item.quantity)) || (unit.trim() || null) !== (item.unit ?? null)) {
			body.quantity = q;
			body.unit = unit.trim() || null;
		}
		patch(body);
	}
</script>

<BottomSheet {onclose} ariaLabel={`Lager: ${item.name}`}>
	<div class="ps">
		<button class="ps-title" onclick={onclose} aria-label="Lukk">{item.name}</button>

		<p class="ps-age" class:stale>
			{describeStockAge(item.confirmedAt ?? null, now)}{stale ? ' — handlelista sjekker før den stoler på tallet' : ''}
		</p>
		<button class="ps-confirm" disabled={busy} onclick={() => patch({ confirm: true })} data-track="lager:bekreft">
			✓ Stemmer
		</button>

		<div class="ps-grid">
			<label class="ps-field">
				<span>Mengde hjemme</span>
				<input inputmode="decimal" bind:value={quantity} placeholder="ukjent" data-track="lager:mengde" />
			</label>
			<label class="ps-field">
				<span>Enhet</span>
				<input bind:value={unit} placeholder="stk, g, dl …" data-track="lager:enhet" />
			</label>
		</div>

		<label class="ps-check">
			<input type="checkbox" bind:checked={isStaple} data-track="lager:fast-vare" />
			Fast vare — skal alltid finnes hjemme
		</label>
		{#if isStaple}
			<label class="ps-field">
				<span>Ønsket buffer ({unit.trim() || 'stk'})</span>
				<input inputmode="decimal" bind:value={target} placeholder="f.eks. 1" data-track="lager:buffer" />
			</label>
			<p class="ps-hint">
				{target.trim()
					? 'Handlelista fyller opp til bufferen.'
					: 'Uten buffer havner varen på handlelista først når den er tom.'}
			</p>
		{/if}

		<button class="ps-save" disabled={busy} onclick={save} data-track="lager:lagre">Lagre</button>
		{#if error}<p class="ps-error" role="alert">{error}</p>{/if}
	</div>
</BottomSheet>

<style>
	.ps {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 18px 20px calc(20px + env(safe-area-inset-bottom));
		color: var(--text-primary);
	}
	.ps-title {
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		text-align: left;
		cursor: pointer;
		font-size: var(--font-size-title, 1rem);
		font-weight: 700;
	}
	.ps-age {
		margin: 0;
		font-size: var(--font-size-body, 0.9rem);
		color: var(--text-secondary);
	}
	.ps-age.stale {
		color: var(--warning-text);
	}
	.ps-confirm,
	.ps-save {
		align-self: flex-start;
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		color: var(--text-primary);
		padding: 8px 14px;
		font-size: var(--font-size-body, 0.9rem);
		cursor: pointer;
	}
	.ps-save {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: var(--accent-contrast);
		font-weight: 600;
	}
	.ps-confirm:disabled,
	.ps-save:disabled {
		opacity: 0.5;
	}
	.ps-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.ps-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--font-size-label, 0.78rem);
		color: var(--text-secondary);
	}
	.ps-field {
		min-width: 0;
	}
	.ps-field input {
		box-sizing: border-box;
		width: 100%;
		min-width: 0;
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		color: var(--text-primary);
		padding: 8px 10px;
		font: inherit;
		font-size: var(--font-size-body, 0.9rem);
	}
	.ps-check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--font-size-body, 0.9rem);
	}
	.ps-hint {
		margin: 0;
		font-size: var(--font-size-caption, 0.72rem);
		color: var(--text-secondary);
	}
	.ps-error {
		margin: 0;
		color: var(--error-text);
		font-size: var(--font-size-caption, 0.72rem);
	}
</style>
