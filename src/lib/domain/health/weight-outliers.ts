/**
 * Veiinger som ikke kan stemme.
 *
 * ## Hvorfor dette finnes
 *
 * 10. august 2018 lå det en måling på ~40 kg midt i en historikk som ellers ligger
 * rundt 100. Den kom ikke fra noen feil i vår tolkning — vekta målte noe, bare ikke
 * brukeren: et barn på vekta, en bag, en sensorglipp. Slikt skjer, og det skal kunne
 * ryddes.
 *
 * Målingen var **synlig** i grafen med én gang, men ikke mulig å gjøre noe med: den
 * ligger som én rad blant 1 200, og å slette den krevde at man først fant den. Det er
 * derfor denne modulen finnes — ikke for å skjule uteliggere, men for å gjøre dem
 * håndterbare.
 *
 * ## Hvorfor vi ikke bare filtrerer dem bort
 *
 * Fristelsen er å la grafen ignorere alt som avviker for mye. Det er feil av to
 * grunner. En måling vi skjuler er fortsatt med i snitt, milepæler og energibalanse —
 * så flaten og regnestykkene ville sagt ulike ting. Og en terskel som skjuler data er
 * en terskel som før eller siden skjuler noe ekte: en reell rask endring etter
 * sykdom, eller den første målingen etter et års pause. Vi **peker**, brukeren
 * bestemmer.
 *
 * ## Hvorfor nabomedianen, og ikke et globalt snitt
 *
 * En person som går ned tjue kilo på et år har ingen «normalvekt» å måle mot — et
 * globalt snitt ville flagget begge endene av historikken. Naboene i tid er derimot
 * alltid nær, uansett hvor mye vekta har flyttet seg over år. Medianen framfor
 * snittet fordi den tåler at det ligger *flere* feilmålinger ved siden av hverandre.
 */

/** En veiing, med nok identitet til at den kan slettes. */
export interface WeightRow {
	/** `sensor_events.id`. Det som gjør raden slettbar. */
	id: string;
	/** Oslo-dato, `YYYY-MM-DD`. */
	date: string;
	weightKg: number;
	/** Hvilken sensor raden kom fra, til visning. */
	source?: string | null;
}

export interface WeightOutlier extends WeightRow {
	/** Medianen av nabomålingene raden ble vurdert mot. */
	neighbourMedianKg: number;
	/** Avviket i kg, med fortegn. Negativt betyr lavere enn naboene. */
	deviationKg: number;
	/** Terskelen som ble brukt, så tallet kan etterprøves. */
	thresholdKg: number;
}

/**
 * Hvor mange naboer i tid en måling vurderes mot.
 *
 * Ti er nok til at medianen er stabil, og kort nok til at et reelt vekttap over
 * måneder ikke drar naboene med seg.
 */
export const NEIGHBOUR_COUNT = 10;

/**
 * Færre naboer enn dette, og vi sier ingenting.
 *
 * En måling kan ikke være en uteligger uten noe å ligge utenfor. De aller første
 * veiingene i en historikk har for lite rundt seg til at en påstand er redelig.
 */
export const MIN_NEIGHBOURS = 4;

/** Avvik større enn denne andelen av nabomedianen er mistenkelig. */
export const DEVIATION_FRACTION = 0.15;

/**
 * Gulv for terskelen, i kg.
 *
 * Uten gulvet ville en lett person fått flagget normale svingninger: 15 % av 45 kg er
 * under sju kilo, og et vekttap etter sykdom kan være det. Gulvet holder terskelen
 * over det kroppsvekt gjør av seg selv.
 */
export const MIN_DEVIATION_KG = 8;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function round1(value: number): number {
	return Math.round(value * 10) / 10;
}

/**
 * Målingene som avviker for mye fra sine naboer i tid.
 *
 * `rows` trenger ikke være sortert. Resultatet er sortert stigende på dato, slik at
 * en liste i flaten leser kronologisk.
 */
export function findWeightOutliers(rows: readonly WeightRow[]): WeightOutlier[] {
	const usable = rows.filter(
		(row) => Number.isFinite(row.weightKg) && row.weightKg > 0
	);
	if (usable.length <= MIN_NEIGHBOURS) return [];

	const sorted = [...usable].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const outliers: WeightOutlier[] = [];

	for (let i = 0; i < sorted.length; i++) {
		// Naboene er de nærmeste i rekkefølgen, uansett side. En måling i hver ende av
		// historikken har bare naboer på én side, og skal vurderes likevel — det er
		// nettopp der en feilmåling er lettest å overse.
		const half = Math.floor(NEIGHBOUR_COUNT / 2);
		let start = Math.max(0, i - half);
		let end = Math.min(sorted.length, start + NEIGHBOUR_COUNT + 1);
		start = Math.max(0, end - NEIGHBOUR_COUNT - 1);

		const neighbours: number[] = [];
		for (let j = start; j < end; j++) {
			if (j !== i) neighbours.push(sorted[j].weightKg);
		}
		if (neighbours.length < MIN_NEIGHBOURS) continue;

		const neighbourMedian = median(neighbours);
		const threshold = Math.max(MIN_DEVIATION_KG, neighbourMedian * DEVIATION_FRACTION);
		const deviation = sorted[i].weightKg - neighbourMedian;

		if (Math.abs(deviation) > threshold) {
			outliers.push({
				...sorted[i],
				neighbourMedianKg: round1(neighbourMedian),
				deviationKg: round1(deviation),
				thresholdKg: round1(threshold)
			});
		}
	}

	return outliers;
}

/**
 * Setningen som forklarer hvorfor raden er flagget.
 *
 * Formuleres her framfor i komponenten, slik at tallet og ordene ikke kan gå fra
 * hverandre — og slik at den kan testes.
 */
export function describeOutlier(outlier: WeightOutlier): string {
	const direction = outlier.deviationKg < 0 ? 'lavere' : 'høyere';
	const amount = Math.abs(outlier.deviationKg).toFixed(1).replace('.', ',');
	const median = outlier.neighbourMedianKg.toFixed(1).replace('.', ',');
	return `${amount} kg ${direction} enn målingene rundt (${median} kg).`;
}
