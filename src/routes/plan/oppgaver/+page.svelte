<script lang="ts">
	import { untrack } from 'svelte';
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
	import { ChecklistCheckbox, ChecklistItemRow } from '$lib/components/ui';
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';
	import type { ChecklistItemLike } from '$lib/types/checklist';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ServerTask = PageData['tasks'][number];
	type ThemeOpt = PageData['themes'][number];

	interface CardState {
		text: string;
		estimateMinutes: number | null;
		dueDate: string | null;
		themeId: string | null;
		breakdown: string[];
		dirty: boolean;
		saving: boolean;
		message: string | null;
		showBreakdown: boolean;
		showEditor: boolean;
		suggestionPreview: {
			estimateMinutes?: number;
			themeId?: string | null;
			breakdown?: string[];
		} | null;
	}

	function emptyState(t: ServerTask): CardState {
		return {
			text: t.text,
			estimateMinutes: t.estimateMinutes,
			dueDate: t.dueDate,
			themeId: t.themeId,
			breakdown: t.subItems.map((s) => s.text),
			dirty: false,
			saving: false,
			message: null,
			showBreakdown: t.subItems.length > 0,
			showEditor: false,
			suggestionPreview: null
		};
	}

	let states = $state<Record<string, CardState>>({});
	$effect(() => {
		const tasks = data.tasks;
		const prev = untrack(() => states);
		const next: Record<string, CardState> = {};
		for (const t of tasks) {
			next[t.id] = prev[t.id] ?? emptyState(t);
		}
		states = next;
	});

	const themeMap = $derived.by(() => {
		const m = new Map<string, ThemeOpt>();
		for (const t of data.themes) m.set(t.id, t);
		return m;
	});

	let suggesting = $state(false);
	let suggestError = $state<string | null>(null);
	let editingTaskId = $state<string | null>(null);
	let editingText = $state('');

	function taskToChecklistItem(task: ServerTask): ChecklistItemLike {
		return { id: task.id, text: task.text, checked: task.checked };
	}

	function handleTaskTextClick(task: ServerTask) {
		return (_item: ChecklistItemLike) => {
			editingTaskId = task.id;
			editingText = states[task.id]?.text ?? task.text;
		};
	}

	function handleTaskToggle(task: ServerTask) {
		return (_item: ChecklistItemLike) => {
			toggleChecked(task.id, task.checked);
		};
	}

	function handleTaskLongpress(task: ServerTask) {
		return (_rect: DOMRect, _item: ChecklistItemLike) => {
			patchState(task.id, { showEditor: true });
		};
	}

	async function commitTaskEdit(task: ServerTask) {
		const text = editingText.trim();
		editingTaskId = null;
		editingText = '';
		if (!text || text === task.text) return;
		markDirty(task.id, { text });
		void saveCard(task.id);
	}

	const ESTIMATE_PRESETS = [
		{ value: 15, label: '15 m' },
		{ value: 30, label: '30 m' },
		{ value: 60, label: '1 t' },
		{ value: 120, label: '2 t' },
		{ value: 240, label: '4 t' },
		{ value: 480, label: '1 dag' },
		{ value: 1440, label: '2 dager' },
		{ value: 2880, label: '4 dager+' }
	];

	function formatEstimate(min: number | null): string {
		if (min === null) return '—';
		if (min < 60) return `${min} m`;
		if (min < 480) return `${(min / 60).toFixed(min % 60 === 0 ? 0 : 1)} t`;
		const days = min / 480;
		return `${days % 1 === 0 ? days : days.toFixed(1)} d`;
	}

	function formatDate(iso: string | null): string {
		if (!iso) return '—';
		const d = new Date(iso + 'T00:00:00');
		return d.toLocaleDateString('nb-NO', { weekday: 'short', day: '2-digit', month: 'short' });
	}

	function dueClass(iso: string | null): string {
		if (!iso) return '';
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const d = new Date(iso + 'T00:00:00');
		if (d < today) return 'overdue';
		if (d.getTime() === today.getTime()) return 'today';
		return '';
	}

	function todayIso(): string {
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	function isoOffset(days: number): string {
		const d = new Date();
		d.setDate(d.getDate() + days);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	function nextFriday(): string {
		const d = new Date();
		const dow = d.getDay();
		const delta = (5 - dow + 7) % 7 || 7;
		d.setDate(d.getDate() + delta);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}
	function nextMonday(): string {
		const d = new Date();
		const dow = d.getDay();
		const delta = (1 - dow + 7) % 7 || 7;
		d.setDate(d.getDate() + delta);
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	const DUE_PRESETS = $derived.by(() => [
		{ iso: todayIso(), label: 'I dag' },
		{ iso: isoOffset(1), label: 'I morgen' },
		{ iso: nextFriday(), label: 'På fredag' },
		{ iso: nextMonday(), label: 'Neste mandag' },
		{ iso: isoOffset(30), label: 'Om en måned' }
	]);

	function patchState(id: string, patch: Partial<CardState>) {
		const cur = states[id];
		if (!cur) return;
		states[id] = { ...cur, ...patch };
	}

	function markDirty(id: string, patch: Partial<CardState>) {
		patchState(id, { ...patch, dirty: true, message: null });
	}

	async function saveCard(id: string) {
		const state = states[id];
		if (!state) return;
		patchState(id, { saving: true, message: null });
		try {
			const res = await fetch(`/api/checklist-items/${id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text: state.text,
					estimateMinutes: state.estimateMinutes,
					dueDate: state.dueDate,
					themeId: state.themeId
				})
			});
			if (!res.ok) throw new Error(await res.text());

			const original = data.tasks.find((t) => t.id === id);
			const originalSubs = original ? original.subItems.map((s) => s.text) : [];
			const breakdownChanged =
				state.breakdown.length !== originalSubs.length ||
				state.breakdown.some((t, i) => t !== originalSubs[i]);
			if (breakdownChanged) {
				const breakRes = await fetch(`/api/checklist-items/${id}/breakdown`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ subItems: state.breakdown })
				});
				if (!breakRes.ok) throw new Error(await breakRes.text());
			}
			patchState(id, { saving: false, dirty: false, message: 'Lagret', suggestionPreview: null });
			await invalidateAll();
		} catch (err) {
			console.error(err);
			patchState(id, { saving: false, message: 'Klarte ikke lagre' });
		}
	}

	async function toggleChecked(id: string, current: boolean) {
		const res = await fetch(`/api/checklist-items/${id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ checked: !current })
		});
		if (res.ok) await invalidateAll();
	}

	async function deleteCard(id: string) {
		if (!confirm('Slette dette punktet?')) return;
		const res = await fetch(`/api/checklist-items/${id}`, { method: 'DELETE' });
		if (res.ok) await invalidateAll();
	}

	async function runSuggestForAll() {
		suggesting = true;
		suggestError = null;
		try {
			const visibleIds = data.tasks.filter((t) => t.isUnsorted).map((t) => t.id);
			const res = await fetch('/api/checklist-items/triage-suggest', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ itemIds: visibleIds.length > 0 ? visibleIds : undefined })
			});
			if (!res.ok) throw new Error(await res.text());
			const body = (await res.json()) as {
				suggestions: Array<{
					id: string;
					estimateMinutes?: number;
					themeId?: string | null;
					breakdown?: string[];
				}>;
			};
			for (const s of body.suggestions) {
				const cur = states[s.id];
				if (!cur) continue;
				states[s.id] = { ...cur, suggestionPreview: s, showEditor: true };
			}
		} catch (err) {
			console.error(err);
			suggestError = 'Klarte ikke hente forslag akkurat nå.';
		} finally {
			suggesting = false;
		}
	}

	function acceptSuggestion(id: string) {
		const state = states[id];
		if (!state || !state.suggestionPreview) return;
		const s = state.suggestionPreview;
		const patch: Partial<CardState> = { suggestionPreview: null, dirty: true, message: null };
		if (typeof s.estimateMinutes === 'number') patch.estimateMinutes = s.estimateMinutes;
		if (s.themeId !== undefined) patch.themeId = s.themeId;
		if (s.breakdown && s.breakdown.length > 0) {
			patch.breakdown = s.breakdown;
			patch.showBreakdown = true;
		}
		patchState(id, patch);
	}
	function dismissSuggestion(id: string) {
		patchState(id, { suggestionPreview: null });
	}

	function addBreakdownLine(id: string) {
		const cur = states[id];
		if (!cur) return;
		patchState(id, { breakdown: [...cur.breakdown, ''], showBreakdown: true, dirty: true });
	}
	function updateBreakdownLine(id: string, idx: number, value: string) {
		const cur = states[id];
		if (!cur) return;
		const next = [...cur.breakdown];
		next[idx] = value;
		patchState(id, { breakdown: next, dirty: true });
	}
	function removeBreakdownLine(id: string, idx: number) {
		const cur = states[id];
		if (!cur) return;
		patchState(id, { breakdown: cur.breakdown.filter((_, i) => i !== idx), dirty: true });
	}

	async function selectBucket(bucket: 'innboks' | 'gjores' | 'ugjort') {
		const url = new URL($page.url);
		if (bucket === 'innboks') url.searchParams.delete('bucket');
		else url.searchParams.set('bucket', bucket);
		await goto(url, { keepFocus: true, invalidateAll: true, noScroll: true });
	}

	const BUCKET_LABELS = {
		innboks: 'Innboks',
		gjores: 'Gjøres',
		ugjort: 'Ugjort'
	} as const;
</script>

<svelte:head>
	<title>Oppgaver – Plan | Resonans</title>
</svelte:head>

<div class="oppgaver">
	<nav class="bucket-tabs" aria-label="Oppgave-buckets">
		{#each ['innboks', 'gjores', 'ugjort'] as const as b (b)}
			<button
				type="button"
				class="bucket-tab"
				class:active={data.bucket === b}
				onclick={() => selectBucket(b)}
			>
				<span class="bucket-label">{BUCKET_LABELS[b]}</span>
				<span class="bucket-count">{data.counts[b]}</span>
			</button>
		{/each}
	</nav>

	<p class="bucket-hint">
		{#if data.bucket === 'innboks'}
			Nye oppgaver havner her. Gi dem estimat og tema for å sende videre.
		{:else if data.bucket === 'gjores'}
			Klare oppgaver — kan hentes inn i en dagsplan eller tas som quick win.
		{:else}
			Oppgaver som passerte fristen uten å bli gjort. Vurder å omplanlegge eller slette.
		{/if}
	</p>

	{#if data.bucket === 'innboks'}
		{@const unsortedInInbox = data.tasks.filter((t) => t.isUnsorted).length}
		{#if unsortedInInbox > 0}
			<div class="ai-row">
				<button
					class="ai-suggest"
					type="button"
					disabled={suggesting}
					onclick={runSuggestForAll}
				>
					{suggesting ? 'Tenker…' : `✨ AI-foreslå for ${unsortedInInbox} usortert${unsortedInInbox === 1 ? '' : 'e'}`}
				</button>
				{#if suggestError}
					<span class="err">{suggestError}</span>
				{/if}
			</div>
		{/if}
	{/if}

	{#if data.tasks.length === 0}
		<p class="empty">
			{#if data.bucket === 'innboks'}
				Innboksen er tom. Bruk «Noter»-chippen på hjem for å legge til nye.
			{:else if data.bucket === 'gjores'}
				Ingen ferdigsorterte oppgaver klare ennå. Behandle noen fra innboksen.
			{:else}
				Ingen ugjorte oppgaver. Bra jobba!
			{/if}
		</p>
	{:else}
		<ul class="cards">
			{#each data.tasks as task (task.id)}
				{@const state = states[task.id]}
				{#if state}
					{#snippet taskBadges(_item: ChecklistItemLike)}
						{#if task.estimateMinutes !== null}
							<span class="badge est">⏱ {formatEstimate(task.estimateMinutes)}</span>
						{/if}
						{#if task.dueDate}
							<span class="badge due {dueClass(task.dueDate)}">📅 {formatDate(task.dueDate)}</span>
						{/if}
						{#if task.themeId && task.themeName}
							<span class="badge theme">{task.themeEmoji ?? '·'} {task.themeName}</span>
						{:else if !task.themeId}
							<span class="badge missing">🏷</span>
						{/if}
						{#if task.checklistContext === 'inbox'}
							<span class="badge loc inbox">📥</span>
						{/if}
					{/snippet}

					<li class="card" class:dirty={state.dirty} class:done={task.checked} class:unsorted={task.isUnsorted}>
						<ChecklistItemRow
							item={taskToChecklistItem(task)}
							editing={editingTaskId === task.id}
							bind:editText={editingText}
							animated={false}
							showTime={false}
							showTravel={false}
							ontoggle={handleTaskToggle(task)}
							ontextclick={handleTaskTextClick(task)}
							onlongpress={handleTaskLongpress(task)}
							oneditcommit={() => commitTaskEdit(task)}
							oneditcancel={() => { editingTaskId = null; editingText = ''; }}
							trailingBadge={taskBadges}
						/>

						{#if state.suggestionPreview}
							<div class="suggestion">
								<div class="suggestion-head">✨ AI foreslår:</div>
								<ul class="suggestion-list">
									{#if state.suggestionPreview.estimateMinutes !== undefined}
										<li>Estimat: <strong>{formatEstimate(state.suggestionPreview.estimateMinutes)}</strong></li>
									{/if}
									{#if state.suggestionPreview.themeId}
										<li>Tema: <strong>{themeMap.get(state.suggestionPreview.themeId)?.name ?? 'Ukjent'}</strong></li>
									{:else if state.suggestionPreview.themeId === null}
										<li>Tema: <em>ingen passer</em></li>
									{/if}
									{#if state.suggestionPreview.breakdown && state.suggestionPreview.breakdown.length > 0}
										<li>Delsteg:
											<ul class="sub-bullets">
												{#each state.suggestionPreview.breakdown as step}
													<li>{step}</li>
												{/each}
											</ul>
										</li>
									{/if}
								</ul>
								<div class="suggestion-actions">
									<button type="button" class="primary" onclick={() => acceptSuggestion(task.id)}>Bruk forslaget</button>
									<button type="button" class="ghost" onclick={() => dismissSuggestion(task.id)}>Avvis</button>
								</div>
							</div>
						{/if}

						{#if state.showEditor}
							<div class="editor">
								<div class="chip-group">
									<span class="chip-label">⏱ Estimat</span>
									<div class="chip-options">
										{#each ESTIMATE_PRESETS as preset}
											<button
												type="button"
												class="chip"
												class:active={state.estimateMinutes === preset.value}
												onclick={() => markDirty(task.id, { estimateMinutes: preset.value })}
											>{preset.label}</button>
										{/each}
										{#if state.estimateMinutes !== null}
											<button type="button" class="chip clear" onclick={() => markDirty(task.id, { estimateMinutes: null })}>×</button>
										{/if}
									</div>
								</div>

								<div class="chip-group">
									<span class="chip-label">📅 Frist</span>
									<div class="chip-options">
										{#each DUE_PRESETS as preset}
											<button
												type="button"
												class="chip"
												class:active={state.dueDate === preset.iso}
												onclick={() => markDirty(task.id, { dueDate: preset.iso })}
											>{preset.label}</button>
										{/each}
										<input
											type="date"
											class="chip date-input"
											value={state.dueDate ?? ''}
											onchange={(e) => markDirty(task.id, { dueDate: e.currentTarget.value || null })}
										/>
										{#if state.dueDate !== null}
											<button type="button" class="chip clear" onclick={() => markDirty(task.id, { dueDate: null })}>×</button>
										{/if}
									</div>
								</div>

								<div class="chip-group">
									<span class="chip-label">🏷 Tema</span>
									<div class="chip-options">
										{#each data.themes as theme (theme.id)}
											<button
												type="button"
												class="chip"
												class:active={state.themeId === theme.id}
												onclick={() => markDirty(task.id, { themeId: theme.id })}
											>{theme.emoji ?? '·'} {theme.name}</button>
										{/each}
										{#if state.themeId !== null}
											<button type="button" class="chip clear" onclick={() => markDirty(task.id, { themeId: null })}>×</button>
										{/if}
									</div>
								</div>

								<button
									type="button"
									class="breakdown-toggle"
									onclick={() => patchState(task.id, { showBreakdown: !state.showBreakdown })}
								>
									↳ Bryt opp {state.breakdown.length > 0 ? `(${state.breakdown.length})` : ''}
								</button>

								{#if state.showBreakdown}
									<div class="breakdown">
										{#each state.breakdown as line, idx (idx)}
											<div class="breakdown-row">
												<input
													type="text"
													value={line}
													placeholder="Delsteg"
													oninput={(e) => updateBreakdownLine(task.id, idx, e.currentTarget.value)}
												/>
												<button type="button" class="ghost-icon" onclick={() => removeBreakdownLine(task.id, idx)} aria-label="Fjern">×</button>
											</div>
										{/each}
										<button type="button" class="add-line" onclick={() => addBreakdownLine(task.id)}>+ Legg til delsteg</button>
									</div>
								{/if}

								<div class="actions">
									<button
										type="button"
										class="save"
										disabled={!state.dirty || state.saving}
										onclick={() => saveCard(task.id)}
									>
										{state.saving ? 'Lagrer…' : state.dirty ? 'Lagre endringer' : 'Lagret'}
									</button>
									<button type="button" class="close" onclick={() => patchState(task.id, { showEditor: false })}>Lukk</button>
									<button type="button" class="delete" onclick={() => deleteCard(task.id)}>Slett</button>
									{#if state.message}
										<span class="msg">{state.message}</span>
									{/if}
								</div>
							</div>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
</div>

<style>
	.oppgaver {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.bucket-tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid var(--border-color);
	}
	.bucket-tab {
		flex: 1;
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 0.6rem 0.5rem;
		background: transparent;
		border: 0;
		border-bottom: 2px solid transparent;
		color: var(--text-tertiary);
		cursor: pointer;
		font: inherit;
		transition: color 0.12s, border-color 0.12s;
	}
	.bucket-tab:hover {
		color: var(--text-secondary);
	}
	.bucket-tab.active {
		color: var(--text-primary);
		border-bottom-color: var(--accent-primary);
	}
	.bucket-label {
		font-size: 0.92rem;
		font-weight: 600;
	}
	.bucket-count {
		font-size: 0.74rem;
		color: var(--text-tertiary);
	}
	.bucket-tab.active .bucket-count {
		color: var(--accent-primary);
	}
	.bucket-hint {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-secondary);
		font-style: italic;
		padding: 0.1rem 0.1rem 0;
	}
	.ai-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.ai-suggest {
		background: var(--accent-primary);
		color: white;
		border: 0;
		padding: 0.5rem 0.95rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
	}
	.ai-suggest:disabled {
		opacity: 0.6;
		cursor: wait;
	}
	.err {
		color: var(--error-text);
		font-size: 0.8rem;
	}
	.empty {
		color: var(--text-tertiary);
		font-style: italic;
		text-align: center;
		padding: 2rem 1rem;
	}
	.link {
		background: transparent;
		border: 0;
		color: var(--accent-primary);
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
	.cards {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
	}
	.card {
		background: transparent;
		padding: 0;
		transition: opacity 0.12s;
	}
	.card.done { opacity: 0.55; }
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 6px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.04);
		color: var(--text-tertiary);
		font-size: 0.65rem;
	}
	.badge.missing {
		background: transparent;
		border: 1px dashed var(--border-color);
		color: #444;
	}
	.badge.due.overdue {
		background: var(--error-bg);
		color: var(--error-text);
	}
	.badge.due.today {
		background: var(--info-bg);
		color: var(--accent-primary);
	}
	.badge.loc.inbox {
		background: hsl(40 90% 60% / 0.15);
		color: hsl(40 90% 60%);
	}
	.suggestion {
		background: var(--info-bg);
		border: 1px solid var(--info-border);
		border-radius: 10px;
		padding: 0.6rem 0.75rem;
		margin: 4px 12px 8px;
	}
	.suggestion-head {
		font-size: 0.74rem;
		color: var(--text-secondary);
		margin-bottom: 0.3rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.suggestion-list {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: 0.85rem;
	}
	.sub-bullets {
		margin: 0.2rem 0 0;
		padding-left: 1rem;
		font-size: 0.82rem;
		color: var(--text-secondary);
	}
	.suggestion-actions {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}
	.suggestion-actions .primary,
	.suggestion-actions .ghost {
		padding: 0.25rem 0.7rem;
		border-radius: 6px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		border: 0;
	}
	.suggestion-actions .primary {
		background: var(--accent-primary);
		color: white;
	}
	.suggestion-actions .ghost {
		background: transparent;
		color: var(--text-tertiary);
		border: 1px solid var(--border-color);
	}
	.editor {
		margin: 4px 12px 8px;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding-top: 0.65rem;
		border-top: 1px dashed var(--border-subtle);
	}
	.chip-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.chip-label {
		font-size: 0.7rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.chip-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		background: transparent;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		padding: 0.25rem 0.65rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.76rem;
		cursor: pointer;
	}
	.chip.active {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
	}
	.chip.clear {
		border-style: dashed;
		color: var(--text-tertiary);
	}
	.date-input { min-width: 130px; }
	.breakdown-toggle {
		align-self: flex-start;
		background: transparent;
		border: 1px dashed var(--border-color);
		color: var(--text-secondary);
		padding: 0.3rem 0.75rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.76rem;
		cursor: pointer;
	}
	.breakdown {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.breakdown-row {
		display: flex;
		gap: 0.35rem;
		align-items: center;
	}
	.breakdown-row input {
		flex: 1;
		padding: 0.4rem 0.65rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 6px;
		color: var(--text-primary);
		font: inherit;
		font-size: 0.85rem;
	}
	.ghost-icon {
		width: 26px;
		height: 26px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-tertiary);
		border-radius: 5px;
		cursor: pointer;
	}
	.add-line {
		align-self: flex-start;
		background: transparent;
		border: 0;
		color: var(--accent-primary);
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
		padding: 0.25rem 0;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
		margin-top: 0.45rem;
	}
	.save {
		background: var(--accent-primary);
		color: white;
		border: 0;
		padding: 0.4rem 0.95rem;
		border-radius: 6px;
		font: inherit;
		font-size: 0.82rem;
		font-weight: 600;
		cursor: pointer;
	}
	.save:disabled {
		background: var(--border-color);
		color: var(--text-tertiary);
		cursor: not-allowed;
	}
	.close {
		background: transparent;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.delete {
		background: transparent;
		color: var(--error-text);
		border: 1px solid var(--error-border);
		padding: 0.35rem 0.75rem;
		border-radius: 6px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.msg {
		font-size: 0.78rem;
		color: var(--success-text);
	}
</style>
