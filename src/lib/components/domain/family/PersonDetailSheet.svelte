<script lang="ts">
	import type { FamilyDashboardData } from '$lib/client/dashboard-cache';
	import PersonEditSheet from './PersonEditSheet.svelte';
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';

	interface Props {
		person: FamilyDashboardData['persons'][number];
		memories: FamilyDashboardData['recentMemoriesByPerson'][string];
		goals: FamilyDashboardData['openGoalsByPerson'][string];
		events: FamilyDashboardData['upcomingEventsByPerson'][string];
		conversations: FamilyDashboardData['conversationsByPerson'][string];
		tasks: FamilyDashboardData['tasksByPerson'][string];
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
		tasks = [],
		onClose,
		onStartChat,
		onPersonUpdated
	}: Props = $props();

	type FilterId = 'all' | 'chats' | 'memories' | 'goals' | 'tasks' | 'events' | 'mentions';
	let activeFilter = $state<FilterId>('all');
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

	interface MentionsPayload {
		messages: Array<{
			messageId: string;
			conversationId: string;
			role: string;
			snippet: string;
			createdAt: string;
			confidence: 'explicit' | 'inferred';
		}>;
		tasks: Array<{
			taskId: string;
			goalId: string;
			title: string;
			status: string;
			frequency: string | null;
			createdAt: string;
			confidence: 'explicit' | 'inferred';
		}>;
		checklistItems: Array<{
			itemId: string;
			checklistId: string;
			text: string;
			checked: boolean;
			createdAt: string;
			confidence: 'explicit' | 'inferred';
		}>;
	}

	let mentions = $state<MentionsPayload | null>(null);
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
		// Personen kan endres når brukeren klikker en annen i listen — last mentions ved hvert id-bytte.
		void person.id;
		mentions = null;
		void loadMentions();
	});

	type FeedItem =
		| { kind: 'memory'; id: string; ts: number; text: string; sub: string }
		| { kind: 'goal'; id: string; ts: number; title: string; description: string | null }
		| { kind: 'task'; id: string; ts: number; title: string; status: string; source: 'direct' | 'mention'; confidence?: 'explicit' | 'inferred' }
		| { kind: 'conversation'; id: string; ts: number; title: string }
		| { kind: 'event'; id: string; ts: number; title: string; groupName: string | null; future: boolean }
		| { kind: 'message-mention'; id: string; ts: number; conversationId: string; snippet: string; role: string; confidence: 'explicit' | 'inferred' }
		| { kind: 'checklist-mention'; id: string; ts: number; text: string; checked: boolean; confidence: 'explicit' | 'inferred' };

	const feed = $derived.by<FeedItem[]>(() => {
		const items: FeedItem[] = [];

		for (const m of memories) {
			items.push({
				kind: 'memory',
				id: m.id,
				ts: new Date(m.createdAt).getTime(),
				text: m.content,
				sub: `${m.category} · ${m.importance}`
			});
		}

		for (const g of goals) {
			items.push({
				kind: 'goal',
				id: g.id,
				ts: new Date(g.createdAt).getTime(),
				title: g.title,
				description: g.description
			});
		}

		const directTaskIds = new Set<string>();
		for (const t of tasks) {
			directTaskIds.add(t.id);
			items.push({
				kind: 'task',
				id: t.id,
				ts: new Date(t.createdAt).getTime(),
				title: t.title,
				status: t.status,
				source: 'direct'
			});
		}

		for (const c of conversations) {
			items.push({
				kind: 'conversation',
				id: c.id,
				ts: new Date(c.updatedAt).getTime(),
				title: c.title ?? 'Ny samtale'
			});
		}

		const now = Date.now();
		for (const e of events) {
			const ts = e.startTimestamp ? new Date(e.startTimestamp).getTime() : now;
			items.push({
				kind: 'event',
				id: e.id,
				ts,
				title: e.title,
				groupName: e.groupName,
				future: ts >= now
			});
		}

		if (mentions) {
			for (const t of mentions.tasks) {
				if (directTaskIds.has(t.taskId)) continue; // dedupe — vises allerede som direkte
				items.push({
					kind: 'task',
					id: t.taskId,
					ts: new Date(t.createdAt).getTime(),
					title: t.title,
					status: t.status,
					source: 'mention',
					confidence: t.confidence
				});
			}
			for (const msg of mentions.messages) {
				items.push({
					kind: 'message-mention',
					id: msg.messageId,
					ts: new Date(msg.createdAt).getTime(),
					conversationId: msg.conversationId,
					snippet: msg.snippet,
					role: msg.role,
					confidence: msg.confidence
				});
			}
			for (const ci of mentions.checklistItems) {
				items.push({
					kind: 'checklist-mention',
					id: ci.itemId,
					ts: new Date(ci.createdAt).getTime(),
					text: ci.text,
					checked: ci.checked,
					confidence: ci.confidence
				});
			}
		}

		items.sort((a, b) => b.ts - a.ts);
		return items;
	});

	const filteredFeed = $derived.by(() => {
		if (activeFilter === 'all') return feed;
		const map: Record<FilterId, FeedItem['kind'][]> = {
			all: [],
			chats: ['conversation'],
			memories: ['memory'],
			goals: ['goal'],
			tasks: ['task'],
			events: ['event'],
			mentions: ['message-mention']
		};
		const allowed = new Set(map[activeFilter]);
		// "Nevnt" inkluderer også oppgave- og checklist-omtaler (source=mention)
		if (activeFilter === 'mentions') {
			return feed.filter(
				(it) =>
					it.kind === 'message-mention' ||
					it.kind === 'checklist-mention' ||
					(it.kind === 'task' && it.source === 'mention')
			);
		}
		return feed.filter((it) => allowed.has(it.kind));
	});

	const counts = $derived({
		all: feed.length,
		chats: feed.filter((i) => i.kind === 'conversation').length,
		memories: feed.filter((i) => i.kind === 'memory').length,
		goals: feed.filter((i) => i.kind === 'goal').length,
		tasks: feed.filter((i) => i.kind === 'task').length,
		events: feed.filter((i) => i.kind === 'event').length,
		mentions: feed.filter(
			(i) =>
				i.kind === 'message-mention' ||
				i.kind === 'checklist-mention' ||
				(i.kind === 'task' && i.source === 'mention')
		).length
	});

	function formatDate(ts: number): string {
		const d = new Date(ts);
		const today = new Date();
		const sameYear = d.getFullYear() === today.getFullYear();
		return d.toLocaleDateString('no-NO', {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			year: sameYear ? undefined : 'numeric'
		});
	}

	function relativeDate(ts: number): string {
		const diffMs = ts - Date.now();
		const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
		if (diffDays === 0) return 'I dag';
		if (diffDays === 1) return 'I morgen';
		if (diffDays === -1) return 'I går';
		if (diffDays > 1 && diffDays < 7) return `Om ${diffDays} dager`;
		if (diffDays < -1 && diffDays > -7) return `${-diffDays} dager siden`;
		return formatDate(ts);
	}

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
</script>

<div class="sheet" role="dialog" aria-label={`Detaljer om ${person.name}`}>
	<header class="sheet-head">
		<div class="title">
			{#if person.photoUrl}
				<img class="photo" src={person.photoUrl} alt={person.name} />
			{:else}
				<span class="emoji">{person.avatarEmoji ?? '👤'}</span>
			{/if}
			<div class="name-block">
				<h2>{person.name}</h2>
				{#if age !== null}<span class="age">{age} år</span>{/if}
			</div>
		</div>
		<div class="actions">
			<button class="primary" onclick={() => onStartChat?.(person.id)}>Samtale</button>
			<button class="ghost" onclick={() => void startEdit()}>Rediger</button>
			<button class="ghost" onclick={() => onClose?.()}>Lukk</button>
		</div>
	</header>

	{#if editing && fullPerson}
		<div class="edit-overlay" onclick={() => (editing = false)} role="presentation">
			<div class="edit-wrap" onclick={(e) => e.stopPropagation()} role="presentation">
				<PersonEditSheet
					person={fullPerson}
					onClose={() => (editing = false)}
					onSaved={(updated) => {
						editing = false;
						fullPerson = updated;
						onPersonUpdated?.(updated.id);
					}}
				/>
			</div>
		</div>
	{/if}

	<div class="filters" role="tablist">
		<button class:active={activeFilter === 'all'} onclick={() => (activeFilter = 'all')}>Alt <span class="count">{counts.all}</span></button>
		<button class:active={activeFilter === 'chats'} onclick={() => (activeFilter = 'chats')} disabled={counts.chats === 0}>Chatter <span class="count">{counts.chats}</span></button>
		<button class:active={activeFilter === 'memories'} onclick={() => (activeFilter = 'memories')} disabled={counts.memories === 0}>Memories <span class="count">{counts.memories}</span></button>
		<button class:active={activeFilter === 'goals'} onclick={() => (activeFilter = 'goals')} disabled={counts.goals === 0}>Mål <span class="count">{counts.goals}</span></button>
		<button class:active={activeFilter === 'tasks'} onclick={() => (activeFilter = 'tasks')} disabled={counts.tasks === 0}>Oppgaver <span class="count">{counts.tasks}</span></button>
		<button class:active={activeFilter === 'events'} onclick={() => (activeFilter = 'events')} disabled={counts.events === 0}>Events <span class="count">{counts.events}</span></button>
		<button class:active={activeFilter === 'mentions'} onclick={() => (activeFilter = 'mentions')} disabled={counts.mentions === 0}>Nevnt <span class="count">{counts.mentions}</span></button>
	</div>

	<div class="feed">
		{#if filteredFeed.length === 0}
			<p class="empty">
				{#if mentionsLoading && activeFilter === 'all'}
					Laster…
				{:else}
					Ingenting å vise her enda.
				{/if}
			</p>
		{:else}
			{#each filteredFeed as item (item.kind + '::' + item.id)}
				<article class="item kind-{item.kind}" class:future={item.kind === 'event' && item.future}>
					<div class="icon" aria-hidden="true">
						{#if item.kind === 'memory'}💭
						{:else if item.kind === 'goal'}🎯
						{:else if item.kind === 'task'}✅
						{:else if item.kind === 'conversation'}💬
						{:else if item.kind === 'event'}📅
						{:else if item.kind === 'message-mention'}@
						{:else if item.kind === 'checklist-mention'}@
						{/if}
					</div>
					<div class="body">
						{#if item.kind === 'memory'}
							<p class="text">{item.text}</p>
							<span class="meta">Memory · {item.sub} · {relativeDate(item.ts)}</span>
						{:else if item.kind === 'goal'}
							<p class="text"><strong>{item.title}</strong></p>
							{#if item.description}<p class="sub">{item.description}</p>{/if}
							<span class="meta">Mål · {relativeDate(item.ts)}</span>
						{:else if item.kind === 'task'}
							<a href={`/oppgaver/${item.id}`} class="title-link"><TaskTitle title={item.title} /></a>
							<span class="meta">
								Oppgave · {item.status === 'active' ? 'aktiv' : item.status} · {relativeDate(item.ts)}
								{#if item.source === 'mention'}
									<span class="badge">{item.confidence === 'inferred' ? 'utledet' : 'nevnt'}</span>
								{/if}
							</span>
						{:else if item.kind === 'conversation'}
							<a href={`/samtaler/${item.id}`} class="title-link">{item.title}</a>
							<span class="meta">Chat · {relativeDate(item.ts)}</span>
						{:else if item.kind === 'event'}
							<p class="text"><strong>{item.title}</strong></p>
							<span class="meta">
								{item.future ? 'Kommende' : 'Tidligere'} event · {relativeDate(item.ts)}
								{#if item.groupName}— {item.groupName}{/if}
							</span>
						{:else if item.kind === 'message-mention'}
							<a href={`/samtaler/${item.conversationId}`} class="snippet-link">{item.snippet}</a>
							<span class="meta">
								Nevnt i chat · {item.role === 'user' ? 'du' : 'Resonans'} · {relativeDate(item.ts)}
								{#if item.confidence === 'inferred'}<span class="badge">utledet</span>{/if}
							</span>
						{:else if item.kind === 'checklist-mention'}
							<p class="text" class:checked={item.checked}><TaskTitle title={item.text} /></p>
							<span class="meta">
								Nevnt i dagsliste · {item.checked ? 'utført' : 'åpen'} · {relativeDate(item.ts)}
								{#if item.confidence === 'inferred'}<span class="badge">utledet</span>{/if}
							</span>
						{/if}
					</div>
				</article>
			{/each}
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

	/* Redigering popper opp som eget bunn-panel oppå detalj-arket, i stedet for
	   å injiseres inline midt i innholdet (som havnet langt nede i scrollen). */
	.edit-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: flex-end;
		justify-content: center;
		z-index: 1100;
		padding: 1rem;
	}
	.edit-wrap {
		width: 100%;
		max-width: 560px;
	}
	.title { display: flex; align-items: center; gap: 0.75rem; }
	.title h2 { margin: 0; font-size: 1.25rem; color: #f0f0f0; }
	.name-block { display: flex; flex-direction: column; gap: 0.1rem; }
	.age { font-size: 0.8rem; opacity: 0.6; }
	.emoji { font-size: 2rem; }
	.photo {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		object-fit: cover;
		border: 1px solid #2a2a2a;
	}
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
	button:hover:not(:disabled) { background: #2e2e2e; border-color: #444; color: #e8e8e8; }
	button:disabled { opacity: 0.4; cursor: not-allowed; }
	button.primary {
		background: #252525;
		color: #a0acf8;
		border-color: #3a4060;
	}
	button.primary:hover { background: #2a2f4a; border-color: #5060a0; color: #c0caff; }
	button.ghost { background: transparent; border-color: transparent; }
	button.ghost:hover { background: #252525; border-color: #333; }

	.filters {
		display: flex;
		gap: 0.4rem;
		flex-wrap: wrap;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid #2a2a2a;
	}
	.filters button {
		padding: 0.3rem 0.7rem;
		font-size: 0.8rem;
		border-radius: 999px;
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
	}
	.filters button.active {
		background: #2a2f4a;
		border-color: #5060a0;
		color: #c0caff;
	}
	.filters .count {
		font-size: 0.7rem;
		opacity: 0.65;
		font-variant-numeric: tabular-nums;
	}

	.feed { display: flex; flex-direction: column; gap: 0.5rem; }
	.empty { color: #666; font-style: italic; padding: 1rem 0; }
	.item {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.6rem;
		padding: 0.65rem 0.75rem;
		border-radius: 10px;
		background: #1f1f1f;
		border: 1px solid #2a2a2a;
		align-items: start;
	}
	.item .icon {
		width: 1.6rem;
		height: 1.6rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		opacity: 0.85;
	}
	.item .body { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
	.item .text { margin: 0; color: #d8d8d8; line-height: 1.4; }
	.item .text.checked { color: #777; text-decoration: line-through; }
	.item .sub { margin: 0; color: #aaa; font-size: 0.85rem; }
	.item .meta {
		font-size: 0.72rem;
		color: #777;
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.item .badge {
		font-size: 0.65rem;
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
		background: #2a2a2a;
		color: #999;
	}
	.item .title-link, .item .snippet-link {
		color: #d8d8d8;
		text-decoration: none;
		font-weight: 500;
	}
	.item .title-link:hover, .item .snippet-link:hover { color: #c0caff; }
	.item .snippet-link {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-weight: 400;
	}
	.item.future {
		background: #1c2030;
		border-color: #2f3a55;
	}
</style>
