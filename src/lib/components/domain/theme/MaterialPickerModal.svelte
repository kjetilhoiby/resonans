<!--
  MaterialPickerModal — velg/legg til et materiale i en kappliste.
  Toggle plate/lengdevare, tresort + behandling, og mål (x/y/z). Tidligere brukte
  materialer vises som klikkbare presets (chips) som fyller feltene. Returnerer et
  nytt Material (med ett tomt kapp) via onAdd.
-->
<script lang="ts">
	import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
	import { WOOD_TYPES, TREATMENTS, materialDisplayName } from '$lib/kappliste/catalog';
	import type { Material } from '$lib/kappliste/calc';

	interface Props {
		presets: Material[];
		onAdd: (material: Material) => void;
		onClose: () => void;
	}

	let { presets, onAdd, onClose }: Props = $props();

	let kind = $state<'sheet' | 'linear'>('sheet');
	let woodType = $state('');
	let treatment = $state('Ubehandlet');
	let thicknessMm = $state(''); // godstykkelse (z)
	let crossWidthMm = $state(''); // tverrsnittsbredde (lengdevare)
	let stockWidthMm = $state('2440');
	let stockHeightMm = $state('1220');
	let stockLengthMm = $state('3900');
	let price = $state('');
	let nameOverride = $state('');
	let nameDirty = $state(false);

	function parseNum(value: string): number {
		const n = Number(value.replace(',', '.'));
		return Number.isFinite(n) ? n : 0;
	}

	const autoName = $derived(
		materialDisplayName({
			kind,
			woodType: woodType.trim(),
			treatment,
			thicknessMm: parseNum(thicknessMm) || undefined,
			crossWidthMm: parseNum(crossWidthMm) || undefined
		})
	);
	const name = $derived(nameDirty ? nameOverride : autoName);

	function applyPreset(p: Material) {
		kind = p.kind;
		woodType = p.woodType ?? '';
		treatment = p.treatment ?? 'Ubehandlet';
		thicknessMm = p.thicknessMm ? String(p.thicknessMm) : '';
		crossWidthMm = p.crossWidthMm ? String(p.crossWidthMm) : '';
		if (p.kind === 'sheet') {
			stockWidthMm = String(p.stockWidthMm ?? 2440);
			stockHeightMm = String(p.stockHeightMm ?? 1220);
			price = p.pricePerSheetNok ? String(p.pricePerSheetNok) : '';
		} else {
			stockLengthMm = String(p.stockLengthMm ?? 3900);
			price = p.pricePerMeterNok ? String(p.pricePerMeterNok) : '';
		}
		nameOverride = p.name ?? '';
		nameDirty = !!p.name && p.name !== autoName;
	}

	function presetLabel(p: Material): string {
		return p.name?.trim() || materialDisplayName(p) || (p.kind === 'sheet' ? 'Plate' : 'Lengdevare');
	}

	function add() {
		const thickness = parseNum(thicknessMm);
		const finalName = name.trim() || (kind === 'sheet' ? 'Plate' : 'Lengdevare');
		const base: Material = {
			id: crypto.randomUUID(),
			name: finalName.slice(0, 80),
			kind,
			cuts:
				kind === 'sheet'
					? [{ id: crypto.randomUUID(), widthMm: 0, heightMm: 0, quantity: 1 }]
					: [{ id: crypto.randomUUID(), lengthMm: 0, quantity: 1 }]
		};
		if (woodType.trim()) base.woodType = woodType.trim();
		if (treatment) base.treatment = treatment;
		if (thickness > 0) base.thicknessMm = thickness;
		if (kind === 'sheet') {
			base.stockWidthMm = Math.round(parseNum(stockWidthMm)) || 2440;
			base.stockHeightMm = Math.round(parseNum(stockHeightMm)) || 1220;
			base.pricePerSheetNok = parseNum(price);
		} else {
			base.crossWidthMm = Math.round(parseNum(crossWidthMm)) || undefined;
			base.stockLengthMm = Math.round(parseNum(stockLengthMm)) || 3900;
			base.pricePerMeterNok = parseNum(price);
		}
		onAdd(base);
	}
</script>

<BottomSheet onclose={onClose} ariaLabel="Nytt materiale">
	<header class="mp-head">
		<h2 class="mp-title">Nytt materiale</h2>
		<button class="mp-close" onclick={onClose} aria-label="Lukk">✕</button>
	</header>

	<div class="mp-body">
		{#if presets.length > 0}
			<section class="mp-section">
				<span class="mp-label">Tidligere brukt</span>
				<div class="mp-chips">
					{#each presets as p, i (i)}
						<button class="mp-chip preset" onclick={() => applyPreset(p)} data-track="materiale-modal:velg-preset">
							{presetLabel(p)}
						</button>
					{/each}
				</div>
			</section>
		{/if}

		<section class="mp-section">
			<div class="mp-toggle" role="group" aria-label="Materialtype">
				<button class="mp-tg" class:active={kind === 'sheet'} onclick={() => (kind = 'sheet')} data-track="materiale-modal:type-plate">
					Plate
				</button>
				<button class="mp-tg" class:active={kind === 'linear'} onclick={() => (kind = 'linear')} data-track="materiale-modal:type-lengdevare">
					Lengdevare
				</button>
			</div>
		</section>

		<section class="mp-section">
			<label class="mp-field-label" for="mp-wood">Tresort / platetype</label>
			<input
				id="mp-wood"
				class="mp-input"
				list="mp-wood-list"
				placeholder={kind === 'sheet' ? 'F.eks. kryssfiner poppel' : 'F.eks. furu'}
				bind:value={woodType}
				data-track="materiale-modal:tresort"
			/>
			<datalist id="mp-wood-list">
				{#each WOOD_TYPES as w (w)}<option value={w}></option>{/each}
			</datalist>
		</section>

		<section class="mp-section">
			<span class="mp-label">Behandling</span>
			<div class="mp-chips">
				{#each TREATMENTS as t (t)}
					<button
						class="mp-chip"
						class:active={treatment === t}
						onclick={() => (treatment = t)}
						data-track="materiale-modal:behandling"
					>
						{t}
					</button>
				{/each}
			</div>
		</section>

		<section class="mp-section">
			<span class="mp-label">Mål</span>
			{#if kind === 'sheet'}
				<div class="mp-dims">
					<label>Tykkelse<span class="mp-fld"><input type="text" inputmode="decimal" placeholder="15" bind:value={thicknessMm} data-track="materiale-modal:tykkelse" /><span class="sfx">mm</span></span></label>
					<label>Bredde<span class="mp-fld"><input type="text" inputmode="numeric" bind:value={stockWidthMm} data-track="materiale-modal:platebredde" /><span class="sfx">mm</span></span></label>
					<label>Høyde<span class="mp-fld"><input type="text" inputmode="numeric" bind:value={stockHeightMm} data-track="materiale-modal:platehoyde" /><span class="sfx">mm</span></span></label>
					<label>Pris/plate<span class="mp-fld"><input type="text" inputmode="decimal" placeholder="299" bind:value={price} data-track="materiale-modal:plate-pris" /><span class="sfx">kr</span></span></label>
				</div>
			{:else}
				<div class="mp-dims">
					<label>Tykkelse<span class="mp-fld"><input type="text" inputmode="numeric" placeholder="48" bind:value={thicknessMm} data-track="materiale-modal:tykkelse" /><span class="sfx">mm</span></span></label>
					<label>Bredde<span class="mp-fld"><input type="text" inputmode="numeric" placeholder="48" bind:value={crossWidthMm} data-track="materiale-modal:tverrsnittsbredde" /><span class="sfx">mm</span></span></label>
					<label>Lengde/lekt<span class="mp-fld"><input type="text" inputmode="numeric" bind:value={stockLengthMm} data-track="materiale-modal:lengde-per-lekt" /><span class="sfx">mm</span></span></label>
					<label>Meterpris<span class="mp-fld"><input type="text" inputmode="decimal" placeholder="54" bind:value={price} data-track="materiale-modal:meterpris" /><span class="sfx">kr/m</span></span></label>
				</div>
			{/if}
		</section>

		<section class="mp-section">
			<label class="mp-field-label" for="mp-name">Navn</label>
			<input
				id="mp-name"
				class="mp-input"
				placeholder={autoName || 'Materialnavn'}
				value={name}
				oninput={(e) => {
					nameOverride = e.currentTarget.value;
					nameDirty = true;
				}}
				data-track="materiale-modal:navn"
			/>
		</section>
	</div>

	<footer class="mp-foot">
		<button class="mp-add" onclick={add} data-track="materiale-modal:legg-til">Legg til materiale</button>
	</footer>
</BottomSheet>

<style>
	.mp-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 18px 18px 10px;
		border-bottom: 1px solid var(--card-border, #2a2a2a);
	}
	.mp-title {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--tp-text, #eee);
		letter-spacing: -0.01em;
	}
	.mp-close {
		background: none;
		border: 0;
		color: var(--tp-text-muted, #888);
		font-size: 0.95rem;
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 6px;
	}
	.mp-close:hover {
		color: var(--tp-text, #eee);
	}
	.mp-body {
		overflow-y: auto;
		padding: 14px 18px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.mp-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.mp-label,
	.mp-field-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--tp-text-muted, #888);
	}
	.mp-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.mp-chip {
		background: var(--tp-bg-2, #1c1c1c);
		border: 1px solid var(--card-border, #2a2a2a);
		border-radius: 99px;
		color: var(--tp-text-soft, #ccc);
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 12px;
		cursor: pointer;
	}
	.mp-chip:hover {
		border-color: var(--tp-border-strong, #3c8f7c);
	}
	.mp-chip.active {
		background: var(--tp-accent-bg-strong, rgba(60, 143, 124, 0.32));
		border-color: var(--tp-border-strong, #3c8f7c);
		color: var(--tp-text, #eee);
	}
	.mp-chip.preset {
		background: var(--tp-accent-bg, rgba(60, 143, 124, 0.12));
	}
	.mp-toggle {
		display: flex;
		gap: 0;
		border: 1px solid var(--card-border, #2a2a2a);
		border-radius: 10px;
		overflow: hidden;
	}
	.mp-tg {
		flex: 1;
		background: var(--tp-bg-1, #161616);
		border: 0;
		color: var(--tp-text-muted, #888);
		font: inherit;
		font-size: 0.86rem;
		font-weight: 600;
		padding: 9px 0;
		cursor: pointer;
	}
	.mp-tg.active {
		background: var(--tp-accent-bg-strong, rgba(60, 143, 124, 0.32));
		color: var(--tp-text, #eee);
	}
	.mp-input {
		background: var(--tp-bg-2, #1c1c1c);
		border: 1px solid var(--card-border, #2a2a2a);
		border-radius: 8px;
		color: var(--tp-text, #eee);
		font: inherit;
		font-size: 0.9rem;
		padding: 9px 10px;
		width: 100%;
	}
	.mp-input:focus {
		outline: none;
		border-color: var(--tp-border-strong, #3c8f7c);
	}
	.mp-dims {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.mp-dims label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.72rem;
		color: var(--tp-text-soft, #ccc);
	}
	.mp-fld {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: var(--tp-bg-2, #1c1c1c);
		border: 1px solid var(--card-border, #2a2a2a);
		border-radius: 8px;
		padding: 0 8px;
	}
	.mp-fld input {
		width: 100%;
		min-width: 0;
		background: transparent;
		border: 0;
		color: var(--tp-text, #eee);
		font: inherit;
		font-size: 0.85rem;
		padding: 8px 0;
		text-align: right;
	}
	.mp-fld input:focus {
		outline: none;
	}
	.mp-fld:focus-within {
		border-color: var(--tp-border-strong, #3c8f7c);
	}
	.sfx {
		font-size: 0.72rem;
		color: var(--tp-text-muted, #888);
		flex-shrink: 0;
	}
	.mp-foot {
		padding: 12px 18px calc(14px + env(safe-area-inset-bottom));
		border-top: 1px solid var(--card-border, #2a2a2a);
	}
	.mp-add {
		width: 100%;
		background: var(--tp-accent-bg-strong, rgba(60, 143, 124, 0.32));
		border: 1px solid var(--tp-border-strong, #3c8f7c);
		border-radius: 10px;
		color: var(--tp-text, #eee);
		font: inherit;
		font-size: 0.92rem;
		font-weight: 600;
		padding: 12px;
		cursor: pointer;
	}
	.mp-add:hover {
		filter: brightness(1.1);
	}
</style>
