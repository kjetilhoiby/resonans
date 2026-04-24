<script lang="ts">
	import { AppPage, Button, PageHeader } from '$lib/components/ui';
	import { onMount } from 'svelte';
	import { CATEGORIES } from '$lib/integrations/transaction-categories-client';

	interface Override {
		id: number;
		domain: 'transaction' | 'task';
		fingerprint: string;
		correctedCategory: string;
		weight: number;
		source: string;
		updatedAt: string;
	}

	let transactionOverrides = $state<Override[]>([]);
	let taskOverrides = $state<Override[]>([]);
	let loading = $state(true);
	let deleting = $state<number | null>(null);
	let recalculating = $state(false);
	let recalculateResult = $state<{ processed: number; updated: number } | null>(null);

	onMount(async () => {
		await loadOverrides();
	});

	async function loadOverrides() {
		loading = true;
		try {
			const res = await fetch('/api/classification-overrides');
			if (res.ok) {
				const data = await res.json();
				transactionOverrides = data.overrides.filter((o: Override) => o.domain === 'transaction');
				taskOverrides = data.overrides.filter((o: Override) => o.domain === 'task');
			}
		} catch (err) {
			console.error('Failed to load overrides:', err);
		} finally {
			loading = false;
		}
	}

	async function deleteOverride(id: number) {
		if (!confirm('Slett denne klassifiseringsregelen?')) return;
		
		deleting = id;
		try {
			const res = await fetch(`/api/classification-overrides/${id}`, { method: 'DELETE' });
			if (res.ok) {
				await loadOverrides();
			} else {
				alert('Kunne ikke slette regel');
			}
		} catch (err) {
			console.error('Failed to delete override:', err);
			alert('Feil ved sletting');
		} finally {
			deleting = null;
		}
	}

	async function recalculateTransactions() {
		if (!confirm('Rekalkuler alle transaksjoner basert på dagens klassifiseringsregler?\n\nDette kan ta litt tid.')) {
			return;
		}

		recalculating = true;
		recalculateResult = null;
		try {
			const res = await fetch('/api/classification-overrides/recalculate', { method: 'POST' });
			if (res.ok) {
				recalculateResult = await res.json();
			} else {
				const data = await res.json();
				alert(data.error || 'Feil ved rekalkulering');
			}
		} catch (err) {
			console.error('Failed to recalculate:', err);
			alert('Feil ved rekalkulering');
		} finally {
			recalculating = false;
		}
	}

	function getCategoryInfo(categoryId: string) {
		const cat = CATEGORIES[categoryId as keyof typeof CATEGORIES];
		return cat ? `${cat.emoji} ${cat.label}` : categoryId;
	}

	function formatDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { 
			day: '2-digit', 
			month: 'short', 
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(iso));
	}
</script>

<AppPage width="full" theme="dark" className="classification-page">
	<PageHeader
		title="Klassifisering"
		titleHref="/settings"
		titleLabel="Gå til innstillinger"
	/>

	<main class="content">
		<section class="info-box">
			<h2>Klassifiseringshierarki</h2>
			<p>
				Transaksjoner klassifiseres i prioritert rekkefølge: først sjekkes dine manuelle overrides, 
				deretter AI-analyserte merchant-mønstre, så keyword-baserte regler fra utvikleren, 
				og til slutt fallback-regler. Du kan styre klassifiseringen på alle nivåer.
			</p>
		</section>

		<section class="hierarchy-section">
			<h2>Klassifiseringslag (prioritert rekkefølge)</h2>
			
			<div class="hierarchy-item priority-1">
				<div class="hierarchy-header">
					<span class="hierarchy-icon">🔒</span>
					<div class="hierarchy-title">
						<h3>1. Dine Overrides</h3>
						<p>Høyeste prioritet – dine manuelle korrigeringer</p>
					</div>
					<span class="hierarchy-count">{transactionOverrides.length + taskOverrides.length} aktive</span>
				</div>
				<p class="hierarchy-description">
					Når du endrer kategori på en transaksjon eller oppgave, lagres dette som en override 
					som alltid har forrang fremfor AI og regler.
				</p>
			</div>

			<div class="hierarchy-item priority-2">
				<div class="hierarchy-header">
					<span class="hierarchy-icon">🤖</span>
					<div class="hierarchy-title">
						<h3>2. AI Merchant Taxonomy</h3>
						<p>LLM-analyserte merchant-mønstre</p>
					</div>
					<a href="/settings/classification/merchants" class="hierarchy-link">
						Se alle merchants →
					</a>
				</div>
				<p class="hierarchy-description">
					AI analyserer transaksjonshistorikk per merchant: beløp, frekvens, regularitet. 
					Foreslår kategori, label, emoji og om utgiften er fast eller variabel. Du kan overstyre per merchant.
				</p>
			</div>

			<div class="hierarchy-item priority-3">
				<div class="hierarchy-header">
					<span class="hierarchy-icon">💻</span>
					<div class="hierarchy-title">
						<h3>3. Developer Intent Rules</h3>
						<p>Keyword-baserte matchingregler</p>
					</div>
					<div class="hierarchy-links">
						<a href="/settings/classification/transaction-rules" class="hierarchy-link">
							Transaksjoner →
						</a>
						<a href="/settings/classification/rules" class="hierarchy-link">
							Oppgaver →
						</a>
					</div>
				</div>
				<p class="hierarchy-description">
					Globale regler som matcher keywords i transaksjons-/oppgavebeskrivelser. 
					F.eks: "Rema 1000" → dagligvare, "trening" → workout.
				</p>
			</div>
		</section>

		{#if recalculateResult}
			<div class="result-box success">
				<strong>✓ Rekalkulering fullført</strong>
				<p>Behandlet {recalculateResult.processed} transaksjoner, oppdaterte {recalculateResult.updated} kategorier.</p>
				<Button variant="ghost" type="button" onClick={() => recalculateResult = null}>Lukk</Button>
			</div>
		{/if}

		<section class="actions-section">
			<Button
				type="button"
				onClick={recalculateTransactions}
				disabled={recalculating || loading}
			>
				{recalculating ? '🔄 Rekalkulerer...' : '🔄 Rekalkuler alle transaksjoner'}
			</Button>
			<p class="hint">
				Kjører alle transaksjoner gjennom dagens regler og oppdaterer kategorier der det er endringer.
			</p>
		</section>

		{#if loading}
			<div class="loading">Laster klassifiseringsregler...</div>
		{:else}
			<section class="overrides-section">
				<h2>Transaksjoner ({transactionOverrides.length})</h2>
				{#if transactionOverrides.length === 0}
					<p class="empty">Ingen manuelle transaksjonsklassifiseringer enda.</p>
				{:else}
					<ul class="override-list">
						{#each transactionOverrides as override}
							<li class="override-item">
								<div class="override-main">
									<div class="override-category">{getCategoryInfo(override.correctedCategory)}</div>
									<div class="override-fingerprint">{override.fingerprint}</div>
									<div class="override-meta">
										Vekt: {override.weight} · Oppdatert: {formatDate(override.updatedAt)} · {override.source}
									</div>
								</div>
								<button
									type="button"
									class="delete-btn"
									disabled={deleting === override.id}
									onclick={() => deleteOverride(override.id)}
									aria-label="Slett regel"
								>
									{deleting === override.id ? '...' : '🗑'}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="overrides-section">
				<h2>Oppgaver ({taskOverrides.length})</h2>
				{#if taskOverrides.length === 0}
					<p class="empty">Ingen manuelle oppgaveklassifiseringer enda.</p>
				{:else}
					<ul class="override-list">
						{#each taskOverrides as override}
							<li class="override-item">
								<div class="override-main">
									<div class="override-category">{override.correctedCategory}</div>
									<div class="override-fingerprint">{override.fingerprint}</div>
									<div class="override-meta">
										Vekt: {override.weight} · Oppdatert: {formatDate(override.updatedAt)} · {override.source}
									</div>
								</div>
								<button
									type="button"
									class="delete-btn"
									disabled={deleting === override.id}
									onclick={() => deleteOverride(override.id)}
									aria-label="Slett regel"
								>
									{deleting === override.id ? '...' : '🗑'}
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</section>
		{/if}
	</main>
</AppPage>

<style>
	:global(.classification-page) { color: #aaa; }

	.content {
		padding: 1.5rem 1rem;
	}

	.info-box {
		background: #171717;
		border: none;
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

	.hint {
		margin-top: 0.5rem;
		font-size: 0.8rem;
		color: #666;
	}

	.hierarchy-section {
		margin-bottom: 2rem;
	}

	.hierarchy-section h2 {
		margin: 0 0 1rem 0;
		font-size: 1.1rem;
		font-weight: 600;
		color: #ddd;
	}

	.hierarchy-item {
		background: #171717;
		border: none;
		border-radius: 12px;
		padding: 1.25rem;
		margin-bottom: 1rem;
	}

	.hierarchy-item.priority-1 {
		box-shadow: inset 3px 0 0 #34d399;
	}

	.hierarchy-item.priority-2 {
		box-shadow: inset 3px 0 0 #4a5af0;
	}

	.hierarchy-item.priority-3 {
		box-shadow: inset 3px 0 0 #78808d;
	}

	.hierarchy-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.hierarchy-icon {
		font-size: 1.5rem;
	}

	.hierarchy-title {
		flex: 1;
	}

	.hierarchy-title h3 {
		margin: 0 0 0.25rem 0;
		font-size: 1rem;
		font-weight: 600;
		color: #eee;
	}

	.hierarchy-title p {
		margin: 0;
		font-size: 0.8rem;
		color: #888;
	}

	.hierarchy-count {
		padding: 0.25rem 0.75rem;
		background: #222;
		border-radius: 6px;
		font-size: 0.8rem;
		color: #aaa;
		font-weight: 600;
	}

	.hierarchy-link {
		color: #4a5af0;
		text-decoration: none;
		font-size: 0.9rem;
		font-weight: 600;
		transition: color 0.15s;
	}

	.hierarchy-link:hover {
		color: #7c8ef5;
	}

	.hierarchy-links {
		display: flex;
		gap: 1rem;
	}

	.hierarchy-description {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: #999;
	}

	.result-box {
		background: rgba(74, 222, 128, 0.1);
		border: 1px solid rgba(74, 222, 128, 0.2);
		border-radius: 10px;
		padding: 1rem;
		margin-bottom: 1.5rem;
	}

	.result-box strong {
		display: block;
		margin-bottom: 0.5rem;
		color: #4ade80;
		font-size: 1rem;
	}

	.result-box p {
		margin: 0 0 0.75rem 0;
		color: #aaa;
	}

	.actions-section {
		margin-bottom: 2rem;
	}

	.loading {
		text-align: center;
		padding: 3rem 0;
		color: #666;
	}

	.overrides-section {
		margin-bottom: 2rem;
	}

	.overrides-section h2 {
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

	.override-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.override-item {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		padding: 1rem;
	}

	.override-main {
		flex: 1;
		min-width: 0;
	}

	.override-category {
		font-size: 1rem;
		font-weight: 600;
		color: #eee;
		margin-bottom: 0.25rem;
	}

	.override-fingerprint {
		font-size: 0.85rem;
		color: #888;
		margin-bottom: 0.5rem;
		font-family: 'SF Mono', monospace;
	}

	.override-meta {
		font-size: 0.75rem;
		color: #666;
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
</style>
