<script lang="ts">
	import { Button } from '$lib/components/ui';

	interface Props {
		aiGeneratedCount: number;
		analyzing: boolean;
		analysisResult: any;
		analysisError: string | null;
		onRunAnalysis: (testMode: boolean) => void;
		onRegenerateInsights: () => void;
		onClearAll: () => void;
	}

	let {
		aiGeneratedCount,
		analyzing,
		analysisResult,
		analysisError,
		onRunAnalysis,
		onRegenerateInsights,
		onClearAll
	}: Props = $props();
</script>

<section class="info-box">
	<h2>Om AI-klassifisering</h2>
	<p>
		AI-analysatoren grupperer transaksjoner etter merchant og analyserer monstre som belop,
		frekvens og regularitet. Den foreslar kategori, label, emoji og om utgiften er fast eller variabel.
		Du kan overstyre AI-klassifiseringen for individuelle merchants.
	</p>
</section>

<section class="analysis-section">
	<div class="analysis-buttons">
		<Button
			className="analysis-btn test"
			onClick={() => onRunAnalysis(true)}
			disabled={analyzing}
			title="Rask test: analyserer ~10 merchants fra siste maned"
		>
			{#if analyzing}
				<span class="spinner"></span>
				Analyserer...
			{:else}
				🧪 Test (rask)
			{/if}
		</Button>
		<Button
			className="analysis-btn full"
			onClick={() => onRunAnalysis(false)}
			disabled={analyzing}
			title="Full analyse: analyserer alle merchants fra siste 13 maneder"
		>
			{#if analyzing}
				<span class="spinner"></span>
				Analyserer...
			{:else}
				🤖 Kjor full analyse
			{/if}
		</Button>
		<Button
			className="analysis-btn insights"
			onClick={onRegenerateInsights}
			disabled={analyzing || aiGeneratedCount === 0}
		>
			{#if analyzing}
				<span class="spinner"></span>
				Genererer...
			{:else}
				💡 Generer insights
			{/if}
		</Button>
		<Button
			className="analysis-btn clear"
			onClick={onClearAll}
			disabled={analyzing || aiGeneratedCount === 0}
		>
			{#if analyzing}
				<span class="spinner"></span>
				Sletter...
			{:else}
				🗑️ Slett alle ({aiGeneratedCount})
			{/if}
		</Button>
	</div>

	{#if analysisResult}
		<div class="analysis-result success">
			<h3>Analyse fullfort</h3>
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
			<h3>Analyse feilet</h3>
			<p>{analysisError}</p>
		</div>
	{/if}
</section>

<style>
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

	:global(.analysis-btn) {
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

	:global(.analysis-btn.test) {
		background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
	}

	:global(.analysis-btn.test:hover:not(:disabled)) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
	}

	:global(.analysis-btn.full) {
		background: linear-gradient(135deg, #4a5af0 0%, #6a7af0 100%);
	}

	:global(.analysis-btn.full:hover:not(:disabled)) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(74, 90, 240, 0.3);
	}

	:global(.analysis-btn.insights) {
		background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
	}

	:global(.analysis-btn.insights:hover:not(:disabled)) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(245, 158, 11, 0.3);
	}

	:global(.analysis-btn.clear) {
		background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
	}

	:global(.analysis-btn.clear:hover:not(:disabled)) {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
	}

	:global(.analysis-btn:disabled) {
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
