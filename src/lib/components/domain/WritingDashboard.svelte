<!--
  Skriving-temaets dashboard.

  Bevisst tynt: viser hvor du står og sender deg videre. Redigeringen eies av
  /skriv og /notater — å duplisere prosjektrommet hit ville gitt to steder å
  vedlikeholde samme liste. Samme arbeidsdeling som mortema mot undertema.
-->
<script lang="ts">
	import type { WritingDashboardPayload } from '$lib/server/writing-dashboard';
	import { describeStreak } from '$lib/domain/writing/exercise';

	interface Props {
		data: WritingDashboardPayload | null;
	}

	let { data }: Props = $props();

	function fmt(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}
</script>

{#if !data}
	<p class="empty">Laster …</p>
{:else}
	<div class="top">
		<p class="streak">
			{#if data.streakDays > 0}🔥 {/if}{describeStreak(data.streakDays)}
			{#if data.wroteToday}<span class="muted">Skrevet i dag.</span>{/if}
		</p>
		<p class="muted">{data.totalWords} ord totalt · {data.looseNotes} frie notater</p>
	</div>

	<div class="links">
		<a class="cta" href="/skriv" data-track="skriving-tema:apne-prosjekter">Skriveprosjekter →</a>
		<a class="cta" href="/notater" data-track="skriving-tema:apne-notatblokk">Notatblokka →</a>
	</div>

	{#if data.projects.length === 0}
		<p class="empty">Ingen skriveprosjekter ennå.</p>
	{:else}
		<ul class="list">
			{#each data.projects as p (p.id)}
				<li>
					<a class="row" href={`/skriv/${p.id}`} data-track="skriving-tema:apne-prosjekt">
						<span class="row-main">
							<span class="row-title">{p.title}</span>
							<span class="row-sub">
								{p.parts} deler · {p.words} ord{#if p.characters > 0} · {p.characters} karakterer{/if}
							</span>
						</span>
						<span class="row-meta">
							{#if p.genre}<span>{p.genre}</span>{/if}
							<span>{fmt(p.updatedAt)}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
{/if}

<style>
	.top {
		margin-bottom: 12px;
	}
	.streak {
		margin: 0 0 4px;
		font-size: var(--text-md);
	}
	.muted {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
		margin: 0;
	}
	.links {
		display: flex;
		gap: 12px;
		margin-bottom: 16px;
		flex-wrap: wrap;
	}
	.cta {
		color: var(--accent-primary);
		font-size: var(--text-sm);
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		gap: 12px;
		align-items: flex-start;
		background: var(--card-bg);
		border: 1px solid var(--card-border);
		border-radius: var(--card-radius);
		padding: var(--card-padding);
		color: var(--text-primary);
		text-decoration: none;
	}
	.row:hover {
		background: var(--card-bg-subtle);
	}
	.row-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.row-title {
		font-weight: 600;
	}
	.row-sub,
	.row-meta {
		color: var(--text-tertiary);
		font-size: var(--text-xs);
	}
	.row-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 4px;
		white-space: nowrap;
	}
	.empty {
		color: var(--text-tertiary);
		font-size: var(--text-sm);
	}
</style>
