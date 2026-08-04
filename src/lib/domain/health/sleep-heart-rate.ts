/**
 * Sovepuls per natt: hvilepulsen mens du sov, og avviket fra ditt eget snitt.
 *
 * ## Hvorfor `hr_min` og ikke `hr_average`
 *
 * `hr_min` fra en søvnmåling er den laveste pulsen gjennom natta, og det er den
 * definisjonen av hvilepuls som faktisk holder — `heart-rate-baseline.ts` prioriterer
 * nettopp `sleep_min` over alt annet. `hr_average` ligger 5–10 slag høyere fordi det
 * blander REM-perioder og oppvåkninger inn i snittet. Begge vises, men **hvilepulsen er
 * hovedtallet**.
 *
 * ## Netter deles i segmenter
 *
 * Withings deler natta når man er ute av senga, så én natt kan gi to rader. Samme felle
 * `buildSleepNightSeries` løste for nattlengder. Her slås segmentene sammen per
 * nattnøkkel, og hvilepulsen blir **minimum av minimaene**: det laveste punktet gjennom
 * natta er det laveste punktet, uansett hvor mange biter måleren delte den i. Å snitte
 * segmentminimaene ville gitt et kunstig høyt tall for en oppdelt natt.
 *
 * ## Retningen er motsatt av VO2max
 *
 * **Lav hvilepuls er bra.** Et *fall* er framgang, en *stigning* er signalet man vil
 * fange — hard trening, dårlig restitusjon, sykdom eller alkohol. Derfor er
 * `deviationBpm` positiv når pulsen ligger over snittet, og det er den retningen som
 * flagges.
 *
 * Og som HRV: **siste natt** er tallet, ikke den beste. Beste hvilepuls siste to måneder
 * svarer ikke på hvordan det står til nå.
 */

/** Under dette er snittet for tynt til å regne avvik mot. Samme terskel som HRV. */
export const MIN_BASELINE_NIGHTS = 7;

/**
 * Avvik i slag som er verdt å nevne.
 *
 * Hvilepuls varierer 2–3 slag fra natt til natt uten at noe har skjedd. Fem slag er
 * over den støyen og under det som krever en forklaring.
 */
export const NOTABLE_DEVIATION_BPM = 5;

export interface SleepHeartRateRow {
	/** Nattnøkkel — datoen man våkner. */
	date: string;
	/** `hr_min` fra søvnmålingen. */
	minBpm: number | null;
	/** `hr_average` fra søvnmålingen. */
	averageBpm: number | null;
}

export interface SleepHeartRateNight {
	date: string;
	/** Hvilepuls: laveste punkt gjennom natta. Null når måleren ikke ga den. */
	restingBpm: number | null;
	/** Snittpuls gjennom natta. Ligger over hvilepulsen. */
	averageBpm: number | null;
	/** Hvor mange segmenter natta besto av. 2+ betyr at man var ute av senga. */
	segments: number;
}

export interface SleepHeartRateSummary {
	/** Eldste først, til grafen. Bare netter med hvilepuls. */
	nights: SleepHeartRateNight[];
	/** Siste natt med hvilepuls. */
	latest: SleepHeartRateNight | null;
	/** Medianen over vinduet, utenom siste natt. Null under MIN_BASELINE_NIGHTS. */
	baselineBpm: number | null;
	baselineNights: number;
	/** Siste natt minus snittet. Positivt = høyere puls enn vanlig = verdt å se på. */
	deviationBpm: number | null;
	/** 'over' når pulsen er merkbart høyere enn snittet, 'under' når lavere. */
	band: 'over' | 'normal' | 'under' | 'ukjent';
}

/**
 * Slår sammen segmenter per natt.
 *
 * Hvilepuls = min av segmentenes `hr_min` (se modulkommentaren). Snittpuls = snitt av
 * segmentenes `hr_average`, som er en tilnærming: uten segmentlengder kan vi ikke vekte
 * dem, og et uvektet snitt er nærmere sannheten enn å plukke ett segment.
 */
export function buildSleepHeartRateNights(rows: SleepHeartRateRow[]): SleepHeartRateNight[] {
	const byNight = new Map<string, { mins: number[]; avgs: number[]; segments: number }>();

	for (const row of rows) {
		if (!row.date) continue;
		const bucket = byNight.get(row.date) ?? { mins: [], avgs: [], segments: 0 };
		bucket.segments += 1;
		if (isBpm(row.minBpm)) bucket.mins.push(row.minBpm);
		if (isBpm(row.averageBpm)) bucket.avgs.push(row.averageBpm);
		byNight.set(row.date, bucket);
	}

	return [...byNight.entries()]
		.map(([date, bucket]) => ({
			date,
			restingBpm: bucket.mins.length > 0 ? Math.min(...bucket.mins) : null,
			averageBpm:
				bucket.avgs.length > 0
					? Math.round(bucket.avgs.reduce((a, b) => a + b, 0) / bucket.avgs.length)
					: null,
			segments: bucket.segments
		}))
		.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Siste natt mot ditt eget snitt.
 *
 * Baselinen regnes **uten** siste natt: hadde den vært med, ville en avvikende natt
 * dratt snittet mot seg selv og dempet sitt eget avvik. Median framfor snitt, av samme
 * grunn som i HRV — én natt med dårlig sensorfeste skal ikke flytte grunnlinja.
 */
export function summarizeSleepHeartRate(
	nights: SleepHeartRateNight[]
): SleepHeartRateSummary {
	const withResting = nights.filter(
		(night): night is SleepHeartRateNight & { restingBpm: number } => night.restingBpm !== null
	);

	if (withResting.length === 0) {
		return {
			nights: [],
			latest: null,
			baselineBpm: null,
			baselineNights: 0,
			deviationBpm: null,
			band: 'ukjent'
		};
	}

	const latest = withResting[withResting.length - 1];
	const earlier = withResting.slice(0, -1);

	if (earlier.length < MIN_BASELINE_NIGHTS) {
		return {
			nights: withResting,
			latest,
			baselineBpm: null,
			baselineNights: earlier.length,
			deviationBpm: null,
			band: 'ukjent'
		};
	}

	const baselineBpm = Math.round(median(earlier.map((night) => night.restingBpm)));
	const deviationBpm = latest.restingBpm - baselineBpm;

	return {
		nights: withResting,
		latest,
		baselineBpm,
		baselineNights: earlier.length,
		deviationBpm,
		band:
			deviationBpm >= NOTABLE_DEVIATION_BPM
				? 'over'
				: deviationBpm <= -NOTABLE_DEVIATION_BPM
					? 'under'
					: 'normal'
	};
}

/** Puls skal være et menneskelig tall. Utenfor dette er det en målefeil. */
function isBpm(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 25 && value <= 150;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
