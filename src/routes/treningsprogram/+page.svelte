<script lang="ts">
	import { AppPage, PageHeader, PageSection } from '$lib/components/ui';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function fmtPace(secPerKm?: number): string {
		if (secPerKm == null) return '–';
		const m = Math.floor(secPerKm / 60);
		const s = Math.round(secPerKm - m * 60);
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	function statusLabel(s: string): string {
		return (
			{
				active: 'Aktivt',
				paused: 'Pauset',
				completed: 'Fullført',
				archived: 'Arkivert'
			}[s] ?? s
		);
	}

	function statusColor(s: string): string {
		return (
			{
				active: 'var(--accent-primary)',
				paused: 'var(--text-secondary)',
				completed: 'var(--text-secondary)',
				archived: 'var(--text-tertiary)'
			}[s] ?? 'var(--text-secondary)'
		);
	}

	const active = $derived(data.programs.filter((p) => p.status === 'active'));
	const inactive = $derived(data.programs.filter((p) => p.status !== 'active'));
</script>

<AppPage>
	<PageSection>
	<PageHeader title="Treningsprogram" subtitle="Hybride programmer — styrke + løping" titleHref="/">
		{#snippet actions()}
			<IconButton href="/treningsprogram/ny" icon="plus" variant="nav" ariaLabel="Lag nytt program" />
		{/snippet}
	</PageHeader>

	{#if data.snapshot}
		<section class="snapshot-card">
			<header class="snapshot-head">
				<h2>Hva vi vet om deg</h2>
				<span class="quality-badge" data-quality={data.snapshot.dataQuality}>
					{#if data.snapshot.dataQuality === 'rich'}
						Rik data
					{:else if data.snapshot.dataQuality === 'thin'}
						Tynt grunnlag
					{:else}
						Ingen data
					{/if}
				</span>
			</header>
			<dl class="snapshot-grid">
				<div>
					<dt>Volum (siste 4 uker)</dt>
					<dd>{data.snapshot.recentVolumeKm} km/uke</dd>
				</div>
				<div>
					<dt>Økter/uke</dt>
					<dd>{data.snapshot.recentSessionsPerWeek}</dd>
				</div>
				{#if data.snapshot.vdotEstimate}
					<div>
						<dt>VDOT</dt>
						<dd>{data.snapshot.vdotEstimate}</dd>
					</div>
				{/if}
				{#if data.snapshot.paceZones?.easySecPerKm}
					<div>
						<dt>Easy</dt>
						<dd>{fmtPace(data.snapshot.paceZones.easySecPerKm)}/km</dd>
					</div>
				{/if}
				{#if data.snapshot.paceZones?.tempoSecPerKm}
					<div>
						<dt>Tempo</dt>
						<dd>{fmtPace(data.snapshot.paceZones.tempoSecPerKm)}/km</dd>
					</div>
				{/if}
				{#if data.snapshot.paceZones?.intervalSecPerKm}
					<div>
						<dt>Intervall</dt>
						<dd>{fmtPace(data.snapshot.paceZones.intervalSecPerKm)}/km</dd>
					</div>
				{/if}
			</dl>
			{#if data.snapshot.bestEfforts && Object.keys(data.snapshot.bestEfforts).length > 0}
				<div class="best-efforts">
					<span class="be-label">PR-er siste 90 dager:</span>
					{#each Object.entries(data.snapshot.bestEfforts) as [dist, seconds]}
						{#if typeof seconds === 'number'}
							<span class="be-pill">{dist} {fmtPace(seconds)}</span>
						{/if}
					{/each}
				</div>
			{/if}
		</section>
	{/if}

	{#if data.programs.length === 0}
		<section class="empty">
			<h2>Ingen programmer ennå</h2>
			<p>
				Lag et hybridprogram skreddersydd til din nåværende form. Vi bygger på faktiske
				PR-er fra GPS-løpene dine og styrketestene du har gjort.
			</p>
			<a class="cta" href="/treningsprogram/ny">Lag program</a>
		</section>
	{:else}
		{#if active.length > 0}
			<section>
				<h2 class="section-title">Aktive</h2>
				<div class="program-list">
					{#each active as p (p.id)}
						<a class="program-card" href="/treningsprogram/{p.id}">
							<header class="pc-head">
								<h3>{p.name}</h3>
								<span class="pc-status" style="color: {statusColor(p.status)}">
									{statusLabel(p.status)}
								</span>
							</header>
							<p class="pc-goal">{p.goal}</p>
							<div class="pc-meta">
								<span>{p.durationWeeks} uker</span>
								<span>{p.sessionsPerWeek} økter/uke</span>
								<span>
									{p.completedSessions} / {p.totalSessions} fullført
								</span>
							</div>
							<div class="pc-progress">
								<div
									class="pc-progress-fill"
									style="width: {p.totalSessions > 0
										? (p.completedSessions / p.totalSessions) * 100
										: 0}%"
								></div>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}

		{#if inactive.length > 0}
			<section>
				<h2 class="section-title">Tidligere</h2>
				<div class="program-list">
					{#each inactive as p (p.id)}
						<a class="program-card" href="/treningsprogram/{p.id}">
							<header class="pc-head">
								<h3>{p.name}</h3>
								<span class="pc-status" style="color: {statusColor(p.status)}">
									{statusLabel(p.status)}
								</span>
							</header>
							<p class="pc-goal">{p.goal}</p>
							<div class="pc-meta">
								<span>{p.durationWeeks} uker</span>
								<span>
									{p.completedSessions} / {p.totalSessions} fullført
								</span>
							</div>
						</a>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
	</PageSection>
</AppPage>

<style>
	.snapshot-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 16px;
		padding: 20px;
		margin-bottom: 24px;
	}
	.snapshot-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}
	.snapshot-head h2 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.quality-badge {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 999px;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
	}
	.quality-badge[data-quality='rich'] {
		background: color-mix(in oklab, var(--accent-primary) 20%, transparent);
		color: var(--accent-primary);
	}
	.quality-badge[data-quality='none'] {
		background: var(--bg-tertiary);
		color: var(--text-tertiary);
	}
	.snapshot-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
		gap: 16px;
		margin: 0;
	}
	.snapshot-grid div {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.snapshot-grid dt {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-tertiary);
	}
	.snapshot-grid dd {
		margin: 0;
		font-size: 18px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.best-efforts {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		align-items: center;
		margin-top: 16px;
		padding-top: 16px;
		border-top: 1px solid var(--border-subtle);
	}
	.be-label {
		font-size: 12px;
		color: var(--text-tertiary);
	}
	.be-pill {
		font-size: 13px;
		padding: 3px 10px;
		border-radius: 999px;
		background: var(--bg-tertiary);
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}

	.section-title {
		font-size: 13px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-tertiary);
		margin: 24px 0 12px;
	}

	.empty {
		text-align: center;
		padding: 48px 24px;
		background: var(--bg-secondary);
		border-radius: 16px;
		border: 1px solid var(--border-subtle);
	}
	.empty h2 {
		margin: 0 0 8px;
		font-size: 18px;
		color: var(--text-primary);
	}
	.empty p {
		margin: 0 auto 24px;
		max-width: 360px;
		color: var(--text-secondary);
	}
	.cta {
		display: inline-block;
		padding: 12px 24px;
		border-radius: 999px;
		background: var(--accent-primary);
		color: var(--bg-primary);
		font-weight: 600;
		text-decoration: none;
	}

	.program-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.program-card {
		display: block;
		background: var(--bg-secondary);
		border: 1px solid var(--border-subtle);
		border-radius: 14px;
		padding: 16px;
		text-decoration: none;
		color: inherit;
		transition: border-color 120ms ease, transform 120ms ease;
	}
	.program-card:hover {
		border-color: var(--accent-primary);
		transform: translateY(-1px);
	}
	.pc-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-bottom: 4px;
	}
	.pc-head h3 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
		color: var(--text-primary);
	}
	.pc-status {
		font-size: 12px;
		font-weight: 500;
	}
	.pc-goal {
		margin: 0 0 12px;
		color: var(--text-secondary);
		font-size: 14px;
	}
	.pc-meta {
		display: flex;
		gap: 14px;
		font-size: 13px;
		color: var(--text-tertiary);
		margin-bottom: 8px;
	}
	.pc-progress {
		height: 4px;
		background: var(--bg-tertiary);
		border-radius: 2px;
		overflow: hidden;
	}
	.pc-progress-fill {
		height: 100%;
		background: var(--accent-primary);
		transition: width 300ms ease;
	}
</style>
