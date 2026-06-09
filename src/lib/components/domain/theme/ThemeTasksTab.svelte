<script module lang="ts">
	export interface ProjectTask {
		id: string;
		text: string;
		checked: boolean;
		parentId: string | null;
		sortOrder: number;
		startDate: string | null;
		dueDate: string | null;
		estimateMinutes: number | null;
		blockedBy: string[];
		createdAt: string;
	}
</script>

<script lang="ts">
	import AnimatedProgressBar from '../../visualizations/AnimatedProgressBar.svelte';

	interface Props {
		themeId: string;
		initialTasks?: ProjectTask[];
		projectProfile?: Record<string, unknown> | null;
		onSwitchToChat?: (draft?: string) => void;
	}

	let { themeId, initialTasks = [], projectProfile = null, onSwitchToChat }: Props = $props();

	let tasks = $state<ProjectTask[]>(initialTasks);
	let newText = $state('');
	let adding = $state(false);
	let breakingDown = $state<string | null>(null); // item-id eller 'project' mens AI jobber

	const topLevel = $derived(
		tasks.filter((t) => !t.parentId).sort((a, b) => a.sortOrder - b.sortOrder)
	);
	const total = $derived(tasks.length);
	const done = $derived(tasks.filter((t) => t.checked).length);
	const pct = $derived(total > 0 ? (done / total) * 100 : 0);
	const textById = $derived(new Map(tasks.map((t) => [t.id, t.text])));

	function childrenOf(parentId: string): ProjectTask[] {
		return tasks.filter((t) => t.parentId === parentId).sort((a, b) => a.sortOrder - b.sortOrder);
	}

	const todayISO = new Date().toISOString().slice(0, 10);
	function isOverdue(t: ProjectTask): boolean {
		return !t.checked && !!t.dueDate && t.dueDate < todayISO;
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' });
	}

	function formatEstimate(min: number): string {
		if (min < 60) return `${min} min`;
		if (min < 600) return `${Math.round(min / 60)} t`;
		return `${Math.round(min / 480)} dager`;
	}

	async function addTask(parentId: string | null = null, text?: string) {
		const t = (text ?? newText).trim();
		if (!t || adding) return;
		adding = true;
		try {
			const res = await fetch(`/api/tema/${themeId}/tasks`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ text: t, parentId })
			});
			if (res.ok) {
				const { item } = await res.json();
				tasks = [...tasks, item];
				if (!text) newText = '';
			}
		} finally {
			adding = false;
		}
	}

	async function toggle(item: ProjectTask) {
		const next = !item.checked;
		tasks = tasks.map((t) => (t.id === item.id ? { ...t, checked: next } : t));
		await fetch(`/api/tema/${themeId}/tasks`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ itemId: item.id, checked: next })
		});
	}

	function collectDescendants(id: string, acc: Set<string>) {
		acc.add(id);
		for (const c of tasks.filter((t) => t.parentId === id)) collectDescendants(c.id, acc);
	}

	async function removeTask(item: ProjectTask) {
		const drop = new Set<string>();
		collectDescendants(item.id, drop);
		tasks = tasks.filter((t) => !drop.has(t.id));
		await fetch(`/api/tema/${themeId}/tasks`, {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ itemId: item.id })
		});
	}

	async function breakdown(parentId: string | null) {
		breakingDown = parentId ?? 'project';
		try {
			const res = await fetch(`/api/tema/${themeId}/tasks/breakdown`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ parentId })
			});
			if (res.ok) {
				const { items } = await res.json();
				tasks = items;
			}
		} finally {
			breakingDown = null;
		}
	}

	function blockedNames(t: ProjectTask): string {
		return t.blockedBy
			.map((id) => textById.get(id))
			.filter(Boolean)
			.join(', ');
	}

	const room = $derived((projectProfile?.room as string | undefined) ?? null);
	const targetDate = $derived((projectProfile?.targetDate as string | undefined) ?? null);
</script>

<div class="tasks">
	{#if room || targetDate}
		<div class="proj-meta">
			{#if room}<span>{room}</span>{/if}
			{#if room && targetDate}<span class="dot">·</span>{/if}
			{#if targetDate}<span>Frist {formatDate(targetDate)}</span>{/if}
		</div>
	{/if}

	{#if total > 0}
		<div class="summary">
			<AnimatedProgressBar {pct} tone="accent" height={6} />
			<span class="summary-label">{done}/{total} fullført</span>
		</div>
	{/if}

	{#if total === 0}
		<div class="empty">
			<p>Ingen oppgaver ennå. Legg til manuelt, eller la AI bryte ned prosjektet i steg.</p>
			<div class="empty-actions">
				<button class="ai-btn" onclick={() => breakdown(null)} disabled={breakingDown !== null}>
					{breakingDown === 'project' ? 'Bryter ned …' : '✨ Bryt ned med AI'}
				</button>
				{#if onSwitchToChat}
					<button class="ghost-btn" onclick={() => onSwitchToChat?.()}>Diskutér i chat</button>
				{/if}
			</div>
		</div>
	{:else}
		<ul class="tree">
			{#each topLevel as item (item.id)}
				{@render taskRow(item, 0)}
			{/each}
		</ul>
	{/if}

	<form class="add-row" onsubmit={(e) => { e.preventDefault(); addTask(null); }}>
		<input type="text" placeholder="Ny oppgave …" bind:value={newText} disabled={adding} />
		<button type="submit" disabled={adding || !newText.trim()}>Legg til</button>
	</form>

	{#if total > 0}
		<button class="ai-btn wide" onclick={() => breakdown(null)} disabled={breakingDown !== null}>
			{breakingDown === 'project' ? 'Bryter ned …' : '✨ Foreslå flere steg med AI'}
		</button>
	{/if}
</div>

{#snippet taskRow(item: ProjectTask, depth: number)}
	<li class="row" style:margin-left={`${depth * 1.25}rem`}>
		<div class="row-main">
			<input type="checkbox" checked={item.checked} onchange={() => toggle(item)} />
			<div class="row-body">
				<span class="row-text" class:done={item.checked}>{item.text}</span>
				<div class="row-sub">
					{#if item.dueDate}
						<span class="badge" class:overdue={isOverdue(item)}>frist {formatDate(item.dueDate)}</span>
					{/if}
					{#if item.estimateMinutes}
						<span class="badge muted">{formatEstimate(item.estimateMinutes)}</span>
					{/if}
					{#if item.blockedBy.length > 0 && blockedNames(item)}
						<span class="badge blocked">avventer: {blockedNames(item)}</span>
					{/if}
				</div>
			</div>
			<div class="row-actions">
				<button
					class="icon-btn"
					title="Bryt ned i underoppgaver"
					onclick={() => breakdown(item.id)}
					disabled={breakingDown !== null}
				>
					{breakingDown === item.id ? '…' : '✨'}
				</button>
				<button class="icon-btn" title="Slett" onclick={() => removeTask(item)}>✕</button>
			</div>
		</div>
	</li>
	{#each childrenOf(item.id) as child (child.id)}
		{@render taskRow(child, depth + 1)}
	{/each}
{/snippet}

<style>
	.tasks {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		max-width: 640px;
		margin: 0 auto;
	}
	.proj-meta {
		display: flex;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--text-tertiary);
	}
	.summary {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.summary-label {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}
	.tree {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.row {
		list-style: none;
	}
	.row-main {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.55rem 0.7rem;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 10px;
	}
	.row-main input[type='checkbox'] {
		margin-top: 0.15rem;
		width: 1.05rem;
		height: 1.05rem;
		accent-color: var(--accent-primary);
		cursor: pointer;
		flex-shrink: 0;
	}
	.row-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		min-width: 0;
	}
	.row-text {
		font-size: 0.92rem;
	}
	.row-text.done {
		text-decoration: line-through;
		color: var(--text-tertiary);
	}
	.row-sub {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.badge {
		font-size: 0.72rem;
		padding: 0.1rem 0.45rem;
		border-radius: 999px;
		background: var(--bg-hover);
		color: var(--text-secondary);
	}
	.badge.muted {
		color: var(--text-tertiary);
	}
	.badge.overdue {
		background: rgba(224, 112, 112, 0.15);
		color: #e07070;
	}
	.badge.blocked {
		background: rgba(250, 204, 21, 0.12);
		color: #eab308;
	}
	.row-actions {
		display: flex;
		gap: 0.15rem;
		flex-shrink: 0;
	}
	.icon-btn {
		border: 0;
		background: transparent;
		color: var(--text-tertiary);
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.15rem 0.3rem;
		border-radius: 6px;
	}
	.icon-btn:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	.icon-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.add-row {
		display: flex;
		gap: 0.5rem;
	}
	.add-row input {
		flex: 1;
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-input);
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}
	.add-row button {
		padding: 0.55rem 1rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent-primary);
		color: #fff;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}
	.add-row button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.empty {
		text-align: center;
		color: var(--text-secondary);
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
		padding: 1.5rem 0;
	}
	.empty p {
		margin: 0;
		font-size: 0.9rem;
	}
	.empty-actions {
		display: flex;
		gap: 0.5rem;
		justify-content: center;
		flex-wrap: wrap;
	}
	.ai-btn {
		padding: 0.55rem 1rem;
		border-radius: 999px;
		border: 1px solid var(--accent-primary);
		background: transparent;
		color: var(--accent-light);
		font: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}
	.ai-btn:hover:not(:disabled) {
		background: var(--bg-hover);
	}
	.ai-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.ai-btn.wide {
		align-self: center;
	}
	.ghost-btn {
		padding: 0.55rem 1rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
	}
	.ghost-btn:hover {
		border-color: var(--text-secondary);
	}
</style>
