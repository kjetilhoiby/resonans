<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/stores';
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
		const next: Record<string, CardState> = {};
		for (const t of data.tasks) {
			next[t.id] = states[t.id] ?? emptyState(t);
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

	function setFilter(key: 'status' | 'timeframe' | 'theme', value: string) {
		const params = new URLSearchParams($page.url.searchParams);
		if (value === '' || value === 'all') params.delete(key);
		else params.set(key, value);
		goto(`/plan/oppgaver?${params.toString()}`, { keepFocus: true });
	}

	function toggleUnsorted() {
		const params = new URLSearchParams($page.url.searchParams);
		if (params.get('usortert') === '1') params.delete('usortert');
		else params.set('usortert', '1');
		goto(`/plan/oppgaver?${params.toString()}`, { keepFocus: true });
	}

	function clearFilters() {
		goto('/plan/oppgaver', { keepFocus: true });
	}

	const activeFilterCount = $derived(
		(data.filters.status !== 'open' ? 1 : 0) +
		(data.filters.timeframe !== 'all' ? 1 : 0) +
		(data.filters.theme !== 'all' ? 1 : 0) +
		(data.filters.unsortedOnly ? 1 : 0)
	);
	const unsortedCount = $derived(data.tasks.filter((t) => t.isUnsorted).length);
</script>

<svelte:head>
	<title>Oppgaver – Plan | Resonans</title>
</svelte:head>

<div class="oppgaver">
	<header class="head">
		<h1>Oppgaver</h1>
		<span class="count">{data.tasks.length}</span>
	</header>

	<div class="filter-bar">
		<button
			type="button"
			class="filter-chip"
			class:active={data.filters.unsortedOnly}
			onclick={toggleUnsorted}
		>
			Usortert ({unsortedCount})
		</button>

		<label class="filter-select">
			Status
			<select value={data.filters.status} onchange={(e) => setFilter('status', e.currentTarget.value)}>
				<option value="open">Åpne</option>
				<option value="done">Ferdige</option>
				<option value="all">Alle</option>
			</select>
		</label>

		<label class="filter-select">
			Frist
			<select value={data.filters.timeframe} onchange={(e) => setFilter('timeframe', e.currentTarget.value)}>
				<option value="all">Alle</option>
				<option value="overdue">Forfalt</option>
				<option value="today">I dag</option>
				<option value="this_week">Denne uka</option>
				<option value="next_week">Neste uke</option>
				<option value="no_due">Ingen frist</option>
			</select>
		</label>

		<label class="filter-select">
			Tema
			<select value={data.filters.theme} onchange={(e) => setFilter('theme', e.currentTarget.value)}>
				<option value="all">Alle</option>
				<option value="none">Uten tema</option>
				{#each data.themes as t (t.id)}
					<option value={t.id}>{t.emoji ?? '·'} {t.name}</option>
				{/each}
			</select>
		</label>

		{#if activeFilterCount > 0}
			<button type="button" class="clear-filter" onclick={clearFilters}>Nullstill</button>
		{/if}
	</div>

	{#if unsortedCount > 0}
		<div class="ai-row">
			<button
				class="ai-suggest"
				type="button"
				disabled={suggesting}
				onclick={runSuggestForAll}
			>
				{suggesting ? 'Tenker…' : `✨ AI-foreslå for ${unsortedCount} usortert${unsortedCount === 1 ? '' : 'e'}`}
			</button>
			{#if suggestError}
				<span class="err">{suggestError}</span>
			{/if}
		</div>
	{/if}

	{#if data.tasks.length === 0}
		<p class="empty">
			{#if activeFilterCount > 0}
				Ingen oppgaver matcher filtrene. <button class="link" onclick={clearFilters}>Nullstill</button>.
			{:else}
				Ingen åpne oppgaver. Bruk «Noter»-chippen på hjem for å legge til nye.
			{/if}
		</p>
	{:else}
		<ul class="cards">
			{#each data.tasks as task (task.id)}
				{@const state = states[task.id]}
				{#if state}
					<li class="card" class:dirty={state.dirty} class:done={task.checked} class:unsorted={task.isUnsorted}>
						<div class="row">
							<button
								type="button"
								class="check"
								class:checked={task.checked}
								onclick={() => toggleChecked(task.id, task.checked)}
								aria-label={task.checked ? 'Marker som ikke ferdig' : 'Marker ferdig'}
							>{task.checked ? '✓' : ''}</button>

							<div class="body">
								{#if state.showEditor}
									<textarea
										class="text-edit"
										value={state.text}
										rows="2"
										oninput={(e) => markDirty(task.id, { text: e.currentTarget.value })}
									></textarea>
								{:else}
									<div class="text-row" onclick={() => patchState(task.id, { showEditor: true })} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && patchState(task.id, { showEditor: true })}>
										{state.text}
									</div>
								{/if}

								<div class="badges">
									{#if task.estimateMinutes !== null}
										<span class="badge est">⏱ {formatEstimate(task.estimateMinutes)}</span>
									{:else}
										<span class="badge missing">⏱ Mangler estimat</span>
									{/if}
									{#if task.dueDate}
										<span class="badge due {dueClass(task.dueDate)}">📅 {formatDate(task.dueDate)}</span>
									{/if}
									{#if task.themeId && task.themeName}
										<span class="badge theme">{task.themeEmoji ?? '·'} {task.themeName}</span>
									{:else}
										<span class="badge missing">🏷 Uten tema</span>
									{/if}
									{#if task.checklistContext && task.checklistContext !== 'inbox'}
										<span class="badge loc">{task.checklistTitle}</span>
									{:else if task.checklistContext === 'inbox'}
										<span class="badge loc inbox">📥 Innboks</span>
									{/if}
									{#if task.subItems.length > 0}
										<span class="badge sub">↳ {task.subItems.length} delsteg</span>
									{/if}
								</div>

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
							</div>
						</div>
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
	.head {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}
	h1 {
		font-size: 1.4rem;
		margin: 0;
	}
	.count {
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}
	.filter-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		align-items: center;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-subtle);
	}
	.filter-chip {
		background: transparent;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.filter-chip.active {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: white;
	}
	.filter-select {
		display: inline-flex;
		gap: 0.3rem;
		align-items: center;
		font-size: 0.78rem;
		color: var(--text-tertiary);
	}
	.filter-select select {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		color: var(--text-primary);
		padding: 0.3rem 0.5rem;
		border-radius: 6px;
		font: inherit;
	}
	.clear-filter {
		background: transparent;
		color: var(--text-tertiary);
		border: 0;
		padding: 0.3rem 0.5rem;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		text-decoration: underline;
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
		gap: 0.6rem;
	}
	.card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 0.7rem 0.85rem;
		transition: border-color 0.12s, opacity 0.12s;
	}
	.card.dirty { border-color: var(--accent-primary); }
	.card.done { opacity: 0.55; }
	.card.unsorted { border-left: 3px solid hsl(40 90% 60%); padding-left: 0.75rem; }
	.row {
		display: flex;
		gap: 0.65rem;
		align-items: flex-start;
	}
	.check {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		border-radius: 50%;
		border: 1.5px solid var(--border-color);
		background: transparent;
		color: white;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 700;
		margin-top: 1px;
	}
	.check.checked {
		background: var(--success-text);
		border-color: var(--success-text);
	}
	.body {
		flex: 1;
		min-width: 0;
	}
	.text-row {
		font-size: 0.96rem;
		font-weight: 500;
		cursor: text;
		padding: 0.15rem 0;
		line-height: 1.35;
	}
	.text-edit {
		width: 100%;
		background: transparent;
		border: 0;
		resize: vertical;
		color: var(--text-primary);
		font: inherit;
		font-size: 0.96rem;
		font-weight: 500;
		padding: 0;
		outline: none;
	}
	.card.done .text-row {
		text-decoration: line-through;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-top: 0.4rem;
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 999px;
		background: var(--bg-hover);
		color: var(--text-secondary);
		font-size: 0.72rem;
	}
	.badge.missing {
		background: transparent;
		border: 1px dashed var(--border-color);
		color: var(--text-tertiary);
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
		margin: 0.6rem 0;
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
		margin-top: 0.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		padding-top: 0.65rem;
		border-top: 1px dashed var(--border-color);
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
