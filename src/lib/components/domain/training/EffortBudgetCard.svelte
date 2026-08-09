<script lang="ts">
	import {
		describeAcuteChronic,
		describeAnchor,
		describeBudgetStanding
	} from '$lib/domain/health/effort-standing';

	interface Budget {
		bandMin: number;
		bandMax: number;
		spentThisWeek: number;
		remainingMin: number;
		remainingMax: number;
		acuteChronicRatio: number | null;
		restRecommended: boolean;
		deload: boolean;
		anchor: 'snitt_uker' | 'gulv';
		anchorWeeks?: number;
		maintenance?: boolean;
	}

	interface SessionSlice {
		date: string;
		family: string;
		effort: number;
	}

	interface PlanExample {
		label: string;
		effort: number;
		pctOfBand: number;
	}

	interface Projection {
		expectedRemaining: number;
		projectedTotal: number;
		remainingDays: number;
	}

	interface Props {
		budget: Budget;
		composition: string | null;
		sessions?: SessionSlice[];
		planExamples?: PlanExample[];
		/** Vekt-nøytral-linja fra effort/vekt-modellen (kan ligge utenfor båndet). */
		weightThreshold?: { thresholdEffort: number; source: string } | null;
		projection?: Projection | null;
		boost?: PlanExample | null;
		/** Konkret øktoppskrift som tetter gjenstående effort. */
		weekRecipe?: { label: string; totalEffort: number; sessions: string[] } | null;
	}

	let {
		budget,
		composition,
		sessions = [],
		planExamples = [],
		weightThreshold = null,
		projection = null,
		boost = null,
		weekRecipe = null
	}: Props = $props();

	const familyColors: Record<string, string> = {
		running: '#f59e0b',
		cycling: '#10b981',
		ebike: '#6ee7b7'
	};
	const familyLabels: Record<string, string> = {
		running: 'Løp',
		cycling: 'Sykkel',
		ebike: 'El-sykkel'
	};

	const scaleMax = $derived(
		Math.max(
			budget.bandMax * 1.15,
			budget.spentThisWeek * 1.05,
			(weightThreshold?.thresholdEffort ?? 0) * 1.08,
			projection?.projectedTotal ?? 0,
			1
		)
	);
	const minPct = $derived((budget.bandMin / scaleMax) * 100);
	const maxPct = $derived((budget.bandMax / scaleMax) * 100);
	const thresholdPct = $derived(
		weightThreshold ? (weightThreshold.thresholdEffort / scaleMax) * 100 : null
	);
	const projectionPct = $derived(
		projection && projection.remainingDays > 0 ? (projection.projectedTotal / scaleMax) * 100 : null
	);

	// Stablede segmenter: hver registrert økt som andel av skalaen
	const segments = $derived.by(() => {
		let cursor = 0;
		return sessions.map((s) => {
			const left = (cursor / scaleMax) * 100;
			const width = (s.effort / scaleMax) * 100;
			cursor += s.effort;
			return { ...s, left, width };
		});
	});

	// To linjer, med vilje. Budsjettet sier om uka følger planen; belastningen er
	// det eneste restitusjonssignalet, og det eneste som får varselfarge. Ordene
	// deles med chatten — se $lib/domain/health/effort-standing.
	const plan = $derived(
		describeBudgetStanding(budget.spentThisWeek, budget.bandMin, budget.bandMax)
	);
	const load = $derived(describeAcuteChronic(budget.acuteChronicRatio, budget.restRecommended));

	// «Fortsett å fylle uka» hjelper ingen når vi kan foreslå noe konkret.
	const planText = $derived(plan.standing === 'under' ? (composition ?? plan.text) : plan.text);

	const anchorText = $derived(describeAnchor(budget.anchor, budget.anchorWeeks ?? 0));

	// Prognose-setning: se tidlig i uka om den ligger an til å havne i grøfta
	const projectionText = $derived.by(() => {
		if (!projection || projection.remainingDays === 0) return null;
		const p = projection.projectedTotal;
		const base = `Prognose for uka: ~${p} (du pleier å gjøre ~${projection.expectedRemaining} til).`;

		const belowThreshold = weightThreshold != null && p < weightThreshold.thresholdEffort;
		const belowBand = p < budget.bandMin;
		if (!belowThreshold && !belowBand) {
			return `${base} Innenfor båndet${weightThreshold ? ' og over vekt-linja' : ''} — ligger bra an.`;
		}
		const problem = belowThreshold && belowBand
			? `under både båndet og vekt-linja (${weightThreshold!.thresholdEffort})`
			: belowThreshold
				? `under vekt-linja (${weightThreshold!.thresholdEffort})`
				: `under båndet (${budget.bandMin})`;
		const boostText = boost ? ` ${boost.label} (+${boost.effort}) løfter deg til ~${p + boost.effort}.` : '';
		return `${base} Det er ${problem}.${boostText}`;
	});

	const showPlanner = $derived(planExamples.length > 0 && budget.remainingMax > 0 && !budget.restRecommended);
</script>

<section class="budget-card">
	<header>
		<div class="title-row">
			<h2>Ukas effort</h2>
			<div class="badges">
				{#if budget.maintenance}<span class="badge">Ferie · vedlikehold</span>{/if}
				{#if budget.deload}<span class="badge">Deload-uke</span>{/if}
				<!-- Merket gjelder BELASTNING, ikke budsjettet. «Over ukas plan» skal
				     ikke se ut som et helsevarsel — den står i plan-linja under. -->
				{#if load?.level === 'høy'}<span class="badge warn">{load.label}</span>{/if}
			</div>
		</div>
		<p class="numbers">
			<span class="spent">{budget.spentThisWeek}</span>
			<span class="band">av {budget.bandMin}–{budget.bandMax}</span>
			<span class="anchor">({anchorText})</span>
		</p>
	</header>

	<div class="bar-track" role="progressbar" aria-valuenow={budget.spentThisWeek} aria-valuemin="0" aria-valuemax={budget.bandMax} aria-label="Effort denne uka mot ukesintervallet, stablet per økt">
		<div class="band-zone" style="left: {minPct}%; width: {Math.max(0, maxPct - minPct)}%"></div>
		{#each segments as seg, i (seg.date + i)}
			<div
				class="segment"
				style="left: {seg.left}%; width: {Math.max(0.5, seg.width)}%; background: {familyColors[seg.family] ?? '#94a3b8'}"
				title="{familyLabels[seg.family] ?? seg.family} {seg.date}: {seg.effort} effort"
			></div>
		{/each}
		<div class="tick" style="left: {minPct}%"></div>
		<div class="tick" style="left: {maxPct}%"></div>
		{#if projectionPct != null}
			<div class="projection-tick" style="left: {Math.min(99, projectionPct)}%" title="Prognose for uka: ~{projection?.projectedTotal}"></div>
		{/if}
		{#if thresholdPct != null && weightThreshold}
			<div class="weight-tick" style="left: {Math.min(99, thresholdPct)}%" title="Vekt-nøytral-linja: ~{weightThreshold.thresholdEffort} — over dette støtter uka vektnedgang"></div>
		{/if}
	</div>
	{#if weightThreshold}
		<p class="scale-hint">
			Sonen = trygg trening (nok mot regresjon, ikke mer enn restitusjonen tåler) · <span class="weight-hint">gul strek</span> = vekt-nøytral (~{weightThreshold.thresholdEffort})
		</p>
	{/if}

	{#if segments.length > 0}
		<ul class="legend">
			{#each segments as seg, i (seg.date + i)}
				<li>
					<span class="dot" style="background: {familyColors[seg.family] ?? '#94a3b8'}"></span>
					<span>{familyLabels[seg.family] ?? seg.family} {seg.effort}</span>
				</li>
			{/each}
		</ul>
	{/if}

	<dl class="verdicts">
		<dt>Plan</dt>
		<dd class="status">{planText}</dd>
		{#if load}
			<dt>Belastning</dt>
			<dd class="status" class:warn={load.level === 'høy'}>{load.text}</dd>
		{/if}
	</dl>
	{#if projectionText}
		<p class="projection">{projectionText}</p>
	{/if}

	{#if showPlanner}
		<section class="planner">
			<h3>Sånn blir uka — hva typiske økter gir</h3>
			{#if weekRecipe}
				<p class="recipe">
					For å nå ukas mål: <strong>{weekRecipe.label}</strong> (~{weekRecipe.totalEffort})
				</p>
			{/if}
			<ul>
				{#each planExamples as ex (ex.label)}
					<li>
						<span class="planner-label">{ex.label}</span>
						<span class="planner-value">{ex.effort} effort · {ex.pctOfBand} % av uka</span>
					</li>
				{/each}
			</ul>
		</section>
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
		height: 12px;
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

	.segment {
		position: absolute;
		top: 1px;
		bottom: 1px;
	}

	.tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: color-mix(in srgb, var(--text-primary, #eee) 40%, transparent);
	}

	.weight-tick {
		position: absolute;
		top: -2px;
		bottom: -2px;
		width: 2px;
		background: #fbbf24;
	}

	.projection-tick {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: #38bdf8;
		opacity: 0.8;
	}

	.scale-hint {
		margin: 0;
		font-size: 0.72rem;
		color: var(--text-tertiary, #777);
		line-height: 1.4;
	}

	.weight-hint {
		color: #fbbf24;
	}

	.projection {
		margin: 0;
		font-size: 0.82rem;
		color: #38bdf8;
		line-height: 1.45;
	}

	.legend {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem 0.9rem;
	}

	.legend li {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 0.75rem;
		color: var(--text-secondary, #aaa);
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 999px;
		flex-shrink: 0;
	}

	/* To dommer, tydelig adskilt: etiketten foran gjør at «over ukas plan» ikke
	   kan leses som en påstand om restitusjon. */
	.verdicts {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.3rem 0.6rem;
		align-items: baseline;
	}

	.verdicts dt {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary, #777);
		white-space: nowrap;
	}

	.verdicts dd {
		margin: 0;
	}

	.status {
		font-size: 0.88rem;
		color: var(--text-primary, #eee);
		line-height: 1.45;
	}

	.status.warn {
		color: #fbbf24;
	}

	.planner {
		border-top: 1px solid var(--card-border, #242424);
		padding-top: 0.65rem;
	}

	.planner h3 {
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-tertiary, #777);
		margin: 0 0 0.4rem;
	}

	.planner ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.planner li {
		display: flex;
		justify-content: space-between;
		gap: 0.75rem;
		font-size: 0.8rem;
	}

	.planner-label {
		color: var(--text-secondary, #aaa);
	}

	.planner-value {
		color: var(--text-primary, #eee);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.recipe {
		margin: 0 0 0.5rem;
		font-size: 0.85rem;
		color: var(--text-primary, #eee);
		line-height: 1.45;
	}

	.recipe strong {
		color: var(--accent-light, #7c8ef5);
		font-weight: 650;
	}
</style>
