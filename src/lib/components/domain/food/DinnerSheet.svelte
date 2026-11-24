<!--
  DinnerSheet — én middag i planen: registrer hva som skjedde (spist, droppet,
  spiste noe annet), bytt rett, flytt til en annen dag, og skriv en erfaring.
  Planen er fasit, og hver endring speiles til «middag: …» på riktig dag i
  ukelista av serveren (meal-plan-sync.ts). Se
  docs/changelog/2026-11-24-middagsplanen-som-fasit.md.
-->
<script lang="ts">
	import BottomSheet from '../../ui/BottomSheet.svelte';
	import { extractApiErrorMessage } from '$lib/client/api-error';
	import { readMealStatus, MEAL_LOG_READING_LABEL, type MealPlanStatus } from '$lib/domains/food/meal-log';

	export type DinnerPlan = {
		id: string;
		date: string;
		mealType: string;
		mealId: string | null;
		mealTitle?: string | null;
		status?: MealPlanStatus | string | null;
		servings: number;
		notes: string | null;
		takeaway?: boolean;
	};

	type Recipe = { id: string; title: string };

	interface Props {
		plan: DinnerPlan;
		/** Dagene planen kan flyttes til (ISO-datoer), typisk uka den står i. */
		weekDates: string[];
		todayIso: string;
		onchanged: () => void;
		onclose: () => void;
		onopencard?: (mealId: string) => void;
	}

	let { plan, weekDates, todayIso, onchanged, onclose, onopencard }: Props = $props();

	type Mode = 'main' | 'swap' | 'other';
	let mode = $state<Mode>('main');
	let busy = $state(false);
	let error = $state('');
	let query = $state('');
	let takeaway = $state(false);
	let recipes = $state<Recipe[] | null>(null);
	let notes = $state(plan.notes ?? '');
	let savedNotes = $state(plan.notes ?? '');

	const status = $derived((plan.status ?? 'planned') as MealPlanStatus);
	const reading = $derived(readMealStatus(status, plan.date, todayIso));
	const isFuture = $derived(plan.date > todayIso);
	const title = $derived(plan.mealTitle ?? plan.notes ?? 'Middag');

	const matches = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!recipes) return [];
		if (!q) return recipes.slice(0, 8);
		return recipes.filter((r) => r.title.toLowerCase().includes(q)).slice(0, 8);
	});

	function dayLabel(iso: string): string {
		return new Date(iso + 'T12:00:00').toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric' });
	}

	async function send(method: 'PATCH' | 'POST', body: Record<string, unknown>): Promise<boolean> {
		const res = await fetch('/api/food/meal-plans', {
			method,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			error = extractApiErrorMessage(res.status, await res.text());
			return false;
		}
		return true;
	}

	async function run(action: () => Promise<boolean>, close = true) {
		if (busy) return;
		busy = true;
		error = '';
		try {
			const ok = await action();
			if (ok) {
				onchanged();
				if (close) onclose();
			}
		} catch (e) {
			error = e instanceof Error ? e.message : 'Noe gikk galt. Prøv igjen.';
		} finally {
			busy = false;
		}
	}

	const setStatus = (next: MealPlanStatus) => run(() => send('PATCH', { id: plan.id, status: next }));
	const moveTo = (date: string) => run(() => send('PATCH', { id: plan.id, date }));
	const saveNotes = () =>
		run(async () => {
			const ok = await send('PATCH', { id: plan.id, notes: notes.trim() || null });
			if (ok) savedNotes = notes;
			return ok;
		}, false);

	function swapTo(choice: { mealId?: string; title: string }) {
		return run(() =>
			send('PATCH', choice.mealId ? { id: plan.id, mealId: choice.mealId } : { id: plan.id, mealName: choice.title })
		);
	}

	// «Spiste noe annet»: planen ble ikke fulgt. Den gamle raden droppes og det
	// som faktisk ble spist registreres ved siden av — da står både planen og
	// historikken riktig (meal-log.ts).
	function ateSomethingElse(choice: { mealId?: string; title: string }) {
		return run(async () => {
			if (!(await send('PATCH', { id: plan.id, status: 'skipped' }))) return false;
			return send('POST', {
				date: plan.date,
				mealType: plan.mealType,
				status: 'eaten',
				...(choice.mealId ? { mealId: choice.mealId } : { mealName: choice.title }),
				takeaway: !choice.mealId && takeaway
			});
		});
	}

	async function openPicker(next: Mode) {
		mode = next;
		query = '';
		takeaway = false;
		if (recipes) return;
		try {
			const res = await fetch('/api/food/recipes');
			if (!res.ok) throw new Error(extractApiErrorMessage(res.status, await res.text()));
			const data = await res.json();
			recipes = (data.meals ?? []).map((m: Recipe) => ({ id: m.id, title: m.title }));
		} catch (e) {
			recipes = [];
			error = e instanceof Error ? e.message : 'Klarte ikke hente rettene.';
		}
	}

	function pick(choice: { mealId?: string; title: string }) {
		if (mode === 'swap') swapTo(choice);
		else ateSomethingElse(choice);
	}
</script>

<BottomSheet {onclose} ariaLabel="Middag">
	<div class="ds">
		<header class="ds-head">
			<button class="ds-title" onclick={mode === 'main' ? onclose : () => (mode = 'main')} aria-label={mode === 'main' ? 'Lukk' : 'Tilbake'}>
				<span class="ds-date">{dayLabel(plan.date)}</span>
				<span class="ds-name">{title}</span>
			</button>
			<span class="ds-reading" data-reading={reading}>{MEAL_LOG_READING_LABEL[reading]}</span>
		</header>

		{#if mode === 'main'}
			<section class="ds-section">
				<span class="ds-label">Hva skjedde?</span>
				<div class="ds-row">
					<button
						class="ds-chip"
						class:active={status === 'eaten'}
						disabled={busy || isFuture}
						title={isFuture ? 'En middag kan ikke være spist før dagen har vært' : undefined}
						onclick={() => setStatus('eaten')}
						data-track="middag:spist"
					>✓ Spist</button>
					<button
						class="ds-chip"
						class:active={status === 'skipped'}
						disabled={busy}
						onclick={() => setStatus('skipped')}
						data-track="middag:droppet"
					>✕ Droppet</button>
					{#if status !== 'planned'}
						<button class="ds-chip" disabled={busy} onclick={() => setStatus('planned')} data-track="middag:angre-status">Angre</button>
					{/if}
				</div>
				{#if !isFuture}
					<button class="ds-link" onclick={() => openPicker('other')} data-track="middag:spiste-noe-annet">Vi spiste noe annet …</button>
				{/if}
			</section>

			<section class="ds-section">
				<span class="ds-label">Flytt til</span>
				<div class="ds-row">
					{#each weekDates as date (date)}
						<button
							class="ds-chip ds-day"
							class:active={date === plan.date}
							disabled={busy || date === plan.date}
							onclick={() => moveTo(date)}
							data-track="middag:flytt"
						>{dayLabel(date)}</button>
					{/each}
				</div>
			</section>

			<section class="ds-section">
				<div class="ds-row ds-actions">
					<button class="ds-button" disabled={busy} onclick={() => openPicker('swap')} data-track="middag:bytt">Bytt rett</button>
					{#if plan.mealId && onopencard}
						<button class="ds-button" onclick={() => onopencard?.(plan.mealId!)} data-track="middag:apne-kort">Middagskort</button>
					{/if}
				</div>
			</section>

			<section class="ds-section">
				<label class="ds-label" for="ds-notes">Erfaring fra denne kvelden</label>
				<textarea
					id="ds-notes"
					class="ds-notes"
					rows="2"
					bind:value={notes}
					placeholder="F.eks. doblet porsjonen, barna ville ha mer saus"
					data-track="middag:erfaring"
				></textarea>
				{#if notes.trim() !== savedNotes.trim()}
					<button class="ds-button" disabled={busy} onclick={saveNotes} data-track="middag:lagre-erfaring">Lagre erfaring</button>
				{/if}
			</section>
		{:else}
			<section class="ds-section">
				<span class="ds-label">{mode === 'swap' ? 'Bytt til' : 'Hva spiste dere?'}</span>
				<input
					class="ds-search"
					bind:value={query}
					placeholder="Søk eller skriv en rett"
					onkeydown={(e) => {
						if (e.key === 'Enter' && query.trim()) pick({ title: query.trim() });
					}}
					data-track={mode === 'swap' ? 'middag:sok-bytt' : 'middag:sok-spiste'}
				/>
				{#if mode === 'other'}
					<label class="ds-check">
						<input type="checkbox" bind:checked={takeaway} data-track="middag:takeaway" />
						Takeaway eller restaurant
					</label>
				{/if}
				{#if recipes === null}
					<p class="ds-muted">Henter rettene …</p>
				{:else}
					<ul class="ds-list">
						{#each matches as recipe (recipe.id)}
							<li>
								<button class="ds-option" disabled={busy} onclick={() => pick({ mealId: recipe.id, title: recipe.title })}>{recipe.title}</button>
							</li>
						{/each}
						{#if query.trim() && !matches.some((r) => r.title.toLowerCase() === query.trim().toLowerCase())}
							<li>
								<button class="ds-option ds-new" disabled={busy} onclick={() => pick({ title: query.trim() })}>+ «{query.trim()}»</button>
							</li>
						{/if}
					</ul>
				{/if}
			</section>
		{/if}

		{#if error}<p class="ds-error" role="alert">{error}</p>{/if}
	</div>
</BottomSheet>

<style>
	.ds {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 18px 20px calc(20px + env(safe-area-inset-bottom));
		overflow-y: auto;
		color: var(--text-primary);
	}
	.ds-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.ds-title {
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		text-align: left;
		cursor: pointer;
		min-width: 0;
	}
	.ds-date {
		font-size: var(--font-size-label, 0.78rem);
		color: var(--text-secondary);
		text-transform: capitalize;
	}
	.ds-name {
		font-size: var(--font-size-title, 1rem);
		font-weight: 700;
	}
	.ds-reading {
		flex-shrink: 0;
		font-size: var(--font-size-caption, 0.72rem);
		padding: 3px 8px;
		border-radius: 999px;
		border: 1px solid var(--border-color);
		color: var(--text-secondary);
	}
	.ds-reading[data-reading='eaten'] {
		background: var(--success-bg);
		border-color: var(--success-border);
		color: var(--success-text);
	}
	.ds-reading[data-reading='unconfirmed'] {
		background: var(--warning-bg);
		border-color: var(--warning-border);
		color: var(--warning-text);
	}
	.ds-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.ds-label {
		font-size: var(--font-size-label, 0.78rem);
		font-weight: 600;
		color: var(--text-secondary);
	}
	.ds-row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.ds-chip,
	.ds-button,
	.ds-option {
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		color: var(--text-primary);
		padding: 7px 12px;
		font-size: var(--font-size-body, 0.9rem);
		cursor: pointer;
	}
	.ds-button {
		border-radius: 10px;
	}
	.ds-chip.active {
		background: var(--accent-primary);
		border-color: var(--accent-primary);
		color: var(--accent-contrast);
	}
	.ds-chip:disabled:not(.active),
	.ds-button:disabled,
	.ds-option:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.ds-day {
		text-transform: capitalize;
	}
	.ds-link {
		align-self: flex-start;
		background: none;
		border: none;
		padding: 0;
		color: var(--accent-primary);
		font-size: var(--font-size-body, 0.9rem);
		cursor: pointer;
		text-decoration: underline;
	}
	.ds-notes,
	.ds-search {
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: 10px;
		color: var(--text-primary);
		padding: 9px 11px;
		font: inherit;
		font-size: var(--font-size-body, 0.9rem);
		resize: vertical;
	}
	.ds-notes + .ds-button {
		align-self: flex-start;
	}
	.ds-check {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--font-size-body, 0.9rem);
	}
	.ds-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.ds-option {
		width: 100%;
		text-align: left;
		border-radius: 10px;
	}
	.ds-new {
		color: var(--accent-primary);
	}
	.ds-muted {
		margin: 0;
		color: var(--text-secondary);
		font-size: var(--font-size-caption, 0.72rem);
	}
	.ds-error {
		margin: 0;
		color: var(--error-text);
		font-size: var(--font-size-caption, 0.72rem);
	}
</style>
