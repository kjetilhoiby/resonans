<script lang="ts">
	import { Button, Input, Select } from '$lib/components/ui';
	import { CATEGORIES } from '$lib/integrations/transaction-categories-client';

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
		mappings: MerchantMapping[];
		loading: boolean;
		deleting: string | null;
		onDelete: (id: string) => void;
		onOverride: (mapping: MerchantMapping) => void;
		onBulkOverride: () => void;
	}

	let { mappings, loading, deleting, onDelete, onOverride, onBulkOverride }: Props = $props();

	let filterCategory = $state<string>('all');
	let filterSource = $state<string>('all');
	let searchQuery = $state('');

	const categoryOptions = Object.values(CATEGORIES);

	function getCategoryLabel(categoryId: string): string {
		const cat = categoryOptions.find((c) => c.id === categoryId);
		return cat ? `${cat.emoji} ${cat.label}` : categoryId;
	}

	function formatAmount(amount: string | null): string {
		if (!amount) return '-';
		return `${Math.round(Number(amount)).toLocaleString('nb-NO')} kr/mnd`;
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', {
			day: '2-digit',
			month: 'short',
			year: 'numeric'
		}).format(new Date(iso));
	}

	const filteredMappings = $derived.by(() => {
		let result = mappings;

		if (filterCategory !== 'all') {
			result = result.filter((m) =>
				m.hasOverride ? m.overrideCategory === filterCategory : m.category === filterCategory
			);
		}

		if (filterSource !== 'all') {
			result = result.filter((m) => m.source === filterSource);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			result = result.filter((m) =>
				m.label.toLowerCase().includes(query) ||
				m.merchantKey.toLowerCase().includes(query)
			);
		}

		return result;
	});

	const stats = $derived.by(() => ({
		total: mappings.length,
		aiGenerated: mappings.filter((m) => m.source === 'ai').length,
		withOverrides: mappings.filter((m) => m.hasOverride).length
	}));

	const topOverridden = $derived.by(() => {
		return mappings
			.filter((m) => m.hasOverride)
			.sort((a, b) => (b.txCount || 0) - (a.txCount || 0))
			.slice(0, 10);
	});
</script>

<section class="stats-bar">
	<div class="stat">
		<span class="stat-value">{stats.total}</span>
		<span class="stat-label">Merchants</span>
	</div>
	<div class="stat">
		<span class="stat-value">{stats.aiGenerated}</span>
		<span class="stat-label">AI-generert</span>
	</div>
	<div class="stat">
		<span class="stat-value">{stats.withOverrides}</span>
		<span class="stat-label">Med override</span>
	</div>
</section>

<section class="filters">
	<Input
		bind:value={searchQuery}
		placeholder="Sok etter merchant..."
		className="search-input"
	/>
	<Select bind:value={filterCategory} className="filter-select">
		<option value="all">Alle kategorier</option>
		{#each categoryOptions as cat}
			<option value={cat.id}>{cat.emoji} {cat.label}</option>
		{/each}
	</Select>
	<Select bind:value={filterSource} className="filter-select">
		<option value="all">Alle kilder</option>
		<option value="ai">AI-generert</option>
		<option value="rule">Regel-basert</option>
		<option value="manual">Manuell</option>
	</Select>
</section>

{#if topOverridden.length > 0}
	<section class="override-analytics">
		<div class="analytics-header">
			<h2>Merchants du har overstyrt ({stats.withOverrides} totalt)</h2>
			<Button
				type="button"
				variant="secondary"
				onClick={onBulkOverride}
				title="Overstyr mange merchants samtidig"
			>
				Bulk override
			</Button>
		</div>
		<p class="analytics-hint">
			Viser merchants hvor du manuelt har endret AI-kategoriseringen. Dette er nyttig for a identifisere hvor AI-modellen systematisk gjor feil.
		</p>
		<ul class="override-list">
			{#each topOverridden as mapping}
				<li class="override-item">
					<div class="override-header">
						<span class="override-label">
							{#if mapping.emoji}<span class="emoji">{mapping.emoji}</span>{/if}
							{mapping.label}
						</span>
						<span class="override-stats">{mapping.txCount} tx</span>
					</div>
					<div class="override-change">
						<span class="old-cat">{getCategoryLabel(mapping.category)}</span>
						<span class="arrow">&rarr;</span>
						<span class="new-cat">{getCategoryLabel(mapping.overrideCategory || mapping.category)}</span>
					</div>
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if loading}
	<div class="loading">Laster merchants...</div>
{:else}
	<section class="merchants-section">
		<h2>Merchants ({filteredMappings.length})</h2>
		{#if filteredMappings.length === 0}
			<p class="empty">Ingen merchants funnet. Kjor AI-analyse fra okonomioversikten.</p>
		{:else}
			<ul class="merchant-list">
				{#each filteredMappings as mapping}
					<li class="merchant-item">
						<div class="merchant-main">
							<div class="merchant-header">
								<div class="merchant-label">
									{#if mapping.emoji}
										<span class="emoji">{mapping.emoji}</span>
									{/if}
									<span class="label">{mapping.label}</span>
								</div>
								<div class="merchant-meta">
									{#if mapping.hasOverride}
										<span class="badge override">Override</span>
									{/if}
									{#if mapping.isFixed}
										<span class="badge fixed">Fast utgift</span>
									{/if}
									<span class="badge source">{mapping.source}</span>
								</div>
							</div>
							<div class="merchant-details">
								<span class="detail-item">
									{getCategoryLabel(mapping.hasOverride ? (mapping.overrideCategory || mapping.category) : mapping.category)}
								</span>
								{#if mapping.subcategory}
									<span class="detail-item subcategory">{mapping.subcategory}</span>
								{/if}
								<span class="detail-item">{mapping.txCount} transaksjoner</span>
								<span class="detail-item">{formatAmount(mapping.avgMonthlyAmount)}</span>
								<span class="detail-item">{mapping.monthsActive} maneder</span>
							</div>
							<div class="merchant-key">{mapping.merchantKey}</div>
							<div class="merchant-timestamp">Analysert: {formatDate(mapping.analyzedAt)}</div>
						</div>
						<div class="merchant-actions">
							<Button
								type="button"
								variant="ghost"
								className="override-btn"
								onClick={() => onOverride(mapping)}
								title={mapping.hasOverride ? 'Endre override' : 'Opprett override'}
							>
								{mapping.hasOverride ? '✏️' : '🔒'}
							</Button>
							<Button
								type="button"
								variant="danger"
								className="delete-btn"
								disabled={deleting === mapping.id}
								onClick={() => onDelete(mapping.id)}
								ariaLabel="Slett mapping"
								title="Slett mapping (regenereres ved neste analyse)"
							>
								{deleting === mapping.id ? '...' : '🗑'}
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<style>
	.stats-bar {
		display: flex;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.stat {
		flex: 1;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 1rem;
		text-align: center;
	}

	.stat-value {
		display: block;
		font-size: 1.75rem;
		font-weight: 700;
		color: #4a5af0;
		margin-bottom: 0.25rem;
	}

	.stat-label {
		display: block;
		font-size: 0.8rem;
		color: #777;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.filters {
		display: flex;
		gap: 0.75rem;
		margin-bottom: 1.5rem;
		flex-wrap: wrap;
	}

	:global(.search-input) {
		flex: 2;
		min-width: 200px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 0.75rem;
		color: #ddd;
		font: inherit;
		font-size: 0.9rem;
	}

	:global(.search-input:focus) {
		outline: none;
		border-color: #4a5af0;
	}

	:global(.filter-select) {
		flex: 1;
		min-width: 150px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 0.75rem;
		color: #ddd;
		font: inherit;
		font-size: 0.9rem;
	}

	:global(.filter-select:focus) {
		outline: none;
		border-color: #4a5af0;
	}

	.loading {
		text-align: center;
		padding: 3rem 0;
		color: #666;
	}

	.override-analytics {
		background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
		padding: 1.5rem;
		border-radius: 12px;
		margin-bottom: 2rem;
		border: 1px solid #2a2a3a;
	}

	.analytics-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
		gap: 1rem;
	}

	.override-analytics h2 {
		margin: 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: #f59e0b;
	}

	.analytics-hint {
		color: #999;
		font-size: 0.85rem;
		margin-bottom: 1rem;
	}

	.override-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.override-item {
		background: rgba(255, 255, 255, 0.03);
		padding: 0.75rem;
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.05);
	}

	.override-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}

	.override-label {
		font-weight: 500;
		color: #ddd;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.override-stats {
		font-size: 0.85rem;
		color: #888;
	}

	.override-change {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}

	.old-cat {
		color: #ef4444;
		text-decoration: line-through;
		opacity: 0.7;
	}

	.arrow {
		color: #666;
	}

	.new-cat {
		color: #10b981;
		font-weight: 500;
	}

	.merchants-section h2 {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: #ddd;
	}

	.empty {
		color: #666;
		font-size: 0.9rem;
		padding: 1.5rem 0;
		text-align: center;
	}

	.merchant-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.merchant-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 1rem;
	}

	.merchant-main {
		flex: 1;
		min-width: 0;
	}

	.merchant-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		gap: 1rem;
	}

	.merchant-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 1rem;
		font-weight: 600;
		color: #eee;
	}

	.emoji {
		font-size: 1.25rem;
	}

	.merchant-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.badge {
		padding: 0.25rem 0.5rem;
		border-radius: 6px;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.badge.override {
		background: rgba(138, 43, 226, 0.15);
		color: #ba68ff;
	}

	.badge.fixed {
		background: rgba(74, 222, 128, 0.15);
		color: #4ade80;
	}

	.badge.source {
		background: #222;
		color: #888;
	}

	.merchant-details {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
		font-size: 0.85rem;
		color: #aaa;
	}

	.detail-item {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.subcategory {
		padding: 0.125rem 0.5rem;
		background: #222;
		border-radius: 4px;
		font-size: 0.75rem;
	}

	.merchant-key {
		font-size: 0.8rem;
		color: #666;
		font-family: 'SF Mono', monospace;
		margin-bottom: 0.25rem;
	}

	.merchant-timestamp {
		font-size: 0.75rem;
		color: #555;
	}

	.merchant-actions {
		display: flex;
		gap: 0.5rem;
	}

	:global(.override-btn) {
		background: transparent;
		border: 1px solid #3a2a5a;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		color: #ba68ff;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	:global(.override-btn:hover) {
		background: rgba(138, 43, 226, 0.08);
		border-color: #5a3a7a;
	}

	:global(.delete-btn) {
		background: transparent;
		border: 1px solid #3a2a2a;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		color: #e07070;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s;
		flex-shrink: 0;
	}

	:global(.delete-btn:hover:not(:disabled)) {
		background: rgba(224, 112, 112, 0.08);
		border-color: #6a2a2a;
	}

	:global(.delete-btn:disabled) {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
