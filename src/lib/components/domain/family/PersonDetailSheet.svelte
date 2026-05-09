<script lang="ts">
	import type { FamilyDashboardData } from '$lib/client/dashboard-cache';
	import PersonMentionsList from './PersonMentionsList.svelte';
	import PersonEditSheet from './PersonEditSheet.svelte';

	interface Props {
		person: FamilyDashboardData['persons'][number];
		memories: FamilyDashboardData['recentMemoriesByPerson'][string];
		goals: FamilyDashboardData['openGoalsByPerson'][string];
		events: FamilyDashboardData['upcomingEventsByPerson'][string];
		conversations: FamilyDashboardData['conversationsByPerson'][string];
		onClose?: () => void;
		onStartChat?: (personId: string) => void;
		onPersonUpdated?: (personId: string) => void;
	}

	let {
		person,
		memories = [],
		goals = [],
		events = [],
		conversations = [],
		onClose,
		onStartChat,
		onPersonUpdated
	}: Props = $props();

	type Tab = 'overview' | 'chats' | 'memories' | 'goals' | 'events' | 'mentions';
	let activeTab = $state<Tab>('overview');
	let editing = $state(false);
	let fullPerson = $state<any | null>(null);

	async function startEdit() {
		const res = await fetch(`/api/persons/${person.id}`);
		if (res.ok) {
			const body = await res.json();
			fullPerson = body.person;
			editing = true;
		}
	}

	let mentions = $state<{ messages: any[]; tasks: any[] } | null>(null);
	let mentionsLoading = $state(false);

	async function loadMentions() {
		if (mentions || mentionsLoading) return;
		mentionsLoading = true;
		try {
			const res = await fetch(`/api/persons/${person.id}/mentions`);
			if (res.ok) mentions = await res.json();
		} finally {
			mentionsLoading = false;
		}
	}

	$effect(() => {
		if (activeTab === 'mentions') void loadMentions();
	});

	function formatDate(iso: string | null | Date): string {
		if (!iso) return '';
		const d = typeof iso === 'string' ? new Date(iso) : iso;
		return d.toLocaleDateString('no-NO', { weekday: 'short', day: 'numeric', month: 'short' });
	}
</script>

<div class="sheet" role="dialog" aria-label={`Detaljer om ${person.name}`}>
	<header class="sheet-head">
		<div class="title">
			<span class="emoji">{person.avatarEmoji ?? '👤'}</span>
			<h2>{person.name}</h2>
		</div>
		<div class="actions">
			<button class="primary" onclick={() => onStartChat?.(person.id)}>
				Samtale
			</button>
			<button class="ghost" onclick={() => void startEdit()}>Rediger</button>
			<button class="ghost" onclick={() => onClose?.()}>Lukk</button>
		</div>
	</header>

	{#if editing && fullPerson}
		<PersonEditSheet
			person={fullPerson}
			onClose={() => (editing = false)}
			onSaved={(updated) => {
				editing = false;
				fullPerson = updated;
				onPersonUpdated?.(updated.id);
			}}
		/>
	{/if}

	<div class="tabs" role="tablist">
		<button class:active={activeTab === 'overview'} onclick={() => (activeTab = 'overview')}>Oversikt</button>
		<button class:active={activeTab === 'chats'} onclick={() => (activeTab = 'chats')}>Chatter ({conversations.length})</button>
		<button class:active={activeTab === 'memories'} onclick={() => (activeTab = 'memories')}>Memories ({memories.length})</button>
		<button class:active={activeTab === 'goals'} onclick={() => (activeTab = 'goals')}>Mål ({goals.length})</button>
		<button class:active={activeTab === 'events'} onclick={() => (activeTab = 'events')}>Events ({events.length})</button>
		<button class:active={activeTab === 'mentions'} onclick={() => (activeTab = 'mentions')}>Nevnt i</button>
	</div>

	<div class="content">
		{#if activeTab === 'overview'}
			<section>
				<h3>Siste memory</h3>
				{#if memories[0]}
					<p>{memories[0].content}</p>
				{:else}
					<p class="empty">Ingen memories enda.</p>
				{/if}
			</section>
			<section>
				<h3>Neste event</h3>
				{#if events[0]}
					<p>{formatDate(events[0].startTimestamp)} — {events[0].title}</p>
				{:else}
					<p class="empty">Ingen kommende events.</p>
				{/if}
			</section>
		{:else if activeTab === 'chats'}
			{#if conversations.length === 0}
				<p class="empty">Ingen samtaler scoped til {person.name} enda. Trykk "Start chat om relasjonen" for å lage en.</p>
			{:else}
				<ul class="list">
					{#each conversations as c (c.id)}
						<li>
							<a href={`/samtaler/${c.id}`}>
								<span class="title">{c.title ?? 'Ny samtale'}</span>
								<span class="meta">{formatDate(c.updatedAt)}</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if activeTab === 'memories'}
			{#if memories.length === 0}
				<p class="empty">Ingen memories enda.</p>
			{:else}
				<ul class="list">
					{#each memories as m (m.id)}
						<li class="memory">
							<p>{m.content}</p>
							<span class="meta">{m.category} · {m.importance} · {formatDate(m.createdAt)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if activeTab === 'goals'}
			{#if goals.length === 0}
				<p class="empty">Ingen åpne mål.</p>
			{:else}
				<ul class="list">
					{#each goals as g (g.id)}
						<li>
							<span class="title">{g.title}</span>
							{#if g.description}<span class="meta">{g.description}</span>{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{:else if activeTab === 'events'}
			{#if events.length === 0}
				<p class="empty">Ingen kommende events.</p>
			{:else}
				<ul class="list">
					{#each events as e (e.id)}
						<li>
							<span class="title">{e.title}</span>
							<span class="meta">{formatDate(e.startTimestamp)} {#if e.groupName}— {e.groupName}{/if}</span>
						</li>
					{/each}
				</ul>
			{/if}
		{:else if activeTab === 'mentions'}
			{#if mentionsLoading}
				<p class="empty">Laster…</p>
			{:else if mentions}
				<PersonMentionsList messages={mentions.messages} tasks={mentions.tasks} />
			{:else}
				<p class="empty">Ingen omtaler funnet.</p>
			{/if}
		{/if}
	</div>
</div>

<style>
	.sheet {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		background: var(--surface-1, #1a1a1a);
		color: var(--text, #d0d0d0);
		border-radius: 16px;
		max-height: 80vh;
		overflow: auto;
	}
	.sheet-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 1rem;
		flex-wrap: wrap;
	}
	.title { display: flex; align-items: center; gap: 0.5rem; }
	.title h2 { margin: 0; font-size: 1.25rem; color: #f0f0f0; }
	.emoji { font-size: 1.6rem; }
	.actions { display: flex; gap: 0.5rem; }
	button {
		padding: 0.45rem 0.9rem;
		border-radius: 8px;
		border: 1px solid #333;
		background: #252525;
		color: #c8c8c8;
		font: inherit;
		cursor: pointer;
		transition: background 0.1s, border-color 0.1s;
	}
	button:hover { background: #2e2e2e; border-color: #444; color: #e8e8e8; }
	button.primary {
		background: #252525;
		color: #a0acf8;
		border-color: #3a4060;
	}
	button.primary:hover { background: #2a2f4a; border-color: #5060a0; color: #c0caff; }
	button.ghost { background: transparent; border-color: transparent; }
	button.ghost:hover { background: #252525; border-color: #333; }
	.tabs {
		display: flex;
		gap: 0.25rem;
		flex-wrap: wrap;
		border-bottom: 1px solid #2a2a2a;
		padding-bottom: 0.5rem;
	}
	.tabs button {
		border: none;
		background: transparent;
		color: #888;
		padding: 0.4rem 0.7rem;
	}
	.tabs button:hover { background: transparent; border-color: transparent; color: #bbb; }
	.tabs button.active { color: #e8e8e8; font-weight: 600; }
	.content section { margin-bottom: 1rem; }
	.content h3 { margin: 0 0 0.4rem; font-size: 0.95rem; color: #e0e0e0; font-weight: 600; }
	.list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
	.list li {
		padding: 0.6rem 0.75rem;
		border-radius: 8px;
		background: #222;
		border: 1px solid #2a2a2a;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.list .title { font-weight: 500; color: #d8d8d8; }
	.list .meta { font-size: 0.75rem; color: #777; }
	.list a { color: inherit; text-decoration: none; display: flex; flex-direction: column; gap: 0.2rem; }
	.empty { color: #666; font-style: italic; }
	.memory p { margin: 0; color: #bbb; }
</style>
