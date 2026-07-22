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

	interface Find {
		id: string;
		title: string;
		summary: string | null;
		domain: string | null;
		kind: string | null;
		sourceUrl: string | null;
		thumbnailUrl: string | null;
		status: string;
		mealId: string | null;
		createdAt: string;
	}

	interface Props {
		themeId: string;
		themeFiles: ThemeFile[];
		themeInstruction: string;
		finds?: Find[];
		/** Called when files list changes (upload or delete) */
		onFilesChanged?: (files: ThemeFile[]) => void;
	}

	let { themeId, themeFiles: initialFiles, themeInstruction = '', finds = [] }: Props = $props();

	let themeFiles = $state<ThemeFile[]>(initialFiles);
	let fileUploading = $state(false);
	let fileUploadError = $state('');

	/* ── Sync med parent ved prop-endring ── */
	$effect(() => {
		themeFiles = initialFiles;
	});

	/* ── Funn (lagrede lenker) ── */
	let findsState = $state<Find[]>(finds);
	$effect(() => {
		findsState = finds;
	});

	async function patchFind(id: string, status: 'kept' | 'discarded') {
		// Arkiverte forsvinner fra seksjonen; beholdte blir stående (kun badge endres).
		findsState =
			status === 'discarded'
				? findsState.filter((f) => f.id !== id)
				: findsState.map((f) => (f.id === id ? { ...f, status } : f));
		await fetch('/api/funn', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, status })
		});
	}

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

	<!-- Funn (lagrede lenker for dette domenet) -->
	{#if findsState.length > 0}
		<section class="funn-section">
			<div class="funn-head">
				<span class="funn-label">Funn</span>
				<a class="funn-all" href="/funn">Alle funn →</a>
			</div>
			<ul class="funn-list">
				{#each findsState as f (f.id)}
					<li class="funn-row">
						{#if f.thumbnailUrl}
							<a class="funn-thumb" href={f.sourceUrl ?? undefined} target="_blank" rel="noopener noreferrer">
								<img src={f.thumbnailUrl} alt="" loading="lazy" referrerpolicy="no-referrer" />
							</a>
						{/if}
						<div class="funn-body">
							<div class="funn-chips">
								{#if f.status === 'inbox'}<span class="funn-chip new">ny</span>{/if}
								{#if f.kind}<span class="funn-chip">{f.kind}</span>{/if}
								{#if f.mealId}<span class="funn-chip recipe">✓ oppskrift</span>{/if}
							</div>
							{#if f.sourceUrl}
								<a class="funn-title" href={f.sourceUrl} target="_blank" rel="noopener noreferrer">{f.title}</a>
							{:else}
								<span class="funn-title">{f.title}</span>
							{/if}
							{#if f.summary}<p class="funn-summary">{f.summary}</p>{/if}
						</div>
						<div class="funn-actions">
							{#if f.status === 'inbox'}
								<button class="funn-act keep" data-track="tema-funn:behold" onclick={() => patchFind(f.id, 'kept')}>Behold</button>
							{/if}
							<button class="funn-act archive" data-track="tema-funn:arkiver" onclick={() => patchFind(f.id, 'discarded')}>Arkiver</button>
						</div>
					</li>
				{/each}
			</ul>
		</section>
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

	/* ── Funn ── */
	.funn-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.funn-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.funn-label {
		font-size: 0.72rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #8a99c4;
	}

	.funn-all {
		font-size: 0.75rem;
		color: #7c8ef5;
		text-decoration: none;
	}
	.funn-all:hover {
		text-decoration: underline;
	}

	.funn-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.funn-row {
		display: flex;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid #242424;
		border-radius: 12px;
		background: #131313;
	}

	.funn-thumb {
		flex-shrink: 0;
		width: 56px;
		height: 56px;
		border-radius: 9px;
		overflow: hidden;
		background: #0f0f0f;
	}
	.funn-thumb img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}

	.funn-body {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
		flex: 1;
	}

	.funn-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.funn-chip {
		font-size: 0.68rem;
		padding: 1px 6px;
		border-radius: 5px;
		background: #1a1a2a;
		color: #9a9ac0;
		text-transform: capitalize;
	}
	.funn-chip.recipe {
		background: #16311f;
		color: #6ee7a8;
	}
	.funn-chip.new {
		background: #2a2410;
		color: #d8c169;
	}

	.funn-title {
		font-size: 0.86rem;
		font-weight: 600;
		color: #c4c4c4;
		text-decoration: none;
		word-break: break-word;
	}
	a.funn-title:hover {
		color: #c8c8f8;
	}

	.funn-summary {
		margin: 0;
		font-size: 0.8rem;
		color: #888;
		line-height: 1.45;
	}

	.funn-actions {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex-shrink: 0;
	}
	.funn-act {
		font-size: 0.74rem;
		padding: 3px 10px;
		border-radius: 7px;
		border: 1px solid #2a2a2a;
		background: transparent;
		color: #888;
		cursor: pointer;
		white-space: nowrap;
	}
	.funn-act.keep:hover {
		border-color: #10b981;
		color: #6ee7a8;
	}
	.funn-act.archive:hover {
		border-color: #7a5a2a;
		color: #d8b06a;
	}
</style>
