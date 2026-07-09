<script lang="ts">
	interface Recommendation {
		tmdbId: number | null;
		title: string;
		year: number | null;
		runtime: number | null;
		posterUrl: string | null;
		fitsTime: boolean;
		availableOnMyServices: boolean;
		matchedProviders: string[];
		source: 'library' | 'list' | 'discover';
	}

	interface Props {
		themeId: string;
		onClose: () => void;
		onOpenProviders: () => void;
	}

	let { themeId, onClose, onOpenProviders }: Props = $props();

	let minutes = $state(120);
	let loading = $state(false);
	let ran = $state(false);
	let recommendations = $state<Recommendation[]>([]);
	let hasPreferences = $state(true);
	let note = $state<string | null>(null);
	let error = $state('');

	const presets = [90, 120, 150, 180];

	async function run() {
		loading = true;
		error = '';
		try {
			const res = await fetch(`/api/tema/${themeId}/films/recommend`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ minutes })
			});
			if (!res.ok) throw new Error();
			const data = await res.json();
			recommendations = data.recommendations ?? [];
			hasPreferences = data.hasPreferences ?? false;
			note = data.note ?? null;
			ran = true;
		} catch {
			error = 'Kunne ikke hente forslag.';
		} finally {
			loading = false;
		}
	}

	function sourceLabel(s: Recommendation['source']): string {
		return s === 'library' ? 'Ønskeliste' : s === 'list' ? 'Liste' : 'Forslag';
	}
</script>

<div class="fl-w2w">
	<div class="fl-w2w-head">
		<h2 class="fl-w2w-title">🍿 Hva ser jeg i kveld?</h2>
		<button class="fl-w2w-close" onclick={onClose} aria-label="Lukk">✕</button>
	</div>

	<p class="fl-w2w-sub">Hvor lang tid har du?</p>
	<div class="fl-w2w-times">
		{#each presets as p}
			<button class="fl-w2w-time" class:active={minutes === p} onclick={() => (minutes = p)}>
				{Math.floor(p / 60)}t{p % 60 ? ` ${p % 60}m` : ''}
			</button>
		{/each}
	</div>

	<button class="fl-w2w-go" disabled={loading} onclick={run} data-track="film-hva-ser-jeg:kjor">
		{loading ? 'Leter…' : 'Finn noe å se'}
	</button>

	{#if !hasPreferences && ran}
		<button class="fl-w2w-prefs-hint" onclick={onOpenProviders}>
			💡 Tips: velg strømmetjenestene dine for bedre forslag →
		</button>
	{/if}

	{#if error}<p class="fl-error">{error}</p>{/if}
	{#if note}<p class="fl-w2w-note">{note}</p>{/if}

	{#if ran && recommendations.length === 0 && !error}
		<p class="fl-empty">Fant ingen filmer som passer. Legg til noen på ønskelisten, eller prøv lengre tid.</p>
	{/if}

	{#if recommendations.length > 0}
		<div class="fl-w2w-list">
			{#each recommendations as r}
				<div class="fl-w2w-card" class:dim={!r.fitsTime}>
					{#if r.posterUrl}
						<img class="fl-w2w-poster" src={r.posterUrl} alt="" loading="lazy" />
					{:else}
						<div class="fl-w2w-poster fl-w2w-poster-ph">🎬</div>
					{/if}
					<div class="fl-w2w-info">
						<span class="fl-w2w-name">{r.title}{#if r.year} <span class="fl-w2w-year">({r.year})</span>{/if}</span>
						<span class="fl-w2w-meta">
							{#if r.runtime}{r.runtime} min{:else}ukjent lengde{/if}
							· {sourceLabel(r.source)}
						</span>
						<div class="fl-w2w-badges">
							{#if r.availableOnMyServices}
								<span class="fl-w2w-badge fl-w2w-badge-ok">📺 {r.matchedProviders.join(', ')}</span>
							{/if}
							{#if !r.fitsTime}
								<span class="fl-w2w-badge fl-w2w-badge-warn">⏱ lengre enn tiden din</span>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.fl-w2w {
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		overflow-y: auto;
		flex: 1;
	}
	.fl-w2w-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.fl-w2w-title {
		margin: 0;
		font-size: 1.05rem;
		color: var(--film-text-primary, #eee);
	}
	.fl-w2w-close {
		background: none;
		border: none;
		color: var(--film-text-secondary, #999);
		font-size: 0.9rem;
		cursor: pointer;
	}
	.fl-w2w-sub {
		margin: 4px 0 0;
		font-size: 0.85rem;
		color: var(--film-text-secondary, #999);
	}
	.fl-w2w-times {
		display: flex;
		gap: 6px;
	}
	.fl-w2w-time {
		flex: 1;
		font: inherit;
		font-size: 0.85rem;
		padding: 9px;
		background: var(--film-bg-input, #1a0f12);
		border: 1px solid var(--film-border, #3a2226);
		border-radius: 9px;
		color: var(--film-text-secondary, #999);
		cursor: pointer;
	}
	.fl-w2w-time.active {
		background: var(--film-bg-active, #2a1418);
		border-color: var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-w2w-go {
		font: inherit;
		font-size: 0.9rem;
		padding: 11px;
		background: var(--film-bg-accent, #2a1420);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
		border-radius: 10px;
		cursor: pointer;
	}
	.fl-w2w-go:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.fl-w2w-prefs-hint {
		font: inherit;
		font-size: 0.8rem;
		padding: 8px 10px;
		background: none;
		border: 1px dashed var(--film-border, #3a2226);
		border-radius: 8px;
		color: var(--film-link, #e59a6a);
		cursor: pointer;
		text-align: left;
	}
	.fl-w2w-note {
		margin: 0;
		font-size: 0.78rem;
		color: var(--film-text-tertiary, #7a6a6a);
		font-style: italic;
	}
	.fl-w2w-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.fl-w2w-card {
		display: grid;
		grid-template-columns: 46px 1fr;
		gap: 12px;
		padding: 8px;
		background: var(--film-bg-card, #160d10);
		border: 1px solid var(--film-border-faint, #2a1a1a);
		border-radius: 10px;
	}
	.fl-w2w-card.dim {
		opacity: 0.6;
	}
	.fl-w2w-poster {
		width: 46px;
		height: 69px;
		object-fit: cover;
		border-radius: 5px;
		background: var(--film-bg-chip, #221518);
	}
	.fl-w2w-poster-ph {
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 1.3rem;
	}
	.fl-w2w-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.fl-w2w-name {
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--film-text-primary, #eee);
	}
	.fl-w2w-year {
		color: var(--film-text-tertiary, #7a6a6a);
		font-weight: 400;
	}
	.fl-w2w-meta {
		font-size: 0.76rem;
		color: var(--film-text-secondary, #999);
	}
	.fl-w2w-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
	}
	.fl-w2w-badge {
		font-size: 0.7rem;
		padding: 2px 7px;
		border-radius: 99px;
	}
	.fl-w2w-badge-ok {
		background: var(--film-bg-active, #2a1418);
		border: 1px solid var(--film-border-accent, #6a3a3e);
		color: var(--film-accent-text, #ffcaa0);
	}
	.fl-w2w-badge-warn {
		background: #302816;
		color: #d8b060;
	}
	.fl-empty {
		color: var(--film-text-tertiary, #7a6a6a);
		font-size: 0.85rem;
		text-align: center;
		padding: 16px;
	}
	.fl-error {
		color: var(--error-text);
		font-size: 0.8rem;
		margin: 0;
	}
</style>
