<!--
  DiaryImages — flerbilde-redigerer for dagboknotater (reise + ferie).

  Viser opplastede bilder som miniatyrer med fjern-knapp, og lar brukeren laste
  opp flere bilder om gangen via Cloudinary (uploadImage). Bruker tema-tokens
  (--tp-*) slik at den ser riktig ut i både TripDiary og FerieExecutionView.

  Props:
    images   – nåværende bilde-URLer (bindable)
    onChange – kalles med ny liste når bilder legges til/fjernes (for lagring)
    track    – område-prefiks for data-track-logging (f.eks. 'reise-dagbok')
-->
<script lang="ts">
	import { uploadImage } from '$lib/client/upload-image';

	interface Props {
		images: string[];
		onChange?: (images: string[]) => void;
		track?: string;
	}

	let { images = $bindable([]), onChange, track = 'dagbok' }: Props = $props();

	let uploading = $state(false);
	let error = $state('');

	async function onFilesSelected(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (files.length === 0) return;

		uploading = true;
		error = '';
		try {
			const urls: string[] = [];
			for (const file of files) {
				const { url } = await uploadImage(file);
				urls.push(url);
			}
			images = [...images, ...urls];
			onChange?.(images);
		} catch {
			error = 'Klarte ikke laste opp bilde.';
		} finally {
			uploading = false;
		}
	}

	function removeImage(url: string) {
		images = images.filter((u) => u !== url);
		onChange?.(images);
	}
</script>

<div class="diary-images">
	{#if images.length > 0}
		<ul class="thumb-grid">
			{#each images as url (url)}
				<li class="thumb">
					<img src={url} alt="Dagbokbilde" loading="lazy" />
					<button
						type="button"
						class="thumb-remove"
						aria-label="Fjern bilde"
						data-track="{track}:fjern-bilde"
						onclick={() => removeImage(url)}>×</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	<div class="upload-row">
		<label class="upload-btn">
			{uploading ? 'Laster opp…' : '📷 Legg til bilde'}
			<input
				type="file"
				accept="image/*"
				multiple
				hidden
				disabled={uploading}
				data-track="{track}:last-opp-bilde"
				onchange={onFilesSelected}
			/>
		</label>
		{#if error}<span class="upload-error">{error}</span>{/if}
	</div>
</div>

<style>
	.diary-images {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.thumb-grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.thumb {
		position: relative;
		width: 72px;
		height: 72px;
		border-radius: 10px;
		overflow: hidden;
		border: 1px solid var(--tp-border, #2a2a2a);
		background: var(--tp-bg-1, #111);
	}

	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.thumb-remove {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: none;
		background: rgba(0, 0, 0, 0.6);
		color: #fff;
		font-size: 0.95rem;
		line-height: 1;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
	}

	.thumb-remove:hover {
		background: rgba(0, 0, 0, 0.85);
	}

	.upload-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.upload-btn {
		display: inline-block;
		padding: 0.35rem 0.7rem;
		border-radius: 8px;
		border: 1px solid var(--tp-border-strong, var(--tp-border, #2a2a2a));
		background: var(--tp-bg-1, #1a1a1a);
		color: var(--tp-text, #d0d0d0);
		font-size: 0.85rem;
		cursor: pointer;
	}

	.upload-btn:hover {
		border-color: var(--tp-accent, #6072e6);
	}

	.upload-error {
		color: hsl(0 70% 70%);
		font-size: 0.85rem;
	}
</style>
