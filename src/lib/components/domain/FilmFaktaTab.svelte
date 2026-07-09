<script lang="ts">
	import { filmTabsApi, type FilmTabsApi, type Film } from './film-api';

	interface Props {
		themeId: string;
		film: Film;
		onFilmUpdated: (film: Film) => void;
		onFilmDeleted: (filmId: string) => void;
		api?: FilmTabsApi;
	}

	let { themeId, film, onFilmUpdated, onFilmDeleted, api = filmTabsApi }: Props = $props();

	let saving = $state(false);
	let reviewDraft = $state(film.reviewNote ?? '');
	let confirmDelete = $state(false);

	$effect(() => {
		// Synk review-draft når filmen byttes
		reviewDraft = film.reviewNote ?? '';
	});

	async function setStatus(status: 'want_to_watch' | 'watched') {
		if (saving || film.status === status) return;
		saving = true;
		const updated = await api.updateFilm(themeId, film.id, { status });
		if (updated) onFilmUpdated(updated);
		saving = false;
	}

	async function setRating(rating: number) {
		saving = true;
		const next = film.rating === rating ? null : rating;
		const updated = await api.updateFilm(themeId, film.id, { rating: next });
		if (updated) onFilmUpdated(updated);
		saving = false;
	}

	async function saveReview() {
		saving = true;
		const updated = await api.updateFilm(themeId, film.id, { reviewNote: reviewDraft.trim() });
		if (updated) onFilmUpdated(updated);
		saving = false;
	}

	async function doDelete() {
		saving = true;
		await api.deleteFilm(themeId, film.id);
		onFilmDeleted(film.id);
	}
</script>

<div class="fl-fakta">
	<!-- Status -->
	<div class="fl-status-toggle">
		<button class="fl-status-opt" class:active={film.status === 'want_to_watch'} disabled={saving} onclick={() => setStatus('want_to_watch')}>
			🎯 Vil se
		</button>
		<button class="fl-status-opt" class:active={film.status === 'watched'} disabled={saving} onclick={() => setStatus('watched')}>
			✅ Sett
		</button>
	</div>

	<!-- Terning + setning (kun relevant når sett) -->
	{#if film.status === 'watched'}
		<div class="fl-section">
			<span class="fl-label">Terningkast</span>
			<div class="fl-dice" data-track="film-fakta:terning">
				{#each [1, 2, 3, 4, 5, 6] as n}
					<button
						class="fl-die"
						class:filled={film.rating != null && n <= film.rating}
						disabled={saving}
						aria-label="Gi terningkast {n}"
						onclick={() => setRating(n)}
					>🎬</button>
				{/each}
			</div>
		</div>

		<div class="fl-section">
			<span class="fl-label">Din setning om filmen</span>
			<textarea
				class="fl-review"
				rows="2"
				placeholder="Én setning — hva satt du igjen med?"
				bind:value={reviewDraft}
				data-track="film-fakta:setning"
			></textarea>
			<button class="fl-save-btn" disabled={saving || reviewDraft.trim() === (film.reviewNote ?? '')} onclick={saveReview}>
				Lagre setning
			</button>
		</div>
	{/if}

	<!-- Metadata -->
	{#if film.overview}
		<div class="fl-section">
			<span class="fl-label">Synopsis</span>
			<p class="fl-overview">{film.overview}</p>
		</div>
	{/if}

	{#if film.genres?.length}
		<div class="fl-section">
			<span class="fl-label">Sjangre</span>
			<div class="fl-chips">
				{#each film.genres as g}<span class="fl-chip">{g}</span>{/each}
			</div>
		</div>
	{/if}

	{#if film.cast?.length}
		<div class="fl-section">
			<span class="fl-label">Medvirkende</span>
			<div class="fl-chips">
				{#each film.cast.slice(0, 8) as c}
					<span class="fl-chip">{c.name}{#if c.character} <span class="fl-chip-sub">· {c.character}</span>{/if}</span>
				{/each}
			</div>
		</div>
	{/if}

	{#if film.watchProviders?.flatrate?.length}
		<div class="fl-section">
			<span class="fl-label">Strømmes i Norge</span>
			<div class="fl-providers">
				{#each film.watchProviders.flatrate as p}
					<span class="fl-provider">
						{#if p.logoUrl}<img src={p.logoUrl} alt="" class="fl-provider-logo" />{/if}
						{p.provider}
					</span>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Delete -->
	<div class="fl-danger">
		{#if !confirmDelete}
			<button class="fl-delete-btn" onclick={() => (confirmDelete = true)} data-track="film-fakta:slett">Fjern film</button>
		{:else}
			<span class="fl-confirm-text">Sikker?</span>
			<button class="fl-delete-btn fl-delete-confirm" disabled={saving} onclick={doDelete}>Ja, fjern</button>
			<button class="fl-cancel-btn" onclick={() => (confirmDelete = false)}>Avbryt</button>
		{/if}
	</div>
</div>

<style>
	.fl-fakta {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.fl-status-toggle {
		display: flex;
		gap: 6px;
	}
	.fl-status-opt {
		flex: 1;
		font: inherit;
		font-size: 0.85rem;
		padding: 9px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 9px;
		color: var(--film-text-secondary, #999);
		cursor: pointer;
		transition: all 0.15s;
	}
	.fl-status-opt.active {
		background: var(--film-bg-active, #2a1418);
		border-color: var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-status-opt:disabled {
		opacity: 0.6;
		cursor: default;
	}

	.fl-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.fl-label {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--film-text-tertiary, #7a6a6a);
	}

	.fl-dice {
		display: flex;
		gap: 4px;
	}
	.fl-die {
		background: none;
		border: none;
		font-size: 1.3rem;
		cursor: pointer;
		filter: grayscale(1) opacity(0.35);
		transition: filter 0.15s;
		padding: 0;
	}
	.fl-die.filled {
		filter: none;
	}
	.fl-die:disabled {
		cursor: default;
	}

	.fl-review {
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 9px;
		color: var(--film-text-primary, #eee);
		font: inherit;
		font-size: 0.88rem;
		padding: 8px 10px;
		resize: vertical;
	}

	.fl-overview {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--film-text-strong, #cbbfbf);
	}

	.fl-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}
	.fl-chip {
		font-size: 0.76rem;
		padding: 3px 9px;
		border-radius: 99px;
		background: var(--film-chip-bg, #241619);
		border: 1px solid var(--film-chip-border, #4a2a30);
		color: var(--film-chip-text, #c89890);
	}
	.fl-chip-sub {
		color: var(--film-text-tertiary, #7a6a6a);
	}

	.fl-providers {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.fl-provider {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 0.78rem;
		padding: 4px 10px 4px 4px;
		border-radius: 99px;
		background: var(--film-bg-active, #2a1418);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-provider-logo {
		width: 20px;
		height: 20px;
		border-radius: 4px;
		object-fit: cover;
	}

	.fl-save-btn {
		align-self: flex-start;
		font: inherit;
		font-size: 0.8rem;
		padding: 7px 14px;
		background: var(--film-bg-accent, #2a1420);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 8px;
		cursor: pointer;
	}
	.fl-save-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.fl-danger {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 8px;
		padding-top: 12px;
		border-top: 1px solid var(--film-border-faint, #2a1a1a);
	}
	.fl-delete-btn {
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 12px;
		background: none;
		border: 1px solid var(--film-border, #3a2226);
		color: var(--film-text-secondary, #999);
		border-radius: 8px;
		cursor: pointer;
	}
	.fl-delete-confirm {
		border-color: var(--error-text);
		color: var(--error-text);
	}
	.fl-cancel-btn {
		font: inherit;
		font-size: 0.78rem;
		padding: 6px 12px;
		background: none;
		border: none;
		color: var(--film-text-tertiary, #7a6a6a);
		cursor: pointer;
	}
	.fl-confirm-text {
		font-size: 0.8rem;
		color: var(--film-text-secondary, #999);
	}
</style>
