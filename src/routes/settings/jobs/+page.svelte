<script lang="ts">
	import { AppPage, PageHeader } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Job = (typeof data.jobs)[number];

	let jobs = $state<Job[]>(data.jobs);
	let loading = $state(false);
	let processingId = $state<string | null>(null);
	let expanded = $state<Record<string, boolean>>({});

	let aggregating = $state<'30d' | 'all' | null>(null);
	let aggregateResult = $state<{ ok: boolean; message: string } | null>(null);

	let workerRunning = $state(false);
	let workerResult = $state<{ ok: boolean; message: string } | null>(null);

	type BulkAction = 'delete_failed' | 'delete_completed' | 'cancel_queued' | 'requeue_failed';
	let bulkRunning = $state<BulkAction | null>(null);
	let bulkResult = $state<{ ok: boolean; message: string } | null>(null);

	async function runAggregation(mode: '30d' | 'all') {
		aggregating = mode;
		aggregateResult = null;
		try {
			const body =
				mode === '30d'
					? { fromDate: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0] }
					: {};
			const res = await fetch('/api/sensors/aggregate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			if (res.ok) {
				aggregateResult = {
					ok: true,
					message:
						mode === '30d'
							? 'Aggregering ferdig for siste 30 dager.'
							: 'Aggregering ferdig for alle perioder (inkl. daglig effort tilbake til 400 dager).'
				};
			} else {
				const text = await res.text();
				aggregateResult = { ok: false, message: text || 'Aggregering feilet.' };
			}
		} catch (err) {
			aggregateResult = { ok: false, message: String(err) };
		} finally {
			aggregating = null;
		}
	}

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

	async function runWorker() {
		workerRunning = true;
		workerResult = null;
		try {
			const res = await fetch('/api/jobs/process', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ limit: 50 })
			});
			const json = await res.json();
			if (res.ok && json.success) {
				const processed = json.processed ?? 0;
				const completed = json.completed ?? 0;
				const failed = json.failed ?? 0;
				const retried = json.retried ?? 0;
				workerResult = {
					ok: true,
					message: `Worker kjørt: ${processed} prosessert (${completed} ok, ${failed} feilet, ${retried} retry).`
				};
				await refresh();
			} else {
				workerResult = { ok: false, message: json.error ?? 'Worker feilet.' };
			}
		} catch (err) {
			workerResult = { ok: false, message: String(err) };
		} finally {
			workerRunning = false;
		}
	}

	const bulkLabels: Record<BulkAction, string> = {
		delete_failed: 'Slett alle failed',
		delete_completed: 'Slett alle ferdige',
		cancel_queued: 'Avbryt alle aktive',
		requeue_failed: 'Prøv alle failed på nytt'
	};

	const bulkConfirm: Record<BulkAction, string> = {
		delete_failed: 'Slette alle jobber med status "failed"?',
		delete_completed: 'Slette alle ferdige jobber (completed)?',
		cancel_queued: 'Avbryte alle jobber i kø (queued/retry)?',
		requeue_failed: 'Sette alle failed jobber tilbake i kø?'
	};

	async function runBulk(action: BulkAction) {
		if (!confirm(bulkConfirm[action])) return;
		bulkRunning = action;
		bulkResult = null;
		try {
			const res = await fetch('/api/jobs/bulk', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action })
			});
			const json = await res.json();
			if (res.ok && json.success) {
				bulkResult = {
					ok: true,
					message: `${bulkLabels[action]}: ${json.affected ?? 0} jobber berørt.`
				};
				await refresh();
			} else {
				bulkResult = { ok: false, message: json.error ?? 'Bulk-handling feilet.' };
			}
		} catch (err) {
			bulkResult = { ok: false, message: String(err) };
		} finally {
			bulkRunning = null;
		}
	}

	function toggleExpanded(id: string) {
		expanded = { ...expanded, [id]: !expanded[id] };
	}

	function fmtJson(value: unknown) {
		if (value === null || value === undefined) return '—';
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
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

<AppPage width="full" theme="dark" className="jobs-page">
	<PageHeader
		title="Bakgrunnsjobber"
		titleHref="/settings"
		titleLabel="Gå til innstillinger"
	>
		{#snippet actions()}
			<button class="refresh-btn" onclick={refresh} disabled={loading}>
				{loading ? '…' : '↺ Oppdater'}
			</button>
		{/snippet}
	</PageHeader>

	<div class="jobs-content">

	<section class="manual-section">
		<h2 class="jobs-section-title">Manuelle kjøringer</h2>
		<p class="manual-hint">
			Triggrer aggregering av sensordata her og nå. Den nattlige cron-jobben gjør det samme automatisk kl. 00:00 UTC.
		</p>
		<div class="manual-row">
			<button
				class="manual-btn"
				onclick={() => runAggregation('30d')}
				disabled={aggregating !== null}
			>
				{aggregating === '30d' ? '⏳ Aggregerer siste 30 dager…' : '↺ Aggreger siste 30 dager'}
			</button>
			<button
				class="manual-btn"
				onclick={() => runAggregation('all')}
				disabled={aggregating !== null}
			>
				{aggregating === 'all' ? '⏳ Aggregerer alt…' : '⟳ Aggreger alt (full backfill)'}
			</button>
		</div>
		{#if aggregateResult}
			<p class="manual-result" class:ok={aggregateResult.ok} class:err={!aggregateResult.ok}>
				{aggregateResult.ok ? '✅' : '❌'} {aggregateResult.message}
			</p>
		{/if}
	</section>

	<section class="debug-section">
		<h2 class="jobs-section-title">Debug</h2>
		<p class="debug-hint">
			Workeren plukker normalt opp jobber via cron. Bruk knappene her for å trigge manuelt
			eller rydde i køen. Bulk-handlinger gjelder bare dine egne jobber.
		</p>
		<div class="debug-row">
			<button class="debug-btn debug-btn-primary" onclick={runWorker} disabled={workerRunning}>
				{workerRunning ? '⏳ Kjører worker…' : '▶ Kjør worker nå (50)'}
			</button>
			<button
				class="debug-btn"
				onclick={() => runBulk('cancel_queued')}
				disabled={bulkRunning !== null}
			>
				{bulkRunning === 'cancel_queued' ? '⏳ Avbryter…' : '🚫 Avbryt alle aktive'}
			</button>
			<button
				class="debug-btn"
				onclick={() => runBulk('requeue_failed')}
				disabled={bulkRunning !== null}
			>
				{bulkRunning === 'requeue_failed' ? '⏳ Setter i kø…' : '🔄 Prøv alle failed på nytt'}
			</button>
			<button
				class="debug-btn debug-btn-danger"
				onclick={() => runBulk('delete_failed')}
				disabled={bulkRunning !== null}
			>
				{bulkRunning === 'delete_failed' ? '⏳ Sletter…' : '🗑 Slett alle failed'}
			</button>
			<button
				class="debug-btn debug-btn-danger"
				onclick={() => runBulk('delete_completed')}
				disabled={bulkRunning !== null}
			>
				{bulkRunning === 'delete_completed' ? '⏳ Sletter…' : '🗑 Slett alle ferdige'}
			</button>
		</div>
		{#if workerResult}
			<p class="manual-result" class:ok={workerResult.ok} class:err={!workerResult.ok}>
				{workerResult.ok ? '✅' : '❌'} {workerResult.message}
			</p>
		{/if}
		{#if bulkResult}
			<p class="manual-result" class:ok={bulkResult.ok} class:err={!bulkResult.ok}>
				{bulkResult.ok ? '✅' : '❌'} {bulkResult.message}
			</p>
		{/if}
	</section>

	{#if activeJobs.length > 0}
		<section class="jobs-section">
			<h2 class="jobs-section-title">Aktive ({activeJobs.length})</h2>
			<div class="jobs-list">
				{#each activeJobs as job}
					{@const isOpen = expanded[job.id] === true}
					<div class="job-row" class:busy={processingId === job.id}>
						<div class="job-main">
							<button
								class="job-toggle"
								onclick={() => toggleExpanded(job.id)}
								aria-expanded={isOpen}
								title={isOpen ? 'Skjul detaljer' : 'Vis detaljer'}
							>
								<span class="job-status">{statusEmoji(job.status)}</span>
								<div class="job-info">
									<span class="job-type">{typeLabel(job.type)}</span>
									<span class="job-meta">Forsøk {job.attempts}/{job.maxAttempts} · opprettet {fmtDate(job.createdAt)}</span>
									{#if job.error}
										<span class="job-error">{job.error}</span>
									{/if}
								</div>
								<span class="job-chevron" class:open={isOpen}>›</span>
							</button>
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
						{#if isOpen}
							<div class="job-details">
								<dl class="job-fields">
									<dt>ID</dt><dd class="mono">{job.id}</dd>
									<dt>Type</dt><dd class="mono">{job.type}</dd>
									<dt>Status</dt><dd class="mono">{job.status}</dd>
									<dt>Prioritet</dt><dd class="mono">{job.priority}</dd>
									<dt>runAt</dt><dd class="mono">{fmtDate(job.runAt)}</dd>
									<dt>startedAt</dt><dd class="mono">{fmtDate(job.startedAt)}</dd>
									<dt>lockedAt</dt><dd class="mono">{fmtDate(job.lockedAt)}</dd>
									<dt>lockedBy</dt><dd class="mono">{job.lockedBy ?? '—'}</dd>
									<dt>updatedAt</dt><dd class="mono">{fmtDate(job.updatedAt)}</dd>
								</dl>
								{#if job.payload && Object.keys(job.payload as object).length > 0}
									<div class="job-block">
										<span class="job-block-label">payload</span>
										<pre class="job-pre">{fmtJson(job.payload)}</pre>
									</div>
								{/if}
								{#if job.error}
									<div class="job-block">
										<span class="job-block-label">error</span>
										<pre class="job-pre job-pre-error">{job.error}</pre>
									</div>
								{/if}
							</div>
						{/if}
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
					{@const isOpen = expanded[job.id] === true}
					<div class="job-row job-row-done" class:busy={processingId === job.id}>
						<div class="job-main">
							<button
								class="job-toggle"
								onclick={() => toggleExpanded(job.id)}
								aria-expanded={isOpen}
								title={isOpen ? 'Skjul detaljer' : 'Vis detaljer'}
							>
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
								<span class="job-chevron" class:open={isOpen}>›</span>
							</button>
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
						{#if isOpen}
							<div class="job-details">
								<dl class="job-fields">
									<dt>ID</dt><dd class="mono">{job.id}</dd>
									<dt>Type</dt><dd class="mono">{job.type}</dd>
									<dt>Status</dt><dd class="mono">{job.status}</dd>
									<dt>Prioritet</dt><dd class="mono">{job.priority}</dd>
									<dt>runAt</dt><dd class="mono">{fmtDate(job.runAt)}</dd>
									<dt>startedAt</dt><dd class="mono">{fmtDate(job.startedAt)}</dd>
									<dt>finishedAt</dt><dd class="mono">{fmtDate(job.finishedAt)}</dd>
									<dt>updatedAt</dt><dd class="mono">{fmtDate(job.updatedAt)}</dd>
								</dl>
								{#if job.payload && Object.keys(job.payload as object).length > 0}
									<div class="job-block">
										<span class="job-block-label">payload</span>
										<pre class="job-pre">{fmtJson(job.payload)}</pre>
									</div>
								{/if}
								{#if job.error}
									<div class="job-block">
										<span class="job-block-label">error</span>
										<pre class="job-pre job-pre-error">{job.error}</pre>
									</div>
								{/if}
								{#if job.result}
									<div class="job-block">
										<span class="job-block-label">result</span>
										<pre class="job-pre">{fmtJson(job.result)}</pre>
									</div>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}
	</div>
</AppPage>

<style>
	:global(.jobs-page) {
		color: var(--text-secondary);
	}

	.jobs-content {
		display: flex;
		flex-direction: column;
		gap: 24px;
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
		flex-direction: column;
		background: #171717;
		border: none;
		border-radius: 10px;
		padding: 10px 12px;
		transition: opacity 0.15s;
	}
	.job-row.busy { opacity: 0.5; pointer-events: none; }
	.job-row-done { opacity: 0.7; }

	.job-main {
		display: flex;
		align-items: flex-start;
		gap: 10px;
	}

	.job-toggle {
		flex: 1;
		display: flex;
		align-items: flex-start;
		gap: 10px;
		background: transparent;
		border: none;
		padding: 0;
		text-align: left;
		cursor: pointer;
		color: inherit;
		font: inherit;
		min-width: 0;
	}
	.job-toggle:hover { opacity: 0.85; }

	.job-chevron {
		font-size: 1.1rem;
		color: #555;
		flex-shrink: 0;
		margin-top: 2px;
		transition: transform 0.15s;
	}
	.job-chevron.open { transform: rotate(90deg); color: #aaa; }

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

	.job-btn-retry { color: #7ec8a8; }
	.job-btn-retry:hover:not(:disabled) { background: #0e2019; }

	.job-btn-cancel { color: #f0b96b; }
	.job-btn-cancel:hover:not(:disabled) { background: #1f1608; }

	.job-btn-delete { color: #c05050; }
	.job-btn-delete:hover:not(:disabled) { background: #1f0808; }

	.jobs-empty {
		color: #555;
		font-size: 0.88rem;
		text-align: center;
		padding: 32px 0;
	}

	.manual-section {
		background: #171717;
		border-radius: 12px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.manual-hint {
		margin: 0;
		font-size: 0.82rem;
		color: #888;
		line-height: 1.4;
	}

	.manual-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.manual-btn {
		background: #1e2040;
		border: 1px solid #3a4080;
		border-radius: 8px;
		color: #aab4f5;
		cursor: pointer;
		font: inherit;
		font-size: 0.85rem;
		padding: 8px 14px;
	}

	.manual-btn:hover:not(:disabled) {
		background: #2a2c55;
	}

	.manual-btn:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.manual-result {
		margin: 0;
		font-size: 0.82rem;
	}

	.manual-result.ok {
		color: #7ec8a8;
	}

	.manual-result.err {
		color: #fb7185;
	}

	.debug-section {
		background: #171717;
		border-radius: 12px;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.debug-hint {
		margin: 0;
		font-size: 0.82rem;
		color: #888;
		line-height: 1.4;
	}

	.debug-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.debug-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #aaa;
		cursor: pointer;
		font: inherit;
		font-size: 0.82rem;
		padding: 7px 12px;
	}
	.debug-btn:hover:not(:disabled) { background: #222; color: #e0e0e0; }
	.debug-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.debug-btn-primary {
		background: #1e3a2c;
		border-color: #2d5a40;
		color: #7ec8a8;
	}
	.debug-btn-primary:hover:not(:disabled) { background: #264a37; }

	.debug-btn-danger {
		color: #c05050;
		border-color: #3a1f1f;
	}
	.debug-btn-danger:hover:not(:disabled) { background: #1f0808; }

	.job-details {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid #232323;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.job-fields {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 4px 12px;
		margin: 0;
		font-size: 0.78rem;
	}
	.job-fields dt {
		color: #666;
	}
	.job-fields dd {
		margin: 0;
		color: #c0c0c0;
		word-break: break-all;
	}

	.mono {
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	}

	.job-block {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.job-block-label {
		font-size: 0.7rem;
		font-weight: 500;
		color: #666;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	.job-pre {
		margin: 0;
		padding: 8px 10px;
		background: #0e0e0e;
		border: 1px solid #232323;
		border-radius: 6px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.74rem;
		color: #c0c0c0;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 320px;
		overflow: auto;
	}

	.job-pre-error {
		color: #fb7185;
		border-color: #3a1f1f;
		background: #1a0a0a;
	}
</style>
