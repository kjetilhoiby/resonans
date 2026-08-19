/**
 * Hull i lønnsdatoene — en manglende rad skal ikke gi en periode på 58 dager.
 *
 * ## Målingen
 *
 * `pickBestPerMonth` gir **én lønnsdato per kalendermåned**, og en måned uten kandidatrad gir
 * ingen dato i det hele tatt. Målt i prod 18. august 2026:
 *
 * ```
 * 2026-01-22  54 687,92  AMEDIA PRODUKT OG TEKNOLOGI AS
 * 2026-02-24  54 687,92  AMEDIA PRODUKT OG TEKNOLOGI AS
 *          ← mars mangler
 * 2026-04-23  54 687,92  AMEDIA PRODUKT OG TEKNOLOGI AS
 * 2026-05-21  87 824,86  AMEDIA PRODUKT OG TEKNOLOGI AS
 * ```
 *
 * 24. februar → 23. april er **58 dager**, og det var nøyaktig den «lønnsperioden» som gjorde
 * snittkurven på Økonomi-oversikten ubrukelig. Én manglende rad forplantet seg til en graf.
 *
 * ## Lønna kom, raden gjorde ikke
 *
 * Lønnskontoen dekker 2025-12-30 til 2026-08-17 med 524 transaksjoner, så mars er et **hull i
 * dataene, ikke en kant**. Og på en annen konto står `2026-03-24 12 500,00 Kjetil Høiby` — den
 * faste overføringen brukeren gjør rett etter lønn. Lønna kom altså rundt 23. mars; raden nådde
 * aldri canonical.
 *
 * Det er derfor riktig å slutte at det fantes en lønnsdato. **Men det er en slutning**, og den
 * merkes: `inferred` sier hvilke datoer som ikke er observert.
 *
 * ## Hvorfor ikke bare la hullet stå
 *
 * Alternativet er ikke «ingen påstand» — det er påstanden «februar og april var én lønnsperiode
 * på 58 dager», som er konkret og gal. Et hull er ikke et fravær av data i konsumentene; det er
 * feil data. Valget står mellom to slutninger, og den merkede er bedre.
 *
 * Vaktene er derfor mot å slutte for MYE, ikke mot å slutte:
 *
 * - **`MAX_INFERRED_RUN`** — et hull på flere måneder er ikke en tapt rad. Det er jobbskifte,
 *   permisjon eller en synk som aldri kjørte, og da skal ingen datoer diktes opp.
 * - **`MIN_OBSERVED`** — uten nok observerte lønninger finnes det ingen pålitelig lønnsdag å
 *   plassere den antatte datoen på, og da er gjetningen en gjetning med selvtillit.
 *
 * Se `docs/changelog/2026-08-18-manglende-lonnsdato.md`.
 */

/**
 * Hvor mange måneder på rad som kan antas.
 *
 * 2 dekker en tapt rad og en tapt synk. Tre måneder uten lønn er en livshendelse, ikke en
 * databuffer — og å dikte opp tre lønninger ville skjult nettopp den hendelsen.
 */
export const MAX_INFERRED_RUN = 2;

/** Færre observerte lønninger enn dette gir ingen pålitelig lønnsdag å plassere hullet på. */
export const MIN_OBSERVED = 3;

export type PaydaySeries = {
	/** Observerte + antatte datoer, sortert stigende. Dette er lista konsumentene skal bruke. */
	dates: string[];
	/** Datoene som faktisk finnes som rader. */
	observed: string[];
	/**
	 * Datoene som er sluttet fra lønnsdagen fordi måneden manglet en rad.
	 *
	 * Rapporteres så en flate kan si det. En antatt dato som ser observert ut er verre enn et
	 * hull, fordi ingen da kan etterprøve tallet den bærer.
	 */
	inferred: string[];
	/** Måneder som ble hoppet over fordi hullet var for langt å anta. `YYYY-MM`. */
	skippedMonths: string[];
	/** Lønnsdagen antagelsene ble plassert på, eller null når ingen ble gjort. */
	inferredDom: number | null;
};

function isWeekend(date: Date): boolean {
	const day = date.getUTCDay();
	return day === 0 || day === 6;
}

function median(nums: readonly number[]): number {
	if (nums.length === 0) return 0;
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Antall kalendermåneder mellom to `YYYY-MM`-nøkler. */
function monthsBetween(fromMonth: string, toMonth: string): number {
	const [fy, fm] = fromMonth.split('-').map(Number);
	const [ty, tm] = toMonth.split('-').map(Number);
	return (ty - fy) * 12 + (tm - fm);
}

function addMonths(month: string, count: number): string {
	const [y, m] = month.split('-').map(Number);
	const total = (y * 12 + (m - 1)) + count;
	const year = Math.floor(total / 12);
	const monthIndex = total % 12;
	return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function daysInMonth(month: string): number {
	const [y, m] = month.split('-').map(Number);
	return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Plasserer lønnsdagen i en måned, trukket bakover fra helg.
 *
 * Begge justeringene er nødvendige og av ulik grunn: klemmingen mot månedslengden hindrer at
 * dag 31 blir 3. mars, og helgetrekket følger at lønn utbetales siste virkedag før — samme
 * antagelse som `businessDayDom` i detektoren bygger på.
 */
function paydayInMonth(month: string, dom: number): string {
	const clamped = Math.min(Math.max(1, dom), daysInMonth(month));
	const [y, m] = month.split('-').map(Number);
	const date = new Date(Date.UTC(y, m - 1, clamped, 12));
	while (isWeekend(date)) date.setUTCDate(date.getUTCDate() - 1);
	return date.toISOString().slice(0, 10);
}

/**
 * Fyller hull i lønnsdatoene med den antatte lønnsdagen.
 *
 * `observedDates` er `YYYY-MM-DD`, i vilkårlig rekkefølge. Duplikater innenfor samme måned
 * tolereres — den tidligste beholdes, som er det `pickBestPerMonth` allerede sikter på.
 */
export function fillPaydayGaps(observedDates: readonly string[]): PaydaySeries {
	// Én dato per måned, tidligste vinner. To datoer i samme måned ville ellers gitt et
	// «hull» på 0 måneder og forvirret avstandsregningen.
	const byMonth = new Map<string, string>();
	for (const date of observedDates) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
		const month = date.slice(0, 7);
		const existing = byMonth.get(month);
		if (!existing || date < existing) byMonth.set(month, date);
	}

	const observed = [...byMonth.values()].sort();
	const empty: PaydaySeries = {
		dates: observed,
		observed,
		inferred: [],
		skippedMonths: [],
		inferredDom: null
	};

	if (observed.length < MIN_OBSERVED) return empty;

	// Lønnsdagen: medianen av de observerte, men **uten de sene datoene**. En lønning som
	// glir til den 28. fordi den 25. var en søndag skal ikke flytte medianen — samme
	// begrunnelse som `domNoLate` i detektoren.
	const doms = observed.map((d) => Number(d.slice(8, 10)));
	const notLate = doms.filter((d) => d <= 25);
	const dom = Math.round(median(notLate.length > 0 ? notLate : doms));

	const inferred: string[] = [];
	const skippedMonths: string[] = [];

	for (let i = 1; i < observed.length; i += 1) {
		const prevMonth = observed[i - 1].slice(0, 7);
		const gap = monthsBetween(prevMonth, observed[i].slice(0, 7));
		// gap === 1 er normalen: to lønninger i påfølgende måneder.
		if (gap <= 1) continue;

		const missing = gap - 1;
		const months = Array.from({ length: missing }, (_, k) => addMonths(prevMonth, k + 1));
		if (missing > MAX_INFERRED_RUN) {
			// **Hoppes over, men rapporteres.** En stille utelatelse ser ut som full dekning, og
			// det var nettopp det som gjorde 58-dagersperioden vanskelig å feste.
			skippedMonths.push(...months);
			continue;
		}
		inferred.push(...months.map((month) => paydayInMonth(month, dom)));
	}

	return {
		dates: [...observed, ...inferred].sort(),
		observed,
		inferred,
		skippedMonths,
		inferredDom: inferred.length > 0 ? dom : null
	};
}

/**
 * Lengste avstand mellom to påfølgende datoer, i dager.
 *
 * Finnes som en **etterprøvbar sjekk**: er den mye over ~31 etter utfyllingen, står det
 * fortsatt et hull, og da er det et hull vakten bevisst nektet å fylle. Samme rolle som
 * `isMonotonicComparison` har for snittkurven — invarianten formuleres framfor å leses ut av
 * koden.
 */
export function longestPaydayGapDays(dates: readonly string[]): number {
	if (dates.length < 2) return 0;
	const sorted = [...dates].sort();
	let longest = 0;
	for (let i = 1; i < sorted.length; i += 1) {
		const from = new Date(`${sorted[i - 1]}T12:00:00Z`).getTime();
		const to = new Date(`${sorted[i]}T12:00:00Z`).getTime();
		longest = Math.max(longest, Math.round((to - from) / 86400000));
	}
	return longest;
}
