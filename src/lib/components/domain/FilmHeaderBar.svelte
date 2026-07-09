<script lang="ts">
	import type { Film } from './film-api';

	interface Props {
		film: Film;
		onClose: () => void;
	}

	let { film, onClose }: Props = $props();
</script>

<div class="fl-header">
	<button class="fl-close" onclick={onClose} aria-label="Tilbake til biblioteket">←</button>
	{#if film.posterUrl}
		<img class="fl-header-poster" src={film.posterUrl} alt="" />
	{:else}
		<div class="fl-header-poster fl-header-poster-placeholder">🎬</div>
	{/if}
	<div class="fl-header-info">
		<h1 class="fl-header-title">{film.title}</h1>
		<p class="fl-header-meta">
			{#if film.year}{film.year}{/if}
			{#if film.year && film.director} · {/if}
			{#if film.director}{film.director}{/if}
			{#if film.runtime} · {film.runtime} min{/if}
		</p>
		{#if film.status === 'watched'}
			<span class="fl-header-seen">✅ Sett{#if film.rating} · {'🎬'.repeat(film.rating)}{/if}</span>
		{/if}
	</div>
</div>

<style>
	.fl-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px 8px;
		flex-shrink: 0;
		border-bottom: 1px solid var(--film-border-faint, #2a1a1a);
	}

	.fl-close {
		background: none;
		border: none;
		color: var(--film-text-secondary, #999);
		font-size: 1.4rem;
		cursor: pointer;
		padding: 0 4px;
		line-height: 1;
		flex-shrink: 0;
	}
	.fl-close:hover {
		color: var(--film-text-primary, #eee);
	}

	.fl-header-poster {
		width: 44px;
		height: 66px;
		object-fit: cover;
		border-radius: 5px;
		flex-shrink: 0;
		background: var(--film-bg-chip, #221518);
	}
	.fl-header-poster-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.4rem;
	}

	.fl-header-info {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.fl-header-title {
		margin: 0;
		font-size: 1.02rem;
		font-weight: 600;
		color: var(--film-text-primary, #eee);
		line-height: 1.25;
	}

	.fl-header-meta {
		margin: 0;
		font-size: 0.78rem;
		color: var(--film-text-secondary, #999);
	}

	.fl-header-seen {
		font-size: 0.74rem;
		color: var(--film-success, #d8a24a);
	}
</style>
