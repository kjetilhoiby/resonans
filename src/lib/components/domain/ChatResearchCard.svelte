<!--
  ChatResearchCard — «bunnpanel» under et assistent-svar når web_search fant treff.
  Viser en valgfri bildestripe, et valgfritt mini-kart (reise-treff), og kildene
  som klikkbare rader med favicon + snippet.
-->
<script lang="ts">
	import type { ResearchCard } from '$lib/chat/research-card';
	import ChatMapCard from './ChatMapCard.svelte';

	interface Props {
		card: ResearchCard;
	}

	let { card }: Props = $props();

	// Skjul bilder som ikke lastes (døde/hotlink-beskyttede URL-er).
	let hiddenImages = $state<Set<string>>(new Set());
	function hideImage(url: string) {
		hiddenImages = new Set(hiddenImages).add(url);
	}

	const visibleImages = $derived(card.images.filter((u) => !hiddenImages.has(u)));
</script>

<div class="research-card">
	{#if visibleImages.length > 0}
		<div class="rc-images">
			{#each visibleImages as img (img)}
				<img class="rc-image" src={img} alt="" loading="lazy" onerror={() => hideImage(img)} />
			{/each}
		</div>
	{/if}

	{#if card.map}
		<ChatMapCard lat={card.map.lat} lng={card.map.lng} label={card.map.label} />
	{/if}

	<div class="rc-sources">
		<span class="rc-heading">Kilder</span>
		{#each card.sources as s (s.url)}
			<a class="rc-source" href={s.url} target="_blank" rel="noopener noreferrer" data-track="chat-research:kilde">
				<img class="rc-favicon" src={s.favicon} alt="" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
				<span class="rc-source-text">
					<span class="rc-domain">{s.source}</span>
					{#if s.snippet}<span class="rc-snippet">{s.snippet}</span>{/if}
				</span>
			</a>
		{/each}
	</div>
</div>

<style>
	.research-card {
		margin-top: 10px;
		border: 1px solid #222;
		border-radius: 14px;
		background: #111;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.rc-images {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.rc-images::-webkit-scrollbar { display: none; }

	.rc-image {
		height: 96px;
		width: auto;
		border-radius: 10px;
		object-fit: cover;
		flex-shrink: 0;
		background: #1a1a1a;
	}

	.rc-heading {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #666;
	}

	.rc-sources {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.rc-source {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 7px 8px;
		border-radius: 10px;
		text-decoration: none;
		transition: background 0.12s;
	}
	.rc-source:hover {
		background: #171717;
	}

	.rc-favicon {
		width: 16px;
		height: 16px;
		border-radius: 4px;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.rc-source-text {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.rc-domain {
		font-size: 0.82rem;
		font-weight: 600;
		color: #b4b4f0;
	}

	.rc-snippet {
		font-size: 0.78rem;
		color: #999;
		line-height: 1.4;
		overflow: hidden;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}
</style>
