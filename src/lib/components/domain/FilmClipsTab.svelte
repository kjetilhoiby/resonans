<script lang="ts">
	import { filmTabsApi, type FilmTabsApi, type Film, type FilmClip } from './film-api';

	interface Props {
		themeId: string;
		film: Film;
		api?: FilmTabsApi;
	}

	let { themeId, film, api = filmTabsApi }: Props = $props();

	let clips = $state<FilmClip[]>([]);
	let loaded = $state(false);
	let adding = $state(false);
	let draftText = $state('');
	let draftTimestamp = $state('');
	let draftNote = $state('');

	$effect(() => {
		if (!loaded) void load();
	});

	async function load() {
		const res = await api.getClips(themeId, film.id);
		if (res) clips = res;
		loaded = true;
	}

	async function addClip() {
		if (!draftText.trim() || adding) return;
		adding = true;
		const clip = await api.createClip(themeId, film.id, {
			text: draftText.trim(),
			timestamp: draftTimestamp.trim() || null,
			note: draftNote.trim() || null
		});
		if (clip) {
			clips = [clip, ...clips];
			draftText = '';
			draftTimestamp = '';
			draftNote = '';
		}
		adding = false;
	}

	async function removeClip(clipId: string) {
		await api.deleteClip(themeId, film.id, clipId);
		clips = clips.filter((c) => c.id !== clipId);
	}

	function fmtDate(iso: string): string {
		return new Intl.DateTimeFormat('nb-NO', { day: 'numeric', month: 'short' }).format(new Date(iso));
	}
</script>

<div class="fl-clips">
	<div class="fl-clip-form">
		<textarea
			class="fl-clip-input"
			rows="2"
			placeholder="En replikk, en scene, en tanke…"
			bind:value={draftText}
			data-track="film-klipp:tekst"
		></textarea>
		<div class="fl-clip-form-row">
			<input class="fl-clip-ts" placeholder="Tidsstempel (f.eks. 1:24:35)" bind:value={draftTimestamp} data-track="film-klipp:tidsstempel" />
			<button class="fl-clip-add" disabled={adding || !draftText.trim()} onclick={addClip}>Legg til</button>
		</div>
		<input class="fl-clip-note" placeholder="Notat (valgfritt)" bind:value={draftNote} data-track="film-klipp:notat" />
	</div>

	{#if !loaded}
		<p class="fl-empty">Laster…</p>
	{:else if clips.length === 0}
		<p class="fl-empty">Ingen klipp ennå. Lagre en favorittscene eller replikk.</p>
	{:else}
		<div class="fl-clip-list">
			{#each clips as clip}
				<div class="fl-clip">
					<div class="fl-clip-head">
						{#if clip.timestamp}<span class="fl-clip-loc">⏱ {clip.timestamp}</span>{/if}
						<span class="fl-clip-date">{fmtDate(clip.createdAt)}</span>
						<button class="fl-clip-del" aria-label="Slett klipp" onclick={() => removeClip(clip.id)}>✕</button>
					</div>
					<p class="fl-clip-text">{clip.text}</p>
					{#if clip.note}<p class="fl-clip-notetext">{clip.note}</p>{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.fl-clips {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.fl-clip-form {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fl-clip-input,
	.fl-clip-ts,
	.fl-clip-note {
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 8px;
		color: var(--film-text-primary, #eee);
		font: inherit;
		font-size: 0.85rem;
		padding: 8px 10px;
	}
	.fl-clip-input {
		resize: vertical;
	}
	.fl-clip-form-row {
		display: flex;
		gap: 6px;
	}
	.fl-clip-ts {
		flex: 1;
	}
	.fl-clip-add {
		font: inherit;
		font-size: 0.8rem;
		padding: 0 16px;
		background: var(--film-bg-accent, #2a1420);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 8px;
		cursor: pointer;
		white-space: nowrap;
	}
	.fl-clip-add:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.fl-clip-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fl-clip {
		background: var(--film-bg-card, #160d10);
		border: 1px solid var(--film-border-faint, #2a1a1a);
		border-radius: 10px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.fl-clip-head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.fl-clip-loc {
		font-size: 0.72rem;
		color: var(--film-accent-text, #ffcaa0);
		background: var(--film-bg-active, #2a1418);
		padding: 2px 6px;
		border-radius: 4px;
	}
	.fl-clip-date {
		font-size: 0.7rem;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-clip-del {
		margin-left: auto;
		background: none;
		border: none;
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.75rem;
		cursor: pointer;
	}
	.fl-clip-del:hover {
		color: #ff9999;
	}
	.fl-clip-text {
		margin: 0;
		font-size: 0.88rem;
		line-height: 1.5;
		color: var(--film-text-primary, #eee);
		white-space: pre-wrap;
	}
	.fl-clip-notetext {
		margin: 0;
		font-size: 0.8rem;
		color: var(--film-text-secondary, #999);
		font-style: italic;
	}

	.fl-empty {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 24px 16px;
	}
</style>
