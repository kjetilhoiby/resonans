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
		shopping: boolean;
		store: string | null;
		createdAt: string;
	}
</script>

<script lang="ts">
	import AnimatedProgressBar from '../../visualizations/AnimatedProgressBar.svelte';
	import TaskContextMenu from '../../ui/TaskContextMenu.svelte';
	import BreakdownModal from '../../ui/BreakdownModal.svelte';

	interface Props {
		themeId: string;
		projectName?: string;
		initialTasks?: ProjectTask[];
		projectProfile?: Record<string, unknown> | null;
		onSwitchToChat?: (draft?: string) => void;
	}

	let { themeId, projectName = '', initialTasks = [], projectProfile = null, onSwitchToChat }: Props = $props();

	const ESTIMATES = [
		{ label: '15 min', v: 15 },
		{ label: '30 min', v: 30 },
		{ label: '1 t', v: 60 },
		{ label: '2 t', v: 120 },
		{ label: '½ dag', v: 240 },
		{ label: '1 dag', v: 480 },
		{ label: 'Flere dager', v: 2880 }
	];

	let tasks = $state<ProjectTask[]>(initialTasks);
	let newText = $state('');
	let adding = $state(false);

	// Langpress / kontekstmeny
	let menuItem = $state<ProjectTask | null>(null);
	let menuRect = $state<DOMRect | null>(null);

	// Inline «+ underoppgave»
	let addChildFor = $state<string | null>(null);
	let childText = $state('');

	// Redigerings-sheet
	let editItem = $state<ProjectTask | null>(null);
	let editText = $state('');
	let editEstimate = $state<number | null>(null);
	let editDue = $state('');
	let editBlocked = $state<Set<string>>(new Set());

	// AI-nedbryting (BreakdownModal — tekstforslag du plukker fra)
	let breakdownTarget = $state<{ title: string; description: string; parentId: string | null } | null>(null);

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
	function blockedNames(t: ProjectTask): string {
		return t.blockedBy.map((id) => textById.get(id)).filter(Boolean).join(', ');
	}

	async function addTask(parentId: string | null, text: string) {
		const t = text.trim();
		if (!t) return;
		const res = await fetch(`/api/tema/${themeId}/tasks`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ text: t, parentId })
		});
		if (res.ok) {
			const { item } = await res.json();
			tasks = [...tasks, item];
		}
	}

	async function submitNew() {
		if (adding || !newText.trim()) return;
		adding = true;
		try {
			await addTask(null, newText);
			newText = '';
		} finally {
			adding = false;
		}
	}

	async function submitChild(parentId: string) {
		if (!childText.trim()) return;
		await addTask(parentId, childText);
		childText = '';
		addChildFor = null;
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

	/* ── Kontekstmeny (langpress + ⋯) ─────────────────── */
	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	function openMenu(rect: DOMRect, item: ProjectTask) {
		menuRect = rect;
		menuItem = item;
	}
	function pressStart(e: PointerEvent, item: ProjectTask) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		pressTimer = setTimeout(() => {
			pressTimer = null;
			openMenu(rect, item);
		}, 500);
	}
	function pressEnd() {
		if (pressTimer) {
			clearTimeout(pressTimer);
			pressTimer = null;
		}
	}

	/* ── Dra/slipp-sortering (peker-basert, virker på touch + mus) ── */
	let dragId = $state<string | null>(null);
	let dragOverId = $state<string | null>(null);

	function startDrag(e: PointerEvent, item: ProjectTask) {
		e.preventDefault();
		dragId = item.id;
		const move = (ev: PointerEvent) => onDragMove(ev);
		const up = () => {
			endDrag();
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function sameParent(aId: string, bId: string): boolean {
		const a = tasks.find((t) => t.id === aId);
		const b = tasks.find((t) => t.id === bId);
		return !!a && !!b && (a.parentId ?? null) === (b.parentId ?? null);
	}

	function onDragMove(ev: PointerEvent) {
		if (!dragId) return;
		const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest(
			'[data-task-id]'
		);
		const overId = el?.getAttribute('data-task-id') ?? null;
		dragOverId = overId && overId !== dragId && sameParent(dragId, overId) ? overId : null;
	}

	async function endDrag() {
		const moved = dragId;
		const over = dragOverId;
		dragId = null;
		dragOverId = null;
		if (!moved || !over || moved === over || !sameParent(moved, over)) return;

		const parentId = tasks.find((t) => t.id === moved)?.parentId ?? null;
		const siblings = tasks
			.filter((t) => (t.parentId ?? null) === parentId)
			.sort((a, b) => a.sortOrder - b.sortOrder);
		const fromIdx = siblings.findIndex((t) => t.id === moved);
		const toIdx = siblings.findIndex((t) => t.id === over);
		if (fromIdx < 0 || toIdx < 0) return;

		const [dragged] = siblings.splice(fromIdx, 1);
		siblings.splice(toIdx, 0, dragged);

		// Reassign sortOrder og oppdater lokalt + persistér de som endret seg.
		const changed: Array<{ id: string; sortOrder: number }> = [];
		siblings.forEach((s, i) => {
			if (s.sortOrder !== i) changed.push({ id: s.id, sortOrder: i });
		});
		const orderMap = new Map(siblings.map((s, i) => [s.id, i]));
		tasks = tasks.map((t) => (orderMap.has(t.id) ? { ...t, sortOrder: orderMap.get(t.id)! } : t));

		await Promise.all(
			changed.map((c) =>
				fetch(`/api/tema/${themeId}/tasks`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ itemId: c.id, sortOrder: c.sortOrder })
				})
			)
		);
	}

	/* ── Redigering ───────────────────────────────────── */
	function openEdit(item: ProjectTask) {
		editItem = item;
		editText = item.text;
		editEstimate = item.estimateMinutes;
		editDue = item.dueDate ?? '';
		editBlocked = new Set(item.blockedBy);
	}
	const editableDeps = $derived.by(() => {
		if (!editItem) return [] as ProjectTask[];
		const exclude = new Set<string>();
		collectDescendants(editItem.id, exclude);
		return tasks.filter((t) => !exclude.has(t.id));
	});
	function toggleDep(id: string) {
		const next = new Set(editBlocked);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		editBlocked = next;
	}
	async function saveEdit() {
		if (!editItem) return;
		const itemId = editItem.id;
		const payload = {
			itemId,
			text: editText.trim() || editItem.text,
			estimateMinutes: editEstimate,
			dueDate: editDue || null,
			blockedBy: [...editBlocked]
		};
		const res = await fetch(`/api/tema/${themeId}/tasks`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload)
		});
		if (res.ok) {
			const { item } = await res.json();
			tasks = tasks.map((t) => (t.id === itemId ? item : t));
		}
		editItem = null;
	}

	/* ── Nedbryting (BreakdownModal — du plukker forslag) ── */
	function openBreakdown(item: ProjectTask | null) {
		breakdownTarget = item
			? { title: item.text, description: '', parentId: item.id }
			: {
					title: projectName,
					description: (projectProfile?.room as string | undefined) ?? '',
					parentId: null
				};
	}
	async function handleBreakdownSave(subtasks: string[]) {
		const parentId = breakdownTarget?.parentId ?? null;
		for (const text of subtasks) await addTask(parentId, text);
		breakdownTarget = null;
	}

	const room = $derived((projectProfile?.room as string | undefined) ?? null);
	const targetDate = $derived((projectProfile?.targetDate as string | undefined) ?? null);
</script>

<div class="tasks">
	{#if room || targetDate}
		<div class="proj-meta">
			{#if room}<span>{room}</span>{/if}
			{#if room && targetDate}<span>·</span>{/if}
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
			<p>Ingen oppgaver ennå. Legg til manuelt, eller la AI foreslå steg du kan plukke fra.</p>
			<div class="empty-actions">
				<button class="ai-btn" data-track="tema-oppgaver:foresla-steg" onclick={() => openBreakdown(null)}>✨ Foreslå steg</button>
				{#if onSwitchToChat}
					<button class="ghost-btn" data-track="tema-oppgaver:diskuter-chat" onclick={() => onSwitchToChat?.()}>Diskutér i chat</button>
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

	<form class="add-row" onsubmit={(e) => { e.preventDefault(); submitNew(); }}>
		<input type="text" placeholder="Ny oppgave …" data-track="tema-oppgaver:ny-oppgave" bind:value={newText} disabled={adding} />
		<button type="submit" disabled={adding || !newText.trim()}>Legg til</button>
	</form>

	{#if total > 0}
		<button class="ai-btn wide" data-track="tema-oppgaver:foresla-flere" onclick={() => openBreakdown(null)}>✨ Foreslå flere steg</button>
	{/if}
</div>

{#snippet taskRow(item: ProjectTask, depth: number)}
	<li class="row" style:margin-left={`${depth * 1.25}rem`}>
		<div
			class="row-main"
			class:drag-over={dragOverId === item.id}
			class:dragging={dragId === item.id}
			role="group"
			aria-label={item.text}
			data-task-id={item.id}
			onpointerdown={(e) => pressStart(e, item)}
			onpointerup={pressEnd}
			onpointercancel={pressEnd}
			onpointerleave={pressEnd}
		>
			<button
				class="drag-handle"
				title="Dra for å sortere"
				aria-label="Dra for å sortere"
				data-track="tema-oppgaver:dra"
				onpointerdown={(e) => startDrag(e, item)}
			>⠿</button>
			<input
				type="checkbox"
				checked={item.checked}
				aria-label={item.text}
				data-track="tema-oppgaver:toggle"
				onchange={() => toggle(item)}
			/>
			<div class="row-body">
				<span class="row-text" class:done={item.checked}>{item.text}</span>
				<div class="row-sub">
					{#if item.shopping}
						<span class="badge shop">🛒{#if item.store} {item.store}{/if}</span>
					{/if}
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
					title="Legg til underoppgave"
					aria-label="Legg til underoppgave"
					data-track="tema-oppgaver:legg-til-underoppgave"
					onclick={() => { addChildFor = addChildFor === item.id ? null : item.id; childText = ''; }}
				>＋</button>
				<button
					class="icon-btn"
					title="Mer"
					aria-label="Flere handlinger"
					data-track="tema-oppgaver:meny"
					onclick={(e) => openMenu((e.currentTarget as HTMLElement).getBoundingClientRect(), item)}
				>⋯</button>
			</div>
		</div>
		{#if addChildFor === item.id}
			<form class="child-add" onsubmit={(e) => { e.preventDefault(); submitChild(item.id); }}>
				<input type="text" placeholder="Underoppgave …" data-track="tema-oppgaver:ny-underoppgave" bind:value={childText} />
				<button type="submit" disabled={!childText.trim()}>Legg til</button>
			</form>
		{/if}
	</li>
	{#each childrenOf(item.id) as child (child.id)}
		{@render taskRow(child, depth + 1)}
	{/each}
{/snippet}

<TaskContextMenu
	open={menuItem !== null}
	anchor={menuRect}
	itemText={menuItem?.text ?? ''}
	hasChildren={menuItem ? childrenOf(menuItem.id).length > 0 : false}
	isChecked={menuItem?.checked ?? false}
	onClose={() => (menuItem = null)}
	onEdit={() => { if (menuItem) openEdit(menuItem); menuItem = null; }}
	onBreakdown={() => { if (menuItem) openBreakdown(menuItem); menuItem = null; }}
	onDelete={() => { if (menuItem) removeTask(menuItem); menuItem = null; }}
/>

{#if breakdownTarget}
	<BreakdownModal
		itemTitle={breakdownTarget.title}
		itemDescription={breakdownTarget.description}
		onClose={() => (breakdownTarget = null)}
		onSave={handleBreakdownSave}
	/>
{/if}

{#if editItem}
	<div
		class="edit-overlay"
		role="button"
		tabindex="0"
		onclick={(e) => { if (e.target === e.currentTarget) editItem = null; }}
		onkeydown={(e) => { if (e.key === 'Escape') editItem = null; }}
	>
		<div class="edit-sheet">
			<h3>Rediger oppgave</h3>
			<label class="field">
				<span>Tekst</span>
				<input type="text" data-track="tema-oppgaver:rediger-tekst" bind:value={editText} />
			</label>
			<div class="field">
				<span>Estimat</span>
				<div class="chips">
					{#each ESTIMATES as e}
						<button
							type="button"
							class="chip"
							class:active={editEstimate === e.v}
							data-track="tema-oppgaver:estimat"
							onclick={() => (editEstimate = editEstimate === e.v ? null : e.v)}
						>{e.label}</button>
					{/each}
				</div>
			</div>
			<label class="field">
				<span>Frist</span>
				<input type="date" data-track="tema-oppgaver:frist" bind:value={editDue} />
			</label>
			{#if editableDeps.length > 0}
				<div class="field">
					<span>Avventer (må gjøres først)</span>
					<div class="deps">
						{#each editableDeps as d (d.id)}
							<label class="dep">
								<input type="checkbox" checked={editBlocked.has(d.id)} onchange={() => toggleDep(d.id)} />
								<span>{d.text}</span>
							</label>
						{/each}
					</div>
				</div>
			{/if}
			<div class="edit-actions">
				<button class="ghost-btn" data-track="tema-oppgaver:rediger-avbryt" onclick={() => (editItem = null)}>Avbryt</button>
				<button class="save-btn" data-track="tema-oppgaver:rediger-lagre" onclick={saveEdit}>Lagre</button>
			</div>
		</div>
	</div>
{/if}

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
		touch-action: pan-y;
	}
	.row-main.dragging {
		opacity: 0.5;
	}
	.row-main.drag-over {
		border-color: var(--accent-primary);
		box-shadow: 0 -2px 0 0 var(--accent-primary) inset;
	}
	.drag-handle {
		border: 0;
		background: transparent;
		color: var(--text-tertiary);
		cursor: grab;
		font-size: 0.95rem;
		line-height: 1;
		padding: 0.15rem 0.1rem;
		margin-top: 0.1rem;
		touch-action: none;
		flex-shrink: 0;
	}
	.drag-handle:active {
		cursor: grabbing;
	}
	.badge.shop {
		background: rgba(74, 222, 128, 0.12);
		color: var(--success-text);
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
		gap: 0.1rem;
		flex-shrink: 0;
	}
	.icon-btn {
		border: 0;
		background: transparent;
		color: var(--text-tertiary);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
		padding: 0.15rem 0.35rem;
		border-radius: 6px;
	}
	.icon-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}
	.child-add {
		display: flex;
		gap: 0.4rem;
		margin: 0.4rem 0 0 1.65rem;
	}
	.child-add input {
		flex: 1;
		padding: 0.4rem 0.6rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-input);
		color: inherit;
		font: inherit;
		font-size: 0.85rem;
	}
	.child-add button,
	.add-row button {
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent-primary);
		color: #fff;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 500;
		cursor: pointer;
	}
	.child-add button:disabled,
	.add-row button:disabled {
		opacity: 0.5;
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
	.ai-btn:hover {
		background: var(--bg-hover);
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

	/* Edit sheet */
	.edit-overlay {
		position: fixed;
		inset: 0;
		background: var(--bg-overlay);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 400;
	}
	.edit-sheet {
		width: 100%;
		max-width: 480px;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 16px 16px 0 0;
		padding: 1.25rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		max-height: 80vh;
		overflow-y: auto;
	}
	.edit-sheet h3 {
		margin: 0;
		font-size: 1rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}
	.field > span {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-secondary);
	}
	.field input[type='text'],
	.field input[type='date'] {
		padding: 0.55rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: var(--bg-input);
		color: inherit;
		font: inherit;
		font-size: 0.9rem;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chip {
		padding: 0.35rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.chip.active {
		border-color: var(--accent-primary);
		background: var(--bg-hover);
		color: var(--accent-light);
	}
	.deps {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
		max-height: 30vh;
		overflow-y: auto;
	}
	.dep {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.85rem;
	}
	.edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	.save-btn {
		padding: 0.55rem 1.2rem;
		border-radius: 8px;
		border: 0;
		background: var(--accent-primary);
		color: #fff;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 500;
		cursor: pointer;
	}
</style>
