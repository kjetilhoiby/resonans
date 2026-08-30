<script lang="ts">
	import type { PageData } from './$types';
	import { enhance } from '$app/forms';
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';

	let { data }: { data: PageData } = $props();

	const hidden = $derived(data.hidden.filter((h) => h.scope === 'activity'));
	const rejectedSources = $derived(data.hidden.filter((h) => h.scope === 'source'));

	const SPORT_LABELS: Record<string, string> = {
		running: 'Løping',
		cycling: 'Sykling',
		walking: 'Gåtur',
		swimming: 'Svømming',
		workout: 'Økt'
	};

	function sportLabel(h: { sportType: string | null; sportFamily: string }): string {
		if (h.sportType === 'e_bike') return 'Elsykkeltur';
		return SPORT_LABELS[h.sportFamily] ?? h.sportFamily;
	}

	function formatStart(iso: string): string {
		return new Date(iso).toLocaleString('nb-NO', {
			weekday: 'short',
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatDuration(seconds: number | null): string | null {
		if (seconds === null || seconds <= 0) return null;
		const total = Math.round(seconds / 60);
		if (total < 60) return `${total} min`;
		const hours = Math.floor(total / 60);
		const minutes = total % 60;
		return minutes === 0 ? `${hours} t` : `${hours} t ${minutes} min`;
	}

	function details(h: PageData['hidden'][number]): string {
		const parts: string[] = [];
		if (h.distanceMeters !== null) parts.push(`${(h.distanceMeters / 1000).toFixed(2)} km`);
		const duration = formatDuration(h.durationSeconds);
		if (duration) parts.push(duration);
		if (h.providers.length > 0) parts.push(h.providers.join(', '));
		return parts.join(' · ');
	}

	// «Svartelistet» er den sperren som overlever synken. Den skilles fra det rene
	// radflagget fordi de betyr ulike ting for om økta kan komme tilbake.
	function holdLabel(holds: string[]): string {
		if (holds.includes('suppression')) return 'Svartelistet';
		return 'Skjult';
	}
</script>

<svelte:head>
	<title>Skjulte økter – Innstillinger | Resonans</title>
</svelte:head>

<AppPage>
	<PageSection>
		<PageHeader title="Skjulte økter" titleHref="/settings" />

		<p class="lead">
			Økter du har skjult fra aktivitetslista. De er ikke slettet — de vises bare ikke, og teller
			ikke i form, belastning eller løpemål. Du kan hente dem tilbake her.
		</p>

		{#if data.hidden.length === 0}
			<p class="empty">Ingen skjulte økter.</p>
		{:else}
			{#if hidden.length > 0}
				<section>
					<h2>Skjulte økter</h2>
					<p class="muted">
						<strong>Svartelistet</strong> betyr at økta ikke kan komme tilbake, heller ikke om kilden
						sender den på nytt. <strong>Skjult</strong> gjelder bare denne registreringen — den ble
						skjult før svartelisten fantes.
					</p>
					<ul class="liste">
						{#each hidden as item (item.id)}
							<li>
								<div class="rad">
									<div class="info">
										<div class="tittel">
											{sportLabel(item)}
											<span class="merke" class:sterk={item.holds.includes('suppression')}>
												{holdLabel(item.holds)}
											</span>
										</div>
										<div class="tid">{formatStart(item.startTime)}</div>
										{#if details(item)}
											<div class="detaljer">{details(item)}</div>
										{/if}
									</div>
									<form method="POST" action="?/restore" use:enhance>
										<input type="hidden" name="id" value={item.id} />
										<input type="hidden" name="scope" value="activity" />
										<button type="submit" class="primary" data-track="skjulte-okter:gjenopprett">
											Gjenopprett
										</button>
									</form>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}

			{#if rejectedSources.length > 0}
				<section>
					<h2>Avviste kilder</h2>
					<p class="muted">
						Her har du avvist én registrering av en økt — selve økta vises fortsatt, men uten tallene
						fra denne kilden.
					</p>
					<ul class="liste">
						{#each rejectedSources as item (item.id)}
							<li>
								<div class="rad">
									<div class="info">
										<div class="tittel">{sportLabel(item)}</div>
										<div class="tid">{formatStart(item.startTime)}</div>
										{#if details(item)}
											<div class="detaljer">{details(item)}</div>
										{/if}
									</div>
									<form method="POST" action="?/restore" use:enhance>
										<input type="hidden" name="id" value={item.id} />
										<input type="hidden" name="scope" value="source" />
										<button type="submit" class="ghost" data-track="skjulte-okter:gjenopprett-kilde">
											Ta i bruk igjen
										</button>
									</form>
								</div>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	</PageSection>
</AppPage>

<style>
	.lead {
		color: var(--text-secondary);
		margin: 0 0 1.25rem;
		line-height: 1.5;
	}
	h2 {
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
		margin: 1.75rem 0 0.6rem;
	}
	.empty {
		color: var(--text-tertiary);
		font-style: italic;
	}
	.muted {
		color: var(--text-tertiary);
		font-size: 0.85rem;
		margin: 0 0 0.75rem;
		line-height: 1.5;
	}
	.muted strong {
		color: var(--text-secondary);
		font-weight: 600;
	}
	.liste {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.rad {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: var(--bg-card);
		border: 1px solid var(--border-subtle);
		border-radius: 12px;
		padding: 0.85rem 1rem;
	}
	.info {
		min-width: 0;
	}
	.tittel {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
		color: var(--text-primary);
		font-weight: 500;
	}
	.merke {
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
		font-weight: 500;
	}
	.merke.sterk {
		color: var(--warning-text);
		border-color: var(--warning-border);
		background: var(--warning-bg);
	}
	.tid {
		color: var(--text-secondary);
		font-size: 0.85rem;
		margin-top: 0.2rem;
	}
	.detaljer {
		color: var(--text-tertiary);
		font-size: 0.8rem;
		margin-top: 0.15rem;
	}
	.primary,
	.ghost {
		flex-shrink: 0;
		border-radius: 8px;
		padding: 0.45rem 0.85rem;
		font-size: 0.85rem;
		cursor: pointer;
		font-family: inherit;
	}
	.primary {
		background: var(--accent-primary);
		color: #fff;
		border: 0;
	}
	.primary:hover {
		background: var(--accent-hover);
	}
	.ghost {
		background: transparent;
		color: var(--text-secondary);
		border: 1px solid var(--border-color);
	}
	.ghost:hover {
		background: var(--bg-hover);
	}
</style>
