<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Job = (typeof data.jobs)[number];

	let jobs = $state<Job[]>(data.jobs);
	let loading = $state(false);
	let processingId = $state<string | null>(null);

	function fmtDate(iso: string | Date | null) {
		if (!iso) return '—';
		return new Intl.DateTimeFormat('nb-NO', {
			day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
		}).format(new Date(iso));
	}

	function statusEmoji(status: string) {
		return status === 'queued' ? '⏳'
			: status === 'running' ? '⚙️'
			: status === 'retry' ? '🔄'
			: status === 'completed' ? '✅'
			: status === 'failed' ? '❌'
			: status === 'canceled' ? '🚫'
			: '❓';
	}

	function typeLabel(type: string) {
		const map: Record<string, string> = {
			book_context_collect: '📚 Bokkontekst',
			sparebank1_sync: '🏦 Sparebank1 sync',
			sparebank1_historical_sync: '🏦 Sparebank1 historisk sync',
			goal_intent_parse: '🎯 Mål-tolkning',
			task_intent_parse: '✅ Oppgave-tolkning'
		};
		return map[type] ?? type;
	}

	async function refresh() {
		loading = true;
		try {
			const res = await fetch('/api/jobs?limit=100');
			const json = await res.json();
			if (json.success) jobs = json.jobs;
		} finally {
			loading = false;
		}
	}

	async function retry(id: string) {
		processingId = id;
		try {
			const res = await fetch(`/api/jobs/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'retry' })
			});
			if (res.ok) await refresh();
		} finally {
			processingId = null;
		}
	}

	async function cancel(id: string) {
		processingId = id;
		try {
			const res = await fetch(`/api/jobs/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'cancel' })
			});
			if (res.ok) await refresh();
		} finally {
			processingId = null;
		}
	}

	async function remove(id: string) {
		processingId = id;
		try {
			const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
			if (res.ok) jobs = jobs.filter((j) => j.id !== id);
		} finally {
			processingId = null;
		}
	}

	const activeJobs = $derived(jobs.filter((j) => ['queued', 'running', 'retry'].includes(j.status)));
	const doneJobs = $derived(jobs.filter((j) => !['queued', 'running', 'retry'].includes(j.status)));
</script>

<div class="jobs-page">
	<header class="jobs-header">
		<a href="/settings" class="back-link">← Innstillinger</a>
		<h1 class="jobs-title">Bakgrunnsjobber</h1>
		<button class="refresh-btn" onclick={refresh} disabled={loading}>
			{loading ? '…' : '↺ Oppdater'}
		</button>
	</header>

	{#if activeJobs.length > 0}
		<section class="jobs-section">
			<h2 class="jobs-section-title">Aktive ({activeJobs.length})</h2>
			<div class="jobs-list">
				{#each activeJobs as job}
					<div class="job-row" class:busy={processingId === job.id}>
						<span class="job-status">{statusEmoji(job.status)}</span>
						<div class="job-info">
							<span class="job-type">{typeLabel(job.type)}</span>
							<span class="job-meta">Forsøk {job.attempts}/{job.maxAttempts} · opprettet {fmtDate(job.createdAt)}</span>
							{#if job.error}
								<span class="job-error">{job.error}</span>
							{/if}
						</div>
						<div class="job-actions">
							{#if job.status !== 'running'}
								<button class="job-btn job-btn-retry" onclick={() => retry(job.id)} disabled={processingId === job.id}>
									Kjør nå
								</button>
								<button class="job-btn job-btn-cancel" onclick={() => cancel(job.id)} disabled={processingId === job.id}>
									Avbryt
								</button>
							{/if}
							<button class="job-btn job-btn-delete" onclick={() => remove(job.id)} disabled={processingId === job.id}>
								Slett
							</button>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{:else}
		<p class="jobs-empty">Ingen aktive jobber.</p>
	{/if}

	{#if doneJobs.length > 0}
		<section class="jobs-section jobs-section-done">
			<h2 class="jobs-section-title">Historikk</h2>
			<div class="jobs-list">
				{#each doneJobs as job}
					<div class="job-row job-row-done" class:busy={processingId === job.id}>
						<span class="job-status">{statusEmoji(job.status)}</span>
						<div class="job-info">
							<span class="job-type">{typeLabel(job.type)}</span>
							<span class="job-meta">
								{fmtDate(job.finishedAt ?? job.updatedAt)}
								{#if job.attempts > 1}· {job.attempts} forsøk{/if}
							</span>
							{#if job.error}
								<span class="job-error">{job.error}</span>
							{/if}
						</div>
						<div class="job-actions">
							{#if job.status === 'failed' || job.status === 'canceled'}
								<button class="job-btn job-btn-retry" onclick={() => retry(job.id)} disabled={processingId === job.id}>
									Prøv igjen
								</button>
							{/if}
							<button class="job-btn job-btn-delete" onclick={() => remove(job.id)} disabled={processingId === job.id}>
								Slett
							</button>
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<style>
	.jobs-page {
		max-width: 760px;
		margin: 0 auto;
		padding: 24px 16px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	.jobs-header {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.back-link {
		color: #666;
		font-size: 0.85rem;
		text-decoration: none;
	}
	.back-link:hover { color: #aaa; }

	.jobs-title {
		font-size: 1.2rem;
		font-weight: 600;
		margin: 0;
		flex: 1;
	}

	.refresh-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #aaa;
		cursor: pointer;
		font: inherit;
		font-size: 0.82rem;
		padding: 6px 12px;
	}
	.refresh-btn:hover:not(:disabled) { background: #222; color: #e0e0e0; }
	.refresh-btn:disabled { opacity: 0.5; }

	.jobs-section-title {
		font-size: 0.8rem;
		font-weight: 500;
		color: #666;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		margin: 0 0 8px;
	}

	.jobs-section-done .jobs-section-title { color: #444; }

	.jobs-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.job-row {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
		padding: 10px 12px;
		transition: opacity 0.15s;
	}
	.job-row.busy { opacity: 0.5; pointer-events: none; }
	.job-row-done { opacity: 0.7; }

	.job-status {
		font-size: 1rem;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.job-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}

	.job-type {
		font-size: 0.9rem;
		font-weight: 500;
		color: #e0e0e0;
	}

	.job-meta {
		font-size: 0.78rem;
		color: #555;
	}

	.job-error {
		font-size: 0.78rem;
		color: #c0392b;
		word-break: break-all;
	}

	.job-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
		align-items: center;
	}

	.job-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		color: #aaa;
		cursor: pointer;
		font: inherit;
		font-size: 0.78rem;
		padding: 4px 10px;
		white-space: nowrap;
	}
	.job-btn:hover:not(:disabled) { background: #222; }
	.job-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.job-btn-retry { color: #7ec8a8; border-color: #1e3a2e; }
	.job-btn-retry:hover:not(:disabled) { background: #0e2019; }

	.job-btn-cancel { color: #f0b96b; border-color: #3a2a10; }
	.job-btn-cancel:hover:not(:disabled) { background: #1f1608; }

	.job-btn-delete { color: #c05050; border-color: #3a1010; }
	.job-btn-delete:hover:not(:disabled) { background: #1f0808; }

	.jobs-empty {
		color: #555;
		font-size: 0.88rem;
		text-align: center;
		padding: 32px 0;
	}
</style>
