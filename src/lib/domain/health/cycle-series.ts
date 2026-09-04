/**
 * Sesongkurver: samme kalenderperiode lagt oppå hverandre, år etter år.
 *
 * ## Hva den svarer på som en vanlig tidslinje ikke gjør
 *
 * En kurve langs kalendertid svarer på «hva har skjedd». Den svarer ikke på «er
 * dette normalt for meg i august», og den svarer særlig ikke på «ligger jeg
 * foran i fjor». Til det må årene ligge oppå hverandre med samme x-akse: dag 1
 * til dag 365. Da blir avstanden mellom to linjer på samme dato et tall man kan
 * handle på, og formen på fjorårets kurve blir en prognose for resten av året.
 *
 * Motoren er felles for vekt og løp, og for år og måned, fordi spørsmålet er
 * det samme og bare enheten er ulik. Tre kopier av denne grupperingen ville
 * blitt tre ulike svar på «hvor langt ut i perioden er jeg».
 *
 * ## De tre modusene
 *
 * - `level`: verdien som den er. Vekt i kilo.
 * - `change`: verdien minus periodens FØRSTE verdi. «Endring fra dag 0.» Gjør
 *   år med ulikt utgangspunkt sammenlignbare — det er formen man vil se, ikke
 *   nivået.
 * - `cumulative`: summen så langt i perioden. Løpte kilometer hittil i år.
 *
 * ## To skjevheter som ikke er feil, men som flaten må si
 *
 * **Skuddår forskyver med én dag.** 1. mars er dag 61 i et skuddår og dag 60
 * ellers, så to like datoer havner én piksel fra hverandre etter februar. Å
 * kaste 29. februar ville kastet en ekte økt; å normalisere til brøk ville
 * gjort «samme dato» til noe annet enn samme dato. Ett døgn på en akse med 365
 * er under en piksel på en telefon, og det er den billigste av de tre feilene.
 *
 * **`change` måler fra periodens første MÅLING, ikke fra 1. januar.** Startet
 * du å veie deg 12. januar, er dag 12 nullpunktet ditt det året. Serien bærer
 * derfor `startDate` og `startValue`, så flaten kan si det framfor å late som
 * om alle årene startet samtidig.
 */

/** Én observasjon inn i sesongkurvene. Datoen er `YYYY-MM-DD` i visningens tidssone. */
export interface DayValue {
	date: string;
	value: number;
}

/** År legger dag 1–366 oppå hverandre; måned legger dag 1–31 oppå hverandre. */
export type CycleKind = 'year' | 'month';

export type CycleMode = 'level' | 'change' | 'cumulative';

export interface CyclePoint {
	/** Posisjonen i perioden: dag i året (1–366) eller dag i måneden (1–31). */
	index: number;
	value: number;
	/** Den faktiske datoen, så en avlesning kan si hva den gjelder. */
	date: string;
}

export interface CycleSeries {
	/** `2026` for år, `2026-08` for måned. Stigende sortering er kronologisk. */
	key: string;
	/** Det flaten skriver: «2026» eller «aug. 2026». */
	label: string;
	points: CyclePoint[];
	/** Sann for perioden vi er inne i nå. Bare én serie kan ha den. */
	isCurrent: boolean;
	/** Siste punkt i serien. Null når serien er tom. */
	last: CyclePoint | null;
	/** Første måling i perioden. */
	startDate: string | null;
	/** Verdien på den første målingen, i rå form (før modus er anvendt). */
	startValue: number | null;
	/**
	 * Nullpunktet `change` faktisk målte fra — datoen og den rå verdien.
	 *
	 * Uten et anker er dette periodens første måling. Med et anker er det den
	 * siste målingen på eller før ankerdagen, altså periodens EGEN verdi den
	 * dagen. To år ankret på 1. juni nullstilles hver på sin egen 1. juni, og
	 * det er nettopp det som gjør kurvene sammenlignbare derfra.
	 *
	 * Null når perioden ikke hadde noen måling så tidlig. Da er `points` tom:
	 * en periode uten et nullpunkt kan ikke tegnes i endringsmodus, og en
	 * gjetning ville vært en linje som påstår noe den ikke har målt.
	 */
	baselineDate: string | null;
	baselineValue: number | null;
}

const MONTHS_SHORT = [
	'jan.',
	'feb.',
	'mar.',
	'apr.',
	'mai',
	'jun.',
	'jul.',
	'aug.',
	'sep.',
	'okt.',
	'nov.',
	'des.'
];

/** Dag i året, 1–366. `2026-01-01` er 1. */
export function dayOfYear(date: string): number {
	const [year, month, day] = date.split('-').map(Number);
	const start = Date.UTC(year, 0, 1);
	const at = Date.UTC(year, month - 1, day);
	return Math.round((at - start) / 86_400_000) + 1;
}

/** Dag i måneden, 1–31. */
export function dayOfMonth(date: string): number {
	return Number(date.slice(8, 10));
}

/** Periodenøkkelen en dato hører til: `2026` eller `2026-08`. */
export function cycleKeyOf(date: string, cycle: CycleKind): string {
	return cycle === 'year' ? date.slice(0, 4) : date.slice(0, 7);
}

export function cycleIndexOf(date: string, cycle: CycleKind): number {
	return cycle === 'year' ? dayOfYear(date) : dayOfMonth(date);
}

/** Antall posisjoner på x-aksen. Fast, så alle periodene deler skala. */
export function cycleLength(cycle: CycleKind): number {
	return cycle === 'year' ? 366 : 31;
}

export function cycleLabel(key: string, cycle: CycleKind): string {
	if (cycle === 'year') return key;
	const [year, month] = key.split('-').map(Number);
	return `${MONTHS_SHORT[month - 1]} ${year}`;
}

export interface BuildCycleOptions {
	cycle: CycleKind;
	mode: CycleMode;
	/** Dagens dato, `YYYY-MM-DD`. Avgjør hvilken serie som er «nå». */
	today: string;
	/**
	 * Hvor mange perioder som beholdes, nyeste først.
	 *
	 * Et tak, ikke et vindu: eldre perioder faller bort i sin helhet framfor å
	 * bli klippet på midten. En halv sesong tegnet som en hel er en påstand om
	 * at året sluttet i mai.
	 */
	maxSeries?: number;
	/**
	 * Posisjonen i perioden som settes til null i `change`-modus.
	 *
	 * Uten den måles hver periode fra sin egen første verdi, som er riktig
	 * standard: alle periodene får da et nullpunkt, uansett når de begynte å
	 * måle. Med den kan man spørre et annet spørsmål — «hvordan har det gått
	 * siden 1. juni, år for år» — og da må hver periode nullstilles på SIN egen
	 * 1. juni, ikke på en felles verdi.
	 *
	 * Ignoreres i `level`- og `cumulative`-modus, der et nullpunkt ikke betyr
	 * noe: nivået er nivået, og en akkumulert sum starter alltid på null.
	 */
	anchorIndex?: number;
}

/**
 * Observasjoner → én serie per periode, lagt oppå hverandre.
 *
 * Observasjonene trenger ikke være sortert; periodene sorteres kronologisk og
 * punktene innenfor hver periode stigende. Flere observasjoner på samme dag
 * summeres for `cumulative` og erstattes av den siste for `level`/`change` —
 * en vekt måles flere ganger om dagen, en løpetur legges til.
 */
export function buildCycleSeries(
	values: readonly DayValue[],
	{ cycle, mode, today, maxSeries, anchorIndex }: BuildCycleOptions
): CycleSeries[] {
	const byKey = new Map<string, Map<string, number>>();

	for (const { date, value } of values) {
		if (!Number.isFinite(value)) continue;
		const key = cycleKeyOf(date, cycle);
		const days = byKey.get(key) ?? new Map<string, number>();
		if (mode === 'cumulative') {
			days.set(date, (days.get(date) ?? 0) + value);
		} else {
			// Siste måling på dagen vinner. Dagsverdiene er som regel alt aggregert
			// av kalleren; dette er sikkerhetsnettet, ikke hovedveien.
			days.set(date, value);
		}
		byKey.set(key, days);
	}

	const currentKey = cycleKeyOf(today, cycle);
	const keys = [...byKey.keys()].sort();
	const kept = maxSeries !== undefined && maxSeries > 0 ? keys.slice(-maxSeries) : keys;

	return kept.map((key) => {
		const days = [...byKey.get(key)!.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
		const startDate = days[0]?.[0] ?? null;
		const startValue = days[0]?.[1] ?? null;

		/**
		 * Nullpunktet: siste måling på eller før ankerdagen, ellers periodens
		 * første. Bakover, aldri framover — en verdi målt etter ankeret er ikke
		 * hva perioden sto på den dagen.
		 */
		let baselineDate: string | null = startDate;
		let baselineValue: number | null = startValue;
		if (mode === 'change' && anchorIndex !== undefined) {
			baselineDate = null;
			baselineValue = null;
			for (const [date, value] of days) {
				if (cycleIndexOf(date, cycle) > anchorIndex) break;
				baselineDate = date;
				baselineValue = value;
			}
		}

		const anchored = mode !== 'change' || baselineValue !== null;

		let running = 0;
		const points: CyclePoint[] = anchored
			? days.map(([date, value]) => {
					running += value;
					const shown =
						mode === 'cumulative'
							? running
							: mode === 'change'
								? value - (baselineValue ?? 0)
								: value;
					return { index: cycleIndexOf(date, cycle), value: shown, date };
				})
			: [];

		return {
			key,
			label: cycleLabel(key, cycle),
			points,
			isCurrent: key === currentKey,
			last: points.at(-1) ?? null,
			startDate,
			startValue,
			baselineDate,
			baselineValue
		};
	});
}

/**
 * Verdien en serie hadde ved en gitt posisjon i perioden.
 *
 * Ser BAKOVER til nærmeste punkt, aldri framover: for en akkumulert kurve er
 * verdien på dag 200 summen fram til dag 200, også når man sist løp på dag 193.
 * Interpolasjon mellom nabopunkter ville oppfunnet kilometer i et hull.
 *
 * Returnerer null når perioden ikke hadde noe punkt så tidlig — da har den ikke
 * en verdi på det tidspunktet, og en 0 ville vært et svar den ikke har.
 */
export function valueAtIndex(series: CycleSeries, index: number): number | null {
	let found: number | null = null;
	for (const point of series.points) {
		if (point.index > index) break;
		found = point.value;
	}
	return found;
}

/**
 * Sammenligningen flaten faktisk skal skrive: hvor står inneværende periode mot
 * de forrige, målt på SAMME posisjon i perioden.
 *
 * Sammenligningspunktet er inneværende periodes siste punkt. Å sammenligne mot
 * andres sluttall ville målt en hel sesong mot en halv — den vanligste feilen i
 * en år-mot-år-graf, og den ser ut som at man ligger langt bak i februar.
 */
export interface CycleComparison {
	/** Posisjonen sammenligningen er gjort på. */
	index: number;
	current: number;
	/** Forrige periode med data på samme posisjon, hvis den finnes. */
	previous: { key: string; label: string; value: number } | null;
	/** Snittet av alle tidligere perioder som hadde data på samme posisjon. */
	averageBefore: number | null;
	/** Hvor mange tidligere perioder snittet er bygget av. */
	periodsCompared: number;
}

export function compareCurrentToPrevious(series: readonly CycleSeries[]): CycleComparison | null {
	const current = series.find((s) => s.isCurrent);
	if (!current?.last) return null;

	const index = current.last.index;
	const earlier = series.filter((s) => !s.isCurrent && s.key < current.key);

	const values: Array<{ key: string; label: string; value: number }> = [];
	for (const other of earlier) {
		const value = valueAtIndex(other, index);
		if (value !== null) values.push({ key: other.key, label: other.label, value });
	}

	const previous = values.at(-1) ?? null;
	const averageBefore =
		values.length > 0 ? values.reduce((sum, v) => sum + v.value, 0) / values.length : null;

	return {
		index,
		current: current.last.value,
		previous,
		averageBefore,
		periodsCompared: values.length
	};
}

/** Spennet alle seriene dekker. Aksen må dekke alle årene, ikke bare det aktive. */
export function cycleValueRange(
	series: readonly CycleSeries[]
): { min: number; max: number } | null {
	let min = Number.POSITIVE_INFINITY;
	let max = Number.NEGATIVE_INFINITY;
	let seen = false;
	for (const s of series) {
		for (const point of s.points) {
			seen = true;
			if (point.value < min) min = point.value;
			if (point.value > max) max = point.value;
		}
	}
	return seen ? { min, max } : null;
}

/**
 * Setningen flaten skriver over grafen.
 *
 * Bor i domenelaget fordi den bærer forbeholdet: sammenligningen er gjort på
 * SAMME dag i perioden, ikke mot fjorårets sluttall, og det er forskjellen
 * mellom «du ligger 32 km foran» og «du ligger 380 km bak» i mars.
 *
 * `higherIsBetter` er ikke en smakssak: 32 km mer enn i fjor er «foran», mens
 * 2 kg mer er ikke det. Uten flagget måtte hver flate funnet sine egne ord, og
 * de to ville før eller siden ment noe ulikt med «bedre».
 */
/**
 * Ordparet sammenligningen bruker, valgt av hva verdien ER.
 *
 * `progress` («foran»/«bak») forutsetter at det finnes en god retning, og er
 * riktig når verdien akkumulerer mot noe: løpte kilometer, eller en nedgang
 * målt fra periodens start. Å ligge foran er da en meningsfull påstand.
 *
 * `position` («under»/«over») sier bare hvor du står. Det er riktig for et
 * NIVÅ, og forskjellen er ikke kosmetisk: «2,4 kg foran i fjor» leser som en
 * konkurranse mot deg selv, der setningen bare skal si hvor vekta ligger. En
 * flate som legger en dom på et tall den ikke kan tolke, gjør nøyaktig det vi
 * lar være andre steder — «over båndet er ikke et helsevarsel».
 *
 * Endringsmodus i vektkortet er derfor `progress`, ikke `position`: der er
 * verdien et delta, og «2,4 kg under i fjor» om en nedgang sier ikke om du har
 * gått mer eller mindre ned.
 */
export type CycleComparisonVocabulary = 'progress' | 'position';

/** Felles for begge ordforrådene. */
interface CycleComparisonTextBase {
	unit: string;
	decimals?: number;
	/** «i fjor» / «forrige måned» — hva den forrige perioden heter. */
	previousNoun: string;
}

/**
 * Union framfor ett valgfritt felt: `higherIsBetter` er meningsløs for
 * `position` (en posisjon har ingen god retning), og et felt som ignoreres
 * stille inviterer til å tro at det virker.
 */
export type CycleComparisonTextOptions =
	| (CycleComparisonTextBase & { vocabulary: 'position' })
	| (CycleComparisonTextBase & {
			vocabulary?: 'progress';
			/** Sann for løpte kilometer, usann for en vektnedgang. */
			higherIsBetter: boolean;
	  });

export function describeCycleComparison(
	comparison: CycleComparison | null,
	opts: CycleComparisonTextOptions
): string | null {
	if (!comparison?.previous) return null;

	const decimals = opts.decimals ?? 0;
	const diff = comparison.current - comparison.previous.value;
	const size = Math.abs(diff).toFixed(decimals).replace('.', ',');
	const position = opts.vocabulary === 'position';

	if (Math.abs(diff) < Math.pow(10, -decimals) / 2) {
		return position
			? `Samme som ${opts.previousNoun} på samme dato.`
			: `Like langt som ${opts.previousNoun} på samme dato.`;
	}

	if (position) {
		return `${size} ${opts.unit} ${diff < 0 ? 'under' : 'over'} ${opts.previousNoun} på samme dato.`;
	}

	const ahead = opts.higherIsBetter ? diff > 0 : diff < 0;
	return `${size} ${opts.unit} ${ahead ? 'foran' : 'bak'} ${opts.previousNoun} på samme dato.`;
}
