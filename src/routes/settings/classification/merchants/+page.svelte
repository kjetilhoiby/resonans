<script lang="ts">
	import { onMount } from 'svelte';
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

	let mappings = $state<MerchantMapping[]>([]);
	let loading = $state(true);
	let deleting = $state<string | null>(null);
	let showOverrideModal = $state(false);
	let selectedMapping = $state<MerchantMapping | null>(null);
	let overrideCategory = $state('');
	let showBulkOverrideModal = $state(false);
	let bulkFromCategory = $state('');
	let bulkToCategory = $state('');
	let filterCategory = $state<string>('all');
	let filterSource = $state<string>('all');
	let searchQuery = $state('');
	let analyzing = $state(false);
	let analysisResult = $state<any>(null);
	let analysisError = $state<string | null>(null);

	const categoryOptions: Array<{ id: CategoryId; label: string; emoji: string }> = [
		{ id: 'innskudd', label: 'Inntekter', emoji: '💵' },
		{ id: 'dagligvarer', label: 'Dagligvarer', emoji: '🛒' },
		{ id: 'kafe_og_restaurant', label: 'Kafe og restaurant', emoji: '🍽️' },
		{ id: 'faste_boutgifter', label: 'Faste boutgifter', emoji: '🏠' },
		{ id: 'annet_lan_og_gjeld', label: 'Lån og gjeld', emoji: '🏦' },
		{ id: 'bil_og_transport', label: 'Transport og bil', emoji: '🚗' },
		{ id: 'helse_og_velvaere', label: 'Helse og velvære', emoji: '💊' },
		{ id: 'medier_og_underholdning', label: 'Medier og underholdning', emoji: '📱' },
		{ id: 'hobby_og_fritid', label: 'Hobby og fritid', emoji: '🎉' },
		{ id: 'hjem_og_hage', label: 'Hjem og hage', emoji: '🔨' },
		{ id: 'klaer_og_utstyr', label: 'Klær og utstyr', emoji: '🛍️' },
		{ id: 'barn', label: 'Barn', emoji: '👶' },
		{ id: 'barnehage_og_sfo', label: 'Barnehage og SFO', emoji: '🎒' },
		{ id: 'forsikring', label: 'Forsikring', emoji: '🛡️' },
		{ id: 'bilforsikring_og_billan', label: 'Bilforsikring og billån', emoji: '🚙' },
		{ id: 'sparing', label: 'Sparing', emoji: '💰' },
		{ id: 'reise', label: 'Reise', emoji: '✈️' },
		{ id: 'diverse', label: 'Diverse', emoji: '🔄' },
		{ id: 'ukategorisert', label: 'Ukategorisert', emoji: '📦' }
	];

	onMount(async () => {
		await loadMappings();
	});

	async function loadMappings() {
		loading = true;
		try {
			const res = await fetch('/api/merchant-mappings');
			if (res.ok) {
				const data = await res.json();
				mappings = data.mappings || [];
			}
		} catch (err) {
			console.error('Failed to load merchant mappings:', err);
		} finally {
			loading = false;
		}
	}

	async function deleteMapping(id: string) {
		if (!confirm('Slett denne merchant-klassifiseringen? Den vil regenereres ved neste AI-analyse.')) return;

		deleting = id;
		try {
			const res = await fetch(`/api/merchant-mappings/${id}`, { method: 'DELETE' });
			if (res.ok) {
				await loadMappings();
			} else {
				alert('Kunne ikke slette mapping');
			}
		} catch (err) {
			console.error('Failed to delete mapping:', err);
			alert('Feil ved sletting');
		} finally {
			deleting = null;
		}
	}

	function openOverrideModal(mapping: MerchantMapping) {
		selectedMapping = mapping;
		overrideCategory = mapping.overrideCategory || mapping.category;
		showOverrideModal = true;
	}

	async function createOverride() {
		if (!selectedMapping || !overrideCategory) return;

		try {
			const res = await fetch(`/api/merchant-mappings/${selectedMapping.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					createOverride: true,
					overrideCategory
				})
			});

			if (res.ok) {
				showOverrideModal = false;
				selectedMapping = null;
				overrideCategory = '';
				await loadMappings();
			} else {
				alert('Kunne ikke opprette override');
			}
		} catch (err) {
			console.error('Failed to create override:', err);
			alert('Feil ved oppretting av override');
		}
	}

	async function bulkOverride() {
		if (!bulkFromCategory || !bulkToCategory) return;

		const merchantsToOverride = mappings.filter(m => {
			const currentCat = m.hasOverride ? m.overrideCategory : m.category;
			return currentCat === bulkFromCategory;
		});

		if (merchantsToOverride.length === 0) {
			alert('Ingen merchants funnet i denne kategorien');
			return;
		}

		if (!confirm(`Overstyr ${merchantsToOverride.length} merchants fra "${getCategoryLabel(bulkFromCategory)}" til "${getCategoryLabel(bulkToCategory)}"?`)) {
			return;
		}

		analyzing = true;
		let success = 0;
		let failed = 0;

		for (const mapping of merchantsToOverride) {
			try {
				const res = await fetch(`/api/merchant-mappings/${mapping.id}`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						createOverride: true,
						overrideCategory: bulkToCategory
					})
				});

				if (res.ok) success++;
				else failed++;
			} catch (err) {
				failed++;
			}
		}

		analyzing = false;
		showBulkOverrideModal = false;
		bulkFromCategory = '';
		bulkToCategory = '';
		await loadMappings();

		alert(`Bulk override fullført:\n${success} vellykket\n${failed} feilet`);
	}

	async function runAnalysis(testMode = false) {
		analyzing = true;
		analysisError = null;
		analysisResult = null;

		try {
			const res = await fetch('/api/economics/analyze-spending', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ 
					force: false,  // Don't re-classify recently analyzed merchants
					testLimit: testMode ? 10 : undefined,
					mode: testMode ? 'classify' : 'both'
				})
			});

			if (res.ok) {
				const data = await res.json();
				// Flatten nested structure for backward compatibility
				analysisResult = {
					...(data.classification || {}),
					...(data.insights || {})
				};
				// Reload mappings after successful analysis
				await loadMappings();
			} else {
				const error = await res.json();
				analysisError = error.error || 'Analyse feilet';
			}
		} catch (err) {
			console.error('Analysis failed:', err);
			analysisError = String(err);
		} finally {
			analyzing = false;
		}
	}

	async function clearAllMappings() {
		if (!confirm('Er du sikker på at du vil slette alle AI-genererte kategoriseringer? Dette kan ikke angres.')) {
			return;
		}

		analyzing = true;
		analysisError = null;
		analysisResult = null;

		try {
			const res = await fetch('/api/merchant-mappings', {
				method: 'DELETE'
			});

			if (res.ok) {
				analysisResult = { message: 'Alle AI-kategoriseringer slettet' };
				await loadMappings();
			} else {
				const error = await res.json();
				analysisError = error.error || 'Sletting feilet';
			}
		} catch (err) {
			console.error('Clear failed:', err);
			analysisError = String(err);
		} finally {
			analyzing = false;
		}
	}

	async function regenerateInsights() {
		analyzing = true;
		analysisError = null;
		analysisResult = null;

		try {
			const res = await fetch('/api/economics/analyze-spending', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ mode: 'insights' })  // Only generate insights
			});

			if (res.ok) {
				const data = await res.json();
				analysisResult = data.insights;
			} else {
				const error = await res.json();
				analysisError = error.error || 'Insights-generering feilet';
			}
		} catch (err) {
			console.error('Insights generation failed:', err);
			analysisError = String(err);
		} finally {
			analyzing = false;
		}
	}

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

<div class="merchants-page">
	<header class="page-header">
		<div class="header-top">
			<a href="/settings/classification" class="back-btn" aria-label="Tilbake">
				<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="15 18 9 12 15 6"></polyline>
				</svg>
			</a>
			<h1>AI Merchant Taxonomy</h1>
		</div>
	</header>

	<main class="content">
		<section class="info-box">
			<h2>Om AI-klassifisering</h2>
			<p>
				AI-analysatoren grupperer transaksjoner etter merchant og analyserer mønstre som beløp, 
				frekvens og regularitet. Den foreslår kategori, label, emoji og om utgiften er fast eller variabel.
				Du kan overstyre AI-klassifiseringen for individuelle merchants.
			</p>
		</section>

		<section class="analysis-section">
			<div class="analysis-buttons">
				<button 
					class="analysis-btn test" 
					onclick={() => runAnalysis(true)}
					disabled={analyzing}
					title="Rask test: analyserer ~10 merchants fra siste måned"
				>
					{#if analyzing}
						<span class="spinner"></span>
						Analyserer...
					{:else}
						🧪 Test (rask)
					{/if}
				</button>
				<button 
					class="analysis-btn full" 
					onclick={() => runAnalysis(false)}
					disabled={analyzing}
					title="Full analyse: analyserer alle merchants fra siste 13 måneder"
				>
					{#if analyzing}
						<span class="spinner"></span>
						Analyserer...
					{:else}
						🤖 Kjør full analyse
					{/if}
				</button>
				<button 
					class="analysis-btn insights" 
					onclick={regenerateInsights}
					disabled={analyzing || stats.aiGenerated === 0}
				>
					{#if analyzing}
						<span class="spinner"></span>
						Genererer...
					{:else}
						💡 Generer insights
					{/if}
				</button>
				<button 
					class="analysis-btn clear" 
					onclick={clearAllMappings}
					disabled={analyzing || stats.aiGenerated === 0}
				>
					{#if analyzing}
						<span class="spinner"></span>
						Sletter...
					{:else}
						🗑️ Slett alle ({stats.aiGenerated})
					{/if}
				</button>
			</div>

			{#if analysisResult}
				<div class="analysis-result success">
					<h3>✅ Analyse fullført</h3>
					<dl>
						<dt>Transaksjoner analysert:</dt>
						<dd>{analysisResult.totalTransactions || 0}</dd>
						
						<dt>Merchants analysert:</dt>
						<dd>{analysisResult.totalMerchantsAnalyzed || 0}</dd>
						
						<dt>Nye mappings:</dt>
						<dd>{analysisResult.newMappings || 0}</dd>
						
						<dt>Oppdaterte mappings:</dt>
						<dd>{analysisResult.updatedMappings || 0}</dd>
						
						<dt>Hoppet over (nylig analysert):</dt>
						<dd>{analysisResult.skippedRecent || 0}</dd>
					</dl>

					{#if analysisResult.insights && analysisResult.insights.length > 0}
						<div class="insights">
							<h4>Innsikter:</h4>
							<ul>
								{#each analysisResult.insights as insight}
									<li>{insight}</li>
								{/each}
							</ul>
						</div>
					{/if}
				</div>
			{/if}

			{#if analysisError}
				<div class="analysis-result error">
					<h3>❌ Analyse feilet</h3>
					<p>{analysisError}</p>
				</div>
			{/if}
		</section>

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
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Søk etter merchant..."
				class="search-input"
			/>
			<select bind:value={filterCategory} class="filter-select">
				<option value="all">Alle kategorier</option>
				{#each categoryOptions as cat}
					<option value={cat.id}>{cat.emoji} {cat.label}</option>
				{/each}
			</select>
			<select bind:value={filterSource} class="filter-select">
				<option value="all">Alle kilder</option>
				<option value="ai">AI-generert</option>
				<option value="rule">Regel-basert</option>
				<option value="manual">Manuell</option>
			</select>
		</section>

		{#if topOverridden.length > 0}
			<section class="override-analytics">
				<div class="analytics-header">
					<h2>📊 Merchants du har overstyrt ({stats.withOverrides} totalt)</h2>
					<button 
						type="button" 
						onclick={() => showBulkOverrideModal = true} 
						class="btn-secondary"
						title="Overstyr mange merchants samtidig"
					>
						⚡ Bulk override
					</button>
				</div>
				<p class="analytics-hint">
					Viser merchants hvor du manuelt har endret AI-kategoriseringen. Dette er nyttig for å identifisere hvor AI-modellen systematisk gjør feil.
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
								<span class="arrow">→</span>
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
					<p class="empty">Ingen merchants funnet. Kjør AI-analyse fra økonomioversikten.</p>
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
												<span class="badge override">🔒 Override</span>
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
										<span class="detail-item">{mapping.monthsActive} måneder</span>
									</div>
									<div class="merchant-key">{mapping.merchantKey}</div>
									<div class="merchant-timestamp">Analysert: {formatDate(mapping.analyzedAt)}</div>
								</div>
								<div class="merchant-actions">
									<button
										type="button"
										class="override-btn"
										onclick={() => openOverrideModal(mapping)}
										title={mapping.hasOverride ? 'Endre override' : 'Opprett override'}
									>
										{mapping.hasOverride ? '✏️' : '🔒'}
									</button>
									<button
										type="button"
										class="delete-btn"
										disabled={deleting === mapping.id}
										onclick={() => deleteMapping(mapping.id)}
										aria-label="Slett mapping"
										title="Slett mapping (regenereres ved neste analyse)"
									>
										{deleting === mapping.id ? '...' : '🗑'}
									</button>
								</div>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</main>
</div>

{#if showOverrideModal && selectedMapping}
	<div class="modal-overlay" onclick={() => showOverrideModal = false}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Override kategori for {selectedMapping.label}</h3>
			<p class="modal-hint">
				AI foreslår: {getCategoryLabel(selectedMapping.category)}
				{#if selectedMapping.hasOverride}
					<br />
					<strong>Nåværende override: {getCategoryLabel(selectedMapping.overrideCategory || selectedMapping.category)}</strong>
				{/if}
			</p>
			<div class="form-group">
				<label for="override-category">Velg kategori</label>
				<select id="override-category" bind:value={overrideCategory} class="input">
					{#each categoryOptions as cat}
						<option value={cat.id}>{cat.emoji} {cat.label}</option>
					{/each}
				</select>
			</div>
			<div class="modal-actions">
				<button type="button" onclick={createOverride} class="btn-primary">
					{selectedMapping.hasOverride ? 'Oppdater override' : 'Opprett override'}
				</button>
				<button type="button" onclick={() => showOverrideModal = false} class="btn-ghost">
					Avbryt
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showBulkOverrideModal}
	<div class="modal-overlay" onclick={() => showBulkOverrideModal = false}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<h3>Bulk Override</h3>
			<p class="modal-hint">
				Overstyr alle merchants i én kategori til en annen kategori.
			</p>
			<div class="form-group">
				<label for="bulk-from-category">Fra kategori</label>
				<select id="bulk-from-category" bind:value={bulkFromCategory} class="input">
					<option value="">Velg kategori...</option>
					{#each categoryOptions as cat}
						<option value={cat.id}>{cat.emoji} {cat.label}</option>
					{/each}
				</select>
			</div>
			<div class="form-group">
				<label for="bulk-to-category">Til kategori</label>
				<select id="bulk-to-category" bind:value={bulkToCategory} class="input">
					<option value="">Velg kategori...</option>
					{#each categoryOptions as cat}
						<option value={cat.id}>{cat.emoji} {cat.label}</option>
					{/each}
				</select>
			</div>
			{#if bulkFromCategory && bulkToCategory}
				{@const count = mappings.filter(m => {
					const currentCat = m.hasOverride ? m.overrideCategory : m.category;
					return currentCat === bulkFromCategory;
				}).length}
				<p class="bulk-preview">
					{count} merchant{count !== 1 ? 's' : ''} vil bli påvirket
				</p>
			{/if}
			<div class="modal-actions">
				<button 
					type="button" 
					onclick={bulkOverride} 
					class="btn-primary"
					disabled={!bulkFromCategory || !bulkToCategory || analyzing}
				>
					{analyzing ? 'Behandler...' : 'Utfør bulk override'}
				</button>
				<button type="button" onclick={() => showBulkOverrideModal = false} class="btn-ghost">
					Avbryt
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.merchants-page {
		min-height: 100vh;
		background: #0f0f0f;
		color: #aaa;
	}

	.page-header {
		background: #111;
		border-bottom: 1px solid #2a2a2a;
		padding: 1rem;
		position: sticky;
		top: 0;
		z-index: 10;
	}

	.header-top {
		max-width: 1200px;
		margin: 0 auto;
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.back-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		color: #ccc;
		text-decoration: none;
	}

	.back-btn:hover {
		background: #222;
	}

	h1 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 700;
		color: #eee;
	}

	.content {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}

	.info-box {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.info-box h2 {
		margin: 0 0 0.5rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #ddd;
	}

	.info-box p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.5;
		color: #999;
	}

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

	.search-input {
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

	.search-input:focus {
		outline: none;
		border-color: #4a5af0;
	}

	.filter-select {
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

	.filter-select:focus {
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

	.override-btn {
		background: transparent;
		border: 1px solid #3a2a5a;
		border-radius: 8px;
		padding: 0.5rem 0.75rem;
		color: #ba68ff;
		font-size: 1rem;
		cursor: pointer;
		transition: all 0.15s;
	}

	.override-btn:hover {
		background: rgba(138, 43, 226, 0.08);
		border-color: #5a3a7a;
	}

	.delete-btn {
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

	.delete-btn:hover:not(:disabled) {
		background: rgba(224, 112, 112, 0.08);
		border-color: #6a2a2a;
	}

	.delete-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

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

	.input {
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

	.input:focus {
		outline: none;
		border-color: #4a5af0;
	}

	.modal-actions {
		display: flex;
		gap: 0.75rem;
	}

	.btn-primary {
		background: #4a5af0;
		border: none;
		border-radius: 10px;
		padding: 0.75rem 1.25rem;
		color: white;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		transition: background 0.15s;
	}

	.btn-primary:hover {
		background: #3a4adf;
	}

	.btn-ghost {
		background: transparent;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		padding: 0.5rem 1rem;
		color: #aaa;
		font: inherit;
		cursor: pointer;
		transition: all 0.15s;
	}

	.btn-ghost:hover {
		background: #1a1a1a;
		border-color: #3a3a3a;
	}

	/* Analysis Section */
	.analysis-section {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1.5rem;
	}

	.analysis-buttons {
		display: flex;
		gap: 0.75rem;
	}

	.analysis-btn {
		border: none;
		border-radius: 10px;
		padding: 0.875rem 1.5rem;
		color: white;
		font: inherit;
		font-weight: 600;
		font-size: 0.95rem;
		cursor: pointer;
		transition: all 0.15s;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex: 1;
		justify-content: center;
	}

	.analysis-btn.test {
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
	}

	.analysis-btn.test:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}

	.analysis-btn.full {
		background: linear-gradient(135deg, #4a5af0 0%, #6a7af0 100%);
	}

	.analysis-btn.full:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(74, 90, 240, 0.3);
	}

	.analysis-btn.insights {
		background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
	}

	.analysis-btn.insights:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
	}

	.analysis-btn.clear {
		background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
	}

	.analysis-btn.clear:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
	}

	.analysis-btn:disabled {
		opacity: 0.7;
		cursor: not-allowed;
	}

	.spinner {
		display: inline-block;
		width: 16px;
		height: 16px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: white;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.analysis-result {
		margin-top: 1rem;
		padding: 1rem;
		border-radius: 10px;
		border: 1px solid;
	}

	.analysis-result.success {
		background: rgba(34, 197, 94, 0.05);
		border-color: rgba(34, 197, 94, 0.3);
	}

	.analysis-result.error {
		background: rgba(239, 68, 68, 0.05);
		border-color: rgba(239, 68, 68, 0.3);
	}

	.analysis-result h3 {
		margin: 0 0 0.75rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #eee;
	}

	.analysis-result dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.5rem 1rem;
		margin: 0;
		font-size: 0.9rem;
	}

	.analysis-result dt {
		color: #999;
		font-weight: 500;
	}

	.analysis-result dd {
		margin: 0;
		color: #ddd;
		font-weight: 600;
	}

	.analysis-result .insights {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
	}

	.analysis-result .insights h4 {
		margin: 0 0 0.5rem 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: #bbb;
	}

	.analysis-result .insights ul {
		margin: 0;
		padding-left: 1.5rem;
		list-style: disc;
	}

	.analysis-result .insights li {
		margin-bottom: 0.25rem;
		color: #999;
		font-size: 0.85rem;
		line-height: 1.4;
	}

	.analysis-result.error p {
		margin: 0;
		color: #ef4444;
		font-size: 0.9rem;
	}
</style>
