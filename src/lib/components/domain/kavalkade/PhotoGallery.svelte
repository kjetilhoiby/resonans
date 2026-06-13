<!--
  PhotoGallery — årets opplastede bilder som mosaikk med bildetekst.
  Props-drevet; brukes på /kavalkade.
-->
<script lang="ts">
	import type { PhotoView } from './types';

	interface Props {
		photos: PhotoView[];
	}

	let { photos }: Props = $props();
</script>

<div class="kv-gallery">
	{#each photos as photo (photo.url)}
		<figure class="kv-gallery-item">
			<img src={photo.url} alt={photo.caption || 'Årets bilde'} loading="lazy" />
			{#if photo.caption}
				<figcaption>{photo.caption}</figcaption>
			{/if}
		</figure>
	{/each}
</div>

<style>
	.kv-gallery {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}

	.kv-gallery-item {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.kv-gallery-item img {
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: var(--radius-md, 10px);
		border: 1px solid var(--card-border, #222);
	}

	.kv-gallery-item figcaption {
		font-size: var(--font-size-caption);
		color: var(--text-secondary);
		font-style: italic;
	}
</style>
