/**
 * Snittkurven fra tidligere lønnsperioder — «ligger jeg over eller under normalen?»
 *
 * ## Feilen den finnes for å hindre
 *
 * Brukeren spurte: «Hvordan kan akkumulert forbruk ha gått ned?» Den stiplede linja i
 * `PaydaySpendSection` falt 53 229 kr mellom dag 29 og dag 30 — målt i prod 18. august 2026.
 * **En akkumulert kurve kan ikke synke.** Den summerer utlegg; det finnes ikke negative utlegg.
 *
 * Årsaken var ikke i akkumuleringen, som var riktig per periode. Den var i SNITTET:
 *
 * ```
 * dag 1–29:  snitt av 4 perioder      → alle fire har en dag 29
 * dag 30:    snitt av 1 periode       → tre perioder er slutt, bare den lange står
 * ```
 *
 * Hver enkelt kurve er monotont voksende. **Men gjennomsnittet over en KRYMPENDE populasjon er
 * ikke det** — faller en periode med høyt forbruk ut, synker snittet, uten at noen har fått
 * penger tilbake. Koden delte på `pointsForDay.length`, altså antallet perioder som ennå hadde
 * den dagen, og det tallet endrer seg underveis.
 *
 * ## Løsningen er å gjøre populasjonen konstant
 *
 * Serien kappes ved den **korteste** perioden. Da bidrar alle periodene på hver tegnede dag, og
 * monotonien følger av konstruksjonen framfor å være noe man håper på.
 *
 * De to alternativene ble vurdert og forkastet:
 *
 * - **Videreføre siste verdi** for en avsluttet periode. Da holder populasjonen seg på fire, men
 *   kurven påstår at en periode på 29 dager har en dag 40 — den sammenligner mot noe som ikke
 *   fantes.
 * - **Normalisere x-aksen til prosent av perioden.** Riktigere i teorien, men da er x-aksen ikke
 *   lenger «dager siden lønn», og den grønne kurven ved siden av måtte fulgt med. Større
 *   ombygging enn feilen krever.
 *
 * Å tegne kortere er ærligere enn å tegne feil: linja slutter der sammenligningen slutter å
 * være en sammenligning.
 *
 * ## Den andre observasjonen fra samme måling
 *
 * Serien gikk til **dag 58** mens inneværende periode var 27 dager. En lønnsperiode er ~30 dager,
 * så minst én «periode» dekket to. Det betyr at en lønnsdato ikke ble kjent igjen, og
 * `detectGlobalPayday` slo to perioder sammen. Kappingen skjuler ikke dette — `periodLengths` og
 * `longestPeriodDays` rapporteres, så en flate kan si det framfor at tallet bare ser rart ut.
 *
 * Se `docs/changelog/2026-08-18-akkumulert-snitt-kunne-synke.md`.
 */

/** Standard antall tidligere perioder i snittet. */
export const DEFAULT_COMPARISON_PERIODS = 4;

export type ComparisonTx = {
	/** YYYY-MM-DD */
	date: string;
	/** Positivt beløp = forbruk. Fortegnet er kallerens ansvar. */
	amount: number;
	isGrocery: boolean;
};

export type ComparisonPoint = { day: number; total: number; grocery: number };

export type PaydayComparison = {
	/**
	 * Snittkurven, akkumulert per dag. **Garantert ikke-synkende** — se `assertMonotonic`.
	 * Tom når det ikke finnes en hel tidligere periode å sammenligne med.
	 */
	points: ComparisonPoint[];
	/** Antall tidligere perioder som faktisk inngår. */
	periodsUsed: number;
	/** Hvor langt kurven går = den korteste periodens lengde. */
	comparisonDays: number;
	/** Lengden på hver periode som inngår, nyeste først. Til diagnose på flaten. */
	periodLengths: number[];
	/**
	 * Lengste periode i settet.
	 *
	 * Er den mye større enn ~31, ble en lønnsdato ikke kjent igjen og to perioder er slått
	 * sammen. Rapporteres framfor å skjules, siden kappingen ellers ville gjort symptomet
	 * usynlig uten å fjerne årsaken.
	 */
	longestPeriodDays: number;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Hele dager mellom to YYYY-MM-DD-nøkler. Midt på dagen, så sommertid ikke gir ±1. */
export function daysBetweenKeys(fromKey: string, toKey: string): number {
	return Math.round(
		(new Date(`${toKey}T12:00:00Z`).getTime() - new Date(`${fromKey}T12:00:00Z`).getTime()) /
			MS_PER_DAY
	);
}

/**
 * Bygger snittkurven over tidligere lønnsperioder.
 *
 * `paydayKeys` er lønnsdatoene, **nyeste først**. `paydayKeys[0]` er inneværende periodes start
 * og inngår ikke i snittet; periode `i` spenner `[paydayKeys[i], paydayKeys[i - 1])`.
 */
export function buildPaydayComparison(
	spend: readonly ComparisonTx[],
	paydayKeys: readonly string[],
	options: { maxPeriods?: number } = {}
): PaydayComparison {
	const maxPeriods = options.maxPeriods ?? DEFAULT_COMPARISON_PERIODS;
	const empty: PaydayComparison = {
		points: [],
		periodsUsed: 0,
		comparisonDays: 0,
		periodLengths: [],
		longestPeriodDays: 0
	};

	const previousStarts = paydayKeys.slice(1, 1 + maxPeriods);
	if (previousStarts.length === 0) return empty;

	const series = previousStarts.flatMap((startKey, index) => {
		// Periodens slutt er den NYERE lønnsdatoen. Mangler den, er perioden ikke avsluttet og
		// kan ikke inngå — en halv periode ville trukket snittet ned på alle dager.
		const endKey = paydayKeys[index];
		if (!endKey) return [];
		const lengthDays = daysBetweenKeys(startKey, endKey);
		if (lengthDays < 1) return [];
		return [buildCumulativeSeries(spend, startKey, endKey, lengthDays)];
	});

	if (series.length === 0) return empty;

	const periodLengths = series.map((s) => s.length);
	// **Kappingen ER fixen.** Den korteste perioden bestemmer hvor langt vi kan snitte over en
	// KONSTANT populasjon, og det er konstant populasjon som gjør snittet monotont.
	const comparisonDays = Math.min(...periodLengths);

	const points: ComparisonPoint[] = [];
	for (let day = 1; day <= comparisonDays; day += 1) {
		let total = 0;
		let grocery = 0;
		for (const one of series) {
			// Trygt uten vakt: `day <= comparisonDays <= one.length` for alle serier.
			total += one[day - 1].total;
			grocery += one[day - 1].grocery;
		}
		points.push({ day, total: total / series.length, grocery: grocery / series.length });
	}

	return {
		points,
		periodsUsed: series.length,
		comparisonDays,
		periodLengths,
		longestPeriodDays: Math.max(...periodLengths)
	};
}

/** Akkumulert forbruk per dag for én periode. Dager uten utlegg bærer forrige verdi videre. */
function buildCumulativeSeries(
	spend: readonly ComparisonTx[],
	startKey: string,
	endKey: string,
	lengthDays: number
): ComparisonPoint[] {
	const byDay = new Map<number, { total: number; grocery: number }>();
	for (const tx of spend) {
		if (tx.date < startKey || tx.date >= endKey) continue;
		const dayIndex = daysBetweenKeys(startKey, tx.date) + 1;
		if (dayIndex < 1 || dayIndex > lengthDays) continue;
		const entry = byDay.get(dayIndex) ?? { total: 0, grocery: 0 };
		entry.total += Math.abs(tx.amount);
		if (tx.isGrocery) entry.grocery += Math.abs(tx.amount);
		byDay.set(dayIndex, entry);
	}

	let total = 0;
	let grocery = 0;
	const series: ComparisonPoint[] = [];
	for (let day = 1; day <= lengthDays; day += 1) {
		const dayTotals = byDay.get(day);
		total += dayTotals?.total ?? 0;
		grocery += dayTotals?.grocery ?? 0;
		series.push({ day, total, grocery });
	}
	return series;
}

/**
 * Er serien ikke-synkende i begge kurvene?
 *
 * Finnes fordi feilen var **usynlig i koden og åpenbar på skjermen**: hvert ledd var riktig, og
 * bare den sammensatte kurven var gal. En invariant som kan sjekkes er billigere enn å lese
 * gjennomsnitt-over-populasjon-resonnementet på nytt hver gang noen endrer funksjonen.
 */
export function isMonotonicComparison(points: readonly ComparisonPoint[]): boolean {
	for (let i = 1; i < points.length; i += 1) {
		// Toleranse for flyttallsstøy i divisjonen, ikke for et reelt fall.
		if (points[i].total < points[i - 1].total - 0.001) return false;
		if (points[i].grocery < points[i - 1].grocery - 0.001) return false;
	}
	return true;
}
