<!--
  ThemeKapplisteTab — Kapplister-fanen i ThemePage (prosjekt-undertema).
  Hver kappliste har materialer (lengdevarer eller plater). Et materiale har ett
  eller flere kapp. Resonans regner ut hvor mange hele lekter/bjelker eller plater
  du må kjøpe (smart kapping) og hva det koster — for å scope prosjektet.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import {
		computeMaterial,
		computeCutList,
		formatNok,
		type Material,
		type CutSpec
	} from '$lib/kappliste/calc';

	interface CutList {
		id: string;
		title: string;
		kerfMm: number;
		materials: Material[];
		sortOrder: number;
		updatedAt: string;
	}

	interface Props {
		themeId: string;
		initialCutLists?: CutList[];
	}

	let { themeId, initialCutLists = [] }: Props = $props();

	let lists = $state<CutList[]>(initialCutLists);
	let creating = $state(false);
	let savingIds = $state<Set<string>>(new Set());

	const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

	onMount(async () => {
		try {
			const res = await fetch(`/api/tema/${themeId}/kapplister`);
			if (res.ok) {
				const { cutLists } = await res.json();
				lists = cutLists;
			}
		} catch {
			/* behold initialCutLists ved feil */
		}
	});

	function parseNum(value: string): number {
		const n = Number(value.replace(',', '.'));
		return Number.isFinite(n) ? n : 0;
	}

	/* ── Lagring (debounce per liste) ───────────────────── */
	function scheduleSave(id: string) {
		const existing = saveTimers.get(id);
		if (existing) clearTimeout(existing);
		saveTimers.set(
			id,
			setTimeout(() => {
				saveTimers.delete(id);
				void saveList(id);
			}, 600)
		);
	}

	async function saveList(id: string) {
		const list = lists.find((l) => l.id === id);
		if (!list) return;
		savingIds = new Set(savingIds).add(id);
		try {
			await fetch(`/api/tema/${themeId}/kapplister/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: list.title, kerfMm: list.kerfMm, materials: list.materials })
			});
		} finally {
			const next = new Set(savingIds);
			next.delete(id);
			savingIds = next;
		}
	}

	/* ── Mutasjoner ─────────────────────────────────────── */
	function patchList(id: string, patch: Partial<CutList>) {
		lists = lists.map((l) => (l.id === id ? { ...l, ...patch } : l));
		scheduleSave(id);
	}

	function updateMaterials(listId: string, fn: (materials: Material[]) => Material[]) {
		lists = lists.map((l) => (l.id === listId ? { ...l, materials: fn(l.materials) } : l));
		scheduleSave(listId);
	}

	function patchMaterial(listId: string, matId: string, patch: Partial<Material>) {
		updateMaterials(listId, (mats) => mats.map((m) => (m.id === matId ? { ...m, ...patch } : m)));
	}

	function patchCut(listId: string, matId: string, cutId: string, patch: Partial<CutSpec>) {
		updateMaterials(listId, (mats) =>
			mats.map((m) =>
				m.id === matId ? { ...m, cuts: m.cuts.map((c) => (c.id === cutId ? { ...c, ...patch } : c)) } : m
			)
		);
	}

	function addMaterial(listId: string, kind: 'linear' | 'sheet') {
		const material: Material =
			kind === 'linear'
				? {
						id: crypto.randomUUID(),
						name: '',
						kind: 'linear',
						stockLengthMm: 3900,
						pricePerMeterNok: 0,
						cuts: [{ id: crypto.randomUUID(), lengthMm: 0, quantity: 1 }]
					}
				: {
						id: crypto.randomUUID(),
						name: '',
						kind: 'sheet',
						stockWidthMm: 2440,
						stockHeightMm: 1220,
						pricePerSheetNok: 0,
						cuts: [{ id: crypto.randomUUID(), widthMm: 0, heightMm: 0, quantity: 1 }]
					};
		updateMaterials(listId, (mats) => [...mats, material]);
	}

	function removeMaterial(listId: string, matId: string) {
		updateMaterials(listId, (mats) => mats.filter((m) => m.id !== matId));
	}

	function addCut(listId: string, mat: Material) {
		const cut: CutSpec =
			mat.kind === 'linear'
				? { id: crypto.randomUUID(), lengthMm: 0, quantity: 1 }
				: { id: crypto.randomUUID(), widthMm: 0, heightMm: 0, quantity: 1 };
		updateMaterials(listId, (mats) => mats.map((m) => (m.id === mat.id ? { ...m, cuts: [...m.cuts, cut] } : m)));
	}

	function removeCut(listId: string, matId: string, cutId: string) {
		updateMaterials(listId, (mats) =>
			mats.map((m) => (m.id === matId ? { ...m, cuts: m.cuts.filter((c) => c.id !== cutId) } : m))
		);
	}

	/* ── Lister ─────────────────────────────────────────── */
	async function createList() {
		if (creating) return;
		creating = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/kapplister`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: `Kappliste ${lists.length + 1}` })
			});
			if (res.ok) {
				const { cutList } = await res.json();
				lists = [...lists, cutList];
			}
		} finally {
			creating = false;
		}
	}

	async function deleteList(id: string) {
		lists = lists.filter((l) => l.id !== id);
		await fetch(`/api/tema/${themeId}/kapplister/${id}`, { method: 'DELETE' });
	}
</script>

<div class="kapp">
	<p class="intro">
		Lag kapplister for å scope prosjektet. Legg til materialer — <strong>lengdevarer</strong> (lekt/bjelke
		med meterpris) eller <strong>plater</strong> (med plate-pris) — og hvor mange kapp du trenger i hvilke mål.
		Resonans regner ut hvor mange hele lekter/bjelker eller plater du må kjøpe, og hva det koster.
	</p>

	{#each lists as list (list.id)}
		{@const total = computeCutList(list.materials, list.kerfMm)}
		<section class="card">
			<header class="card-head">
				<input
					class="title-input"
					type="text"
					bind:value={list.title}
					data-track="kappliste:tittel"
					oninput={() => patchList(list.id, { title: list.title })}
					aria-label="Tittel på kappliste"
				/>
				<div class="head-right">
					{#if savingIds.has(list.id)}<span class="saving">Lagrer…</span>{/if}
					<button class="icon-btn" onclick={() => deleteList(list.id)} aria-label="Slett kappliste">🗑</button>
				</div>
			</header>

			{#each list.materials as mat (mat.id)}
				{@const res = computeMaterial(mat, list.kerfMm)}
				<div class="material">
					<div class="mat-head">
						<input
							class="mat-name"
							type="text"
							placeholder={mat.kind === 'linear' ? 'F.eks. 48x48 impregnert furu' : 'F.eks. 15mm kryssfiner poppel'}
							value={mat.name}
							data-track="kappliste:materialnavn"
							oninput={(e) => patchMaterial(list.id, mat.id, { name: e.currentTarget.value })}
							aria-label="Materialnavn"
						/>
						<span class="kind-tag">{mat.kind === 'linear' ? 'Lengdevare' : 'Plate'}</span>
						<button class="icon-btn small" onclick={() => removeMaterial(list.id, mat.id)} aria-label="Slett materiale">✕</button>
					</div>

					<!-- Stock + pris -->
					{#if mat.kind === 'linear'}
						<div class="stock-line">
							<label>
								<span>Lengde per lekt/bjelke</span>
								<span class="field"
									><input
										type="text"
										inputmode="numeric"
										value={mat.stockLengthMm ?? 3900}
										data-track="kappliste:lengde-per-lekt"
										onchange={(e) => patchMaterial(list.id, mat.id, { stockLengthMm: Math.round(parseNum(e.currentTarget.value)) || 3900 })}
									/><span class="suffix">mm</span></span
								>
							</label>
							<label>
								<span>Meterpris</span>
								<span class="field"
									><input
										type="text"
										inputmode="decimal"
										placeholder="54"
										value={mat.pricePerMeterNok || ''}
										data-track="kappliste:meterpris"
										oninput={(e) => patchMaterial(list.id, mat.id, { pricePerMeterNok: parseNum(e.currentTarget.value) })}
									/><span class="suffix">kr/m</span></span
								>
							</label>
						</div>
					{:else}
						<div class="stock-line">
							<label>
								<span>Platestørrelse</span>
								<span class="field dims">
									<input
										type="text"
										inputmode="numeric"
										value={mat.stockWidthMm ?? 2440}
										data-track="kappliste:platebredde"
										onchange={(e) => patchMaterial(list.id, mat.id, { stockWidthMm: Math.round(parseNum(e.currentTarget.value)) || 2440 })}
									/><span class="x">×</span><input
										type="text"
										inputmode="numeric"
										value={mat.stockHeightMm ?? 1220}
										data-track="kappliste:platehoyde"
										onchange={(e) => patchMaterial(list.id, mat.id, { stockHeightMm: Math.round(parseNum(e.currentTarget.value)) || 1220 })}
									/><span class="suffix">mm</span>
								</span>
							</label>
							<label>
								<span>Pris per plate</span>
								<span class="field"
									><input
										type="text"
										inputmode="decimal"
										placeholder="299"
										value={mat.pricePerSheetNok || ''}
										data-track="kappliste:plate-pris"
										oninput={(e) => patchMaterial(list.id, mat.id, { pricePerSheetNok: parseNum(e.currentTarget.value) })}
									/><span class="suffix">kr</span></span
								>
							</label>
						</div>
					{/if}

					<!-- Kapp -->
					<div class="cuts">
						<div class="cut-row head" class:sheet={mat.kind === 'sheet'}>
							{#if mat.kind === 'linear'}
								<span>Lengde</span><span>Antall</span><span></span>
							{:else}
								<span>Bredde</span><span>Høyde</span><span>Antall</span><span></span>
							{/if}
						</div>
						{#each mat.cuts as cut (cut.id)}
							<div class="cut-row" class:sheet={mat.kind === 'sheet'}>
								{#if mat.kind === 'linear'}
									<span class="field"
										><input
											type="text"
											inputmode="numeric"
											placeholder="1200"
											value={cut.lengthMm || ''}
											data-track="kappliste:kapp-lengde"
											oninput={(e) => patchCut(list.id, mat.id, cut.id, { lengthMm: Math.round(parseNum(e.currentTarget.value)) })}
											aria-label="Lengde i mm"
										/><span class="suffix">mm</span></span
									>
								{:else}
									<span class="field"
										><input
											type="text"
											inputmode="numeric"
											placeholder="380"
											value={cut.widthMm || ''}
											data-track="kappliste:kapp-bredde"
											oninput={(e) => patchCut(list.id, mat.id, cut.id, { widthMm: Math.round(parseNum(e.currentTarget.value)) })}
											aria-label="Bredde i mm"
										/><span class="suffix">mm</span></span
									>
									<span class="field"
										><input
											type="text"
											inputmode="numeric"
											placeholder="420"
											value={cut.heightMm || ''}
											data-track="kappliste:kapp-hoyde"
											oninput={(e) => patchCut(list.id, mat.id, cut.id, { heightMm: Math.round(parseNum(e.currentTarget.value)) })}
											aria-label="Høyde i mm"
										/><span class="suffix">mm</span></span
									>
								{/if}
								<input
									class="qty"
									type="text"
									inputmode="numeric"
									placeholder="5"
									value={cut.quantity || ''}
									data-track="kappliste:kapp-antall"
									oninput={(e) => patchCut(list.id, mat.id, cut.id, { quantity: Math.round(parseNum(e.currentTarget.value)) })}
									aria-label="Antall"
								/>
								<button class="icon-btn small" onclick={() => removeCut(list.id, mat.id, cut.id)} aria-label="Slett kapp">✕</button>
							</div>
						{/each}
						<button class="add-cut" onclick={() => addCut(list.id, mat)} data-track="kappliste:nytt-kapp">+ Kapp</button>
					</div>

					<!-- Materialresultat -->
					{#if res.totalPieces > 0 || res.tooBig.length > 0}
						<div class="mat-result" class:error={res.tooBig.length > 0}>
							{#if res.tooBig.length > 0}
								<span class="val error">Kapp {res.tooBig.join(', ')} er for store for {res.stockLabel}</span>
							{:else}
								<span class="val">
									{res.stockNeeded}
									{res.kind === 'linear' ? (res.stockNeeded === 1 ? 'lekt/bjelke' : 'lekter/bjelker') : res.stockNeeded === 1 ? 'plate' : 'plater'}
									({formatNok(res.costNok)})
								</span>
								<span class="sub">à {res.stockLabel}{#if res.wasteText} · {res.wasteText}{/if}</span>
							{/if}
						</div>
					{/if}
				</div>
			{/each}

			<div class="add-material">
				<button onclick={() => addMaterial(list.id, 'linear')} data-track="kappliste:nytt-materiale-lengde">+ Lekt/bjelke</button>
				<button onclick={() => addMaterial(list.id, 'sheet')} data-track="kappliste:nytt-materiale-plate">+ Plate</button>
			</div>

			{#if total.materials.length > 0 && !total.hasErrors}
				<div class="list-total">
					<span>Totalt for kapplista</span>
					<span>{formatNok(total.totalCostNok)}</span>
				</div>
			{/if}
		</section>
	{/each}

	<button class="new-list" onclick={createList} disabled={creating} data-track="kappliste:ny-liste">
		{creating ? 'Oppretter…' : '+ Ny kappliste'}
	</button>
</div>

<style>
	.kapp {
		padding: 16px var(--page-px);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.intro {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.45;
		color: var(--tp-text-muted);
	}
	.intro strong {
		color: var(--tp-text-soft);
		font-weight: 600;
	}
	.card {
		border: 1px solid var(--card-border);
		border-radius: 14px;
		background: var(--card-bg);
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.card-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.title-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: 0;
		border-bottom: 1px solid transparent;
		color: var(--tp-text);
		font: inherit;
		font-size: 0.98rem;
		font-weight: 600;
		padding: 2px 0;
	}
	.title-input:focus {
		outline: none;
		border-bottom-color: var(--tp-border-strong);
	}
	.head-right {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	.saving {
		font-size: 0.72rem;
		color: var(--tp-text-muted);
	}
	.icon-btn {
		background: none;
		border: 0;
		cursor: pointer;
		font-size: 0.9rem;
		opacity: 0.6;
		padding: 2px 4px;
		border-radius: 6px;
		color: var(--tp-text-soft);
	}
	.icon-btn:hover {
		opacity: 1;
	}
	.icon-btn.small {
		font-size: 0.8rem;
	}

	/* Materiale */
	.material {
		border: 1px solid var(--card-border);
		border-radius: 12px;
		background: var(--tp-bg-1);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.mat-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.mat-name {
		flex: 1;
		min-width: 0;
		background: var(--tp-bg-2);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		color: var(--tp-text);
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		padding: 7px 9px;
	}
	.mat-name:focus {
		outline: none;
		border-color: var(--tp-border-strong);
	}
	.kind-tag {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--tp-text-muted);
		background: var(--tp-bg-2);
		border: 1px solid var(--card-border);
		border-radius: 6px;
		padding: 3px 6px;
		flex-shrink: 0;
	}

	.stock-line {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.stock-line label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 0.72rem;
		color: var(--tp-text-soft);
	}
	.field {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		background: var(--tp-bg-2);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		padding: 0 8px;
	}
	.field input {
		width: 60px;
		background: transparent;
		border: 0;
		color: var(--tp-text);
		font: inherit;
		font-size: 0.85rem;
		padding: 7px 0;
		text-align: right;
	}
	.field.dims input {
		width: 52px;
	}
	.field input:focus {
		outline: none;
	}
	.field:focus-within {
		border-color: var(--tp-border-strong);
	}
	.x {
		color: var(--tp-text-muted);
		font-size: 0.8rem;
	}
	.suffix {
		font-size: 0.72rem;
		color: var(--tp-text-muted);
		flex-shrink: 0;
	}

	/* Kapp */
	.cuts {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.cut-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 56px 28px;
		gap: 6px;
		align-items: center;
	}
	.cut-row.sheet {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 56px 28px;
	}
	.cut-row.head {
		font-size: 0.66rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--tp-text-muted);
	}
	.cut-row .field {
		width: 100%;
	}
	.cut-row .field input {
		width: 100%;
		flex: 1;
	}
	.qty {
		width: 100%;
		background: var(--tp-bg-2);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		color: var(--tp-text);
		font: inherit;
		font-size: 0.85rem;
		padding: 7px 4px;
		text-align: center;
	}
	.qty:focus {
		outline: none;
		border-color: var(--tp-border-strong);
	}
	.add-cut {
		align-self: flex-start;
		background: none;
		border: 1px dashed var(--card-border);
		border-radius: 8px;
		color: var(--tp-text-soft);
		font: inherit;
		font-size: 0.76rem;
		padding: 5px 10px;
		cursor: pointer;
	}
	.add-cut:hover {
		border-color: var(--tp-border-strong);
		color: var(--tp-text);
	}

	/* Materialresultat */
	.mat-result {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 9px 11px;
		border-radius: 10px;
		background: var(--tp-accent-bg);
		border: 1px solid var(--tp-border-strong);
	}
	.mat-result .val {
		font-size: 0.92rem;
		font-weight: 600;
		color: var(--tp-text);
	}
	.mat-result .val.error {
		font-size: 0.82rem;
		font-weight: 500;
		color: #f0a0a0;
	}
	.mat-result .sub {
		font-size: 0.72rem;
		color: var(--tp-text-soft);
	}

	.add-material {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.add-material button {
		background: none;
		border: 1px dashed var(--card-border);
		border-radius: 8px;
		color: var(--tp-text-soft);
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 12px;
		cursor: pointer;
	}
	.add-material button:hover {
		border-color: var(--tp-border-strong);
		color: var(--tp-text);
	}

	.list-total {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		border-top: 1px solid var(--card-border);
		padding-top: 10px;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--tp-text);
	}

	.new-list {
		align-self: flex-start;
		background: var(--tp-accent-bg);
		border: 1px solid var(--tp-border-strong);
		border-radius: 99px;
		color: var(--tp-text);
		font: inherit;
		font-size: 0.85rem;
		padding: 8px 16px;
		cursor: pointer;
	}
	.new-list:hover:not(:disabled) {
		background: var(--tp-accent-bg-strong);
	}
	.new-list:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
