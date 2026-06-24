<!--
  ThemeKapplisteTab — Kapplister-fanen i ThemePage (prosjekt-undertema).
  Lar deg lage materiallister: dimensjon, ønskede lengder, antall og meterpris.
  Regner ut hvor mange hele fjøler du må kjøpe (optimal kapping) og hva det koster.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { computeCutList, formatNok, formatMeters, type CutListRow } from '$lib/kappliste/calc';

	interface CutList {
		id: string;
		title: string;
		boardLengthCm: number;
		kerfMm: number;
		rows: CutListRow[];
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

	function result(list: CutList) {
		return computeCutList(list.rows, list.boardLengthCm, list.kerfMm);
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
				body: JSON.stringify({
					title: list.title,
					boardLengthCm: list.boardLengthCm,
					kerfMm: list.kerfMm,
					rows: list.rows
				})
			});
		} finally {
			const next = new Set(savingIds);
			next.delete(id);
			savingIds = next;
		}
	}

	function patchList(id: string, patch: Partial<CutList>) {
		lists = lists.map((l) => (l.id === id ? { ...l, ...patch } : l));
		scheduleSave(id);
	}

	/* ── Rader ──────────────────────────────────────────── */
	function patchRow(listId: string, rowId: string, patch: Partial<CutListRow>) {
		lists = lists.map((l) =>
			l.id === listId ? { ...l, rows: l.rows.map((r) => (r.id === rowId ? { ...r, ...patch } : r)) } : l
		);
		scheduleSave(listId);
	}

	function addRow(listId: string) {
		const list = lists.find((l) => l.id === listId);
		const lastDim = list?.rows.at(-1)?.dimension ?? '';
		const lastPrice = list?.rows.at(-1)?.meterPriceNok ?? 0;
		const newRow: CutListRow = {
			id: crypto.randomUUID(),
			dimension: lastDim,
			lengthCm: 0,
			quantity: 1,
			meterPriceNok: lastPrice
		};
		lists = lists.map((l) => (l.id === listId ? { ...l, rows: [...l.rows, newRow] } : l));
		scheduleSave(listId);
	}

	function removeRow(listId: string, rowId: string) {
		lists = lists.map((l) => (l.id === listId ? { ...l, rows: l.rows.filter((r) => r.id !== rowId) } : l));
		scheduleSave(listId);
	}

	/* ── Lister ─────────────────────────────────────────── */
	async function createList() {
		if (creating) return;
		creating = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/kapplister`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: `Kappliste ${lists.length + 1}`, boardLengthCm: 390 })
			});
			if (res.ok) {
				const { cutList } = await res.json();
				// Start med én tom rad så det er noe å fylle ut.
				cutList.rows = [{ id: crypto.randomUUID(), dimension: '', lengthCm: 0, quantity: 1, meterPriceNok: 0 }];
				lists = [...lists, cutList];
				scheduleSave(cutList.id);
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
		Lag en kappliste for prosjektet: dimensjon, ønskede lengder, antall og meterpris. Resonans regner ut hvor
		mange hele fjøler du må kjøpe (optimal kapping) og hva det koster.
	</p>

	{#each lists as list (list.id)}
		{@const res = result(list)}
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

			<label class="board-len">
				<span>Fjøllengde</span>
				<span class="board-len-field">
					<input
						type="text"
						inputmode="decimal"
						value={(list.boardLengthCm / 100).toString().replace('.', ',')}
						data-track="kappliste:fjollengde"
						onchange={(e) => {
							const cm = Math.round(parseNum(e.currentTarget.value) * 100);
							patchList(list.id, { boardLengthCm: cm > 0 ? cm : 390 });
						}}
					/>
					<span class="unit">m</span>
				</span>
			</label>

			<!-- Rader -->
			<div class="rows" role="table" aria-label="Kappliste-rader">
				<div class="row head" role="row">
					<span role="columnheader">Dimensjon</span>
					<span role="columnheader">Lengde</span>
					<span role="columnheader">Antall</span>
					<span role="columnheader">Meterpris</span>
					<span role="columnheader" aria-label="Handlinger"></span>
				</div>
				{#each list.rows as row (row.id)}
					<div class="row" role="row">
						<input
							class="cell"
							type="text"
							placeholder="48x48"
							value={row.dimension}
							data-track="kappliste:dimensjon"
							oninput={(e) => patchRow(list.id, row.id, { dimension: e.currentTarget.value })}
							aria-label="Dimensjon"
						/>
						<span class="cell with-unit">
							<input
								type="text"
								inputmode="numeric"
								placeholder="120"
								value={row.lengthCm || ''}
								data-track="kappliste:lengde"
								oninput={(e) => patchRow(list.id, row.id, { lengthCm: Math.round(parseNum(e.currentTarget.value)) })}
								aria-label="Lengde i cm"
							/><span class="suffix">cm</span>
						</span>
						<input
							class="cell narrow"
							type="text"
							inputmode="numeric"
							placeholder="5"
							value={row.quantity || ''}
							data-track="kappliste:antall"
							oninput={(e) => patchRow(list.id, row.id, { quantity: Math.round(parseNum(e.currentTarget.value)) })}
							aria-label="Antall"
						/>
						<span class="cell with-unit">
							<input
								type="text"
								inputmode="decimal"
								placeholder="54"
								value={row.meterPriceNok || ''}
								data-track="kappliste:meterpris"
								oninput={(e) => patchRow(list.id, row.id, { meterPriceNok: parseNum(e.currentTarget.value) })}
								aria-label="Meterpris i kroner"
							/><span class="suffix">kr/m</span>
						</span>
						<button class="icon-btn small" onclick={() => removeRow(list.id, row.id)} aria-label="Slett rad">✕</button>
					</div>
				{/each}
			</div>

			<button class="add-row" onclick={() => addRow(list.id)} data-track="kappliste:ny-rad">+ Legg til rad</button>

			<!-- Resultat -->
			{#if res.dimensions.length > 0}
				<div class="result">
					{#each res.dimensions as dim (dim.dimension)}
						<div class="result-line" class:error={dim.tooLong.length > 0}>
							<span class="result-dim">{dim.dimension}</span>
							{#if dim.tooLong.length > 0}
								<span class="result-val error">
									{dim.tooLong.length === 1 ? 'Bit' : 'Biter'} på {dim.tooLong.join(', ')} cm er lengre enn fjølen
								</span>
							{:else}
								<span class="result-val">
									{dim.boardsNeeded} {dim.boardsNeeded === 1 ? 'fjøl' : 'fjøler'} ({formatNok(dim.costNok)})
								</span>
								<span class="result-sub">
									à {formatMeters(res.boardLengthCm)}{#if dim.piecesPerFullBoard > 0} · {dim.piecesPerFullBoard} biter per fjøl{/if}{#if dim.wasteCm > 0} · {Math.round(dim.wasteCm)} cm kapp{/if}
								</span>
							{/if}
						</div>
					{/each}
					{#if res.dimensions.length > 1 && !res.hasErrors}
						<div class="result-total">
							<span>Totalt</span>
							<span>{res.totalBoards} fjøler · {formatNok(res.totalCostNok)}</span>
						</div>
					{/if}
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
	.board-len {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.82rem;
		color: var(--tp-text-soft);
	}
	.board-len-field {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.board-len-field input {
		width: 64px;
		text-align: right;
		background: var(--tp-bg-1);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		color: var(--tp-text);
		font: inherit;
		font-size: 0.85rem;
		padding: 5px 8px;
	}
	.unit {
		color: var(--tp-text-muted);
		font-size: 0.8rem;
	}

	/* Rader-grid */
	.rows {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) 56px minmax(0, 1fr) 28px;
		gap: 6px;
		align-items: center;
	}
	.row.head {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--tp-text-muted);
		padding: 0 2px;
	}
	.cell,
	.cell.with-unit input {
		width: 100%;
		min-width: 0;
		background: var(--tp-bg-1);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		color: var(--tp-text);
		font: inherit;
		font-size: 0.85rem;
		padding: 7px 8px;
	}
	.cell:focus,
	.cell.with-unit input:focus {
		outline: none;
		border-color: var(--tp-border-strong);
	}
	.cell.with-unit {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		background: var(--tp-bg-1);
		border: 1px solid var(--card-border);
		border-radius: 8px;
		padding-right: 7px;
	}
	.cell.with-unit input {
		border: 0;
		padding-right: 2px;
		text-align: right;
	}
	.cell.narrow {
		text-align: center;
	}
	.suffix {
		font-size: 0.72rem;
		color: var(--tp-text-muted);
		flex-shrink: 0;
	}

	.add-row {
		align-self: flex-start;
		background: none;
		border: 1px dashed var(--card-border);
		border-radius: 8px;
		color: var(--tp-text-soft);
		font: inherit;
		font-size: 0.8rem;
		padding: 6px 12px;
		cursor: pointer;
	}
	.add-row:hover {
		border-color: var(--tp-border-strong);
		color: var(--tp-text);
	}

	/* Resultat */
	.result {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-radius: 12px;
		background: var(--tp-accent-bg);
		border: 1px solid var(--tp-border-strong);
	}
	.result-line {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.result-dim {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--tp-text-muted);
	}
	.result-val {
		font-size: 0.98rem;
		font-weight: 600;
		color: var(--tp-text);
	}
	.result-val.error {
		font-size: 0.85rem;
		font-weight: 500;
		color: #f0a0a0;
	}
	.result-sub {
		font-size: 0.74rem;
		color: var(--tp-text-soft);
	}
	.result-total {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		border-top: 1px solid var(--tp-border-strong);
		padding-top: 8px;
		font-size: 0.92rem;
		font-weight: 600;
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
