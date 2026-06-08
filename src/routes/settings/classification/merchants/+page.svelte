<script lang="ts">
	import { AppPage, PageHeader } from '$lib/components/ui';
	import MerchantTable from '$lib/components/settings/MerchantTable.svelte';
	import MerchantEditForm from '$lib/components/settings/MerchantEditForm.svelte';
	import MerchantAnalysisPanel from '$lib/components/settings/MerchantAnalysisPanel.svelte';
	import { onMount } from 'svelte';

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
	let showBulkOverrideModal = $state(false);
	let analyzing = $state(false);
	let analysisResult = $state<any>(null);
	let analysisError = $state<string | null>(null);

	const aiGeneratedCount = $derived(mappings.filter((m) => m.source === 'ai').length);

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
		showOverrideModal = true;
	}

	async function createOverride(mappingId: string, category: string, subcategory: string | null) {
		try {
			const res = await fetch(`/api/merchant-mappings/${mappingId}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					createOverride: true,
					overrideCategory: category,
					overrideSubcategory: subcategory
				})
			});

			if (res.ok) {
				showOverrideModal = false;
				selectedMapping = null;
				await loadMappings();
			} else {
				alert('Kunne ikke opprette override');
			}
		} catch (err) {
			console.error('Failed to create override:', err);
			alert('Feil ved oppretting av override');
		}
	}

	async function bulkOverride(fromCategory: string, toCategory: string) {
		const merchantsToOverride = mappings.filter(m => {
			const currentCat = m.hasOverride ? m.overrideCategory : m.category;
			return currentCat === fromCategory;
		});

		if (merchantsToOverride.length === 0) {
			alert('Ingen merchants funnet i denne kategorien');
			return;
		}

		if (!confirm(`Overstyr ${merchantsToOverride.length} merchants fra "${fromCategory}" til "${toCategory}"?`)) {
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
						overrideCategory: toCategory
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
		await loadMappings();

		alert(`Bulk override fullført:\n${success} vellykket\n${failed} feilet`);
	}

	async function runAnalysis(testMode: boolean) {
		analyzing = true;
		analysisError = null;
		analysisResult = null;

		try {
			const res = await fetch('/api/economics/analyze-spending', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					force: false,
					testLimit: testMode ? 10 : undefined,
					mode: testMode ? 'classify' : 'both'
				})
			});

			if (res.ok) {
				const data = await res.json();
				analysisResult = {
					...(data.classification || {}),
					...(data.insights || {})
				};
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
			const res = await fetch('/api/merchant-mappings', { method: 'DELETE' });

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
				body: JSON.stringify({ mode: 'insights' })
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
</script>

<AppPage className="merchants-page">
	<PageHeader
		title="AI Merchant Taxonomy"
		titleHref="/settings/classification"
		titleLabel="Gå til klassifisering"
	/>

	<main class="content">
		<MerchantAnalysisPanel
			{aiGeneratedCount}
			{analyzing}
			{analysisResult}
			{analysisError}
			onRunAnalysis={runAnalysis}
			onRegenerateInsights={regenerateInsights}
			onClearAll={clearAllMappings}
		/>

		<MerchantTable
			{mappings}
			{loading}
			{deleting}
			onDelete={deleteMapping}
			onOverride={openOverrideModal}
			onBulkOverride={() => showBulkOverrideModal = true}
		/>
	</main>
</AppPage>

<MerchantEditForm
	{selectedMapping}
	{showOverrideModal}
	{showBulkOverrideModal}
	{mappings}
	{analyzing}
	onCreateOverride={createOverride}
	onBulkOverride={bulkOverride}
	onCloseOverride={() => { showOverrideModal = false; selectedMapping = null; }}
	onCloseBulk={() => showBulkOverrideModal = false}
/>

<style>
	:global(.merchants-page) { color: #aaa; }

	.content {
		max-width: 1200px;
		margin: 0 auto;
		padding: 1.5rem 1rem;
	}
</style>
