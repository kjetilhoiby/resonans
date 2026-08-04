<!--
  IntradayEnergyChart — spist mot forbrent så langt i dag, kumulativt.

  Formen er lånt fra skrittkortet i Withings: to kurver som vokser gjennom døgnet, en
  markør på «nå», og gapet mellom dem som hele budskapet.

  Dette retter en reell feil, ikke bare en presentasjon. Flaten viste «Spist 1 214 ·
  Forbrent 2 742» kl. 17:03 — men 2 742 var et anslag for HELE døgnet, mens 1 214 var så
  langt. Differansen kunne derfor ikke handles på. Her er begge sidene kumulative, så
  gapet kl. 17 er et ekte gap, og man ser *når* det åpnet seg.

  Begge kurvene er kcal, så det er **én** y-akse. Ingen skalaproblem å veie her — i
  motsetning til vekt-overlayen i EnergyHistoryChart.

  Forbrukskurven er modellert (se `intraday-energy.ts`), og bunnteksten sier det.
-->
<script lang="ts">
	import SectionLabel from '../../ui/SectionLabel.svelte';
	import {
		minuteLabel,
		MINUTES_PER_DAY,
		type IntradayEnergy
	} from '$lib/domain/nutrition/intraday-energy';
	import { HUNGER_LABELS, type HungerPrediction } from '$lib/domain/nutrition/hunger';

	interface Props {
		energy: IntradayEnergy;
		/** Sultmodellen, til terskellinja. Null når den ikke er klar. */
		prediction?: HungerPrediction | null;
	}

	let { energy, prediction = null }: Props = $props();

	const INTAKE_COLOR = '#3987e5';
	const EXPENDITURE_COLOR = '#d95926';

	/** Y-taket, rundet opp til nærmeste 500 for et lesbart tall. */
	const scaleMax = $derived(Math.max(500, Math.ceil(energy.maxKcal / 500) * 500));

	/** Klokketimer på x-aksen. Hver sjette time — flere blir en grå strek. */
	const HOUR_TICKS = [0, 6, 12, 18, 24];
	const GRID = [1, 0.75, 0.5, 0.25, 0];

	function x(minute: number): number {
		return (minute / MINUTES_PER_DAY) * 100;
	}

	function y(kcal: number): number {
		return 100 - (kcal / scaleMax) * 100;
	}

	function path(points: Array<{ minute: number; kcal: number }>): string {
		return points
			.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.minute).toFixed(2)} ${y(p.kcal).toFixed(2)}`)
			.join(' ');
	}

	const intakePath = $derived(
		path(energy.points.map((p) => ({ minute: p.minute, kcal: p.intakeKcal })))
	);
	const expenditurePath = $derived(
		path(energy.points.map((p) => ({ minute: p.minute, kcal: p.expenditureKcal })))
	);
	const projectionPath = $derived(
		energy.projection.length > 1
			? path(energy.projection.map((p) => ({ minute: p.minute, kcal: p.expenditureKcal })))
			: ''
	);

	/**
	 * Gapet som et fylt felt mellom kurvene — men fargen følger fortegnet.
	 *
	 * Én flate i forbruksfargen ville vist et *overskudd* (spist mer enn forbrent) i
	 * samme farge som et underskudd, altså løyet om det ene grafen finnes for. Feltet
	 * bygges derfor som én firkant per intervall, farget etter hvilken kurve som ligger
	 * øverst der. Ved 15-minutters oppløsning er skjøtene usynlige på 14 % opasitet.
	 */
	const gapBands = $derived.by(() => {
		const bands: Array<{ d: string; deficit: boolean }> = [];
		for (let i = 1; i < energy.points.length; i++) {
			const a = energy.points[i - 1];
			const b = energy.points[i];
			// Ingen flate å tegne der kurvene ligger oppå hverandre.
			if (a.expenditureKcal === a.intakeKcal && b.expenditureKcal === b.intakeKcal) continue;
			const deficit = b.expenditureKcal + a.expenditureKcal >= b.intakeKcal + a.intakeKcal;
			bands.push({
				deficit,
				d:
					`M ${x(a.minute).toFixed(2)} ${y(a.expenditureKcal).toFixed(2)}` +
					` L ${x(b.minute).toFixed(2)} ${y(b.expenditureKcal).toFixed(2)}` +
					` L ${x(b.minute).toFixed(2)} ${y(b.intakeKcal).toFixed(2)}` +
					` L ${x(a.minute).toFixed(2)} ${y(a.intakeKcal).toFixed(2)} Z`
			});
		}
		return bands;
	});

	/** Negativt gap er et overskudd, og skal ikke hete «gap». */
	const gapIsSurplus = $derived(energy.gapNow < 0);

	function nb(value: number): string {
		return Math.round(value).toLocaleString('nb-NO');
	}

	/** Terskelen brukeren pleier å bli skikkelig sulten på, som en linje i gapet. */
	const thresholdKcal = $derived(
		prediction?.ready && prediction.thresholdKcal !== null ? prediction.thresholdKcal : null
	);
</script>

<section class="intraday">
	<SectionLabel tag="h2">Så langt i dag</SectionLabel>

	<div class="heads">
		<div class="head">
			<span class="head-label"><span class="dot" style:background={INTAKE_COLOR}></span>Spist</span>
			<span class="head-value" style:color={INTAKE_COLOR}>{nb(energy.intakeNow)}</span>
		</div>
		<div class="head">
			<span class="head-label">
				<span class="dot" style:background={EXPENDITURE_COLOR}></span>Forbrent
			</span>
			<span class="head-value" style:color={EXPENDITURE_COLOR}>{nb(energy.expenditureNow)}</span>
		</div>
		<div class="head head--gap">
			<span class="head-label">{gapIsSurplus ? 'Over nå' : 'Gap nå'}</span>
			<span class="head-value">{nb(Math.abs(energy.gapNow))}</span>
		</div>
	</div>

	<div class="plot">
		<div class="axis-y" aria-hidden="true">
			{#each GRID as level (level)}
				<span class="y-tick">{nb(scaleMax * level)}</span>
			{/each}
		</div>

		<div class="field">
			<div class="grid" aria-hidden="true">
				{#each GRID as level (level)}
					<span class="grid-line"></span>
				{/each}
			</div>

			<svg
				viewBox="0 0 100 100"
				preserveAspectRatio="none"
				role="img"
				aria-label={`Spist ${nb(energy.intakeNow)} kcal mot forbrent ${nb(energy.expenditureNow)} kcal så langt i dag`}
			>
				<!-- Gapet først, så kurvene ligger over. -->
				{#each gapBands as band, i (i)}
					<path
						d={band.d}
						fill={band.deficit ? EXPENDITURE_COLOR : INTAKE_COLOR}
						opacity="0.16"
					/>
				{/each}

				{#if projectionPath}
					<path
						d={projectionPath}
						fill="none"
						stroke={EXPENDITURE_COLOR}
						stroke-width="1.4"
						stroke-dasharray="3 3"
						opacity="0.45"
						vector-effect="non-scaling-stroke"
					/>
				{/if}

				<path
					d={expenditurePath}
					fill="none"
					stroke={EXPENDITURE_COLOR}
					stroke-width="2"
					stroke-linejoin="round"
					vector-effect="non-scaling-stroke"
				/>
				<path
					d={intakePath}
					fill="none"
					stroke={INTAKE_COLOR}
					stroke-width="2"
					stroke-linejoin="round"
					vector-effect="non-scaling-stroke"
				/>

				<!-- «Nå»-markøren, som i skrittkortet. -->
				<line
					x1={x(energy.nowMinute)}
					y1="0"
					x2={x(energy.nowMinute)}
					y2="100"
					stroke="#555"
					stroke-width="1"
					vector-effect="non-scaling-stroke"
				/>
				<circle
					cx={x(energy.nowMinute)}
					cy={y(energy.expenditureNow)}
					r="2.6"
					fill={EXPENDITURE_COLOR}
					vector-effect="non-scaling-stroke"
				/>
				<circle
					cx={x(energy.nowMinute)}
					cy={y(energy.intakeNow)}
					r="2.6"
					fill={INTAKE_COLOR}
					vector-effect="non-scaling-stroke"
				/>
			</svg>

			<span class="now-label" style:left={`${x(energy.nowMinute)}%`}>
				{minuteLabel(energy.nowMinute)}
			</span>
		</div>

		<div class="axis-x" aria-hidden="true">
			{#each HOUR_TICKS as hour (hour)}
				<span class="x-tick" style:left={`${x(hour * 60)}%`}>{minuteLabel(hour * 60)}</span>
			{/each}
		</div>

		<span class="unit" aria-hidden="true">kcal</span>
	</div>

	{#if thresholdKcal !== null}
		<p class="note note--hunger" class:is-warn={prediction?.approaching}>
			{#if prediction?.approaching}
				Du er på gapet du pleier å melde «{HUNGER_LABELS[4].toLowerCase()}» på
				(~{nb(thresholdKcal)} kcal, {prediction.highObservations} ganger). Verdt en snack.
			{:else}
				Du pleier å melde sterk sult rundt {nb(thresholdKcal)} kcal gap — bygget på
				{prediction?.highObservations} meldinger fra deg.
			{/if}
		</p>
	{/if}

	<p class="note">
		Begge kurvene er kumulative, så gapet er reelt akkurat nå — ikke et døgnanslag minus
		en formiddag. Forbruket er <em>modellert</em>: hvile jevnt over døgnet, kontorpåslaget
		over våken tid, øktene der de skjedde. Den stiplede linja er resten av døgnet.
	</p>
</section>

<style>
	.intraday {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
		background: var(--card-bg-subtle, #141414);
		border-radius: var(--card-radius, 16px);
	}

	.heads {
		display: flex;
		flex-wrap: wrap;
		gap: 18px;
	}

	.head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.head-label {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.72rem;
		/* Teksttoken, ikke seriefargen — en etikett i #d95926 leses som en advarsel. */
		color: #999;
	}

	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}

	.head-value {
		font-size: 1.25rem;
		font-weight: 700;
		letter-spacing: -0.02em;
		color: #eee;
	}

	.head--gap {
		margin-left: auto;
		text-align: right;
	}

	.head--gap .head-label {
		justify-content: flex-end;
	}

	.plot {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto auto;
		column-gap: 6px;
		row-gap: 3px;
	}

	.axis-y {
		grid-area: 1 / 1;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		height: 150px;
	}

	.y-tick {
		font-size: 0.62rem;
		line-height: 1;
		text-align: right;
		color: #6d6d6d;
		white-space: nowrap;
	}

	.field {
		grid-area: 1 / 2;
		position: relative;
		height: 150px;
	}

	.grid {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: space-between;
	}

	.grid-line {
		height: 1px;
		background: #202020;
	}

	.field svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}

	/* Klokkeslettet ved «nå», forskjøvet så det ikke faller utenfor på kantene. */
	.now-label {
		position: absolute;
		top: -2px;
		transform: translateX(-50%);
		padding: 0 3px;
		font-size: 0.6rem;
		color: #999;
		background: var(--card-bg-subtle, #141414);
		white-space: nowrap;
	}

	.axis-x {
		grid-area: 2 / 2;
		position: relative;
		height: 0.95rem;
	}

	.x-tick {
		position: absolute;
		transform: translateX(-50%);
		font-size: 0.62rem;
		color: #6d6d6d;
		white-space: nowrap;
	}

	.unit {
		grid-area: 3 / 1;
		font-size: 0.62rem;
		text-align: right;
		color: #5f5f5f;
	}

	.note {
		margin: 0;
		font-size: 0.72rem;
		line-height: 1.5;
		color: #777;
	}

	.note--hunger {
		color: #9aa7f0;
	}

	.note--hunger.is-warn {
		color: #f0b429;
	}
</style>
