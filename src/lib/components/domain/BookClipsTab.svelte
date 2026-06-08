<script lang="ts">
	import AudioKaraokePlayer from './AudioKaraokePlayer.svelte';

	interface Book {
		id: string;
		title: string;
		author: string | null;
		coverUrl: string | null;
		totalPages: number | null;
		currentPage: number;
		format: 'print' | 'audio' | 'both';
		totalMinutes: number | null;
		currentMinutes: number;
		status: 'not_started' | 'reading' | 'completed' | 'paused';
		conversationId: string | null;
		contextStatus: 'none' | 'pending' | 'partial' | 'ready';
		contextPack: Record<string, unknown> | null;
		startedAt: string | null;
		finishedAt: string | null;
		loanDueDate: string | null;
		loanStartDate: string | null;
		createdAt: string;
	}

	interface WordTimestamp {
		word: string;
		start: number;
		end: number;
	}

	interface BookClip {
		id: string;
		bookId: string;
		text: string;
		page: number | null;
		position: string | null;
		note: string | null;
		source: string | null;
		audioUrl: string | null;
		words: WordTimestamp[] | null;
		characters: string[] | null;
		createdAt: string;
	}

	interface Props {
		themeId: string;
		book: Book;
	}

	let { themeId, book }: Props = $props();

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
			const res = await fetch(`/api/tema/${themeId}/books/${book.id}/clips`);
			if (res.ok) clips = await res.json();
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
			const res = await fetch(`/api/tema/${themeId}/books/${book.id}/clips`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text: clipText.trim(),
					page: clipPage ? Number(clipPage) : null,
					position: clipPosition.trim() || null,
					note: clipNote.trim() || null,
					characters
				})
			});
			if (!res.ok) throw new Error();
			const clip: BookClip = await res.json();
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
		await fetch(`/api/tema/${themeId}/books/${book.id}/clips/${clipId}`, { method: 'DELETE' });
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
		background: #0f0f10;
		border: 1px solid #1e1e1e;
		border-radius: 10px;
	}

	.bk-clip-textarea {
		width: 100%;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
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
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		color: #e8e8e8;
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
		background: #0f0f10;
		border: 1px solid #1e1e1e;
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
		border-left: 3px solid #3b3e6a;
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
		color: #7c8ef5;
		background: #111a2a;
		padding: 2px 6px;
		border-radius: 4px;
	}

	.bk-clip-char {
		font-size: 0.7rem;
		padding: 2px 7px;
		border-radius: 99px;
		background: #1a1a2a;
		border: 1px solid #3a3a5a;
		color: #9090c8;
	}

	.bk-clip-date {
		font-size: 0.7rem;
		color: #555;
		margin-left: auto;
	}

	.bk-clip-delete {
		background: none;
		border: none;
		color: #555;
		font-size: 1rem;
		cursor: pointer;
		padding: 0 2px;
		line-height: 1;
	}
	.bk-clip-delete:hover { color: #e07070; }

	.bk-clip-note {
		margin: 0;
		font-size: 0.8rem;
		color: #7a7a7a;
		padding-top: 4px;
		border-top: 1px solid #1a1a1a;
	}

	/* Audio clip card accent */
	.bk-clip-audio {
		border-color: #2a2a4a;
	}

	/* Shared */
	.bk-empty {
		color: #666;
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}

	.bk-error {
		color: #e07070;
		font-size: 0.8rem;
		margin: 0;
	}

	.bk-action-btn {
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 14px;
		background: #1a1a1a;
		border: 1px solid #2a2a2a;
		color: #7c8ef5;
		border-radius: 99px;
		cursor: pointer;
	}
	.bk-action-btn:hover { border-color: #7c8ef5; }

	.bk-save-btn {
		font: inherit;
		font-size: 0.82rem;
		padding: 8px 16px;
		background: #1e2244;
		border: 1px solid #3b3e6a;
		color: #c8ccff;
		border-radius: 8px;
		cursor: pointer;
		align-self: flex-start;
	}
	.bk-save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.bk-save-btn:hover:not(:disabled) { background: #252b55; }
</style>
