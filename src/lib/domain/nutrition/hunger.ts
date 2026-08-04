/**
 * Sult 1–5: registrering, og å forutsi den neste gangen.
 *
 * ## Hvorfor en skala i det hele tatt
 *
 * Sult er det ene signalet i ernæringsdomenet som **bare brukeren har**. Vekt kommer fra
 * Withings, forbruk kan modelleres, inntaket loggføres — men «jeg falt gjennom i
 * 15-17-tida» finnes ingen sensor for. Uten et tall kan vi bare gjette på når det skjer,
 * og et generisk «spis noe kl. 15» blir bakgrunnsstøy.
 *
 * ## Modellen: brukerens eget gap, ikke en fysiologisk påstand
 *
 * Vi lover **ikke** noe om blodsukker. Appen måler ikke blodsukker, og et råd som later
 * som den gjør det er verre enn intet råd. Det vi kan si er noe mye mer etterprøvbart:
 * *«forrige tre ganger du meldte 4–5, hadde du et gap på rundt 1 400 kcal — du er der
 * nå.»* Det er brukerens egne tall, om brukerens egen kropp.
 *
 * Konkret: hver sultmelding lagres med det **kumulative gapet** (forbrent − spist så
 * langt, se `intraday-energy`) på det tidspunktet. Terskelen er medianen av gapet ved de
 * meldingene som var høye. Median framfor snitt fordi én dag med 3 000 kcal gap ellers
 * flytter terskelen dit ingen dager ligger.
 *
 * ## Den viktigste regelen: hold kjeft til det finnes data
 *
 * `MIN_OBSERVATIONS` og `MIN_HIGH_OBSERVATIONS` må begge være oppfylt før vi forutsier
 * noe. En «prediksjon» fra én måling er en gjetning med selvtillit, og den første gangen
 * den bommer slutter brukeren å svare på skalaen — og da mister vi det ene signalet vi
 * ikke kan måle oss til.
 */

export const HUNGER_MIN = 1;
export const HUNGER_MAX = 5;

/** Fra og med dette er sulten sterk nok til å påvirke dagen. */
export const HUNGER_HIGH = 4;

/** Under disse holder vi kjeft om prediksjon. Se modulkommentaren. */
export const MIN_OBSERVATIONS = 5;
export const MIN_HIGH_OBSERVATIONS = 2;

/**
 * Hvor nær terskelen man må være før vi sier fra.
 *
 * 0,85 gir et forvarsel framfor en konstatering: er terskelen 1 400 kcal, fyrer vi på
 * 1 190. Poenget er å komme *før* krisa, ikke å beskrive den mens den skjer.
 */
export const WARN_AT_FRACTION = 0.85;

export interface HungerObservation {
	/** ISO-tidspunkt. */
	at: string;
	level: number;
	/** Kumulativt gap (forbrent − spist) da meldingen kom. Null når det ikke kunne regnes. */
	gapKcal: number | null;
	/** Oslo-timen meldingen kom, som desimaltall (15,5 = 15:30). */
	osloHour: number | null;
}

export function isHungerLevel(value: unknown): value is number {
	return (
		typeof value === 'number' &&
		Number.isInteger(value) &&
		value >= HUNGER_MIN &&
		value <= HUNGER_MAX
	);
}

/** «Ikke sulten» … «Skrubbsulten». Etikettene på skalaen. */
export const HUNGER_LABELS: Record<number, string> = {
	1: 'Ikke sulten',
	2: 'Litt',
	3: 'Sulten',
	4: 'Veldig sulten',
	5: 'Skrubbsulten'
};

export interface HungerPrediction {
	/** Sant når det finnes nok meldinger til å si noe. */
	ready: boolean;
	/** Hvorfor vi ikke kan forutsi ennå. Null når `ready`. */
	notReadyReason: string | null;
	/** Gapet brukeren pleier å bli skikkelig sulten på. Null når ikke `ready`. */
	thresholdKcal: number | null;
	/** Sant når dagens gap er nær eller over terskelen. */
	approaching: boolean;
	/** Antall meldinger modellen bygger på. */
	observations: number;
	highObservations: number;
	/** Timen brukeren oftest melder høy sult. Null uten mønster. */
	typicalHour: number | null;
}

/**
 * Er brukeren på vei mot sitt eget sultgap?
 *
 * `gapNowKcal` kommer fra `buildIntradayEnergy`. Uten den kan vi ikke sammenligne med
 * terskelen, og da er svaret «ikke klar» framfor et gjett.
 */
export function predictHunger(input: {
	history: HungerObservation[];
	gapNowKcal: number | null;
}): HungerPrediction {
	const usable = input.history.filter(
		(obs) => isHungerLevel(obs.level) && typeof obs.gapKcal === 'number' && obs.gapKcal > 0
	);
	const high = usable.filter((obs) => obs.level >= HUNGER_HIGH);

	const base = {
		observations: usable.length,
		highObservations: high.length,
		typicalHour: typicalHungerHour(high)
	};

	if (usable.length < MIN_OBSERVATIONS) {
		return {
			...base,
			ready: false,
			notReadyReason: `Trenger ${MIN_OBSERVATIONS} sultmeldinger med tall bak før vi kan forutsi noe. Du har ${usable.length}.`,
			thresholdKcal: null,
			approaching: false
		};
	}
	if (high.length < MIN_HIGH_OBSERVATIONS) {
		return {
			...base,
			ready: false,
			notReadyReason: `Ingen mønster ennå — vi trenger ${MIN_HIGH_OBSERVATIONS} meldinger på ${HUNGER_HIGH} eller mer for å vite hvor grensa din ligger.`,
			thresholdKcal: null,
			approaching: false
		};
	}

	const thresholdKcal = Math.round(median(high.map((obs) => obs.gapKcal as number)));
	const gap = input.gapNowKcal;

	return {
		...base,
		ready: true,
		notReadyReason: null,
		thresholdKcal,
		approaching:
			typeof gap === 'number' && Number.isFinite(gap) && gap >= thresholdKcal * WARN_AT_FRACTION
	};
}

/**
 * Timen høy sult oftest meldes, avrundet til hel time.
 *
 * Null uten et flertall: melder man like ofte kl. 11 og kl. 16, er «typisk time»
 * en fabrikasjon.
 */
export function typicalHungerHour(high: HungerObservation[]): number | null {
	const counts = new Map<number, number>();
	for (const obs of high) {
		if (typeof obs.osloHour !== 'number' || !Number.isFinite(obs.osloHour)) continue;
		const hour = Math.floor(obs.osloHour);
		counts.set(hour, (counts.get(hour) ?? 0) + 1);
	}
	if (counts.size === 0) return null;

	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
	if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
	return sorted[0][0];
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
