<!--
  Funn — triage-innboks for lagrede lenker/reels.
  Funn kommer inn via e-post (find_triage-regel), GPT klassifiserer «hva er
  dette», og her beholder/omruter/forkaster du dem. Oppskrifter er allerede
  promotert til mat-temaet.
-->
<script lang="ts">
	import { AppPage, PageSection, PageHeader, TabButton, Select } from '$lib/components/ui';

	let { data } = $props();

	type Find = (typeof data.finds)[number];

	let items = $state<Find[]>(data.finds);
	let tab = $state<'inbox' | 'kept' | 'discarded'>('inbox');

	const THEMES: Array<{ key: string; label: string; emoji: string }> = [
		{ key: 'food', label: 'Mat', emoji: '🍽️' },
		{ key: 'home', label: 'Hjem', emoji: '🏠' },
		{ key: 'health', label: 'Helse', emoji: '❤️' },
		{ key: 'family', label: 'Familie', emoji: '👨‍👩‍👧' },
		{ key: 'self', label: 'Selv', emoji: '🧭' },
		{ key: 'jobb', label: 'Jobb', emoji: '💼' },
		{ key: 'economics', label: 'Økonomi', emoji: '💰' },
		{ key: 'annet', label: 'Annet', emoji: '🔖' }
	];

	function themeMeta(key: string | null) {
		return THEMES.find((t) => t.key === key) ?? THEMES[THEMES.length - 1];
	}

	const filtered = $derived(items.filter((f) => f.status === tab));
	const counts = $derived({
		inbox: items.filter((f) => f.status === 'inbox').length,
		kept: items.filter((f) => f.status === 'kept').length,
		discarded: items.filter((f) => f.status === 'discarded').length
	});

	async function patch(id: string, changes: { status?: string; theme?: string }) {
		const res = await fetch('/api/funn', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, ...changes })
		});
		if (res.ok) {
			const updated = await res.json();
			items = items.map((f) => (f.id === id ? { ...f, ...updated } : f));
		}
	}

	async function remove(id: string) {
		const res = await fetch('/api/funn', {
			method: 'DELETE',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id })
		});
		if (res.ok) items = items.filter((f) => f.id !== id);
	}
</script>

<AppPage>
	<PageSection>
		<PageHeader title="Funn" titleHref="/" emoji="🔖" />

		<p class="intro">
			Lenker og reels du har sendt til deg selv på e-post. Resonans har gjettet hva hvert funn er —
			behold det som er nyttig, omruter feil tema, eller forkast resten.
		</p>

		<div class="tabs">
			<TabButton active={tab === 'inbox'} onClick={() => (tab = 'inbox')}>
				Innboks{counts.inbox ? ` (${counts.inbox})` : ''}
			</TabButton>
			<TabButton active={tab === 'kept'} onClick={() => (tab = 'kept')}>
				Beholdt{counts.kept ? ` (${counts.kept})` : ''}
			</TabButton>
			<TabButton active={tab === 'discarded'} onClick={() => (tab = 'discarded')}>
				Arkiv{counts.discarded ? ` (${counts.discarded})` : ''}
			</TabButton>
		</div>

		{#if filtered.length === 0}
			<div class="empty">
				{#if tab === 'inbox'}
					<p>Ingen funn i innboksen.</p>
					<p class="hint">
						Sett opp en «Funn»-regel under <a href="/settings/sources">Kilder → E-post</a>, så
						send deg selv en reel med caption-teksten limt inn.
					</p>
				{:else if tab === 'kept'}
					<p>Ingenting beholdt ennå.</p>
				{:else}
					<p>Arkivet er tomt.</p>
				{/if}
			</div>
		{:else}
			<div class="cards">
				{#each filtered as find (find.id)}
					<article class="funn-card">
						{#if find.thumbnailUrl}
							<a class="thumb" href={find.sourceUrl ?? undefined} target="_blank" rel="noopener">
								<img src={find.thumbnailUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
							</a>
						{/if}
						<div class="body">
							<div class="chips">
								<span class="chip theme">{themeMeta(find.theme).emoji} {themeMeta(find.theme).label}</span>
								{#if find.kind}<span class="chip kind">{find.kind}</span>{/if}
								{#if find.mealId}<span class="chip recipe">✓ Lagret som oppskrift</span>{/if}
							</div>

							{#if find.sourceUrl}
								<a class="title" href={find.sourceUrl} target="_blank" rel="noopener">{find.title}</a>
							{:else}
								<span class="title">{find.title}</span>
							{/if}

							{#if find.summary}<p class="summary">{find.summary}</p>{/if}

							<div class="actions">
								<Select
									value={find.theme ?? 'annet'}
									className="theme-select"
									onChange={(e: Event) => patch(find.id, { theme: (e.target as HTMLSelectElement).value })}
								>
									{#each THEMES as t}
										<option value={t.key}>{t.emoji} {t.label}</option>
									{/each}
								</Select>

								{#if tab === 'inbox'}
									<button class="act keep" data-track="funn:behold" onclick={() => patch(find.id, { status: 'kept' })}>Behold</button>
									<button class="act discard" data-track="funn:forkast" onclick={() => patch(find.id, { status: 'discarded' })}>Forkast</button>
								{:else if tab === 'kept'}
									<button class="act" data-track="funn:til-innboks" onclick={() => patch(find.id, { status: 'inbox' })}>Til innboks</button>
									<button class="act discard" data-track="funn:forkast" onclick={() => patch(find.id, { status: 'discarded' })}>Forkast</button>
								{:else}
									<button class="act" data-track="funn:gjenopprett" onclick={() => patch(find.id, { status: 'inbox' })}>Gjenopprett</button>
									<button class="act delete" data-track="funn:slett" onclick={() => remove(find.id)}>Slett</button>
								{/if}
							</div>
						</div>
					</article>
				{/each}
			</div>
		{/if}
	</PageSection>
</AppPage>

<style>
	.intro {
		color: var(--text-secondary);
		font-size: var(--font-size-body, 0.9rem);
		line-height: 1.5;
		margin: 0 0 1rem;
	}

	.tabs {
		display: flex;
		gap: 0.25rem;
		border-bottom: 1px solid var(--border-color);
		margin-bottom: 1.1rem;
		overflow-x: auto;
	}

	.empty {
		text-align: center;
		padding: 2.5rem 1rem;
		color: var(--text-tertiary);
	}
	.empty p { margin: 0.3rem 0; }
	.empty .hint { font-size: 0.84rem; }
	.empty a { color: var(--accent-primary, #9eabff); }

	.cards {
		display: flex;
		flex-direction: column;
		gap: 0.85rem;
	}

	.funn-card {
		display: flex;
		gap: 0.85rem;
		background: var(--card-bg, var(--bg-card));
		border: 1px solid var(--card-border, var(--border-color));
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
	}

	.thumb {
		flex-shrink: 0;
		width: 92px;
		height: 92px;
		border-radius: 12px;
		overflow: hidden;
		background: var(--bg-elevated, #12162a);
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		min-width: 0;
		flex: 1;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		font-size: 0.72rem;
		padding: 0.12rem 0.45rem;
		border-radius: 6px;
		background: var(--bg-elevated, #1a1a2a);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.chip.kind { text-transform: capitalize; }
	.chip.recipe { background: #16311f; color: #6ee7a8; }

	.title {
		font-size: var(--font-size-title, 1rem);
		font-weight: 600;
		color: var(--text-primary);
		text-decoration: none;
		word-break: break-word;
	}
	a.title:hover { text-decoration: underline; }

	.summary {
		margin: 0;
		font-size: var(--font-size-body, 0.88rem);
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-top: 0.3rem;
	}

	.act {
		font-size: 0.8rem;
		padding: 0.3rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 0.12s, color 0.12s, border-color 0.12s;
	}
	.act:hover { background: var(--bg-hover, #12162a); color: var(--text-primary); }
	.act.keep:hover { border-color: #10b981; color: #6ee7a8; }
	.act.discard:hover,
	.act.delete:hover { border-color: #e74c4c; color: #e79a9a; }

	:global(.theme-select) {
		font-size: 0.8rem !important;
		padding: 0.3rem 0.5rem !important;
		width: auto !important;
	}

	@media (max-width: 520px) {
		.thumb { width: 68px; height: 68px; }
	}
</style>
