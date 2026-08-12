<script lang="ts">
	/**
	 * Månedsgjennomgangen: de fire spørsmålene, i rekkefølgen brukeren valgte.
	 *
	 * Står ØVERST på lønnsrapporten, før veiviseren. Han skal kunne lese svarene uten å gå
	 * gjennom stegene — veiviseren er for å snakke om dem, ikke for å finne dem. Se
	 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 6.
	 *
	 * **Hvert svar viser sin egen begrunnelse.** «Vet ikke» skrives som «vet ikke», ikke som
	 * «nei» — og «ingenting å gjøre noe med» er et gyldig svar på spørsmål 4.
	 */
	import type { MonthReview, GoalProgressItem } from '$lib/types/salary-report';

	interface Props {
		review: MonthReview;
		goalProgress: GoalProgressItem[];
	}

	let { review, goalProgress }: Props = $props();

	function formatNOK(amount: number): string {
		return new Intl.NumberFormat('nb-NO', {
			style: 'currency',
			currency: 'NOK',
			maximumFractionDigits: 0
		}).format(amount);
	}

	const carriesLabel = $derived.by(() => {
		if (review.monthAhead.carries === null) return 'Vet ikke';
		return review.monthAhead.carries ? 'Ja' : 'Nei';
	});
	const carriesTone = $derived.by(() => {
		if (review.monthAhead.carries === null) return 'neutral';
		return review.monthAhead.carries ? 'good' : 'warn';
	});

	// Bare målbare tak, og bare de som faktisk ble brutt. Et «mål» uten tallverdi kan ikke
	// gjøres opp, og å liste det som uavklart ville gjort spørsmål 3 til støy.
	const measurable = $derived(
		goalProgress.filter((item) => item.type === 'track' && item.targetValue > 0)
	);
	const broken = $derived(measurable.filter((item) => !item.achieved));
</script>

<div class="mr">
	<!-- 1 -->
	<section class="mr-q">
		<header>
			<span class="mr-num">1</span>
			<h3>Bærer måneden som kommer?</h3>
			<span class="mr-verdict {carriesTone}">{carriesLabel}</span>
		</header>
		<p class="mr-reason">{review.monthAhead.reason}</p>
	</section>

	<!-- 2 -->
	<section class="mr-q">
		<header>
			<span class="mr-num">2</span>
			<h3>Hva var uvanlig?</h3>
		</header>
		{#if review.unusual.length === 0}
			<p class="mr-reason mr-muted">
				Ingen kategori skiller seg fra sin egen normal. Terskelen er kategoriens egen
				variasjon, ikke en fast prosent — så stabile kategorier slår ut på mindre enn de
				svingende.
			</p>
		{:else}
			<ul class="mr-list">
				{#each review.unusual.slice(0, 4) as row (row.category)}
					<li>
						<span class="mr-row-head">
							{row.emoji}
							{row.label}
							<span class="mr-delta {row.direction === 'over' ? 'warn' : 'good'}">
								{row.direction === 'over' ? '↑' : '↓'} {formatNOK(Math.abs(row.delta))}
							</span>
						</span>
						<span class="mr-row-reason">{row.reason}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- 3 -->
	<section class="mr-q">
		<header>
			<span class="mr-num">3</span>
			<h3>Gikk vi over noe vi hadde avtalt?</h3>
			{#if measurable.length > 0}
				<span class="mr-verdict {broken.length === 0 ? 'good' : 'warn'}">
					{broken.length === 0 ? 'Nei' : `${broken.length} over`}
				</span>
			{/if}
		</header>
		{#if measurable.length === 0}
			<p class="mr-reason mr-muted">
				Ingen målbare tak satt. Et tak kan settes i chatten — «sett et tak på 2 000 kr/mnd
				på kafé».
			</p>
		{:else}
			<ul class="mr-list">
				{#each measurable as item (item.label)}
					<li>
						<span class="mr-row-head">
							{item.label}
							<span class="mr-delta {item.achieved ? 'good' : 'warn'}">
								{formatNOK(item.actualValue)} av {formatNOK(item.targetValue)}
							</span>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- 4 -->
	<section class="mr-q">
		<header>
			<span class="mr-num">4</span>
			<h3>Én ting å gjøre noe med</h3>
		</header>
		{#if review.oneThing.action}
			<p class="mr-reason">{review.oneThing.action.text}</p>
		{:else}
			<!-- «Ingenting» er et gyldig svar. Et råd som alltid kommer slutter å bety noe. -->
			<p class="mr-reason mr-muted">{review.oneThing.reason}</p>
		{/if}
	</section>
</div>

<style>
	.mr {
		display: flex;
		flex-direction: column;
		gap: 0.9rem;
		margin-bottom: 1.5rem;
	}

	.mr-q {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.07);
		border-radius: 12px;
		padding: 0.85rem 0.95rem;
	}

	.mr-q header {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		margin-bottom: 0.35rem;
	}

	.mr-num {
		flex: none;
		width: 1.35rem;
		height: 1.35rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.09);
		display: grid;
		place-items: center;
		font-size: 0.74rem;
		color: var(--text-secondary);
	}

	.mr-q h3 {
		margin: 0;
		font-size: 0.95rem;
		flex: 1;
	}

	.mr-verdict {
		font-size: 0.78rem;
		padding: 0.14rem 0.5rem;
		border-radius: 999px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: var(--text-secondary);
		white-space: nowrap;
	}
	.mr-verdict.warn,
	.mr-delta.warn {
		color: #fca5a5;
		border-color: rgba(252, 165, 165, 0.35);
	}
	.mr-verdict.good,
	.mr-delta.good {
		color: #86efac;
		border-color: rgba(134, 239, 172, 0.35);
	}

	.mr-reason {
		margin: 0;
		font-size: 0.86rem;
		line-height: 1.5;
	}
	.mr-muted {
		color: var(--text-secondary);
	}

	.mr-list {
		list-style: none;
		margin: 0.35rem 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.mr-list li {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
	}
	.mr-row-head {
		display: flex;
		align-items: baseline;
		gap: 0.4rem;
		font-size: 0.88rem;
	}
	.mr-delta {
		margin-left: auto;
		font-variant-numeric: tabular-nums;
		font-size: 0.8rem;
		white-space: nowrap;
	}
	.mr-row-reason {
		font-size: 0.78rem;
		color: var(--text-secondary);
	}
</style>
