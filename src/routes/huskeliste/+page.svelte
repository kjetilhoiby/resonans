<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import AppPage from '$lib/components/ui/AppPage.svelte';
	import ScreenTitle from '$lib/components/ui/ScreenTitle.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let { data } = $props();

	type PoolTask = (typeof data)['tasks'][number];

	let activeTab = $state<'all' | 'stubs' | 'due' | 'windows' | 'undated'>('all');
	let titlesInput = $state('');
	let projectFilter = $state('');
	let clarifyOpen = $state<Record<string, boolean>>({});
	let clarifyEst = $state<Record<string, string>>({});
	let clarifyDue = $state<Record<string, string>>({});
	let clarifyYearly = $state<Record<string, string>>({});
	let submitting = $state(false);

	const filtered = $derived.by(() => {
		let list: PoolTask[] = data.tasks;
		if (projectFilter) list = list.filter((t) => t.projectId === projectFilter);
		switch (activeTab) {
			case 'stubs':
				return list.filter((t) => t.needsClarification);
			case 'due':
				return list.filter((t) => t.dueDate);
			case 'windows':
				return list.filter((t) => t.yearlyWindow);
			case 'undated':
				return list.filter((t) => !t.dueDate && !t.yearlyWindow);
			default:
				return list;
		}
	});

	const counts = $derived({
		all: data.tasks.length,
		stubs: data.tasks.filter((t) => t.needsClarification).length,
		due: data.tasks.filter((t) => t.dueDate).length,
		windows: data.tasks.filter((t) => t.yearlyWindow).length,
		undated: data.tasks.filter((t) => !t.dueDate && !t.yearlyWindow).length
	});

	function daysUntil(iso: string | null): number | null {
		if (!iso) return null;
		const target = new Date(`${iso}T00:00:00Z`).getTime();
		const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').getTime();
		return Math.round((target - today) / 86400000);
	}

	function dueBadge(iso: string | null): string {
		const d = daysUntil(iso);
		if (d === null) return '';
		if (d < 0) return `Forfalt for ${-d}d`;
		if (d === 0) return 'I dag';
		if (d === 1) return 'I morgen';
		if (d <= 7) return `Om ${d}d`;
		return iso!;
	}

	async function postForm(action: string, body: FormData) {
		submitting = true;
		try {
			const res = await fetch(`?/${action}`, { method: 'POST', body });
			if (res.ok) await invalidateAll();
		} finally {
			submitting = false;
		}
	}

	async function addTitles() {
		if (!titlesInput.trim()) return;
		const fd = new FormData();
		fd.set('titles', titlesInput);
		await postForm('add', fd);
		titlesInput = '';
	}

	async function clarify(taskId: string) {
		const fd = new FormData();
		fd.set('taskId', taskId);
		if (clarifyEst[taskId]) fd.set('estimatedMinutes', clarifyEst[taskId]);
		if (clarifyDue[taskId]) fd.set('dueDate', clarifyDue[taskId]);
		if (clarifyYearly[taskId]) fd.set('yearlyWindow', clarifyYearly[taskId]);
		await postForm('clarify', fd);
		clarifyOpen[taskId] = false;
		clarifyEst[taskId] = '';
		clarifyDue[taskId] = '';
		clarifyYearly[taskId] = '';
	}

	async function snooze(taskId: string, days: number) {
		const fd = new FormData();
		fd.set('taskId', taskId);
		fd.set('days', String(days));
		await postForm('snooze', fd);
	}

	async function complete(taskId: string) {
		const fd = new FormData();
		fd.set('taskId', taskId);
		await postForm('complete', fd);
	}

	async function del(taskId: string) {
		if (!confirm('Slette oppgaven?')) return;
		const fd = new FormData();
		fd.set('taskId', taskId);
		await postForm('delete', fd);
	}
</script>

<AppPage width="content" gap="md">
	<ScreenTitle title="Huskeliste" subtitle="Ting du skulle gjort — uten frist" />

	<section class="add-section">
		<label for="titles" class="label">Dump inn nye oppgaver</label>
		<textarea
			id="titles"
			bind:value={titlesInput}
			placeholder={'En per linje, eller komma-separert\n– rydd klesskap\n– bestill nye nøkler'}
			rows="3"
		></textarea>
		<div class="add-actions">
			<Button onClick={addTitles} disabled={!titlesInput.trim() || submitting}>Legg til</Button>
			<span class="hint">AI vil spørre om estimat/frist senere — eller klargjør per oppgave under.</span>
		</div>
	</section>

	<nav class="tabs">
		<button class:active={activeTab === 'all'} onclick={() => (activeTab = 'all')}>Alle ({counts.all})</button>
		<button class:active={activeTab === 'stubs'} onclick={() => (activeTab = 'stubs')}>Stubs ({counts.stubs})</button>
		<button class:active={activeTab === 'due'} onclick={() => (activeTab = 'due')}>Med frist ({counts.due})</button>
		<button class:active={activeTab === 'windows'} onclick={() => (activeTab = 'windows')}>Vinduer ({counts.windows})</button>
		<button class:active={activeTab === 'undated'} onclick={() => (activeTab = 'undated')}>Uten dato ({counts.undated})</button>
	</nav>

	{#if data.projects.length > 0}
		<div class="filter-row">
			<label for="projectFilter">Prosjekt:</label>
			<select id="projectFilter" bind:value={projectFilter}>
				<option value="">Alle</option>
				{#each data.projects as p (p.id)}
					<option value={p.id}>{p.title}</option>
				{/each}
			</select>
		</div>
	{/if}

	<ul class="tasks">
		{#each filtered as t (t.id)}
			<li class="task" class:stub={t.needsClarification}>
				<div class="task-header">
					<div class="title">
						<span>{t.title}</span>
						{#if t.needsClarification}
							<span class="badge stub-badge">stub</span>
						{/if}
						{#if t.yearlyActiveNow}
							<span class="badge season-badge">sesong nå</span>
						{/if}
					</div>
					<div class="meta">
						{#if t.estimatedMinutes}<span class="chip">{t.estimatedMinutes} min</span>{/if}
						{#if t.effort}<span class="chip">{t.effort}</span>{/if}
						{#if t.dueDate}<span class="chip due">{dueBadge(t.dueDate)}</span>{/if}
						{#if t.yearlyLabel}<span class="chip">{t.yearlyLabel}</span>{/if}
						{#if t.projectTitle}<span class="chip project">{t.projectTitle}</span>{/if}
					</div>
				</div>

				{#if clarifyOpen[t.id]}
					<div class="clarify">
						<label>
							<span>Estimat (min)</span>
							<input type="number" min="1" bind:value={clarifyEst[t.id]} placeholder="f.eks. 30" />
						</label>
						<label>
							<span>Frist</span>
							<input type="date" bind:value={clarifyDue[t.id]} />
						</label>
						<label>
							<span>Årlig vindu</span>
							<input
								type="text"
								bind:value={clarifyYearly[t.id]}
								placeholder="MM-DD..MM-DD (f.eks. 05-13..05-17)"
							/>
						</label>
						<div class="clarify-actions">
							<Button onClick={() => clarify(t.id)} disabled={submitting}>Lagre</Button>
							<button type="button" class="link" onclick={() => (clarifyOpen[t.id] = false)}>Avbryt</button>
						</div>
					</div>
				{/if}

				<div class="task-actions">
					{#if t.needsClarification || !clarifyOpen[t.id]}
						<button type="button" class="link" onclick={() => (clarifyOpen[t.id] = !clarifyOpen[t.id])}>
							{clarifyOpen[t.id] ? 'Skjul' : 'Klargjør'}
						</button>
					{/if}
					<button type="button" class="link" onclick={() => snooze(t.id, 1)}>Snooze 1d</button>
					<button type="button" class="link" onclick={() => snooze(t.id, 7)}>Snooze 1u</button>
					<button type="button" class="link" onclick={() => complete(t.id)}>Fullfør</button>
					<button type="button" class="link danger" onclick={() => del(t.id)}>Slett</button>
				</div>
			</li>
		{:else}
			<li class="empty">Ingenting på huskelista{activeTab !== 'all' ? ' i denne kategorien' : ''}.</li>
		{/each}
	</ul>
</AppPage>

<style>
	.add-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
		background: var(--bg-card, #fafafa);
		padding: 16px;
		border-radius: 12px;
		border: 1px solid var(--border-subtle, #eee);
	}
	.label {
		font-weight: 600;
		font-size: 14px;
	}
	textarea {
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--border-color, #ddd);
		border-radius: 8px;
		font: inherit;
		resize: vertical;
		min-height: 64px;
	}
	.add-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.hint {
		color: var(--text-secondary, #777);
		font-size: 13px;
	}
	.tabs {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		overflow-x: auto;
	}
	.tabs button {
		padding: 6px 12px;
		border: 1px solid var(--border-color, #ddd);
		background: var(--bg-card, #fafafa);
		border-radius: 999px;
		font-size: 13px;
		cursor: pointer;
	}
	.tabs button.active {
		background: var(--accent-primary, #4a5af0);
		color: white;
		border-color: transparent;
	}
	.filter-row {
		display: flex;
		gap: 8px;
		align-items: center;
		font-size: 14px;
	}
	.filter-row select {
		padding: 6px 8px;
		border: 1px solid var(--border-color, #ddd);
		border-radius: 6px;
	}
	.tasks {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.task {
		background: var(--bg-card, #fff);
		border: 1px solid var(--border-subtle, #eee);
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.task.stub {
		border-left: 3px solid #f59e0b;
	}
	.task-header {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
		font-weight: 500;
	}
	.meta {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.chip {
		font-size: 12px;
		padding: 2px 8px;
		background: var(--bg-secondary, #f3f4f6);
		border-radius: 999px;
		color: var(--text-secondary, #555);
	}
	.chip.due {
		background: rgba(244, 114, 182, 0.15);
		color: #b3306b;
	}
	.chip.project {
		background: rgba(74, 90, 240, 0.12);
		color: #4a5af0;
	}
	.badge {
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 4px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.stub-badge {
		background: rgba(245, 158, 11, 0.18);
		color: #b27500;
	}
	.season-badge {
		background: rgba(34, 197, 94, 0.18);
		color: #168042;
	}
	.task-actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}
	.link {
		background: none;
		border: none;
		color: var(--accent-primary, #4a5af0);
		cursor: pointer;
		padding: 0;
		font: inherit;
	}
	.link.danger {
		color: #d54545;
	}
	.clarify {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 8px;
		padding: 10px;
		background: var(--bg-secondary, #f9f9f9);
		border-radius: 8px;
	}
	.clarify label {
		display: flex;
		flex-direction: column;
		font-size: 12px;
		gap: 4px;
	}
	.clarify input {
		padding: 6px 8px;
		border: 1px solid var(--border-color, #ddd);
		border-radius: 6px;
		font: inherit;
	}
	.clarify-actions {
		grid-column: 1 / -1;
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.empty {
		text-align: center;
		padding: 24px;
		color: var(--text-secondary, #777);
		font-size: 14px;
	}
	@media (max-width: 540px) {
		.clarify {
			grid-template-columns: 1fr;
		}
	}
</style>
