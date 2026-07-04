<!--
  DiaryImages — flerbilde-redigerer for dagboknotater (reise + ferie).

  Viser opplastede bilder som miniatyrer med fjern-knapp og felter for
  bildetekst og sted per bilde, og lar brukeren laste opp flere bilder om
  gangen via Cloudinary (uploadImage). Stedet geokodes av lagre-flyten (ikke
  her), så bildet kan vises som egen nål i kartfortellingen. Bruker
  tema-tokens (--tp-*) slik at den ser riktig ut i både TripDiary og
  FerieExecutionView.

  Props:
    images   – nåværende bilder (bindable)
    onChange – kalles med ny liste når bilder legges til/endres/fjernes (for lagring)
    track    – område-prefiks for data-track-logging (f.eks. 'reise-dagbok')
-->
<script lang="ts">
	import { uploadImage } from '$lib/client/upload-image';
	import type { DiaryImage } from './trip-api';

	interface Props {
		images: DiaryImage[];
		onChange?: (images: DiaryImage[]) => void;
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
			const added: DiaryImage[] = [];
			for (const file of files) {
				const { url } = await uploadImage(file);
				added.push({ url });
			}
			images = [...images, ...added];
			onChange?.(images);
		} catch {
			error = 'Klarte ikke laste opp bilde.';
		} finally {
			uploading = false;
		}
	}

	function removeImage(url: string) {
		images = images.filter((img) => img.url !== url);
		onChange?.(images);
	}

	function updateImage(index: number, patch: Partial<DiaryImage>) {
		images = images.map((img, i) => (i === index ? { ...img, ...patch } : img));
	}

	// Meta-endringer committes på blur (ikke per tastetrykk) så lagre-flyten
	// ikke fyrer for hver bokstav.
	function commit() {
		onChange?.(images);
	}
</script>

<div class="diary-images">
	{#if images.length > 0}
		<ul class="img-list">
			{#each images as img, i (img.url)}
				<li class="img-row">
					<img class="img-thumb" src={img.url} alt={img.caption ?? 'Dagbokbilde'} loading="lazy" />
					<div class="img-fields">
						<input
							type="text"
							class="img-input"
							placeholder="Bildetekst"
							value={img.caption ?? ''}
							oninput={(e) => updateImage(i, { caption: (e.currentTarget as HTMLInputElement).value })}
							onblur={commit}
							data-track="{track}:bildetekst"
						/>
						<input
							type="text"
							class="img-input"
							placeholder="Sted (vises på kartet)"
							value={img.place ?? ''}
							oninput={(e) => updateImage(i, { place: (e.currentTarget as HTMLInputElement).value })}
							onblur={commit}
							data-track="{track}:bilde-sted"
						/>
					</div>
					<button
						type="button"
						class="img-remove"
						aria-label="Fjern bilde"
						data-track="{track}:fjern-bilde"
						onclick={() => removeImage(img.url)}>×</button
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

	.img-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.img-row {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		border: 1px solid var(--tp-border, #2a2a2a);
		border-radius: 10px;
		background: var(--tp-bg-1, #111);
		padding: 0.4rem;
	}

	.img-thumb {
		width: 64px;
		height: 64px;
		object-fit: cover;
		border-radius: 8px;
		flex-shrink: 0;
		display: block;
	}

	.img-fields {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.img-input {
		width: 100%;
		box-sizing: border-box;
		background: transparent;
		border: none;
		border-bottom: 1px dashed var(--tp-border-strong, var(--tp-border, #2a2a2a));
		border-radius: 0;
		color: var(--tp-text, #d0d0d0);
		font-size: 0.82rem;
		padding: 0.25rem 0.1rem;
	}

	.img-input:focus {
		outline: none;
		border-bottom-color: var(--tp-accent, #6072e6);
	}

	.img-remove {
		width: 22px;
		height: 22px;
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
		flex-shrink: 0;
	}

	.img-remove:hover {
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
