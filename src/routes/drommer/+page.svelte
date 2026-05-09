<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { AppPage, ScreenTitle } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let busy = $state<string | null>(null);

	const KIND_LABELS: Record<string, string> = {
		daily_dream: 'I går',
		weekly_dream: 'Uka som var',
		monthly_dream: 'Måneden som var',
		yearly_dream: 'Året som var',
		vision_5year: '5 år frem',
		vision_yearly: 'I år',
		vision_quarterly: 'Kommende kvartal',
		vision_themed: 'Tema-visjon'
	};

	const KIND_EMOJI: Record<string, string> = {
		daily_dream: '🌅',
		weekly_dream: '📅',
		monthly_dream: '🗓️',
		yearly_dream: '🎯',
		vision_5year: '🌟',
		vision_yearly: '🧭',
		vision_quarterly: '🎢',
		vision_themed: '🪶'
	};

	const MODE_LABELS: Record<string, string> = {
		least_effort: 'Minimer',
		steady: 'Hold tempo',
		push: 'Trykk på'
	};

	async function generate(kind: string) {
		busy = kind;
		try {
			const res = await fetch('/api/dreams/generate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ kind })
			});
			if (!res.ok) throw new Error(`Generation failed: ${res.status}`);
			await invalidateAll();
		} catch (err) {
			console.error(err);
			alert('Kunne ikke generere drøm. Sjekk konsollen.');
		} finally {
			busy = null;
		}
	}

	async function envision(horizon: string) {
		busy = horizon;
		try {
			const res = await fetch('/api/dreams/envision', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ horizon })
			});
			if (!res.ok) throw new Error(`Envision failed: ${res.status}`);
			await invalidateAll();
		} catch (err) {
			console.error(err);
			alert('Kunne ikke skape visjon. Sjekk konsollen.');
		} finally {
			busy = null;
		}
	}

	async function acceptCandidates(dreamId: string) {
		busy = dreamId;
		try {
			const res = await fetch(`/api/dreams/${dreamId}/accept`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: '{}'
			});
			if (!res.ok) throw new Error(`Accept failed: ${res.status}`);
			const json = await res.json();
			alert(`Lagret ${json.accepted?.length ?? 0} memories.`);
			await invalidateAll();
		} catch (err) {
			console.error(err);
			alert('Kunne ikke lagre memories. Sjekk konsollen.');
		} finally {
			busy = null;
		}
	}
</script>

<AppPage>
	<ScreenTitle title="Drømmer" subtitle="Tilbakeblikk og retning, syntetisert" />

	<div class="grid">
		<section class="column">
			<h2>🧭 Retning (våken drøm)</h2>
			<p class="hint">Hvor er du på vei? Visjoner som mater måned-, uke- og dagsplaner.</p>

			{#if data.visions.length === 0}
				<p class="empty">Ingen visjoner enda.</p>
			{:else}
				{#each data.visions as dream (dream.id)}
					<article class="dream vision">
						<header>
							<span class="emoji">{KIND_EMOJI[dream.kind] ?? '✨'}</span>
							<h3>{KIND_LABELS[dream.kind] ?? dream.kind}</h3>
							{#if dream.confidence === 'llm_inferred'}
								<span class="tag llm">LLM-foreslått</span>
							{/if}
						</header>
						<p class="summary">{dream.summary}</p>
						{#if dream.highlights?.wins?.length}
							<ul class="bullets">
								{#each dream.highlights.wins as win}
									<li>{win}</li>
								{/each}
							</ul>
						{/if}
						{#if dream.confidence === 'llm_inferred'}
							<button class="btn-secondary" onclick={() => acceptCandidates(dream.id)} disabled={busy === dream.id}>
								{busy === dream.id ? 'Lagrer …' : 'Bekreft som memory'}
							</button>
						{/if}
					</article>
				{/each}
			{/if}

			<div class="actions">
				<button onclick={() => envision('vision_5year')} disabled={busy !== null}>
					{busy === 'vision_5year' ? 'Drømmer …' : '🌟 Skap 5-års visjon'}
				</button>
				<button onclick={() => envision('vision_yearly')} disabled={busy !== null}>
					{busy === 'vision_yearly' ? 'Drømmer …' : '🧭 Skap års-visjon'}
				</button>
				<button onclick={() => envision('vision_quarterly')} disabled={busy !== null}>
					{busy === 'vision_quarterly' ? 'Drømmer …' : '🎢 Skap kvartal-visjon'}
				</button>
			</div>
		</section>

		<section class="column">
			<h2>🌙 Tilbakeblikk (natt-drøm)</h2>
			<p class="hint">Hva ble det? Synteser som komprimerer det som faktisk skjedde.</p>

			{#if data.synthesis.length === 0}
				<p class="empty">Ingen synteser enda.</p>
			{:else}
				{#each data.synthesis as dream (dream.id)}
					<article class="dream synthesis">
						<header>
							<span class="emoji">{KIND_EMOJI[dream.kind] ?? '🌙'}</span>
							<h3>{KIND_LABELS[dream.kind] ?? dream.kind}</h3>
							{#if dream.highlights?.mode}
								<span class="tag mode mode-{dream.highlights.mode}">
									{MODE_LABELS[dream.highlights.mode] ?? dream.highlights.mode}
								</span>
							{/if}
						</header>
						<p class="summary">{dream.summary}</p>
						{#if dream.highlights?.rationale}
							<p class="rationale"><em>Modus-begrunnelse:</em> {dream.highlights.rationale}</p>
						{/if}
						{#if dream.highlights?.wins?.length || dream.highlights?.frictions?.length}
							<div class="winfric">
								{#if dream.highlights?.wins?.length}
									<div>
										<strong>Wins</strong>
										<ul class="bullets">
											{#each dream.highlights.wins as win}
												<li>{win}</li>
											{/each}
										</ul>
									</div>
								{/if}
								{#if dream.highlights?.frictions?.length}
									<div>
										<strong>Friksjon</strong>
										<ul class="bullets">
											{#each dream.highlights.frictions as f}
												<li>{f}</li>
											{/each}
										</ul>
									</div>
								{/if}
							</div>
						{/if}
					</article>
				{/each}
			{/if}

			<div class="actions">
				<button onclick={() => generate('daily_dream')} disabled={busy !== null}>
					{busy === 'daily_dream' ? 'Drømmer …' : '🌅 Skap dagens drøm'}
				</button>
				<button onclick={() => generate('weekly_dream')} disabled={busy !== null}>
					{busy === 'weekly_dream' ? 'Drømmer …' : '📅 Oppsummer uka'}
				</button>
				<button onclick={() => generate('monthly_dream')} disabled={busy !== null}>
					{busy === 'monthly_dream' ? 'Drømmer …' : '🗓️ Oppsummer måneden'}
				</button>
				<button onclick={() => generate('yearly_dream')} disabled={busy !== null}>
					{busy === 'yearly_dream' ? 'Drømmer …' : '🎯 Oppsummer året'}
				</button>
			</div>
		</section>
	</div>

	{#if data.historical.length > 0}
		<details class="historical">
			<summary>Historikk ({data.historical.length})</summary>
			<ul>
				{#each data.historical as dream (dream.id)}
					<li>
						<strong>{KIND_LABELS[dream.kind] ?? dream.kind}</strong> ·
						{new Date(dream.createdAt).toLocaleDateString('nb-NO')} —
						{dream.summary.slice(0, 120)}{dream.summary.length > 120 ? '…' : ''}
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</AppPage>

<style>
	.grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.5rem;
		padding: 1rem;
	}

	@media (min-width: 720px) {
		.grid {
			grid-template-columns: 1fr 1fr;
		}
	}

	.column {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.column h2 {
		margin: 0;
		font-size: 1.1rem;
	}

	.hint {
		margin: 0;
		color: var(--text-muted, #888);
		font-size: 0.875rem;
	}

	.empty {
		font-style: italic;
		color: var(--text-muted, #888);
	}

	.dream {
		border: 1px solid var(--border, #e0e0e0);
		border-radius: 0.75rem;
		padding: 1rem;
		background: var(--surface, #fff);
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.dream.vision {
		border-left: 4px solid #6366f1;
	}

	.dream.synthesis {
		border-left: 4px solid #f59e0b;
	}

	.dream header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.dream header h3 {
		margin: 0;
		font-size: 1rem;
		flex: 1;
	}

	.emoji {
		font-size: 1.25rem;
	}

	.tag {
		font-size: 0.75rem;
		padding: 0.125rem 0.5rem;
		border-radius: 1rem;
		background: var(--surface-2, #f3f4f6);
	}

	.tag.llm {
		background: #fef3c7;
		color: #92400e;
	}

	.tag.mode-least_effort {
		background: #dbeafe;
		color: #1e40af;
	}

	.tag.mode-steady {
		background: #d1fae5;
		color: #065f46;
	}

	.tag.mode-push {
		background: #fee2e2;
		color: #991b1b;
	}

	.summary {
		margin: 0;
		line-height: 1.5;
	}

	.rationale {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-muted, #666);
	}

	.bullets {
		margin: 0;
		padding-left: 1.25rem;
		font-size: 0.875rem;
	}

	.winfric {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1rem;
		font-size: 0.875rem;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.actions button,
	.btn-secondary {
		padding: 0.5rem 0.875rem;
		border: 1px solid var(--border, #e0e0e0);
		border-radius: 0.5rem;
		background: var(--surface, #fff);
		cursor: pointer;
		font-size: 0.875rem;
	}

	.actions button:disabled,
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.btn-secondary {
		align-self: flex-start;
		background: #fef3c7;
	}

	.historical {
		margin: 1rem;
	}

	.historical summary {
		cursor: pointer;
		padding: 0.5rem;
	}

	.historical ul {
		font-size: 0.875rem;
		color: var(--text-muted, #555);
	}
</style>
