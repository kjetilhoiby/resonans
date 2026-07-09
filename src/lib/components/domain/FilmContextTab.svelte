<script lang="ts">
	import { filmTabsApi, type FilmTabsApi, type Film } from './film-api';

	interface Props {
		themeId: string;
		film: Film;
		onRefresh: (filmId: string) => void;
		api?: FilmTabsApi;
	}

	let { themeId, film, onRefresh, api = filmTabsApi }: Props = $props();

	let refreshing = $state(false);

	const pack = $derived(film.contextPack ?? {});
	const progress = $derived(film.contextProgress?.progress ?? null);

	async function refresh() {
		if (refreshing) return;
		refreshing = true;
		const res = await api.refreshContext(themeId, film.id);
		if (res.ok) onRefresh(film.id);
		refreshing = false;
	}
</script>

<div class="fl-ctx">
	{#if film.contextStatus === 'pending'}
		<div class="fl-ctx-progress">
			<span class="fl-spinner" aria-hidden="true"></span>
			<div class="fl-ctx-progress-body">
				<p class="fl-ctx-progress-label">{progress?.label ?? 'Samler kontekst…'}</p>
				{#if progress}
					<div class="fl-ctx-bar">
						<div class="fl-ctx-fill" style="width:{Math.round((progress.stepIndex / progress.totalSteps) * 100)}%"></div>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if pack.directorContext?.bio || pack.directorContext?.howFilmFits}
		<section class="fl-ctx-sec">
			<h3 class="fl-ctx-h">Regissøren{pack.directorContext.name ? ` · ${pack.directorContext.name}` : ''}</h3>
			{#if pack.directorContext.bio}<p class="fl-ctx-p">{pack.directorContext.bio}</p>{/if}
			{#if pack.directorContext.howFilmFits}<p class="fl-ctx-p fl-ctx-muted">{pack.directorContext.howFilmFits}</p>{/if}
		</section>
	{/if}

	{#if pack.filmographySequence}
		<section class="fl-ctx-sec">
			<h3 class="fl-ctx-h">I regissørskapet</h3>
			<div class="fl-filmo">
				{#each pack.filmographySequence.before as w}
					<span class="fl-filmo-item">{w.title}{#if w.year} ({w.year}){/if}</span>
				{/each}
				<span class="fl-filmo-item fl-filmo-current">▸ {pack.filmographySequence.currentFilm.title}</span>
				{#each pack.filmographySequence.after as w}
					<span class="fl-filmo-item">{w.title}{#if w.year} ({w.year}){/if}</span>
				{/each}
			</div>
		</section>
	{/if}

	{#if pack.criticReviews?.length}
		<section class="fl-ctx-sec">
			<h3 class="fl-ctx-h">Kritikken</h3>
			{#each pack.criticReviews as r}
				<div class="fl-review-card">
					<div class="fl-review-src">
						<span class="fl-review-name">{r.source}</span>
						{#if r.verdict}<span class="fl-verdict fl-verdict-{r.verdict}">{r.verdict === 'positive' ? 'Positiv' : r.verdict === 'negative' ? 'Negativ' : 'Delt'}</span>{/if}
					</div>
					<p class="fl-review-quote">«{r.quote}»</p>
					<a class="fl-review-link" href={r.url} target="_blank" rel="noopener">Les anmeldelsen ↗</a>
				</div>
			{/each}
		</section>
	{/if}

	{#if pack.reception?.critics || pack.reception?.audience}
		<section class="fl-ctx-sec">
			<h3 class="fl-ctx-h">Mottakelse</h3>
			{#if pack.reception.critics}<p class="fl-ctx-p">{pack.reception.critics}</p>{/if}
			{#if pack.reception.audience}<p class="fl-ctx-p fl-ctx-muted">{pack.reception.audience}</p>{/if}
		</section>
	{/if}

	{#if pack.letterboxd?.averageRating !== undefined}
		<section class="fl-ctx-sec">
			<h3 class="fl-ctx-h">Letterboxd</h3>
			<p class="fl-ctx-p">{pack.letterboxd.averageRating?.toFixed(2)}/5{#if pack.letterboxd.ratingsCount} · {pack.letterboxd.ratingsCount.toLocaleString('nb-NO')} vurderinger{/if}</p>
			{#if pack.letterboxd.url}<a class="fl-review-link" href={pack.letterboxd.url} target="_blank" rel="noopener">Åpne på Letterboxd ↗</a>{/if}
		</section>
	{/if}

	{#if pack.whereToWatch?.flatrate?.length || pack.whereToWatch?.rent?.length}
		<section class="fl-ctx-sec">
			<h3 class="fl-ctx-h">Hvor du kan se den (Norge)</h3>
			{#if pack.whereToWatch.flatrate?.length}
				<p class="fl-ctx-p"><strong>Strømming:</strong> {pack.whereToWatch.flatrate.map((p) => p.provider).join(', ')}</p>
			{/if}
			{#if pack.whereToWatch.rent?.length}
				<p class="fl-ctx-p fl-ctx-muted"><strong>Leie:</strong> {pack.whereToWatch.rent.map((p) => p.provider).join(', ')}</p>
			{/if}
		</section>
	{/if}

	{#if film.contextStatus !== 'pending' && !pack.directorContext && !pack.criticReviews?.length}
		<p class="fl-empty">Ingen kontekst samlet ennå.</p>
	{/if}

	<button class="fl-refresh-btn" disabled={refreshing || film.contextStatus === 'pending'} onclick={refresh}>
		{refreshing ? 'Starter…' : '↻ Oppdater kontekst'}
	</button>
</div>

<style>
	.fl-ctx {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.fl-ctx-progress {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		background: var(--film-bg-active, #2a1418);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		border-radius: 10px;
	}
	.fl-ctx-progress-body {
		flex: 1;
	}
	.fl-ctx-progress-label {
		margin: 0 0 6px;
		font-size: 0.82rem;
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-ctx-bar {
		height: 3px;
		background: var(--film-bg-input, #1a0f12);
		border-radius: 99px;
		overflow: hidden;
	}
	.fl-ctx-fill {
		height: 100%;
		background: var(--film-accent-strong, #e08a5a);
		transition: width 0.3s;
	}

	.fl-ctx-sec {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.fl-ctx-h {
		margin: 0;
		font-size: 0.74rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--film-text-tertiary, #7a6a6a);
	}
	.fl-ctx-p {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
		color: var(--film-text-strong, #cbbfbf);
	}
	.fl-ctx-muted {
		color: var(--film-text-secondary, #999);
		font-size: 0.82rem;
	}

	.fl-filmo {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.fl-filmo-item {
		font-size: 0.82rem;
		color: var(--film-text-secondary, #999);
	}
	.fl-filmo-current {
		color: var(--film-accent-text, #ffcaa0);
		font-weight: 600;
	}

	.fl-review-card {
		background: var(--film-bg-card, #160d10);
		border: 1px solid var(--film-border-faint, #2a1a1a);
		border-radius: 10px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.fl-review-src {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.fl-review-name {
		font-size: 0.82rem;
		font-weight: 600;
		color: var(--film-text-primary, #eee);
	}
	.fl-verdict {
		font-size: 0.68rem;
		padding: 1px 7px;
		border-radius: 99px;
	}
	.fl-verdict-positive {
		background: #16301c;
		color: #7ec87e;
	}
	.fl-verdict-negative {
		background: #301616;
		color: #d88;
	}
	.fl-verdict-mixed {
		background: #302816;
		color: #d8b060;
	}
	.fl-review-quote {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.5;
		color: var(--film-text-strong, #cbbfbf);
		font-style: italic;
	}
	.fl-review-link {
		font-size: 0.76rem;
		color: var(--film-link, #e59a6a);
		text-decoration: none;
	}
	.fl-review-link:hover {
		text-decoration: underline;
	}

	.fl-refresh-btn {
		align-self: flex-start;
		font: inherit;
		font-size: 0.78rem;
		padding: 7px 14px;
		background: none;
		border: 1px solid var(--film-border, #3a2226);
		color: var(--film-text-secondary, #999);
		border-radius: 8px;
		cursor: pointer;
	}
	.fl-refresh-btn:disabled {
		opacity: 0.5;
		cursor: default;
	}

	.fl-empty {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 12px;
	}

	.fl-spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(224, 138, 90, 0.25);
		border-top-color: var(--film-accent-strong, #e08a5a);
		border-radius: 50%;
		animation: fl-spin 0.7s linear infinite;
		flex-shrink: 0;
	}
	@keyframes fl-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
