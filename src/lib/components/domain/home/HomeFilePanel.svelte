<!--
  Fil-flyt panel for HomeChatZone.
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
		<button class="flow-back" onclick={ctx.closeFileFlow} aria-label="Tilbake"><Icon name="back" size={18} /></button>
		<span class="flow-title">Fil</span>
	</div>
	<input
		type="file"
		accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,text/*"
		style="display:none"
		bind:this={ctx.fileFlowInput}
		onchange={ctx.handleFileFlowSelect}
	/>
	<div class="flow-body">
		{#if ctx.fileFlowMode === 'sheet'}
			<p class="flow-hint">Legg inn lenke eller spreadsheetId for å hente et snapshot av regnearket.</p>
			<input
				type="text"
				class="flow-input"
				placeholder="Google Sheet URL eller spreadsheetId"
				bind:value={ctx.sheetFlowUrl}
			/>
			<input
				type="text"
				class="flow-input"
				placeholder="Range (valgfritt), f.eks. Sheet1!A1:F120"
				bind:value={ctx.sheetFlowRange}
			/>
			<textarea
				class="flow-textarea"
				placeholder="Hva vil du bruke dette regnearket til? (valgfritt)"
				bind:value={ctx.fileFlowNote}
				rows="3"
			></textarea>
			{#if ctx.sheetFlowError}
				<p class="flow-error">{ctx.sheetFlowError}</p>
			{/if}
			<div class="flow-inline-actions">
				<button class="flow-ghost" onclick={() => (ctx.fileFlowMode = 'local')} disabled={ctx.sheetFlowUploading}>
					Bruk lokal fil i stedet
				</button>
				<button class="flow-submit" onclick={ctx.submitSheetSnapshot} disabled={ctx.sheetFlowUploading}>
					{ctx.sheetFlowUploading ? 'Henter…' : 'Hent og triager →'}
				</button>
			</div>
		{:else if !ctx.fileFlowSelected}
			<button class="upload-zone" onclick={() => ctx.fileFlowInput?.click()}>
				<span class="upload-zone-icon"><Icon name="file" size={28} /></span>
				<p class="upload-zone-label">Velg fil</p>
				<p class="upload-zone-sub">PDF · Word · Excel · Tekst</p>
			</button>
			{#if ctx.fileHistory.length > 0}
				<div class="media-history">
					<p class="media-history-label">Tidligere filer</p>
					<div class="media-history-list">
						{#each ctx.fileHistory as item}
							<button
								class="media-history-list-item"
								onclick={() => ctx.reuseFileMedia(item)}
								title={item.name}
								aria-label={`Gjenbruk: ${item.name}`}
							>
								<span class="media-list-icon">📄</span>
								<div class="media-list-meta">
									<span class="media-list-name">{item.name}</span>
									<span class="media-list-date">{new Date(item.createdAt).toLocaleDateString('nb-NO')}</span>
								</div>
							</button>
						{/each}
					</div>
				</div>
			{:else if ctx.fileHistoryLoading}
				<p class="media-history-loading">Laster tidligere filer…</p>
			{/if}
			<button class="flow-ghost" onclick={() => (ctx.fileFlowMode = 'sheet')}>
				Eller bruk Google Sheet snapshot
			</button>
		{:else}
			<div class="file-chip">
				<span class="file-chip-icon"><Icon name="file" size={18} /></span>
				<span class="file-chip-name">{ctx.fileFlowSelected.name}</span>
				<button class="preview-clear" onclick={() => ctx.fileFlowSelected = null} aria-label="Fjern fil"><Icon name="close" size={13} /></button>
			</div>
			<textarea
				class="flow-textarea"
				placeholder="Hva vil du gjøre med denne filen? (valgfritt)"
				bind:value={ctx.fileFlowNote}
				rows="2"
			></textarea>
			{#if ctx.fileFlowError}
				<p class="flow-error">Noe gikk galt. Prøv igjen.</p>
			{/if}
			<button class="flow-submit" onclick={ctx.submitFile} disabled={ctx.fileFlowUploading}>
				{ctx.fileFlowUploading ? 'Triagerer…' : 'Last opp og triager →'}
			</button>
			<button class="flow-ghost" onclick={() => {
				ctx.fileFlowSelected = null;
				ctx.fileFlowMode = 'sheet';
			}} disabled={ctx.fileFlowUploading}>
				Bruk Google Sheet snapshot i stedet
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

	.flow-input {
		width: 100%;
		background: #111;
		border: 1px solid #242424;
		border-radius: 12px;
		padding: 11px 12px;
		color: #ddd;
		font: inherit;
		font-size: 0.85rem;
		transition: border-color 0.15s;
	}
	.flow-input:focus {
		outline: none;
		border-color: #3a3a3a;
	}
	.flow-input::placeholder { color: #3a3a3a; }

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

	.flow-inline-actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.flow-ghost {
		width: 100%;
		background: #151515;
		border: 1px solid #2c2c2c;
		border-radius: 12px;
		padding: 11px 12px;
		color: #aaa;
		font-size: 0.82rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s;
	}
	.flow-ghost:hover:not(:disabled) {
		background: #1a1a1a;
		border-color: #3a3a3a;
	}
	.flow-ghost:disabled {
		opacity: 0.5;
		cursor: default;
	}

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

	.file-chip {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 12px;
		padding: 12px 14px;
	}

	.file-chip-icon {
		color: #7c8ef5;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.file-chip-name {
		flex: 1;
		font-size: 0.85rem;
		color: #ccc;
		word-break: break-all;
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
