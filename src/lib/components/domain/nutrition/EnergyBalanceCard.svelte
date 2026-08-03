<!--
  EnergyBalanceCard — spist mot forbrent, og kroppssammensetningen.

  Loggeren måler inntaket; Withings' totalcalories (hvileforbrenning + aktivitet)
  er den andre siden. Uten begge kunne flaten bare vise «2 100 kcal spist», som
  ikke svarer på spørsmålet man har.

  Kortet er eksplisitt om at dagen ikke er omme. Har du ikke spist middag ennå, er
  «underskudd» meningsløst — og et tall som ser ut som en konklusjon midt på dagen
  er verre enn ingen tall.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import { weeklyWeightTrend, type EnergyBalance } from '$lib/domain/nutrition/energy-balance';
	import type { BodyComposition, CompositionChange } from '$lib/domain/health/body-composition';
	import type { ExpenditureBreakdown } from '$lib/domain/nutrition/expenditure-breakdown';
	import type { RealityCheck } from '$lib/domain/nutrition/weight-reality-check';
	import type { DailyExpenditureEstimate } from '$lib/domain/health/energy-expenditure';

	interface Props {
		balance: EnergyBalance | null;
		composition: BodyComposition | null;
		compositionChange: CompositionChange | null;
		compositionDate: string | null;
		/** Hva «forbrent» består av. Null når Withings ikke har levert dagen. */
		expenditure?: ExpenditureBreakdown | null;
		/** Vekta målt mot regnestykket. Null før det er nok å regne på. */
		realityCheck?: RealityCheck | null;
		/** Vårt eget estimat, uavhengig av Withings. Null uten kroppsprofil. */
		ownExpenditure?: DailyExpenditureEstimate | null;
		/** Hva som mangler for å kunne regne selv. */
		ownExpenditureMissing?: string[];
	}

	let {
		balance,
		composition,
		compositionChange,
		compositionDate,
		expenditure = null,
		realityCheck = null,
		ownExpenditure = null,
		ownExpenditureMissing = []
	}: Props = $props();

	/** Hvor langt fra hverandre de to estimatene ligger. */
	const gapKcal = $derived(
		ownExpenditure && balance ? ownExpenditure.totalKcal - balance.expenditureKcal : null
	);

	function nb(value: number, decimals = 0): string {
		return value.toFixed(decimals).replace('.', ',');
	}

	const trend = $derived(balance ? weeklyWeightTrend(balance.balanceKcal) : null);

	const dateLabel = $derived.by(() => {
		if (!compositionDate) return '';
		const date = new Date(compositionDate);
		if (Number.isNaN(date.getTime())) return '';
		return new Intl.DateTimeFormat('nb-NO', {
			day: 'numeric',
			month: 'short',
			timeZone: 'Europe/Oslo'
		}).format(date);
	});

	const hasComposition = $derived(
		composition !== null && (composition.fatMassKg !== null || composition.muscleMassKg !== null)
	);
</script>

{#if balance || hasComposition}
	<section class="balance">
		<SectionLabel tag="h2">Energi og kropp</SectionLabel>

		{#if balance}
			<div class="card">
				<div class="row">
					<span class="label">Spist</span>
					<span class="value">{balance.intakeKcal.toLocaleString('nb-NO')} kcal</span>
				</div>
				<div class="row">
					<span class="label">Forbrent</span>
					<span class="value">{balance.expenditureKcal.toLocaleString('nb-NO')} kcal</span>
				</div>
				{#if expenditure && expenditure.basalKcal !== null && expenditure.activityKcal !== null}
					<p class="breakdown">
						Hvile ~{expenditure.basalKcal.toLocaleString('nb-NO')} + aktivitet
						{expenditure.activityKcal.toLocaleString('nb-NO')}
						{#if expenditure.workoutKcal !== null}
							· økter {expenditure.workoutKcal.toLocaleString('nb-NO')}
						{/if}
					</p>
				{/if}

				{#if ownExpenditure}
					<p class="breakdown">
						Vårt eget anslag: {ownExpenditure.totalKcal.toLocaleString('nb-NO')} kcal
						(hvile {ownExpenditure.basalKcal.toLocaleString('nb-NO')} × kontorhverdag, pluss
						{ownExpenditure.workoutKcal.toLocaleString('nb-NO')} fra
						{ownExpenditure.workouts.length}
						{ownExpenditure.workouts.length === 1 ? 'økt' : 'økter'})
						{#if gapKcal !== null && Math.abs(gapKcal) >= 200}
							— {Math.abs(gapKcal).toLocaleString('nb-NO')} kcal
							{gapKcal < 0 ? 'lavere' : 'høyere'} enn Withings
						{/if}
					</p>
				{:else if ownExpenditureMissing.length > 0}
					<p class="breakdown">
						Vi kan regne forbruket selv, men mangler {ownExpenditureMissing.join(', ')}.
					</p>
				{/if}

				{#if expenditure?.activityFieldSuspect && expenditure.reportedActivityKcal !== null}
					<p class="breakdown breakdown--warn">
						Withings' aktivitetsfelt sier {expenditure.reportedActivityKcal.toLocaleString('nb-NO')}
						kcal i dag, mens resten av dagen tilsier
						{expenditure.activityKcal?.toLocaleString('nb-NO')}. Vi bruker det siste. Skjer
						det ofte, er det enheten som klassifiserer en økt feil.
					</p>
				{/if}

				<div class="row row--total" class:is-deficit={balance.balanceKcal < 0}>
					<span class="label">
						{balance.balanceKcal < 0 ? 'Underskudd' : balance.balanceKcal > 0 ? 'Overskudd' : 'Balanse'}
					</span>
					<span class="value">
						{Math.abs(balance.balanceKcal).toLocaleString('nb-NO')} kcal
					</span>
	
				{#if realityCheck?.balanceIsOff}
					<p class="reality">
						Men vekta sier noe annet: over {realityCheck.days}
						{realityCheck.days === 1 ? 'logget dag' : 'loggede dager'} forutsier regnestykket
						{nb(Math.abs(realityCheck.predictedKg), 1)} kg
						{realityCheck.predictedKg < 0 ? 'ned' : 'opp'}, mens du faktisk gikk
						{nb(Math.abs(realityCheck.observedKg), 1)} kg
						{realityCheck.observedKg < 0 ? 'ned' : realityCheck.observedKg > 0 ? 'opp' : 'ingen vei'}.
						Det tilsvarer {Math.abs(realityCheck.impliedDailyErrorKcal).toLocaleString('nb-NO')} kcal
						per dag — som regel umålt mat, ikke et ekte underskudd.
					</p>
				{:else if realityCheck && !realityCheck.conclusive}
					<p class="breakdown">
						For kort horisont til å sjekke mot vekta ennå. To uker med logging gjør
						tallet etterprøvbart.
					</p>
				{/if}
			</div>

				{#if balance.partialDay}
					<p class="note">
						Dagen er ikke omme — begge tallene vokser fram til midnatt.
					</p>
				{:else if trend !== null && trend !== 0}
					<p class="note">
						Holder dette seg, tilsvarer det omtrent {nb(Math.abs(trend), 2)} kg
						{trend < 0 ? 'ned' : 'opp'} per uke. Grov tommelfingerregel.
					</p>
				{/if}
			</div>
		{/if}

		{#if hasComposition && composition}
			<div class="card">
				<div class="comp-grid">
					{#if composition.fatMassKg !== null}
						<div class="comp">
							<span class="comp-value">{nb(composition.fatMassKg, 1)}</span>
							<span class="comp-label">
								kg fett{composition.fatRatio !== null ? ` · ${nb(composition.fatRatio, 1)} %` : ''}
							</span>
						</div>
					{/if}
					{#if composition.muscleMassKg !== null}
						<div class="comp">
							<span class="comp-value">{nb(composition.muscleMassKg, 1)}</span>
							<span class="comp-label">kg muskel</span>
						</div>
					{/if}
					{#if composition.fatFreeMassKg !== null}
						<div class="comp">
							<span class="comp-value">{nb(composition.fatFreeMassKg, 1)}</span>
							<span class="comp-label">kg fettfri</span>
						</div>
					{/if}
					{#if composition.hydrationKg !== null}
						<div class="comp">
							<span class="comp-value">{nb(composition.hydrationKg, 1)}</span>
							<span class="comp-label">kg vann</span>
						</div>
					{/if}
				</div>

				{#if compositionChange}
					<p class="change">
						Siste 60 dager: {compositionChange.sentence}
						{#if compositionChange.fatShare !== null}
							<span class="change-share">
								({Math.round(compositionChange.fatShare * 100)} % av endringen er fett)
							</span>
						{/if}
					</p>
				{/if}

				<p class="note">
					{composition.fatMassSource === 'derived'
						? 'Fettmasse regnet fra fettprosent × vekt.'
						: 'Målt av vekta.'}{dateLabel ? ` Sist ${dateLabel}.` : ''}
				</p>
			</div>
		{/if}
	</section>
{/if}

<style>
	.breakdown {
		margin: -2px 0 2px;
		font-size: 0.7rem;
		line-height: 1.5;
		color: var(--text-tertiary, #777);
	}

	.breakdown--warn {
		color: #f0b429;
	}

	.reality {
		margin: 6px 0 0;
		padding-top: 8px;
		border-top: 1px solid #222;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #f0b429;
	}

	.balance {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 5px;
		padding: 14px;
		border-radius: 16px;
		background: #141414;
	}

	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}

	.label {
		font-size: 0.78rem;
		color: #888;
	}

	.value {
		font-size: 0.92rem;
		color: #ddd;
		white-space: nowrap;
	}

	.row--total {
		margin-top: 3px;
		padding-top: 7px;
		border-top: 1px solid #222;
	}

	.row--total .label,
	.row--total .value {
		font-weight: 700;
		color: #eee;
	}

	.row--total.is-deficit .value {
		color: #82c882;
	}

	.comp-grid {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 8px;
	}

	@media (min-width: 520px) {
		.comp-grid {
			grid-template-columns: repeat(4, 1fr);
		}
	}

	.comp {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}

	.comp-value {
		font-size: 1.15rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #eee;
	}

	.comp-label {
		font-size: 0.68rem;
		color: #777;
	}

	.change {
		margin: 4px 0 0;
		font-size: 0.78rem;
		line-height: 1.5;
		color: #ddd;
	}

	.change-share {
		color: #888;
	}

	.note {
		margin: 2px 0 0;
		font-size: 0.71rem;
		line-height: 1.5;
		color: #666;
	}
</style>
