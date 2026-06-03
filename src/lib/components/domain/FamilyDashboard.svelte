<script lang="ts">
	import type { FamilyDashboardData } from '$lib/client/dashboard-cache';
	import FamilyTree from './family/FamilyTree.svelte';
	import FamilyFeed from './family/FamilyFeed.svelte';
	import PersonDetailSheet from './family/PersonDetailSheet.svelte';
	import { portal } from '$lib/actions/portal';
	import { goto } from '$app/navigation';
	import { nextUnplannedFerie, classifyDate, occurrenceId, daysUntil } from '$lib/ferie/seasons';

	interface Props {
		data: FamilyDashboardData;
		onOpenChat?: (prefill: string) => void;
		onOpenConversation?: (conversationId: string) => void;
		onPersonUpdated?: (personId: string) => void;
	}

	let { data, onOpenChat, onOpenConversation, onPersonUpdated }: Props = $props();

	let selectedPersonId = $state<string | null>(null);

	const selectedPerson = $derived(
		selectedPersonId ? data.persons.find((p) => p.id === selectedPersonId) ?? null : null
	);

	function selectPerson(id: string) {
		selectedPersonId = id;
	}

	function closeSheet() {
		selectedPersonId = null;
	}

	async function startRelationChat(personId: string) {
		const res = await fetch(`/api/persons/${personId}/conversations`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({})
		});
		if (!res.ok) return;
		const body = await res.json();
		if (body.conversation?.id && onOpenConversation) {
			onOpenConversation(body.conversation.id);
		}
	}

	const totalPersons = $derived(data.persons.length);

	/* ── Ferie (Fase 4) ─────────────────────────────────── */
	type FerieThemeSummary = FamilyDashboardData['ferieThemes'][number];

	let view = $state<'familie' | 'ferie'>('familie');
	let planning = $state(false);
	let noteEdits = $state<Record<string, string>>({});
	let noteSaving = $state<string | null>(null);

	const ferieThemes = $derived(data.ferieThemes ?? []);

	const plannedIds = $derived(
		new Set(
			ferieThemes
				.map((t) => (t.startDate ? classifyDate(t.startDate) : null))
				.filter((c): c is { key: import('$lib/ferie/seasons').FerieSeasonKey; year: number } => c !== null)
				.map((c) => occurrenceId(c.key, c.year))
		)
	);
	const nextFerie = $derived(nextUnplannedFerie(new Date(), plannedIds));

	async function planFerie() {
		if (!nextFerie || planning) return;
		planning = true;
		try {
			const res = await fetch('/api/ferie/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ season: nextFerie.key, year: nextFerie.year })
			});
			if (res.ok) {
				const d = (await res.json()) as { themeId: string };
				void goto(`/tema/${d.themeId}`);
			}
		} finally {
			planning = false;
		}
	}

	function noteValue(t: FerieThemeSummary): string {
		return noteEdits[t.id] ?? t.note ?? '';
	}

	async function saveNote(t: FerieThemeSummary, value: string) {
		noteEdits[t.id] = value;
		noteSaving = t.id;
		try {
			await fetch(`/api/tema/${t.id}/ferie/note`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ note: value })
			});
		} finally {
			noteSaving = null;
		}
	}

	function fmtDate(iso: string | null): string {
		if (!iso) return '?';
		return new Intl.DateTimeFormat('nb-NO', { day: '2-digit', month: 'short' }).format(new Date(iso + 'T12:00:00'));
	}

	function dateRange(t: FerieThemeSummary): string {
		if (!t.startDate && !t.endDate) return '';
		return `${fmtDate(t.startDate)} – ${fmtDate(t.endDate)}`;
	}

	function countdownLabel(t: FerieThemeSummary): string {
		if (!t.startDate) return '';
		const n = daysUntil(t.startDate, new Date());
		if (n === null) return '';
		if (n > 1) return `starter om ${n} dager`;
		if (n === 1) return 'starter i morgen';
		if (n === 0) return 'starter i dag';
		const e = t.endDate ? daysUntil(t.endDate, new Date()) : null;
		if (e !== null && e >= 0) return 'pågår nå';
		return 'avsluttet';
	}
</script>

<div class="family-dashboard">
	<header class="head">
		<h2>👨‍👩‍👧‍👦 Familie</h2>
		<div class="head-actions">
			{#if nextFerie}
				<button class="cta" disabled={planning} onclick={planFerie}>
					{nextFerie.emoji} {planning ? 'Oppretter…' : `Planlegg ${nextFerie.label.toLowerCase()}`}
				</button>
			{/if}
			{#if onOpenChat}
				<button class="cta cta-secondary" onclick={() => onOpenChat('Hjelp meg legge til familiemedlemmer.')}>
					Onboarding
				</button>
			{/if}
		</div>
	</header>

	<nav class="subtabs">
		<button class:active={view === 'familie'} onclick={() => (view = 'familie')}>Familie</button>
		<button class:active={view === 'ferie'} onclick={() => (view = 'ferie')}>
			Ferie{#if ferieThemes.length}<span class="subtab-count">{ferieThemes.length}</span>{/if}
		</button>
	</nav>

	{#if view === 'familie'}
		{#if totalPersons === 0}
			<section class="empty">
				<p>Ingen familiemedlemmer registrert enda.</p>
				<p>Start med å fortelle meg om deg og familien din i chatten — partner, barn, foreldre, svigerfamilie.</p>
			</section>
		{:else}
			<section class="tree-section">
				<h3>Familietre</h3>
				<FamilyTree tree={data.tree} onSelectPerson={selectPerson} />
			</section>

			<section class="feed-section">
				<h3>Strøm</h3>
				<FamilyFeed feed={data.feed} persons={data.persons} onSelectPerson={selectPerson} />
			</section>
		{/if}
	{:else}
		<section class="ferie-section">
			{#if ferieThemes.length === 0}
				<div class="empty">
					<p>Ingen ferieplaner ennå.</p>
					{#if nextFerie}<p>Trykk «Planlegg {nextFerie.label.toLowerCase()}» øverst for å starte.</p>{/if}
				</div>
			{:else}
				<ul class="ferie-cards">
					{#each ferieThemes as t (t.id)}
						<li class="ferie-card">
							<button class="ferie-card-main" onclick={() => goto(`/tema/${t.id}`)}>
								<span class="ferie-card-top">
									<span class="ferie-card-name">{t.emoji ?? '🏖️'} {t.name}</span>
									{#if countdownLabel(t)}<span class="ferie-card-countdown">{countdownLabel(t)}</span>{/if}
								</span>
								{#if dateRange(t)}<span class="ferie-card-dates">{dateRange(t)}</span>{/if}
							</button>
							<input
								class="ferie-card-note"
								placeholder="Foreløpig setning (f.eks. Volda med Marte og David)"
								value={noteValue(t)}
								onchange={(e) => saveNote(t, e.currentTarget.value)}
							/>
							{#if noteSaving === t.id}<span class="ferie-card-saving">Lagrer…</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if selectedPerson}
		<div class="sheet-overlay" use:portal onclick={closeSheet} role="presentation">
			<div class="sheet-wrap" onclick={(e) => e.stopPropagation()} role="presentation">
				<PersonDetailSheet
					person={selectedPerson}
					memories={data.recentMemoriesByPerson[selectedPerson.id] ?? []}
					goals={data.openGoalsByPerson[selectedPerson.id] ?? []}
					events={data.upcomingEventsByPerson[selectedPerson.id] ?? []}
					conversations={data.conversationsByPerson[selectedPerson.id] ?? []}
					tasks={data.tasksByPerson[selectedPerson.id] ?? []}
					onClose={closeSheet}
					onStartChat={startRelationChat}
					onPersonUpdated={onPersonUpdated}
				/>
			</div>
		</div>
	{/if}
</div>

<style>
	.family-dashboard {
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		padding: 1rem;
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.head h2 { margin: 0; }
	.head-actions {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.cta {
		padding: 0.45rem 0.9rem;
		border-radius: 8px;
		border: none;
		background: linear-gradient(135deg, #7c8ef5, #6072e6);
		color: white;
		font: inherit;
		cursor: pointer;
	}
	.cta:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.cta-secondary {
		background: var(--tp-bg-1, #2a2d3a);
		color: var(--tp-text, #e8e8ef);
		border: 1px solid var(--tp-border, #3a3d4a);
	}

	/* Sub-tabs */
	.subtabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--tp-border, #3a3d4a);
	}
	.subtabs button {
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--tp-text-soft, #aaa);
		padding: 0.5rem 0.75rem;
		font: inherit;
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.subtabs button.active {
		color: var(--tp-text, #fff);
		border-bottom-color: var(--tp-accent, #7c8ef5);
	}
	.subtab-count {
		font-size: 0.72rem;
		background: var(--tp-accent-bg, #3a3d5a);
		border-radius: 999px;
		padding: 0.05rem 0.4rem;
	}

	/* Ferie-kort */
	.ferie-cards {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.ferie-card {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.75rem;
		border: 1px solid var(--tp-border, #3a3d4a);
		border-radius: 12px;
		background: var(--tp-bg-2, #20232e);
	}
	.ferie-card-main {
		background: none;
		border: none;
		color: var(--tp-text, #e8e8ef);
		text-align: left;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
		padding: 0;
	}
	.ferie-card-top {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.ferie-card-name {
		font-weight: 600;
	}
	.ferie-card-countdown {
		font-size: 0.8rem;
		color: var(--tp-accent, #9aa8f7);
		white-space: nowrap;
	}
	.ferie-card-dates {
		font-size: 0.8rem;
		color: var(--tp-text-soft, #aaa);
	}
	.ferie-card-note {
		background: var(--tp-bg-1, #2a2d3a);
		border: 1px solid var(--tp-border, #3a3d4a);
		color: var(--tp-text, #e8e8ef);
		border-radius: 8px;
		padding: 0.4rem 0.55rem;
		font: inherit;
		font-size: 0.85rem;
	}
	.ferie-card-saving {
		font-size: 0.72rem;
		color: var(--tp-text-muted, #888);
	}
	.empty {
		padding: 1.5rem;
		text-align: center;
		opacity: 0.75;
		background: var(--surface-2, #f5f5f7);
		border-radius: 12px;
	}
	.empty p { margin: 0.5rem 0; }
	section h3 {
		margin: 0 0 0.5rem;
		font-size: 0.95rem;
		opacity: 0.8;
	}
	.sheet-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1000;
		padding: 1rem;
	}
	.sheet-wrap {
		width: 100%;
		max-width: 560px;
	}
</style>
