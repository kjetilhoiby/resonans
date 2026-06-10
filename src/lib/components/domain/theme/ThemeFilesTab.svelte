<!--
  ThemeFilesTab — Filer-fanen i ThemePage.
  Viser instruksjonsfil, opplastede filer, og filopplasting.
-->
<script lang="ts">
	interface ThemeFile {
		id: string;
		name: string;
		url: string;
		fileType: string | null;
		mimeType: string | null;
		sizeBytes: number | null;
		createdAt: string;
	}

	interface Props {
		themeId: string;
		themeFiles: ThemeFile[];
		themeInstruction: string;
		/** Called when files list changes (upload or delete) */
		onFilesChanged?: (files: ThemeFile[]) => void;
	}

	let { themeId, themeFiles: initialFiles, themeInstruction = '' }: Props = $props();

	let themeFiles = $state<ThemeFile[]>(initialFiles);
	let fileUploading = $state(false);
	let fileUploadError = $state('');

	/* ── Sync med parent ved prop-endring ── */
	$effect(() => {
		themeFiles = initialFiles;
	});

	/* ── Instruksjon ── */
	const instructionFileName = 'instrukser';
	let instructionDraft = $state(themeInstruction ?? '');
	let instructionSaving = $state(false);
	let instructionSaved = $state(false);
	let instructionError = $state('');

	$effect(() => {
		instructionDraft = themeInstruction ?? '';
	});

	async function saveInstruction() {
		instructionSaving = true;
		instructionSaved = false;
		instructionError = '';

		try {
			const res = await fetch(`/api/tema/${themeId}/instruction`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: instructionDraft })
			});

			if (!res.ok) throw new Error('Lagring feilet');

			instructionSaved = true;
			setTimeout(() => {
				instructionSaved = false;
			}, 1400);
		} catch {
			instructionError = 'Lagring feilet. Prøv igjen.';
		} finally {
			instructionSaving = false;
		}
	}

	/* ── Filopplasting ── */
	async function uploadFile(event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fileUploading = true;
		fileUploadError = '';
		try {
			const fd = new FormData();
			fd.append('file', file);
			const res = await fetch(`/api/tema/${themeId}/files`, { method: 'POST', body: fd });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err.error ?? 'Upload feilet');
			}
			const saved: ThemeFile = await res.json();
			themeFiles = [...themeFiles, saved];
		} catch (err) {
			fileUploadError = err instanceof Error ? err.message : 'Opplasting feilet.';
		} finally {
			fileUploading = false;
			input.value = '';
		}
	}

	async function deleteFile(fileId: string) {
		themeFiles = themeFiles.filter((f) => f.id !== fileId);
		await fetch(`/api/tema/${themeId}/files/${fileId}`, { method: 'DELETE' });
	}

	/* ── Hjelpefunksjoner ── */
	function formatBytes(bytes: number | null): string {
		if (!bytes) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function fileIcon(type: string | null): string {
		if (type === 'image') return '🖼';
		if (type === 'pdf') return '📋';
		return '📄';
	}
</script>

<div class="files-panel">
	<div class="files-header">
		<span class="files-count">{1 + themeFiles.length} {1 + themeFiles.length === 1 ? 'fil' : 'filer'}</span>
		<label class="files-upload-btn" aria-label="Last opp fil">
			{fileUploading ? 'Laster opp…' : '+ Legg til fil'}
			<input
				type="file"
				accept="image/*,application/pdf,.txt,.md,.csv"
				disabled={fileUploading}
				class="files-upload-input"
				onchange={uploadFile}
			/>
		</label>
	</div>

	{#if fileUploadError}
		<p class="file-upload-error">{fileUploadError}</p>
	{/if}

	<!-- Instruksjonsfil -->
	<div class="instruction-file">
		<div class="instruction-file-head">
			<span class="instruction-file-icon">📄</span>
			<span class="instruction-file-name">{instructionFileName}</span>
			<button class="files-save-btn" onclick={saveInstruction} disabled={instructionSaving} aria-label="Lagre instruksfil">
				{instructionSaving ? 'Lagrer…' : 'Lagre'}
			</button>
		</div>

		<textarea
			class="instruction-editor"
			bind:value={instructionDraft}
			rows="14"
			placeholder="# Instrukser

Skriv hvordan du vil jobbe med dette temaet.

Eksempel:
- Hvor ser jeg meg om fem år?
- Hva er viktigst nå?
- Hvilke mål må justeres?"
		></textarea>

		<div class="instruction-foot">
			{#if instructionError}
				<span class="instruction-error">{instructionError}</span>
			{:else if instructionSaved}
				<span class="instruction-saved">Lagret</span>
			{:else if !instructionDraft.trim()}
				<span class="instruction-empty">Tom fil klar for utfylling</span>
			{:else}
				<span class="instruction-empty">Redigerbar instruksfil for temaet</span>
			{/if}
		</div>
	</div>

	<!-- Opplastede filer -->
	{#if themeFiles.length > 0}
		<ul class="uploaded-files-list">
			{#each themeFiles as uf (uf.id)}
				<li class="uploaded-file-row">
					<span class="uploaded-file-icon">{fileIcon(uf.fileType)}</span>
					<a class="uploaded-file-name" href={uf.url} target="_blank" rel="noopener noreferrer">{uf.name}</a>
					{#if uf.sizeBytes}
						<span class="uploaded-file-size">{formatBytes(uf.sizeBytes)}</span>
					{/if}
					<button class="uploaded-file-delete" onclick={() => deleteFile(uf.id)} aria-label="Slett {uf.name}">🗑</button>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.files-panel {
		padding: 16px var(--page-px);
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.files-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}

	.files-count {
		font-size: 0.75rem;
		color: #444;
	}

	.files-upload-btn {
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #666;
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 14px;
		border-radius: 99px;
		cursor: pointer;
	}

	.files-upload-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.files-upload-input {
		display: none;
	}

	.file-upload-error {
		margin: 0;
		padding: 8px 12px;
		border-radius: 10px;
		background: #1f1010;
		border: 1px solid #3a1a1a;
		color: #ee8c8c;
		font-size: 0.82rem;
	}

	.instruction-file {
		border: 1px solid #242424;
		border-radius: 14px;
		background: #131313;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.instruction-file-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.instruction-file-icon {
		font-size: 0.98rem;
		opacity: 0.7;
	}

	.instruction-file-name {
		font-size: 0.86rem;
		font-weight: 600;
		color: #aaa;
	}

	.instruction-editor {
		width: 100%;
		border-radius: 12px;
		border: 1px solid #2a2a2a;
		background: #0f0f0f;
		color: #d4d4d4;
		font: inherit;
		font-size: 0.95rem;
		line-height: 1.5;
		padding: 12px;
		resize: vertical;
		min-height: 180px;
	}

	.instruction-editor:focus {
		outline: none;
		border-color: #3c4f9f;
	}

	.instruction-foot {
		font-size: 0.8rem;
	}

	.instruction-saved {
		color: #74cf9e;
	}

	.instruction-error {
		color: #ee8c8c;
	}

	.instruction-empty {
		color: #777;
	}

	.files-save-btn {
		margin-left: auto;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #888;
		font: inherit;
		font-size: 0.78rem;
		padding: 4px 12px;
		border-radius: 99px;
		cursor: pointer;
	}

	.files-save-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.uploaded-files-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.uploaded-file-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid #242424;
		border-radius: 12px;
		background: #131313;
	}

	.uploaded-file-icon {
		font-size: 1rem;
		opacity: 0.8;
		flex-shrink: 0;
	}

	.uploaded-file-name {
		flex: 1;
		font-size: 0.86rem;
		font-weight: 600;
		color: #aaa;
		text-decoration: none;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.uploaded-file-name:hover {
		color: #c8c8f8;
	}

	.uploaded-file-size {
		font-size: 0.78rem;
		color: #555;
		flex-shrink: 0;
	}

	.uploaded-file-delete {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 0.9rem;
		opacity: 0.5;
		padding: 2px 4px;
		border-radius: 6px;
		flex-shrink: 0;
		transition: opacity 0.12s;
	}

	.uploaded-file-delete:hover {
		opacity: 1;
	}
</style>
