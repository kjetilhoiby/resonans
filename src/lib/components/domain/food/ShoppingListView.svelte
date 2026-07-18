<!--
  ShoppingListView — ukas handleliste med Oda-søkelenker og kopierbar tekst.
  Brukes i onsdagsøkta (steg 2 og 3) og fra FoodDashboard. Avhuking PATCHes
  til shopping_lists; «Kopier» legger uavhukede varer på utklippstavla.
-->
<script lang="ts">
	import ChecklistCheckbox from '../../ui/ChecklistCheckbox.svelte';
	import { shoppingListToPlainText } from '$lib/domains/food/oda';

	type Item = {
		id: string;
		name: string;
		normalizedName: string;
		quantity?: number | null;
		unit?: string | null;
		sources: string[];
		checked: boolean;
		manual: boolean;
		odaUrl?: string;
	};

	interface Props {
		listId: string;
		items: Item[];
		/** Vis Oda-lenker og kopier/åpne-knapper (steg 3 / dashboard). */
		odaMode?: boolean;
		/** Lar bruker fjerne varer («har vi allerede») og legge til egne. */
		editable?: boolean;
		onItemsChanged?: (items: Item[]) => void;
	}

	let { listId, items = $bindable(), odaMode = false, editable = false, onItemsChanged }: Props = $props();

	let newItemText = $state('');
	let copied = $state(false);

	async function persist() {
		onItemsChanged?.(items);
		await fetch(`/api/food/shopping-list/${listId}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ items: items.map(({ odaUrl: _odaUrl, ...rest }) => rest) })
		});
	}

	function toggle(item: Item) {
		items = items.map((i) => (i.id === item.id ? { ...i, checked: !i.checked } : i));
		void persist();
	}

	function remove(item: Item) {
		items = items.filter((i) => i.id !== item.id);
		void persist();
	}

	function addManual() {
		const name = newItemText.trim();
		if (!name) return;
		items = [
			...items,
			{
				id: crypto.randomUUID(),
				name,
				normalizedName: name.toLowerCase().trim(),
				quantity: null,
				unit: null,
				sources: ['manuell'],
				checked: false,
				manual: true
			}
		];
		newItemText = '';
		void persist();
	}

	function quantityLabel(item: Item): string | null {
		if (item.quantity == null) return null;
		const qty = Number.isInteger(item.quantity) ? item.quantity : Number(item.quantity).toFixed(1).replace('.', ',');
		return item.unit ? `${qty} ${item.unit}` : String(qty);
	}

	async function copyList() {
		await navigator.clipboard.writeText(shoppingListToPlainText(items));
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const remaining = $derived(items.filter((i) => !i.checked).length);
</script>

<div class="slv">
	{#if items.length === 0}
		<p class="slv-empty">Handlelisten er tom — velg middager først, så bygges lista fra oppskriftene.</p>
	{:else}
		<ul class="slv-list">
			{#each items as item (item.id)}
				<li class="slv-row" class:checked={item.checked}>
					<ChecklistCheckbox checked={item.checked} onclick={() => toggle(item)} />
					<div class="slv-main">
						<span class="slv-name">{item.name}</span>
						<span class="slv-meta">
							{#if quantityLabel(item)}{quantityLabel(item)} · {/if}
							{item.sources.join(', ')}
						</span>
					</div>
					{#if odaMode && item.odaUrl}
						<a
							class="slv-oda"
							href={item.odaUrl}
							target="_blank"
							rel="noopener noreferrer"
							aria-label={`Søk etter ${item.name} i Oda`}
							data-track="matplan:oda-lenke"
						>↗</a>
					{/if}
					{#if editable}
						<button class="slv-remove" onclick={() => remove(item)} aria-label={`Fjern ${item.name} fra lista`} data-track="matplan:fjern-vare">✕</button>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if editable}
		<div class="slv-add">
			<input
				bind:value={newItemText}
				placeholder="+ Legg til vare (melk, brød …)"
				onkeydown={(e) => e.key === 'Enter' && addManual()}
				data-track="matplan:ny-vare"
			/>
		</div>
	{/if}

	{#if odaMode && items.length > 0}
		<div class="slv-actions">
			<button class="slv-action" onclick={copyList} data-track="matplan:kopier-liste">
				{copied ? 'Kopiert ✓' : `📋 Kopier handleliste (${remaining})`}
			</button>
			<a
				class="slv-action slv-action-primary"
				href="https://oda.com/no/"
				target="_blank"
				rel="noopener noreferrer"
				data-track="matplan:apne-oda"
			>
				Åpne Oda →
			</a>
		</div>
	{/if}
</div>

<style>
	.slv {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.slv-empty {
		color: var(--color-text-secondary, #999);
		font-size: 0.9rem;
		padding: 12px 0;
	}
	.slv-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.slv-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 4px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}
	.slv-row.checked .slv-name {
		text-decoration: line-through;
		opacity: 0.5;
	}
	.slv-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.slv-name {
		font-size: 0.92rem;
	}
	.slv-meta {
		font-size: 0.74rem;
		color: var(--color-text-secondary, #888);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.slv-oda {
		color: var(--accent-fg, #aab8ff);
		text-decoration: none;
		font-size: 1rem;
		padding: 6px 10px;
		border-radius: 8px;
		background: rgba(124, 142, 245, 0.12);
	}
	.slv-remove {
		background: none;
		border: none;
		color: var(--color-text-secondary, #777);
		cursor: pointer;
		padding: 6px;
		font-size: 0.8rem;
	}
	.slv-add input {
		width: 100%;
		background: var(--input-bg, rgba(255, 255, 255, 0.05));
		border: 1px solid var(--input-border, rgba(255, 255, 255, 0.1));
		border-radius: 10px;
		color: inherit;
		padding: 10px 12px;
		font-size: 0.9rem;
	}
	.slv-actions {
		display: flex;
		gap: 10px;
	}
	.slv-action {
		flex: 1;
		text-align: center;
		background: rgba(255, 255, 255, 0.07);
		border: none;
		border-radius: 12px;
		color: inherit;
		padding: 13px 12px;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		text-decoration: none;
	}
	.slv-action-primary {
		background: var(--accent-bg, rgba(124, 142, 245, 0.2));
		color: var(--accent-fg, #aab8ff);
	}
</style>
