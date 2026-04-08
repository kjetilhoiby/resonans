<!--
  TripListsPanel — lister knyttet til et reise-tema.
  Støtter: itinerary, aktivitetsforslag, pakkelister, generelle lister.
  Hvert element kan krysses av, ha dato (itinerary), og notater.
-->
<script lang="ts">
	export interface ThemeListItem {
		id: string;
		text: string;
		checked: boolean;
		notes?: string | null;
		itemDate?: string | null;
		sortOrder: number;
	}

	export interface ThemeList {
		id: string;
		title: string;
		emoji: string;
		listType: string;
		sortOrder: number;
		items: ThemeListItem[];
	}

	interface Props {
		themeId: string;
		lists: ThemeList[];
	}

	let { themeId, lists = $bindable([]) }: Props = $props();

	const LIST_TYPES = [
		{ value: 'general',    label: 'Huskeliste',       emoji: '📝' },
		{ value: 'itinerary',  label: 'Dag-for-dag',      emoji: '🗓️' },
		{ value: 'activities', label: 'Aktivitetsforslag', emoji: '🏄' },
		{ value: 'packing',    label: 'Pakkeliste',        emoji: '🎒' }
	];

	/* ── Ny liste ─────────────────────────────────── */
	let creatingList = $state(false);
	let newListTitle = $state('');
	let newListType = $state('general');
	let newListEmoji = $state('📝');
	let createError = $state('');
	let createSaving = $state(false);

	function startCreateList() {
		newListTitle = '';
		newListType = 'general';
		newListEmoji = '📝';
		createError = '';
		creatingList = true;
	}

	function onTypeChange() {
		const t = LIST_TYPES.find((t) => t.value === newListType);
		if (t) newListEmoji = t.emoji;
	}

	async function saveNewList() {
		if (!newListTitle.trim()) { createError = 'Gi listen et navn.'; return; }
		createSaving = true;
		createError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/lists`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ title: newListTitle.trim(), emoji: newListEmoji, listType: newListType })
			});
			if (!res.ok) throw new Error('create_failed');
			const data: ThemeList = await res.json();
			lists = [...lists, { ...data, items: [] }];
			creatingList = false;
		} catch {
			createError = 'Klarte ikke opprette liste.';
		} finally {
			createSaving = false;
		}
	}

	/* ── Åpen liste ───────────────────────────────── */
	let openListId = $state<string | null>(null);

	function toggleList(id: string) {
		openListId = openListId === id ? null : id;
	}

	/* ── Legg til element ─────────────────────────── */
	let addingItemListId = $state<string | null>(null);
	let newItemText = $state('');
	let newItemDate = $state('');
	let addItemError = $state('');
	let addItemSaving = $state(false);

	function startAddItem(listId: string) {
		addingItemListId = listId;
		newItemText = '';
		newItemDate = '';
		addItemError = '';
	}

	async function saveNewItem(listId: string) {
		if (!newItemText.trim()) { addItemError = 'Skriv inn tekst.'; return; }
		addItemSaving = true;
		addItemError = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/lists/${listId}/items`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: newItemText.trim(), itemDate: newItemDate || null })
			});
			if (!res.ok) throw new Error('add_failed');
			const item: ThemeListItem = await res.json();
			lists = lists.map((l) =>
				l.id === listId ? { ...l, items: [...l.items, item] } : l
			);
			addingItemListId = null;
		} catch {
			addItemError = 'Klarte ikke legge til element.';
		} finally {
			addItemSaving = false;
		}
	}

	/* ── Avkrysning ───────────────────────────────── */
	async function toggleItem(listId: string, item: ThemeListItem) {
		const newChecked = !item.checked;
		// Optimistic update
		lists = lists.map((l) =>
			l.id === listId
				? { ...l, items: l.items.map((i) => i.id === item.id ? { ...i, checked: newChecked } : i) }
				: l
		);
		try {
			await fetch(`/api/tema/${themeId}/lists/${listId}/items/${item.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ checked: newChecked })
			});
		} catch {
			// Revert on failure
			lists = lists.map((l) =>
				l.id === listId
					? { ...l, items: l.items.map((i) => i.id === item.id ? { ...i, checked: item.checked } : i) }
					: l
			);
		}
	}

	/* ── Slett element ────────────────────────────── */
	async function deleteItem(listId: string, itemId: string) {
		lists = lists.map((l) =>
			l.id === listId ? { ...l, items: l.items.filter((i) => i.id !== itemId) } : l
		);
		await fetch(`/api/tema/${themeId}/lists/${listId}/items/${itemId}`, { method: 'DELETE' });
	}

	/* ── Slett liste ──────────────────────────────── */
	async function deleteList(listId: string) {
		if (!confirm('Slett listen og alle elementene i den?')) return;
		lists = lists.filter((l) => l.id !== listId);
		await fetch(`/api/tema/${themeId}/lists/${listId}`, { method: 'DELETE' });
	}

	/* ── Helpers ──────────────────────────────────── */
	function progressPct(list: ThemeList): number {
		if (list.items.length === 0) return 0;
		return Math.round((list.items.filter((i) => i.checked).length / list.items.length) * 100);
	}

	function fmtItemDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
	}
</script>

<div class="tl-panel">
	<!-- ── Liste-oversikt ── -->
	{#if lists.length === 0 && !creatingList}
		<div class="tl-empty">
			<p>Ingen lister ennå.</p>
			<p class="tl-empty-hint">Lag itinerary, pakkelister, aktivitetsforslag…</p>
		</div>
	{/if}

	{#each lists as list}
		{@const pct = progressPct(list)}
		{@const isOpen = openListId === list.id}
		<div class="tl-list-card" class:tl-list-open={isOpen}>
			<!-- Header -->
			<button class="tl-list-header" onclick={() => toggleList(list.id)} aria-expanded={isOpen}>
				<span class="tl-list-emoji">{list.emoji}</span>
				<span class="tl-list-title">{list.title}</span>
				<span class="tl-list-meta">
					{#if list.items.length > 0}
						<span class="tl-progress-text">{list.items.filter(i => i.checked).length}/{list.items.length}</span>
					{/if}
					<svg class="tl-chevron" class:tl-chevron-open={isOpen} viewBox="0 0 16 16" width="14" height="14">
						<path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/>
					</svg>
				</span>
			</button>

			{#if list.items.length > 0}
				<div class="tl-progress-bar">
					<div class="tl-progress-fill" style="width:{pct}%"></div>
				</div>
			{/if}

			<!-- Items -->
			{#if isOpen}
				<div class="tl-items">
					{#each list.items as item}
						<div class="tl-item" class:tl-item-checked={item.checked}>
							<button
								class="tl-checkbox"
								class:tl-checked={item.checked}
								onclick={() => toggleItem(list.id, item)}
								aria-label={item.checked ? 'Merk som ikke gjort' : 'Merk som gjort'}
							>
								{#if item.checked}✓{/if}
							</button>
							<div class="tl-item-body">
								{#if item.itemDate}
									<span class="tl-item-date">{fmtItemDate(item.itemDate)}</span>
								{/if}
								<span class="tl-item-text">{item.text}</span>
								{#if item.notes}
									<span class="tl-item-notes">{item.notes}</span>
								{/if}
							</div>
							<button class="tl-item-delete" onclick={() => deleteItem(list.id, item.id)} aria-label="Slett punkt">✕</button>
						</div>
					{/each}

					<!-- Legg til element -->
					{#if addingItemListId === list.id}
						<div class="tl-add-item-form">
							{#if list.listType === 'itinerary'}
								<input
									class="tl-input tl-date-input"
									type="date"
									bind:value={newItemDate}
									placeholder="Dato"
								/>
							{/if}
							<input
								class="tl-input tl-text-input"
								type="text"
								bind:value={newItemText}
								placeholder="Nytt punkt…"
								onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveNewItem(list.id)}
							/>
							{#if addItemError}
								<p class="tl-error">{addItemError}</p>
							{/if}
							<div class="tl-add-item-actions">
								<button class="tl-btn-primary" onclick={() => saveNewItem(list.id)} disabled={addItemSaving}>
									{addItemSaving ? '…' : 'Legg til'}
								</button>
								<button class="tl-btn-ghost" onclick={() => { addingItemListId = null; }}>Avbryt</button>
							</div>
						</div>
					{:else}
						<button class="tl-add-item-btn" onclick={() => startAddItem(list.id)}>+ Legg til punkt</button>
					{/if}

					<div class="tl-list-footer">
						<button class="tl-delete-list-btn" onclick={() => deleteList(list.id)}>Slett liste</button>
					</div>
				</div>
			{/if}
		</div>
	{/each}

	<!-- ── Opprett ny liste ── -->
	{#if creatingList}
		<div class="tl-create-form">
			<label class="tl-field">
				<span class="tl-field-label">Type liste</span>
				<select class="tl-input" bind:value={newListType} onchange={onTypeChange}>
					{#each LIST_TYPES as t}
						<option value={t.value}>{t.emoji} {t.label}</option>
					{/each}
				</select>
			</label>
			<label class="tl-field">
				<span class="tl-field-label">Navn</span>
				<input
					class="tl-input"
					type="text"
					bind:value={newListTitle}
					placeholder="f.eks. Dag 1 – Ankomst Tokyo"
					onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && saveNewList()}
				/>
			</label>
			{#if createError}
				<p class="tl-error">{createError}</p>
			{/if}
			<div class="tl-create-actions">
				<button class="tl-btn-primary" onclick={saveNewList} disabled={createSaving}>
					{createSaving ? 'Oppretter…' : 'Opprett'}
				</button>
				<button class="tl-btn-ghost" onclick={() => { creatingList = false; }}>Avbryt</button>
			</div>
		</div>
	{:else}
		<button class="tl-new-list-btn" onclick={startCreateList}>+ Ny liste</button>
	{/if}
</div>

<style>
	.tl-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 8px 16px 24px;
	}

	.tl-empty {
		text-align: center;
		padding: 32px 0 12px;
		color: var(--tp-text-muted);
		font-size: 0.88rem;
	}
	.tl-empty-hint {
		font-size: 0.8rem;
		margin: 4px 0 0;
		color: var(--tp-text-muted);
	}

	/* List card */
	.tl-list-card {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border);
		border-radius: 12px;
		overflow: hidden;
	}
	.tl-list-open { border-color: var(--tp-border-strong); }

	.tl-list-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		width: 100%;
		background: none;
		border: none;
		cursor: pointer;
		color: var(--tp-text);
		text-align: left;
	}
	.tl-list-emoji { font-size: 1.2rem; flex-shrink: 0; }
	.tl-list-title { flex: 1; font-size: 0.92rem; font-weight: 600; }
	.tl-list-meta {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--tp-text-muted);
		font-size: 0.78rem;
	}
	.tl-chevron { transition: transform 0.18s ease; color: var(--tp-text-muted); }
	.tl-chevron-open { transform: rotate(180deg); }

	/* Progress bar */
	.tl-progress-bar {
		height: 2px;
		background: var(--tp-border);
		margin: 0;
	}
	.tl-progress-fill {
		height: 100%;
		background: var(--tp-accent);
		transition: width 0.3s ease;
	}

	/* Items */
	.tl-items {
		padding: 8px 12px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.tl-item {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 6px 4px;
		border-radius: 6px;
	}
	.tl-item-checked .tl-item-text {
		text-decoration: line-through;
		color: var(--tp-text-muted);
	}

	.tl-checkbox {
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		border: 1.5px solid var(--tp-border-strong);
		border-radius: 5px;
		background: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.7rem;
		color: var(--tp-accent);
		margin-top: 1px;
	}
	.tl-checked {
		background: var(--tp-accent-bg);
		border-color: var(--tp-accent);
	}

	.tl-item-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.tl-item-date {
		font-size: 0.7rem;
		color: var(--tp-accent);
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.tl-item-text {
		font-size: 0.88rem;
		color: var(--tp-text-soft);
		line-height: 1.35;
	}
	.tl-item-notes {
		font-size: 0.75rem;
		color: var(--tp-text-muted);
	}

	.tl-item-delete {
		background: none;
		border: none;
		color: var(--tp-text-muted);
		font-size: 0.72rem;
		cursor: pointer;
		padding: 2px 4px;
		opacity: 0;
		transition: opacity 0.15s;
		border-radius: 4px;
		flex-shrink: 0;
	}
	.tl-item:hover .tl-item-delete { opacity: 1; }
	.tl-item-delete:hover { color: #e07070; }

	/* Add item form */
	.tl-add-item-form {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px 0 4px;
	}
	.tl-input {
		background: var(--tp-bg-1, hsl(228 22% 8%));
		border: 1px solid var(--tp-border);
		border-radius: 7px;
		color: var(--tp-text);
		font-size: 0.86rem;
		padding: 7px 10px;
		outline: none;
		width: 100%;
		box-sizing: border-box;
	}
	.tl-input:focus { border-color: var(--tp-border-strong); }
	.tl-date-input { font-size: 0.8rem; }
	.tl-text-input { flex: 1; }

	.tl-add-item-actions {
		display: flex;
		gap: 8px;
	}
	.tl-add-item-btn {
		background: none;
		border: 1px dashed var(--tp-border);
		border-radius: 7px;
		color: var(--tp-text-muted);
		font-size: 0.82rem;
		padding: 7px 12px;
		cursor: pointer;
		width: 100%;
		text-align: left;
		margin-top: 4px;
	}
	.tl-add-item-btn:hover { border-color: var(--tp-border-strong); color: var(--tp-text-soft); }

	.tl-list-footer {
		display: flex;
		justify-content: flex-end;
		padding-top: 8px;
		border-top: 1px solid var(--tp-border);
		margin-top: 4px;
	}
	.tl-delete-list-btn {
		background: none;
		border: none;
		color: var(--tp-text-muted);
		font-size: 0.75rem;
		cursor: pointer;
		padding: 4px 6px;
		border-radius: 4px;
	}
	.tl-delete-list-btn:hover { color: #e07070; }

	/* Create form */
	.tl-create-form {
		background: var(--tp-bg-2);
		border: 1px solid var(--tp-border-strong);
		border-radius: 12px;
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.tl-field { display: flex; flex-direction: column; gap: 4px; }
	.tl-field-label {
		font-size: 0.73rem;
		color: var(--tp-text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.tl-create-actions { display: flex; gap: 8px; }

	/* Buttons */
	.tl-btn-primary {
		background: var(--tp-accent);
		border: none;
		border-radius: 7px;
		color: hsl(var(--theme-hue, 228) 20% 8%);
		font-size: 0.84rem;
		font-weight: 600;
		padding: 7px 14px;
		cursor: pointer;
	}
	.tl-btn-primary:disabled { opacity: 0.55; cursor: default; }
	.tl-btn-ghost {
		background: none;
		border: 1px solid var(--tp-border);
		border-radius: 7px;
		color: var(--tp-text-soft);
		font-size: 0.84rem;
		padding: 7px 14px;
		cursor: pointer;
	}

	.tl-new-list-btn {
		background: var(--tp-bg-2);
		border: 1px dashed var(--tp-border-strong);
		border-radius: 12px;
		color: var(--tp-text-soft);
		font-size: 0.88rem;
		padding: 12px;
		cursor: pointer;
		width: 100%;
		text-align: center;
	}
	.tl-new-list-btn:hover { border-color: var(--tp-accent); color: var(--tp-accent); }

	.tl-error {
		font-size: 0.78rem;
		color: #e07070;
		margin: 0;
	}
</style>
