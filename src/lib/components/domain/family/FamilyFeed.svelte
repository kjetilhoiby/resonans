<script lang="ts">
	import type { FamilyDashboardData } from '$lib/client/dashboard-cache';
	import TaskTitle from '$lib/components/ui/TaskTitle.svelte';

	interface Props {
		feed: FamilyDashboardData['feed'];
		persons: FamilyDashboardData['persons'];
		onSelectPerson?: (personId: string) => void;
	}

	let { feed, persons, onSelectPerson }: Props = $props();

	const personById = $derived(new Map(persons.map((p) => [p.id, p])));

	type FilterId = 'all' | 'tasks' | 'events' | 'mentions';
	let activeFilter = $state<FilterId>('all');

	type FeedItem = FamilyDashboardData['feed'][number];

	function isMention(it: FeedItem): boolean {
		return (
			it.kind === 'message-mention' ||
			it.kind === 'checklist-mention' ||
			(it.kind === 'task' && it.source === 'mention')
		);
	}

	const filteredFeed = $derived.by(() => {
		if (activeFilter === 'all') return feed;
		if (activeFilter === 'tasks') return feed.filter((it) => it.kind === 'task');
		if (activeFilter === 'events') return feed.filter((it) => it.kind === 'event');
		return feed.filter(isMention);
	});

	const counts = $derived({
		all: feed.length,
		tasks: feed.filter((i) => i.kind === 'task').length,
		events: feed.filter((i) => i.kind === 'event').length,
		mentions: feed.filter(isMention).length
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

	function relativeDate(iso: string): string {
		const ts = new Date(iso).getTime();
		const diffMs = ts - Date.now();
		const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
		if (diffDays === 0) return 'I dag';
		if (diffDays === 1) return 'I morgen';
		if (diffDays === -1) return 'I går';
		if (diffDays > 1 && diffDays < 7) return `Om ${diffDays} dager`;
		if (diffDays < -1 && diffDays > -7) return `${-diffDays} dager siden`;
		return formatDate(ts);
	}
</script>

<div class="family-feed">
	<div class="filters" role="tablist">
		<button class:active={activeFilter === 'all'} onclick={() => (activeFilter = 'all')}>
			Alt <span class="count">{counts.all}</span>
		</button>
		<button
			class:active={activeFilter === 'events'}
			onclick={() => (activeFilter = 'events')}
			disabled={counts.events === 0}
		>
			Hendelser <span class="count">{counts.events}</span>
		</button>
		<button
			class:active={activeFilter === 'tasks'}
			onclick={() => (activeFilter = 'tasks')}
			disabled={counts.tasks === 0}
		>
			Oppgaver <span class="count">{counts.tasks}</span>
		</button>
		<button
			class:active={activeFilter === 'mentions'}
			onclick={() => (activeFilter = 'mentions')}
			disabled={counts.mentions === 0}
		>
			Nevnt <span class="count">{counts.mentions}</span>
		</button>
	</div>

	<div class="feed">
		{#if filteredFeed.length === 0}
			<p class="empty">Ingenting å vise her enda.</p>
		{:else}
			{#each filteredFeed as item (item.kind + '::' + item.id)}
				<article class="item kind-{item.kind}" class:future={item.kind === 'event' && item.future}>
					<div class="avatars" aria-hidden={item.personIds.length === 0}>
						{#each item.personIds as pid (pid)}
							{@const p = personById.get(pid)}
							{#if p}
								<button
									class="avatar"
									title={p.name}
									onclick={() => onSelectPerson?.(pid)}
								>
									{#if p.photoUrl}
										<img src={p.photoUrl} alt={p.name} />
									{:else}
										<span>{p.avatarEmoji ?? '👤'}</span>
									{/if}
								</button>
							{/if}
						{/each}
					</div>
					<div class="body">
						{#if item.kind === 'event'}
							<p class="text"><strong>{item.title}</strong></p>
							<span class="meta">
								<span class="icon">📅</span>
								{item.future ? 'Kommende' : 'Tidligere'} · {relativeDate(item.ts)}
								{#if item.groupName}— {item.groupName}{/if}
							</span>
						{:else if item.kind === 'task'}
							<a href={`/oppgaver/${item.id}`} class="title-link"><TaskTitle title={item.title} /></a>
							<span class="meta">
								<span class="icon">✅</span>
								Oppgave · {item.status === 'active' ? 'aktiv' : item.status} · {relativeDate(item.ts)}
								{#if item.source === 'mention'}
									<span class="badge">{item.confidence === 'inferred' ? 'utledet' : 'nevnt'}</span>
								{/if}
							</span>
						{:else if item.kind === 'message-mention'}
							<a href={`/samtaler/${item.conversationId}`} class="snippet-link">{item.snippet}</a>
							<span class="meta">
								<span class="icon">@</span>
								Nevnt i chat · {item.role === 'user' ? 'du' : 'Resonans'} · {relativeDate(item.ts)}
								{#if item.confidence === 'inferred'}<span class="badge">utledet</span>{/if}
							</span>
						{:else if item.kind === 'checklist-mention'}
							<p class="text" class:checked={item.checked}><TaskTitle title={item.text} /></p>
							<span class="meta">
								<span class="icon">@</span>
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
	.family-feed {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
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
		border: 1px solid #333;
		background: #252525;
		color: #c8c8c8;
		font: inherit;
		cursor: pointer;
		display: inline-flex;
		gap: 0.35rem;
		align-items: center;
		transition: background 0.1s, border-color 0.1s;
	}
	.filters button:hover:not(:disabled) { background: #2e2e2e; border-color: #444; color: #e8e8e8; }
	.filters button:disabled { opacity: 0.4; cursor: not-allowed; }
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
	.item.future {
		background: #1c2030;
		border-color: #2f3a55;
	}

	.avatars {
		display: flex;
		flex-direction: row;
	}
	.avatar {
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 50%;
		border: 1px solid #2a2a2a;
		background: #252525;
		padding: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1rem;
		cursor: pointer;
		overflow: hidden;
		margin-left: -0.5rem;
		transition: transform 0.1s, border-color 0.1s;
	}
	.avatar:first-child { margin-left: 0; }
	.avatar:hover { transform: translateY(-1px); border-color: #5060a0; z-index: 1; }
	.avatar img { width: 100%; height: 100%; object-fit: cover; }

	.body { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
	.body .text { margin: 0; color: #d8d8d8; line-height: 1.4; }
	.body .text.checked { color: #777; text-decoration: line-through; }
	.body .meta {
		font-size: 0.72rem;
		color: #777;
		display: flex;
		gap: 0.4rem;
		align-items: center;
		flex-wrap: wrap;
	}
	.body .meta .icon { opacity: 0.85; }
	.body .badge {
		font-size: 0.65rem;
		padding: 0.05rem 0.35rem;
		border-radius: 4px;
		background: #2a2a2a;
		color: #999;
	}
	.body .title-link, .body .snippet-link {
		color: #d8d8d8;
		text-decoration: none;
		font-weight: 500;
	}
	.body .title-link:hover, .body .snippet-link:hover { color: #c0caff; }
	.body .snippet-link {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		font-weight: 400;
	}
</style>
