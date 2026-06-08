<script lang="ts">
	import { Button, Select } from '$lib/components/ui';
	import { CATEGORIES, SUBCATEGORIES } from '$lib/integrations/transaction-categories-client';
	import type { CategoryId } from '$lib/integrations/transaction-categories-client';

	interface MerchantMapping {
		id: string;
		merchantKey: string;
		category: string;
		subcategory: string | null;
		label: string;
		emoji: string | null;
		isFixed: boolean;
		txCount: number;
		avgMonthlyAmount: string | null;
		monthsActive: number;
		source: string;
		analyzedAt: string;
		updatedAt: string;
		hasOverride: boolean;
		overrideCategory: string | null;
	}

	interface Props {
		/** The mapping being edited (single override modal). Null when not shown. */
		selectedMapping: MerchantMapping | null;
		showOverrideModal: boolean;
		showBulkOverrideModal: boolean;
		mappings: MerchantMapping[];
		analyzing: boolean;
		onCreateOverride: (mappingId: string, category: string, subcategory: string | null) => Promise<void>;
		onBulkOverride: (fromCategory: string, toCategory: string) => Promise<void>;
		onCloseOverride: () => void;
		onCloseBulk: () => void;
	}

	let {
		selectedMapping,
		showOverrideModal,
		showBulkOverrideModal,
		mappings,
		analyzing,
		onCreateOverride,
		onBulkOverride,
		onCloseOverride,
		onCloseBulk
	}: Props = $props();

	let overrideCategory = $state('');
	let overrideSubcategory = $state('');
	let bulkFromCategory = $state('');
	let bulkToCategory = $state('');

	const categoryOptions = Object.values(CATEGORIES);

	function getCategoryLabel(categoryId: string): string {
		const cat = categoryOptions.find((c) => c.id === categoryId);
		return cat ? `${cat.emoji} ${cat.label}` : categoryId;
	}

	// Sync override fields when selectedMapping changes
	$effect(() => {
		if (selectedMapping) {
			overrideCategory = selectedMapping.overrideCategory || selectedMapping.category;
			overrideSubcategory = selectedMapping.subcategory || '';
		}
	});

	async function handleCreateOverride() {
		if (!selectedMapping || !overrideCategory) return;
		await onCreateOverride(selectedMapping.id, overrideCategory, overrideSubcategory || null);
		overrideCategory = '';
		overrideSubcategory = '';
	}

	async function handleBulkOverride() {
		if (!bulkFromCategory || !bulkToCategory) return;
		await onBulkOverride(bulkFromCategory, bulkToCategory);
		bulkFromCategory = '';
		bulkToCategory = '';
	}
</script>

{#if showOverrideModal && selectedMapping}
	<div
		class="modal-overlay"
		onclick={onCloseOverride}
		onkeydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && onCloseOverride()}
		role="button"
		tabindex="0"
	>
		<div
			class="modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<h3>Override kategori for {selectedMapping.label}</h3>
			<p class="modal-hint">
				AI foreslaar: {getCategoryLabel(selectedMapping.category)}
				{#if selectedMapping.hasOverride}
					<br />
					<strong>Navaerende override: {getCategoryLabel(selectedMapping.overrideCategory || selectedMapping.category)}</strong>
				{/if}
			</p>
			<div class="form-group">
				<label for="override-category">Velg kategori</label>
				<Select id="override-category" bind:value={overrideCategory} onChange={() => overrideSubcategory = ''} className="input">
					{#each categoryOptions as cat}
						<option value={cat.id}>{cat.emoji} {cat.label}</option>
					{/each}
				</Select>
			</div>
			{#if overrideCategory && SUBCATEGORIES[overrideCategory as CategoryId]?.length}
				<div class="form-group">
					<label for="override-subcategory">Velg underkategori (valgfritt)</label>
					<Select id="override-subcategory" bind:value={overrideSubcategory} className="input">
						<option value="">— Ingen underkategori —</option>
						{#each SUBCATEGORIES[overrideCategory as CategoryId]! as sub}
							<option value={sub.key}>{sub.label}</option>
						{/each}
					</Select>
				</div>
			{/if}
			<div class="modal-actions">
				<Button type="button" onClick={handleCreateOverride}>
					{selectedMapping.hasOverride ? 'Oppdater override' : 'Opprett override'}
				</Button>
				<Button type="button" variant="ghost" onClick={onCloseOverride}>
					Avbryt
				</Button>
			</div>
		</div>
	</div>
{/if}

{#if showBulkOverrideModal}
	<div
		class="modal-overlay"
		onclick={onCloseBulk}
		onkeydown={(e) => (e.key === 'Escape' || e.key === 'Enter') && onCloseBulk()}
		role="button"
		tabindex="0"
	>
		<div
			class="modal"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
			role="dialog"
			aria-modal="true"
			tabindex="-1"
		>
			<h3>Bulk Override</h3>
			<p class="modal-hint">
				Overstyr alle merchants i en kategori til en annen kategori.
			</p>
			<div class="form-group">
				<label for="bulk-from-category">Fra kategori</label>
				<Select id="bulk-from-category" bind:value={bulkFromCategory} className="input">
					<option value="">Velg kategori...</option>
					{#each categoryOptions as cat}
						<option value={cat.id}>{cat.emoji} {cat.label}</option>
					{/each}
				</Select>
			</div>
			<div class="form-group">
				<label for="bulk-to-category">Til kategori</label>
				<Select id="bulk-to-category" bind:value={bulkToCategory} className="input">
					<option value="">Velg kategori...</option>
					{#each categoryOptions as cat}
						<option value={cat.id}>{cat.emoji} {cat.label}</option>
					{/each}
				</Select>
			</div>
			{#if bulkFromCategory && bulkToCategory}
				{@const count = mappings.filter(m => {
					const currentCat = m.hasOverride ? m.overrideCategory : m.category;
					return currentCat === bulkFromCategory;
				}).length}
				<p class="bulk-preview">
					{count} merchant{count !== 1 ? 's' : ''} vil bli pavirket
				</p>
			{/if}
			<div class="modal-actions">
				<Button
					type="button"
					onClick={handleBulkOverride}
					disabled={!bulkFromCategory || !bulkToCategory || analyzing}
				>
					{analyzing ? 'Behandler...' : 'Utfor bulk override'}
				</Button>
				<Button type="button" variant="ghost" onClick={onCloseBulk}>
					Avbryt
				</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 100;
	}

	.modal {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 1.5rem;
		max-width: 500px;
		width: 90%;
	}

	.modal h3 {
		margin: 0 0 0.5rem 0;
		font-size: 1.25rem;
		font-weight: 600;
		color: #eee;
	}

	.modal-hint {
		margin: 0 0 1.5rem 0;
		font-size: 0.9rem;
		color: #999;
	}

	.bulk-preview {
		margin: 1rem 0;
		padding: 0.75rem;
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.3);
		border-radius: 8px;
		color: #f59e0b;
		font-weight: 600;
		text-align: center;
	}

	.form-group {
		margin-bottom: 1.5rem;
	}

	.form-group label {
		display: block;
		margin-bottom: 0.5rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: #bbb;
	}

	:global(select.input) {
		width: 100%;
		box-sizing: border-box;
		background: #0f0f0f;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 0.75rem;
		color: #ddd;
		font: inherit;
		font-size: 0.9rem;
	}

	:global(select.input:focus) {
		outline: none;
		border-color: #4a5af0;
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
	}
</style>
