<script lang="ts">
	interface DisciplineSlice {
		family: string;
		effort: number;
		sessions: number;
		pct: number;
	}

	interface Balance {
		disciplines: DisciplineSlice[];
		totalEffort: number;
		strengthSessionsThisWeek: number;
		runSessionsThisWeek: number;
		intensity: { rolig: number; moderat: number; hard: number } | null;
		score: number;
		nudge: { kind: string; message: string; severity: 'info' | 'low' | 'medium' } | null;
	}

	interface Props {
		balance: Balance;
	}

	let { balance }: Props = $props();

	const familyColors: Record<string, string> = {
		running: '#f59e0b',
		cycling: '#10b981',
		ebike: '#6ee7b7',
		strength: '#a78bfa',
		swimming: '#38bdf8',
		walking: '#94a3b8',
		hiking: '#84cc16',
		yoga: '#f472b6',
		football: '#fb7185',
		other: '#cbd5e1'
	};
	const familyLabels: Record<string, string> = {
		running: 'Løp',
		cycling: 'Sykkel',
		ebike: 'El-sykkel',
		strength: 'Styrke',
		swimming: 'Svømming',
		walking: 'Gange',
		hiking: 'Tur',
		yoga: 'Yoga',
		football: 'Fotball',
		other: 'Annet'
	};

	const color = (family: string) => familyColors[family] ?? '#94a3b8';
	const label = (family: string) => familyLabels[family] ?? family;

	// Stablet miks-stolpe: hver disiplin som andel av samlet effort.
	const segments = $derived.by(() => {
		let cursor = 0;
		return balance.disciplines.map((d) => {
			const left = cursor;
			cursor += d.pct;
			return { ...d, left, width: d.pct };
		});
	});

	const scoreLabel = $derived(
		balance.score >= 70 ? 'God balanse' : balance.score >= 45 ? 'Grei balanse' : 'Ensidig'
	);
</script>

<section class="balance-card">
	<header>
		<div class="title-row">
			<h2>Balanse</h2>
			{#if balance.totalEffort > 0}
				<span class="score" title="Sammensatt balanse-score (diversitet, styrke-dekning, intensitetsspredning)">
					{balance.score}<span class="score-unit">/100</span>
				</span>
			{/if}
		</div>
		{#if balance.totalEffort > 0}
			<p class="subtitle">{scoreLabel} · siste 4 uker</p>
		{/if}
	</header>

	{#if balance.totalEffort === 0}
		<p class="empty">Ingen registrert trening de siste fire ukene ennå.</p>
	{:else}
		<div class="mix-track" role="img" aria-label="Fordeling av innsats mellom disipliner siste fire uker">
			{#each segments as seg (seg.family)}
				<div
					class="mix-seg"
					style="left: {seg.left}%; width: {Math.max(1, seg.width)}%; background: {color(seg.family)}"
					title="{label(seg.family)}: {seg.pct} % ({seg.sessions} økter)"
				></div>
			{/each}
		</div>
		<ul class="legend">
			{#each balance.disciplines as d (d.family)}
				<li>
					<span class="dot" style="background: {color(d.family)}"></span>
					<span>{label(d.family)} {d.pct} %</span>
				</li>
			{/each}
		</ul>

		{#if balance.intensity}
			<div class="intensity">
				<span class="int-label">Løpsintensitet</span>
				<div class="int-bars">
					<span class="int rolig" style="width: {balance.intensity.rolig}%" title="Rolig {balance.intensity.rolig} %"></span>
					<span class="int moderat" style="width: {balance.intensity.moderat}%" title="Moderat {balance.intensity.moderat} %"></span>
					<span class="int hard" style="width: {balance.intensity.hard}%" title="Hardt {balance.intensity.hard} %"></span>
				</div>
				<span class="int-legend">Rolig {balance.intensity.rolig} · Moderat {balance.intensity.moderat} · Hardt {balance.intensity.hard}</span>
			</div>
		{/if}
	{/if}

	{#if balance.nudge}
		<p class="nudge" class:medium={balance.nudge.severity === 'medium'}>{balance.nudge.message}</p>
	{:else if balance.totalEffort > 0}
		<p class="status">Fin variasjon denne perioden — fortsett å blande disipliner og intensitet.</p>
	{/if}
</section>

<style>
	.balance-card {
		background: var(--surface-raised, rgba(255, 255, 255, 0.04));
		border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
		border-radius: var(--radius-lg, 16px);
		padding: 1rem 1.1rem 1.15rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.title-row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}
	h2 {
		font-size: 1rem;
		font-weight: 600;
		margin: 0;
		color: var(--text-primary, #f8fafc);
	}
	.score {
		font-size: 1.15rem;
		font-weight: 700;
		color: var(--text-primary, #f8fafc);
	}
	.score-unit {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-muted, #94a3b8);
	}
	.subtitle {
		margin: 0;
		font-size: 0.8rem;
		color: var(--text-muted, #94a3b8);
	}

	.mix-track {
		position: relative;
		height: 12px;
		border-radius: 6px;
		background: var(--surface-sunken, rgba(0, 0, 0, 0.25));
		overflow: hidden;
	}
	.mix-seg {
		position: absolute;
		top: 0;
		bottom: 0;
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem 0.9rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #cbd5e1);
	}
	.legend li {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		display: inline-block;
	}

	.intensity {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}
	.int-label {
		font-size: 0.78rem;
		color: var(--text-muted, #94a3b8);
	}
	.int-bars {
		display: flex;
		height: 8px;
		border-radius: 4px;
		overflow: hidden;
		background: var(--surface-sunken, rgba(0, 0, 0, 0.25));
	}
	.int {
		height: 100%;
	}
	.int.rolig {
		background: #38bdf8;
	}
	.int.moderat {
		background: #f59e0b;
	}
	.int.hard {
		background: #ef4444;
	}
	.int-legend {
		font-size: 0.72rem;
		color: var(--text-muted, #94a3b8);
	}

	.nudge {
		margin: 0;
		font-size: 0.85rem;
		line-height: 1.4;
		color: var(--text-secondary, #cbd5e1);
		border-left: 3px solid var(--accent, #f59e0b);
		padding-left: 0.6rem;
	}
	.nudge.medium {
		border-left-color: #ef4444;
	}
	.status,
	.empty {
		margin: 0;
		font-size: 0.85rem;
		color: var(--text-muted, #94a3b8);
	}
</style>
