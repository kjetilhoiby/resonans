<!--
  Lyd-flyt panel for HomeChatZone.
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
		<button class="flow-back" onclick={ctx.closeVoiceFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
		<span class="flow-title">Lyd</span>
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
				<button class="selected-file-chip__clear" onclick={() => {
					ctx.voiceSelectedFile = null;
					ctx.voiceError = false;
					if (ctx.voiceFileInput) ctx.voiceFileInput.value = '';
				}} aria-label="Fjern lydfil">
					<Icon name="close" size={13} />
				</button>
			</div>
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
				{ctx.voiceUploading ? 'Triagerer…' : 'Last opp og triager →'}
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

	.flow-hint {
		margin: 0;
		font-size: 0.85rem;
		color: #555;
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
	.flow-textarea--lg { min-height: 120px; }

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
		background: #161616;
		border: 1px solid #2a2a2a;
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
		color: #d5d5d5;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.selected-file-chip__meta small {
		font-size: 0.72rem;
		color: #666;
	}

	.selected-file-chip__icon {
		color: #7c8ef5;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.selected-file-chip__clear {
		background: transparent;
		border: none;
		color: #777;
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
		background: #202020;
		color: #d5d5d5;
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
		border: 1px solid #2a2a2a;
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
		border-color: #4a5af0;
		background: rgba(74, 90, 240, 0.05);
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
		color: #ddd;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.media-list-date {
		font-size: 0.7rem;
		color: #666;
	}
</style>
