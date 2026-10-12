<!--
  Kamera-flyt panel for HomeChatZone.
  Aksesserer delt state via getContext(HOME_CTX).
-->
<script lang="ts">
	import { getContext } from 'svelte';
	import Icon from '../../ui/Icon.svelte';
	import { HOME_CTX, type HomeContext } from './home-context';

	const ctx = getContext<HomeContext>(HOME_CTX);
</script>

<div class="flow-panel">
	<div class="flow-header">
		<button class="flow-title-btn flow-title" onclick={ctx.closeCameraFlow} aria-label="Tilbake fra Kamera">Kamera</button>
	</div>
	<input
		type="file"
		accept="image/*"
		style="display:none"
		bind:this={ctx.cameraFileInput}
		onchange={ctx.handleCameraFileSelect}
	/>
	<div class="flow-body">
		{#if !ctx.cameraPreview}
			<button class="upload-zone" onclick={() => ctx.cameraFileInput?.click()}>
				<span class="upload-zone-icon"><Icon name="camera" size={28} /></span>
				<p class="upload-zone-label">Velg bilde eller ta foto</p>
				<p class="upload-zone-sub">Skjermtid · Kvittering · Blodprøve · Notat</p>
			</button>
			{#if ctx.cameraHistory.length > 0}
				<div class="media-history">
					<p class="media-history-label">Tidligere bilder</p>
					<div class="media-history-grid">
						{#each ctx.cameraHistory as item}
							<button
								class="media-history-item"
								onclick={() => ctx.reuseCameraMedia(item)}
								title={item.name}
								aria-label={`Gjenbruk: ${item.name}`}
							>
								<img src={item.url} alt={item.name} />
								<span class="media-item-name">{item.name.split('.')[0].slice(0, 10)}</span>
							</button>
						{/each}
					</div>
				</div>
			{:else if ctx.cameraHistoryLoading}
				<p class="media-history-loading">Laster tidligere bilder…</p>
			{/if}
		{:else}
			<div class="img-preview">
				<img src={ctx.cameraPreview} alt="Forhåndsvisning" />
				<button class="preview-clear" onclick={() => { ctx.cameraPreview = null; ctx.cameraSelectedFile = null; }} aria-label="Fjern bilde"><Icon name="close" size={13} /></button>
			</div>
			<textarea
				class="flow-textarea"
				placeholder="Beskriv eller legg til kontekst (valgfritt)…"
				bind:value={ctx.cameraCaption}
				rows="2"
			></textarea>
			{#if ctx.cameraError}
				<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
			{/if}
			<button class="flow-submit" onclick={ctx.submitCamera} disabled={ctx.cameraUploading}>
				{ctx.cameraUploading ? 'Leser bildet…' : 'Legg ved →'}
			</button>
		{/if}
	</div>
</div>

<style>
	/* Tittelen ER tilbakeknappen (docs/DESIGN.md). */
	.flow-title-btn {
		background: none;
		border: none;
		padding: 4px 6px;
		margin: -4px -6px;
		border-radius: 8px;
		color: inherit;
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.flow-title-btn:focus-visible {
		outline: 2px solid var(--accent-primary);
		outline-offset: 2px;
	}
	.flow-title-btn:active { opacity: 0.7; }

	.flow-panel {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.flow-header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.flow-back:hover { color: var(--text-primary); }

	.flow-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: var(--text-secondary);
	}

	.flow-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.flow-textarea {
		width: 100%;
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 12px 14px;
		color: var(--text-primary);
		font: inherit;
		font-size: 0.88rem;
		line-height: 1.5;
		resize: none;
		box-sizing: border-box;
	}
	.flow-textarea:focus {
		outline: none;
		border-color: var(--accent-primary);
	}
	.flow-textarea::placeholder { color: var(--text-muted); }

	.flow-submit {
		background: var(--accent-primary);
		border: none;
		color: var(--accent-contrast);
		border-radius: 14px;
		padding: 13px 20px;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		width: 100%;
		transition: background 0.15s, opacity 0.15s;
	}
	.flow-submit:hover:not(:disabled) { background: var(--accent-hover); }
	.flow-submit:disabled { opacity: 0.4; cursor: default; }

	.flow-error {
		margin: 0;
		font-size: 0.8rem;
		color: var(--error-text);
	}

	.upload-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		background: var(--bg-secondary);
		border: 2px dashed var(--border-color);
		border-radius: 18px;
		padding: 36px 20px;
		cursor: pointer;
		width: 100%;
		transition: border-color 0.15s, background 0.15s;
		font: inherit;
	}
	.upload-zone:hover { border-color: var(--accent-primary); background: var(--bg-hover); }

	.upload-zone-icon {
		color: var(--accent-primary);
		opacity: 0.7;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.upload-zone-label {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.upload-zone-sub {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	.img-preview {
		position: relative;
		border-radius: 14px;
		overflow: hidden;
		max-height: 200px;
	}
	.img-preview img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.preview-clear {
		position: absolute;
		top: 8px;
		right: 8px;
		background: rgba(0,0,0,0.7);
		border: none;
		color: #fff;
		border-radius: 50%;
		width: 28px;
		height: 28px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.media-history {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--border-color);
	}

	.media-history-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-tertiary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 10px 0;
	}

	.media-history-loading {
		font-size: 0.75rem;
		color: var(--text-tertiary);
		margin: 8px 0;
	}

	.media-history-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}

	.media-history-item {
		/* Navnestripa inni er absolutt plassert og trenger et anker. */
		position: relative;
		aspect-ratio: 1;
		border: 1px solid var(--border-color);
		border-radius: 8px;
		overflow: hidden;
		cursor: pointer;
		background: var(--card-bg-inset);
		transition: border-color 0.15s, opacity 0.15s;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: flex-start;
		padding: 0;
		font: inherit;
	}

	.media-history-item img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.media-history-item:hover {
		border-color: var(--accent-primary);
		opacity: 0.85;
	}

	.media-item-name {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: rgba(0, 0, 0, 0.8);
		color: #ccc;
		font-size: 0.65rem;
		padding: 3px 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		text-align: center;
	}
</style>
