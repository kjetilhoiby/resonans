<script lang="ts">
	import type { FamilyDashboardData } from '$lib/client/dashboard-cache';
	import FamilyTree from './family/FamilyTree.svelte';
	import PersonCard from './family/PersonCard.svelte';
	import PersonDetailSheet from './family/PersonDetailSheet.svelte';

	interface Props {
		data: FamilyDashboardData;
		onOpenChat?: (prefill: string) => void;
		onOpenConversation?: (conversationId: string) => void;
	}

	let { data, onOpenChat, onOpenConversation }: Props = $props();

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
</script>

<div class="family-dashboard">
	<header class="head">
		<h2>👨‍👩‍👧‍👦 Familie</h2>
		{#if onOpenChat}
			<button class="cta" onclick={() => onOpenChat('Hjelp meg legge til familiemedlemmer.')}>
				Onboarding
			</button>
		{/if}
	</header>

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

		<section class="cards-section">
			<h3>Personer</h3>
			<div class="cards">
				{#each data.persons as person (person.id)}
					<PersonCard
						{person}
						recentMemory={data.recentMemoriesByPerson[person.id]?.[0]}
						nextEvent={data.upcomingEventsByPerson[person.id]?.[0]}
						openGoalsCount={data.openGoalsByPerson[person.id]?.length ?? 0}
						onClick={selectPerson}
					/>
				{/each}
			</div>
		</section>
	{/if}

	{#if selectedPerson}
		<div class="sheet-overlay" onclick={closeSheet} role="presentation">
			<div class="sheet-wrap" onclick={(e) => e.stopPropagation()} role="presentation">
				<PersonDetailSheet
					person={selectedPerson}
					memories={data.recentMemoriesByPerson[selectedPerson.id] ?? []}
					goals={data.openGoalsByPerson[selectedPerson.id] ?? []}
					events={data.upcomingEventsByPerson[selectedPerson.id] ?? []}
					conversations={data.conversationsByPerson[selectedPerson.id] ?? []}
					onClose={closeSheet}
					onStartChat={startRelationChat}
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
	.cta {
		padding: 0.45rem 0.9rem;
		border-radius: 8px;
		border: none;
		background: linear-gradient(135deg, #7c8ef5, #6072e6);
		color: white;
		font: inherit;
		cursor: pointer;
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
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 0.75rem;
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
