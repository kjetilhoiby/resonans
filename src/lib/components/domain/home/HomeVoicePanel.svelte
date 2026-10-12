<!--
  Lyd-flyt panel for HomeChatZone.
  Aksesserer delt state via getContext(HOME_CTX).
-->
<script lang="ts">
	import { getContext } from 'svelte';
	import Icon from '../../ui/Icon.svelte';
	import { HOME_CTX, type HomeContext } from './home-context';
	import VideoFramePicker from './VideoFramePicker.svelte';

	const ctx = getContext<HomeContext>(HOME_CTX);
	let pickerOpen = $state(false);
</script>

<div class="flow-panel">
	<div class="flow-header">
		<button class="flow-title-btn flow-title" onclick={ctx.closeVoiceFlow} aria-label="Tilbake fra Lyd/video">Lyd/video</button>
	</div>
	<input
		bind:this={ctx.voiceFileInput}
		type="file"
		accept="audio/*,video/*,.m4a,.mp3,.wav,.aac,.ogg,.webm,.mp4,.mov,.m4v"
		class="sr-only"
		onchange={ctx.handleVoiceFileSelect}
	/>
	<div class="flow-body">
		{#if !ctx.voiceSelectedFile}
			<button class="upload-zone" onclick={() => ctx.voiceFileInput?.click()}>
				<span class="upload-zone-icon"><Icon name="wave" size={28} /></span>
				<p class="upload-zone-label">Velg lyd- eller videofil</p>
				<p class="upload-zone-sub">Opptak · talememo · møteklipp · skjermopptak med lyd</p>
			</button>
			{#if ctx.voiceHistory.length > 0}
				<div class="media-history">
					<p class="media-history-label">Tidligere lydopptak</p>
					<div class="media-history-list">
						{#each ctx.voiceHistory as item}
							<button
								class="media-history-list-item"
								onclick={() => ctx.reuseVoiceMedia(item)}
								title={item.name}
								aria-label={`Gjenbruk: ${item.name}`}
							>
								<span class="media-list-icon">🎙️</span>
								<div class="media-list-meta">
									<span class="media-list-name">{item.name}</span>
									<span class="media-list-date">{new Date(item.createdAt).toLocaleDateString('nb-NO')}</span>
								</div>
							</button>
						{/each}
					</div>
				</div>
			{:else if ctx.voiceHistoryLoading}
				<p class="media-history-loading">Laster tidligere opptak…</p>
			{/if}
		{:else}
			<div class="selected-file-chip">
				<div class="selected-file-chip__meta">
					<span class="selected-file-chip__icon"><Icon name="wave" size={16} /></span>
					<div>
						<p>{ctx.voiceSelectedFile.name}</p>
						<small>{Math.max(1, Math.round(ctx.voiceSelectedFile.size / 1024))} KB</small>
					</div>
				</div>
				<button class="selected-file-chip__clear" onclick={ctx.clearVoiceSelection} aria-label="Fjern lydfil">
					<Icon name="close" size={13} />
				</button>
			</div>
			{#if ctx.voicePreview.videoExtracting}
				<p class="flow-hint">Henter bilder fra videoen…</p>
			{:else if ctx.voicePreview.videoThumbs && ctx.voicePreview.videoThumbs.length > 0}
				<div class="frame-strip">
					{#each ctx.voicePreview.videoThumbs as url}
						<img class="frame-thumb" src={url} alt="Utsnitt fra video" />
					{/each}
				</div>
				<div class="frame-meta">
					<span class="flow-hint">Disse {ctx.voicePreview.videoThumbs.length} bildene sendes til analyse.</span>
					<button class="frame-edit" onclick={() => (pickerOpen = true)} data-track="lyd:rediger-bilder">Rediger bilder</button>
				</div>
				<label class="audio-toggle">
					<input type="checkbox" bind:checked={ctx.voicePreview.includeAudio} data-track="lyd:ta-med-lyd" />
					<span>Ta med lyd — transkriber tale <em>(laster opp hele videoen)</em></span>
				</label>
			{/if}
			<p class="flow-hint">Legg til litt kontekst hvis du vil at triagen skal forstå hva lydfilen gjelder.</p>
			<textarea
				class="flow-textarea flow-textarea--lg"
				placeholder="Hva er dette opptaket, og hva vil du ha hjelp til?"
				bind:value={ctx.voiceText}
				rows="4"
			></textarea>
			{#if ctx.voiceError}
				<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
			{/if}
			<button class="flow-submit" onclick={ctx.submitVoice} disabled={ctx.voiceUploading}>
				{#if ctx.voiceUploading}
					{ctx.voiceProgress > 0 && ctx.voiceProgress < 1
						? `Laster opp… ${Math.round(ctx.voiceProgress * 100)}%`
						: 'Transkriberer…'}
				{:else}
					Legg ved →
				{/if}
			</button>
		{/if}
	</div>
</div>

{#if pickerOpen && ctx.voiceSelectedFile}
	<VideoFramePicker file={ctx.voiceSelectedFile} preview={ctx.voicePreview} onClose={() => (pickerOpen = false)} />
{/if}

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

	.flow-hint {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.frame-strip {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 4px;
	}
	.frame-thumb {
		height: 64px;
		width: auto;
		border-radius: 8px;
		border: 1px solid var(--border-color);
		flex-shrink: 0;
		object-fit: cover;
	}
	.frame-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.frame-edit {
		background: none;
		border: none;
		color: var(--accent-light);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0;
		flex-shrink: 0;
	}
	.audio-toggle {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 0.82rem;
		color: var(--text-secondary);
		cursor: pointer;
	}
	.audio-toggle input {
		margin-top: 2px;
		accent-color: var(--accent-primary);
		flex-shrink: 0;
	}
	.audio-toggle em {
		color: var(--text-tertiary);
		font-style: normal;
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
	.flow-textarea--lg { min-height: 120px; }

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

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.selected-file-chip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		padding: 12px 14px;
	}

	.selected-file-chip__meta {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		flex: 1;
	}

	.selected-file-chip__meta p,
	.selected-file-chip__meta small {
		margin: 0;
		display: block;
	}

	.selected-file-chip__meta p {
		font-size: 0.84rem;
		font-weight: 600;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.selected-file-chip__meta small {
		font-size: 0.72rem;
		color: var(--text-tertiary);
	}

	.selected-file-chip__icon {
		color: var(--accent-light);
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.selected-file-chip__clear {
		background: transparent;
		border: none;
		color: var(--text-tertiary);
		cursor: pointer;
		padding: 0;
		width: 28px;
		height: 28px;
		border-radius: 50%;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}

	.selected-file-chip__clear:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
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

	.media-history-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.media-history-list-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 10px;
		border: 1px solid var(--border-color);
		border-radius: 6px;
		background: transparent;
		cursor: pointer;
		transition: border-color 0.15s, background 0.15s;
		text-align: left;
		font: inherit;
		color: inherit;
		width: 100%;
	}

	.media-history-list-item:hover {
		border-color: var(--accent-primary);
		background: color-mix(in srgb, var(--accent-primary) 5%, transparent);
	}

	.media-list-icon {
		font-size: 1.2rem;
		flex-shrink: 0;
	}

	.media-list-meta {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}

	.media-list-name {
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.media-list-date {
		font-size: 0.7rem;
		color: var(--text-tertiary);
	}
</style>
