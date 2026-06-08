<script lang="ts">
	import MerchantAnalysis from '$lib/components/charts/MerchantAnalysis.svelte';

	type MerchantAnalysisData = {
		categories: any[];
		risingFixed: any[];
		clusters: any[];
		subscriptions: any[];
		summary: any | null;
		months: string[];
	};

	interface Props {
		data: MerchantAnalysisData | null;
		loading: boolean;
	}

	let { data, loading }: Props = $props();
</script>

{#if loading}
	<div class="insight-loading">
		<span class="spinner-dark"></span>
		Bygger taksonomi og analyserer monster...
	</div>
{:else if !data}
	<div class="insight-empty">
		<p>Klikk <strong>Analyser forbruk</strong> for a bygge din personlige taksonomi og se kategori-innsikt, abonnementer, prosjektklynger og stigende utgifter.</p>
	</div>
{:else}
	<MerchantAnalysis
		categories={data.categories}
		risingFixed={data.risingFixed}
		clusters={data.clusters}
		subscriptions={data.subscriptions}
		summary={data.summary}
		months={data.months}
	/>
{/if}

<style>
	.insight-empty {
		padding: 3rem 1rem;
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.95rem;
		max-width: 480px;
		margin: 0 auto;
	}

	.insight-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 4rem 1rem;
		color: var(--text-secondary);
		font-size: 0.95rem;
	}

	@keyframes spin-dark { to { transform: rotate(360deg); } }
	.spinner-dark {
		display: inline-block;
		width: 20px;
		height: 20px;
		border: 2px solid rgba(99,102,241,0.3);
		border-top-color: #6366f1;
		border-radius: 50%;
		animation: spin-dark 0.8s linear infinite;
		flex-shrink: 0;
	}
</style>
