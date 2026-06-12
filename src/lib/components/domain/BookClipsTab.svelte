<script lang="ts">
	import AudioKaraokePlayer from './AudioKaraokePlayer.svelte';
	import { bookTabsApi, type BookTabsApi, type Book, type BookClip } from './book-api';

	interface Props {
		themeId: string;
		book: Book;
		api?: BookTabsApi;
	}

	let { themeId, book, api = bookTabsApi }: Props = $props();

	/* ── Clips state ──────────────────────────────────── */
	let clips = $state<BookClip[]>([]);
	let clipsLoaded = $state(false);
	let showAddClip = $state(false);
	let clipText = $state('');
	let clipPage = $state('');
	let clipPosition = $state('');
	let clipNote = $state('');
	let clipCharacters = $state('');
	let clipSaving = $state(false);
	let clipError = $state('');

	/* ── Load clips on mount / book change ────────────── */
	$effect(() => {
		// Re-load when the book changes
		const _bookId = book.id;
		clips = [];
		clipsLoaded = false;
		void loadClips();
	});

	async function loadClips() {
		try {
			const loaded = await api.getClips(themeId, book.id);
			if (loaded) clips = loaded;
		} catch { /* ignore */ }
		clipsLoaded = true;
	}

	async function addClip() {
		if (!clipText.trim()) { clipError = 'Tekst er påkrevd.'; return; }
		clipSaving = true;
		clipError = '';
		try {
			const characters = clipCharacters.trim()
				? clipCharacters.split(',').map((c) => c.trim()).filter(Boolean)
				: null;
			const clip = await api.createClip(themeId, book.id, {
				text: clipText.trim(),
				page: clipPage ? Number(clipPage) : null,
				position: clipPosition.trim() || null,
				note: clipNote.trim() || null,
				characters
			});
			if (!clip) throw new Error();
			clips = [clip, ...clips];
			clipText = '';
			clipPage = '';
			clipPosition = '';
			clipNote = '';
			clipCharacters = '';
			showAddClip = false;
		} catch {
			clipError = 'Kunne ikke lagre klippet.';
		} finally {
			clipSaving = false;
		}
	}

	async function deleteClip(clipId: string) {
		clips = clips.filter((c) => c.id !== clipId);
		await api.deleteClip(themeId, book.id, clipId);
	}

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
	}
</script>

<div class="bk-clips-panel">
	<div class="bk-clips-actions">
		<button class="bk-action-btn" onclick={() => (showAddClip = !showAddClip)}>
			{showAddClip ? '× Avbryt' : '+ Nytt klipp'}
		</button>
	</div>

	{#if showAddClip}
		<div class="bk-clip-form">
			<textarea
				class="bk-clip-textarea"
				placeholder="Passasje, setning eller moment du vil huske…"
				bind:value={clipText}
				rows={3}
			></textarea>
			<div class="bk-clip-meta-row">
				<input class="bk-clip-input" type="number" min="1" placeholder="Side" bind:value={clipPage} />
				<input class="bk-clip-input" placeholder="Tid f.eks. 1:24:35" bind:value={clipPosition} />
			</div>
			<input
				class="bk-clip-input bk-clip-input-full"
				placeholder="Karakterer, f.eks. Line, Morgan (kommasepparert)"
				bind:value={clipCharacters}
			/>
			<textarea
				class="bk-clip-textarea"
				placeholder="Din refleksjon (valgfritt)…"
				bind:value={clipNote}
				rows={2}
			></textarea>
			{#if clipError}<p class="bk-error">{clipError}</p>{/if}
			<button class="bk-save-btn" onclick={addClip} disabled={clipSaving}>
				{clipSaving ? 'Lagrer…' : 'Lagre klipp'}
			</button>
		</div>
	{/if}

	{#if !clipsLoaded}
		<p class="bk-empty">Laster…</p>
	{:else if clips.length === 0}
		<p class="bk-empty">Ingen klipp ennå — lagre passasjer og øyeblikk du vil huske.</p>
	{:else}
		<div class="bk-clips-list">
			{#each clips as clip}
				{@const hasAudio = !!clip.audioUrl}
				<div class="bk-clip-card" class:bk-clip-audio={hasAudio}>

					<!-- Audio player (self-contained, handles scrubbing + karaoke) -->
					{#if hasAudio}
						<AudioKaraokePlayer
							src={clip.audioUrl!}
							words={clip.words}
							text={clip.text}
						/>
					{:else}
						<blockquote class="bk-clip-text">{clip.text}</blockquote>
					{/if}

					<!-- Footer: position, characters, date, delete -->
					<div class="bk-clip-footer">
						{#if clip.page}<span class="bk-clip-loc">📄 Side {clip.page}</span>{/if}
						{#if clip.position}<span class="bk-clip-loc">⏱ {clip.position}</span>{/if}
						{#if clip.characters?.length}
							{#each clip.characters as char}
								<span class="bk-clip-char">{char}</span>
							{/each}
						{/if}
						<span class="bk-clip-date">{fmtDate(clip.createdAt)}</span>
						<button class="bk-clip-delete" onclick={() => deleteClip(clip.id)} aria-label="Slett klipp">×</button>
					</div>
					{#if clip.note}
						<p class="bk-clip-note">{clip.note}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.bk-clips-panel {
		padding: 12px 16px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 12px;
		flex: 1;
	}

	.bk-clips-actions {
		display: flex;
		justify-content: flex-end;
	}

	.bk-clip-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: var(--book-bg-card, #0f0f10);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
	}

	.bk-clip-textarea {
		width: 100%;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		color: var(--book-text-primary, #e8e8e8);
		font: inherit;
		font-size: 0.85rem;
		padding: 8px 10px;
		resize: vertical;
		box-sizing: border-box;
	}

	.bk-clip-meta-row {
		display: flex;
		gap: 8px;
	}

	.bk-clip-input {
		flex: 1;
		background: var(--bg-elevated);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		color: var(--book-text-primary, #e8e8e8);
		font: inherit;
		font-size: 0.82rem;
		padding: 6px 10px;
	}

	.bk-clip-input-full {
		width: 100%;
		box-sizing: border-box;
	}

	.bk-clips-list {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.bk-clip-card {
		background: var(--book-bg-card, #0f0f10);
		border: 1px solid var(--border-subtle);
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.bk-clip-text {
		margin: 0;
		font-style: italic;
		font-size: 0.88rem;
		color: #d0d0d0;
		line-height: 1.5;
		border-left: 3px solid var(--book-border-accent, #3b3e6a);
		padding-left: 10px;
	}

	.bk-clip-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}

	.bk-clip-loc {
		font-size: 0.72rem;
		color: var(--accent-light);
		background: var(--book-bg-active, #111a2a);
		padding: 2px 6px;
		border-radius: 4px;
	}

	.bk-clip-char {
		font-size: 0.7rem;
		padding: 2px 7px;
		border-radius: 99px;
		background: var(--book-chip-bg, #1a1a2a);
		border: 1px solid var(--book-chip-border, #3a3a5a);
		color: var(--book-chip-text, #9090c8);
	}

	.bk-clip-date {
		font-size: 0.7rem;
		color: var(--text-muted);
		margin-left: auto;
	}

	.bk-clip-delete {
		background: none;
		border: none;
		color: var(--text-muted);
		font-size: 1rem;
		cursor: pointer;
		padding: 0 2px;
		line-height: 1;
	}
	.bk-clip-delete:hover { color: var(--error-text); }

	.bk-clip-note {
		margin: 0;
		font-size: 0.8rem;
		color: #7a7a7a;
		padding-top: 4px;
		border-top: 1px solid var(--bg-input);
	}

	/* Audio clip card accent */
	.bk-clip-audio {
		border-color: #2a2a4a;
	}

	/* Shared */
	.bk-empty {
		color: var(--book-text-tertiary, #666);
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}

	.bk-error {
		color: var(--error-text);
		font-size: 0.8rem;
		margin: 0;
	}

	.bk-action-btn {
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 14px;
		background: var(--bg-input);
		border: 1px solid var(--border-color);
		color: var(--accent-light);
		border-radius: 99px;
		cursor: pointer;
	}
	.bk-action-btn:hover { border-color: var(--accent-light); }

	.bk-save-btn {
		font: inherit;
		font-size: 0.82rem;
		padding: 8px 16px;
		background: var(--book-bg-accent, #1e2244);
		border: 1px solid var(--book-border-accent, #3b3e6a);
		color: var(--book-accent-text, #c8ccff);
		border-radius: 8px;
		cursor: pointer;
		align-self: flex-start;
	}
	.bk-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.bk-save-btn:hover:not(:disabled) { background: var(--book-bg-accent-hover, #252b55); }
</style>
