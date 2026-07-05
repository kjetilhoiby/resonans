<script lang="ts">
	interface Budget {
		bandMin: number;
		bandMax: number;
		spentThisWeek: number;
		remainingMin: number;
		remainingMax: number;
		acuteChronicRatio: number | null;
		restRecommended: boolean;
		deload: boolean;
		anchor: 'forrige_uke' | 'p4w_snitt' | 'gulv';
	}

	interface Props {
		budget: Budget;
		composition: string | null;
	}

	let { budget, composition }: Props = $props();

	const scaleMax = $derived(Math.max(budget.bandMax * 1.15, budget.spentThisWeek * 1.05, 1));
	const spentPct = $derived(Math.min(100, (budget.spentThisWeek / scaleMax) * 100));
	const minPct = $derived((budget.bandMin / scaleMax) * 100);
	const maxPct = $derived((budget.bandMax / scaleMax) * 100);

	const statusText = $derived.by(() => {
		if (budget.restRecommended) return 'Høy belastning siste 3 dager — ta en rolig dag.';
		if (budget.spentThisWeek >= budget.bandMax) return 'Uka er i mål — mer nå er bonus, ikke krav.';
		if (budget.spentThisWeek >= budget.bandMin) return 'Innenfor intervallet — resten av uka er valgfri.';
		return composition ?? 'Fortsett å fylle uka.';
	});

	const anchorText = $derived(
		budget.anchor === 'forrige_uke'
			? 'basert på forrige uke'
			: budget.anchor === 'p4w_snitt'
				? 'basert på snitt siste 4 uker'
				: 'forsiktig oppstartsnivå'
	);
</script>

<section class="budget-card">
	<header>
		<div class="title-row">
			<h2>Ukas effort</h2>
			<div class="badges">
				{#if budget.deload}<span class="badge">Deload-uke</span>{/if}
				{#if budget.restRecommended}<span class="badge warn">Hvil</span>{/if}
			</div>
		</div>
		<p class="numbers">
			<span class="spent">{budget.spentThisWeek}</span>
			<span class="band">av {budget.bandMin}–{budget.bandMax}</span>
			<span class="anchor">({anchorText})</span>
		</p>
	</header>

	<div class="bar-track" role="progressbar" aria-valuenow={budget.spentThisWeek} aria-valuemin="0" aria-valuemax={budget.bandMax} aria-label="Effort denne uka mot ukesintervallet">
		<div class="band-zone" style="left: {minPct}%; width: {Math.max(0, maxPct - minPct)}%"></div>
		<div class="bar" class:over={budget.spentThisWeek > budget.bandMax} style="width: {spentPct}%"></div>
		<div class="tick" style="left: {minPct}%"></div>
		<div class="tick" style="left: {maxPct}%"></div>
	</div>

	<p class="status">{statusText}</p>
	{#if budget.acuteChronicRatio != null}
		<p class="ratio">Belastning siste 3 dager mot siste 30: {budget.acuteChronicRatio.toFixed(2).replace('.', ',')}</p>
	{/if}
</section>

<style>
	.budget-card {
		background: var(--card-bg-subtle, #141414);
		border: 1px solid var(--card-border, #242424);
		border-radius: var(--card-radius, 16px);
		padding: var(--card-padding, 16px);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	header {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.title-row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 0.75rem;
	}

	h2 {
		font-size: 1.05rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
		margin: 0;
	}

	.badges {
		display: flex;
		gap: 0.4rem;
	}

	.badge {
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--accent-light, #7c8ef5);
		background: color-mix(in srgb, var(--accent-primary, #4a5af0) 18%, transparent);
		border-radius: 999px;
		padding: 0.15rem 0.6rem;
		white-space: nowrap;
	}

	.badge.warn {
		color: #fbbf24;
		background: rgba(251, 191, 36, 0.15);
	}

	.numbers {
		margin: 0;
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.spent {
		font-size: 2rem;
		font-weight: 700;
		color: var(--text-primary, #eee);
		line-height: 1;
	}

	.band {
		font-size: 0.95rem;
		color: var(--text-secondary, #aaa);
	}

	.anchor {
		font-size: 0.75rem;
		color: var(--text-tertiary, #777);
	}

	.bar-track {
		position: relative;
		height: 10px;
		border-radius: 999px;
		background: var(--card-bg-inset, #0d0d0d);
		overflow: hidden;
	}

	.band-zone {
		position: absolute;
		top: 0;
		bottom: 0;
		background: color-mix(in srgb, var(--accent-primary, #4a5af0) 22%, transparent);
	}

	.bar {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		border-radius: 999px;
		background: var(--accent-primary, #4a5af0);
		transition: width 0.4s ease;
	}

	.bar.over {
		background: #fbbf24;
	}

	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: color-mix(in srgb, var(--text-primary, #eee) 40%, transparent);
	}

	.status {
		margin: 0;
		font-size: 0.88rem;
		color: var(--text-primary, #eee);
		line-height: 1.45;
	}

	.ratio {
		margin: 0;
		font-size: 0.75rem;
		color: var(--text-tertiary, #777);
	}
</style>
