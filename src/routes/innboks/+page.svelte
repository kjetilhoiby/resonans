<script lang="ts">
	import { invalidateAll, goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type ServerItem = PageData['items'][number];
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
		showThemePicker: boolean;
		suggestionPreview: {
			estimateMinutes?: number;
			themeId?: string | null;
			breakdown?: string[];
		} | null;
	}

	function emptyState(item: ServerItem): CardState {
		return {
			text: item.text,
			estimateMinutes: item.estimateMinutes,
			dueDate: item.dueDate,
			themeId: item.themeId,
			breakdown: item.subItems.map((s) => s.text),
			dirty: false,
			saving: false,
			message: null,
			showBreakdown: item.subItems.length > 0,
			showThemePicker: false,
			suggestionPreview: null
		};
	}

	let states = $state<Record<string, CardState>>({});
	$effect(() => {
		const next: Record<string, CardState> = {};
		for (const item of data.items) {
			next[item.id] = states[item.id] ?? emptyState(item);
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
		if (min === null) return 'Sett estimat';
		if (min < 60) return `${min} m`;
		if (min < 480) return `${(min / 60).toFixed(min % 60 === 0 ? 0 : 1)} t`;
		const days = min / 480;
		return `${days % 1 === 0 ? days : days.toFixed(1)} dag${days > 1 ? 'er' : ''}`;
	}

	function formatDate(iso: string | null): string {
		if (!iso) return 'Sett frist';
		const d = new Date(iso + 'T00:00:00');
		return d.toLocaleDateString('nb-NO', { weekday: 'short', day: '2-digit', month: 'short' });
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
			const res = await fetch(`/api/inbox/items/${id}`, {
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

			const original = data.items.find((i) => i.id === id);
			const originalSubs = original ? original.subItems.map((s) => s.text) : [];
			const breakdownChanged =
				state.breakdown.length !== originalSubs.length ||
				state.breakdown.some((t, i) => t !== originalSubs[i]);
			if (breakdownChanged) {
				const breakRes = await fetch(`/api/inbox/items/${id}/breakdown`, {
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

	async function deleteCard(id: string) {
		if (!confirm('Slette dette punktet?')) return;
		const res = await fetch(`/api/inbox/items/${id}`, { method: 'DELETE' });
		if (res.ok) await invalidateAll();
	}

	async function runSuggestForAll() {
		suggesting = true;
		suggestError = null;
		try {
			const res = await fetch('/api/inbox/triage-suggest', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
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
				states[s.id] = { ...cur, suggestionPreview: s };
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
</script>

<svelte:head>
	<title>Innboks · Sorter | Resonans</title>
</svelte:head>

<main>
	<header class="page-head">
		<button class="back" type="button" onclick={() => goto('/hjem')} aria-label="Tilbake">←</button>
		<h1>Innboks</h1>
		<span class="count">{data.items.length} usortert{data.items.length === 1 ? '' : 'e'}</span>
	</header>

	{#if data.items.length === 0}
		<p class="empty">Innboksen er tom. Bra jobba. Bruk «Noter»-chippen på hjem-skjermen for å legge til nytt.</p>
	{:else}
		<div class="tools">
			<button
				class="ai-suggest"
				type="button"
				disabled={suggesting}
				onclick={runSuggestForAll}
			>
				{suggesting ? 'Tenker…' : '✨ AI-foreslå estimat og plan'}
			</button>
			{#if suggestError}
				<span class="err">{suggestError}</span>
			{/if}
		</div>

		<ul class="cards">
			{#each data.items as item (item.id)}
				{@const state = states[item.id]}
				{#if state}
					<li class="card" class:dirty={state.dirty}>
						<textarea
							class="text"
							value={state.text}
							rows="2"
							oninput={(e) => markDirty(item.id, { text: e.currentTarget.value })}
						></textarea>

						{#if state.suggestionPreview}
							<div class="suggestion">
								<div class="suggestion-head">
									✨ AI foreslår:
								</div>
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
									<button type="button" class="primary" onclick={() => acceptSuggestion(item.id)}>Bruk forslaget</button>
									<button type="button" class="ghost" onclick={() => dismissSuggestion(item.id)}>Avvis</button>
								</div>
							</div>
						{/if}

						<div class="chips">
							<div class="chip-group">
								<span class="chip-label">⏱ Estimat</span>
								<div class="chip-options">
									{#each ESTIMATE_PRESETS as preset}
										<button
											type="button"
											class="chip"
											class:active={state.estimateMinutes === preset.value}
											onclick={() => markDirty(item.id, { estimateMinutes: preset.value })}
										>{preset.label}</button>
									{/each}
									{#if state.estimateMinutes !== null}
										<button
											type="button"
											class="chip clear"
											onclick={() => markDirty(item.id, { estimateMinutes: null })}
										>×</button>
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
											onclick={() => markDirty(item.id, { dueDate: preset.iso })}
										>{preset.label}</button>
									{/each}
									<input
										type="date"
										class="chip date-input"
										value={state.dueDate ?? ''}
										onchange={(e) => markDirty(item.id, { dueDate: e.currentTarget.value || null })}
									/>
									{#if state.dueDate !== null}
										<button
											type="button"
											class="chip clear"
											onclick={() => markDirty(item.id, { dueDate: null })}
										>×</button>
									{/if}
								</div>
							</div>

							<div class="chip-group">
								<span class="chip-label">🏷 Tema</span>
								<div class="chip-options">
									{#each data.themes as theme}
										<button
											type="button"
											class="chip"
											class:active={state.themeId === theme.id}
											onclick={() => markDirty(item.id, { themeId: theme.id })}
										>{theme.emoji ?? '·'} {theme.name}</button>
									{/each}
									{#if state.themeId !== null}
										<button
											type="button"
											class="chip clear"
											onclick={() => markDirty(item.id, { themeId: null })}
										>×</button>
									{/if}
								</div>
							</div>

							<button
								type="button"
								class="breakdown-toggle"
								onclick={() => patchState(item.id, { showBreakdown: !state.showBreakdown })}
							>
								↳ Bryt opp {state.breakdown.length > 0 ? `(${state.breakdown.length})` : ''}
							</button>
						</div>

						{#if state.showBreakdown}
							<div class="breakdown">
								{#each state.breakdown as line, idx (idx)}
									<div class="breakdown-row">
										<input
											type="text"
											value={line}
											placeholder="Delsteg"
											oninput={(e) => updateBreakdownLine(item.id, idx, e.currentTarget.value)}
										/>
										<button type="button" class="ghost-icon" onclick={() => removeBreakdownLine(item.id, idx)} aria-label="Fjern">×</button>
									</div>
								{/each}
								<button type="button" class="add-line" onclick={() => addBreakdownLine(item.id)}>+ Legg til delsteg</button>
							</div>
						{/if}

						<div class="actions">
							<button
								type="button"
								class="save"
								disabled={!state.dirty || state.saving}
								onclick={() => saveCard(item.id)}
							>
								{state.saving ? 'Lagrer…' : state.dirty ? 'Lagre endringer' : 'Lagret'}
							</button>
							<button type="button" class="delete" onclick={() => deleteCard(item.id)}>Slett</button>
							{#if state.message}
								<span class="msg">{state.message}</span>
							{/if}
						</div>
					</li>
				{/if}
			{/each}
		</ul>
	{/if}
</main>

<style>
	main {
		max-width: 760px;
		margin: 0 auto;
		padding: 1rem 1rem 4rem;
		color: var(--text-primary);
	}
	.page-head {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding-top: var(--screen-title-top-pad, 28px);
		margin-bottom: 1rem;
	}
	.back {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-primary);
		cursor: pointer;
		font-size: 1.1rem;
	}
	h1 {
		font-size: 1.5rem;
		margin: 0;
	}
	.count {
		margin-left: auto;
		color: var(--text-tertiary);
		font-size: 0.85rem;
	}
	.empty {
		color: var(--text-tertiary);
		font-style: italic;
		text-align: center;
		padding: 2rem 1rem;
	}
	.tools {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}
	.ai-suggest {
		background: var(--accent-primary);
		color: white;
		border: 0;
		padding: 0.55rem 1rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.85rem;
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
	.cards {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}
	.card {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 14px;
		padding: 1rem;
		transition: border-color 0.15s;
	}
	.card.dirty {
		border-color: var(--accent-primary);
	}
	.text {
		width: 100%;
		background: transparent;
		border: 0;
		resize: vertical;
		color: var(--text-primary);
		font: inherit;
		font-size: 1rem;
		font-weight: 500;
		padding: 0;
		outline: none;
	}
	.suggestion {
		background: var(--info-bg);
		border: 1px solid var(--info-border);
		border-radius: 10px;
		padding: 0.7rem 0.85rem;
		margin: 0.75rem 0;
	}
	.suggestion-head {
		font-size: 0.78rem;
		color: var(--text-secondary);
		margin-bottom: 0.35rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}
	.suggestion-list {
		list-style: none;
		padding: 0;
		margin: 0;
		font-size: 0.9rem;
	}
	.suggestion-list > li {
		padding: 0.15rem 0;
	}
	.sub-bullets {
		margin: 0.25rem 0 0;
		padding-left: 1.1rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}
	.suggestion-actions {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	.suggestion-actions .primary {
		background: var(--accent-primary);
		color: white;
		border: 0;
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}
	.suggestion-actions .ghost {
		background: transparent;
		color: var(--text-tertiary);
		border: 1px solid var(--border-color);
		padding: 0.3rem 0.75rem;
		border-radius: 6px;
		font: inherit;
		font-size: 0.82rem;
		cursor: pointer;
	}

	.chips {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-top: 0.85rem;
	}
	.chip-group {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.chip-label {
		font-size: 0.72rem;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.chip-options {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
	}
	.chip {
		background: transparent;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
		padding: 0.3rem 0.7rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
		transition: border-color 0.1s, background 0.1s, color 0.1s;
	}
	.chip:hover {
		border-color: var(--text-secondary);
		color: var(--text-primary);
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
	.date-input {
		min-width: 130px;
	}
	.breakdown-toggle {
		align-self: flex-start;
		background: transparent;
		border: 1px dashed var(--border-color);
		color: var(--text-secondary);
		padding: 0.35rem 0.8rem;
		border-radius: 999px;
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}
	.breakdown {
		margin-top: 0.85rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.breakdown-row {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.breakdown-row input {
		flex: 1;
		padding: 0.5rem 0.7rem;
		background: var(--bg-primary);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		color: var(--text-primary);
		font: inherit;
		font-size: 0.9rem;
	}
	.ghost-icon {
		width: 28px;
		height: 28px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-tertiary);
		border-radius: 6px;
		cursor: pointer;
	}
	.add-line {
		align-self: flex-start;
		background: transparent;
		border: 0;
		color: var(--accent-primary);
		font: inherit;
		font-size: 0.85rem;
		cursor: pointer;
		padding: 0.3rem 0;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		margin-top: 1rem;
	}
	.save {
		background: var(--accent-primary);
		color: white;
		border: 0;
		padding: 0.5rem 1.1rem;
		border-radius: 8px;
		font: inherit;
		font-size: 0.85rem;
		font-weight: 600;
		cursor: pointer;
	}
	.save:disabled {
		background: var(--border-color);
		color: var(--text-tertiary);
		cursor: not-allowed;
	}
	.delete {
		background: transparent;
		color: var(--error-text);
		border: 1px solid var(--error-border);
		padding: 0.45rem 0.85rem;
		border-radius: 8px;
		font: inherit;
		font-size: 0.8rem;
		cursor: pointer;
	}
	.msg {
		font-size: 0.8rem;
		color: var(--success-text);
	}
</style>
