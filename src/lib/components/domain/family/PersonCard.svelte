<script lang="ts">
	import type { FamilyDashboardData } from '$lib/client/dashboard-cache';

	interface Props {
		person: FamilyDashboardData['persons'][number];
		recentMemory?: FamilyDashboardData['recentMemoriesByPerson'][string][number];
		nextEvent?: FamilyDashboardData['upcomingEventsByPerson'][string][number];
		openGoalsCount?: number;
		onClick?: (personId: string) => void;
	}

	let { person, recentMemory, nextEvent, openGoalsCount = 0, onClick }: Props = $props();

	function calculateAge(bd: string | null): number | null {
		if (!bd) return null;
		const d = new Date(bd);
		if (Number.isNaN(d.getTime())) return null;
		const today = new Date();
		let age = today.getFullYear() - d.getFullYear();
		const m = today.getMonth() - d.getMonth();
		if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
		return age;
	}

	const age = $derived(calculateAge(person.birthDate));

	function formatEventTime(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		return d.toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric', month: 'short' });
	}
</script>

<button class="person-card" onclick={() => onClick?.(person.id)}>
	<div class="head">
		<span class="emoji">{person.avatarEmoji ?? '👤'}</span>
		<div class="name-block">
			<span class="name">{person.name}</span>
			{#if age !== null}<span class="age">{age} år</span>{/if}
		</div>
		{#if openGoalsCount > 0}
			<span class="goal-badge" title="Åpne mål">{openGoalsCount}</span>
		{/if}
	</div>
	{#if recentMemory}
		<p class="memory">{recentMemory.content}</p>
	{/if}
	{#if nextEvent}
		<div class="event">
			<span class="event-time">{formatEventTime(nextEvent.startTimestamp)}</span>
			<span class="event-title">{nextEvent.title}</span>
		</div>
	{/if}
</button>

<style>
	.person-card {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem;
		border-radius: 12px;
		border: 1px solid var(--border, #2a2a2a);
		background: var(--surface-1, #1c1c1c);
		color: var(--text, #d0d0d0);
		text-align: left;
		cursor: pointer;
		font: inherit;
		transition: background 0.1s ease, border-color 0.1s ease;
		min-width: 0;
	}
	.person-card:hover {
		background: var(--surface-hover, #242424);
		border-color: var(--border-hover, #3a3a3a);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.emoji {
		font-size: 1.6rem;
	}
	.name-block {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.name { font-weight: 600; }
	.age { font-size: 0.8rem; opacity: 0.6; }
	.goal-badge {
		min-width: 1.5rem;
		height: 1.5rem;
		padding: 0 0.4rem;
		border-radius: 999px;
		background: #f7c873;
		color: #5a3a00;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: 600;
	}
	.memory {
		margin: 0;
		font-size: 0.85rem;
		opacity: 0.85;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.event {
		display: flex;
		gap: 0.5rem;
		font-size: 0.8rem;
		opacity: 0.75;
		align-items: baseline;
	}
	.event-time { font-weight: 500; }
</style>
