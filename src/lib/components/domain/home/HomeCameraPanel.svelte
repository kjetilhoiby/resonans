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
		<button class="flow-back" onclick={ctx.closeCameraFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
		<span class="flow-title">Kamera</span>
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
				{ctx.cameraUploading ? 'Triagerer…' : 'Last opp og triager →'}
			</button>
		{/if}
	</div>
</div>

<style>
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
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.flow-back {
		background: none;
		border: none;
		color: #555;
		font: inherit;
		font-size: 1.1rem;
		cursor: pointer;
		padding: 4px 8px 4px 0;
		transition: color 0.12s;
	}
	.flow-back:hover { color: #ccc; }

	.flow-title {
		font-size: 0.9rem;
		font-weight: 700;
		color: #aaa;
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
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
		color: #ccc;
		font: inherit;
		font-size: 0.88rem;
		line-height: 1.5;
		resize: none;
		box-sizing: border-box;
	}
	.flow-textarea:focus {
		outline: none;
		border-color: #3c4f9f;
	}
	.flow-textarea::placeholder { color: #3a3a3a; }

	.flow-submit {
		background: #4a5af0;
		border: none;
		color: #fff;
		border-radius: 14px;
		padding: 13px 20px;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		cursor: pointer;
		width: 100%;
		transition: background 0.15s, opacity 0.15s;
	}
	.flow-submit:hover:not(:disabled) { background: #3a4adf; }
	.flow-submit:disabled { opacity: 0.4; cursor: default; }

	.flow-error {
		margin: 0;
		font-size: 0.8rem;
		color: #e07070;
	}

	.upload-zone {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		background: #111;
		border: 2px dashed #2a2a2a;
		border-radius: 18px;
		padding: 36px 20px;
		cursor: pointer;
		width: 100%;
		transition: border-color 0.15s, background 0.15s;
		font: inherit;
	}
	.upload-zone:hover { border-color: #3c4f9f; background: #121218; }

	.upload-zone-icon {
		color: #4a5af0;
		opacity: 0.7;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.upload-zone-label {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		color: #ccc;
	}

	.upload-zone-sub {
		margin: 0;
		font-size: 0.75rem;
		color: #555;
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
		border-top: 1px solid #2a2a2a;
	}

	.media-history-label {
		font-size: 0.75rem;
		font-weight: 600;
		color: #888;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 0 0 10px 0;
	}

	.media-history-loading {
		font-size: 0.75rem;
		color: #666;
		margin: 8px 0;
	}

	.media-history-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
	}

	.media-history-item {
		aspect-ratio: 1;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		overflow: hidden;
		cursor: pointer;
		background: #0f0f0f;
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
		border-color: #4a5af0;
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
