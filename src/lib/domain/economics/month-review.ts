/**
 * Månedsgjennomgangen: fire spørsmål ved lønn.
 *
 * Brukeren valgte alle fire i intervjuet, og rekkefølgen er ikke tilfeldig — den går fra det
 * som avgjør handling nå, til det som kan vente. Se
 * `docs/changelog/2026-08-11-okonomi-tillitsgjennomgang.md`, fase 6.
 *
 * 1. Bærer måneden som kommer?
 * 2. Hva var uvanlig forrige måned?
 * 3. Gikk vi over noe vi hadde avtalt?
 * 4. Hva er én ting å gjøre noe med?
 *
 * **Hvert svar bærer sin egen begrunnelse, og «vet ikke» er et gyldig svar.** Et tall uten
 * forbehold blir trodd mer enn det fortjener, og en gjennomgang som later som den vet noe
 * den ikke vet, blir sluttet å lese. Spørsmål 3 besvares av mål-progresjonen som allerede
 * finnes; denne modulen dekker 1, 2 og 4.
 */

// ── Terskler ────────────────────────────────────────────────────────────────

/** Færre hele perioder enn dette, og «forventet variabelt forbruk» er en gjetning. */
export const MIN_PERIODS_FOR_FORECAST = 2;

/**
 * Færre måneder enn dette per kategori, og «uvanlig» kan ikke skilles fra normal variasjon.
 * Tre gir en median og et avvik; to gir bare to tall.
 */
export const MIN_MONTHS_FOR_DEVIATION = 3;

/**
 * Gulv i kroner for at et avvik er verdt å nevne. Uten det ville en kategori på 200 kr som
 * dobler seg konkurrert med husleia om oppmerksomheten.
 */
export const DEVIATION_FLOOR_KR = 500;

/**
 * Hvor mange ganger medianavviket en kategori må ligge over sin egen normal for å kalles
 * uvanlig. Terskelen er relativ til kategoriens EGEN spredning, ikke en fast prosent —
 * dagligvarer svinger lite fra måned til måned, hobby svinger mye, og en fast prosent ville
 * bare rapportert de volatile kategoriene hver gang.
 */
export const DEVIATION_MAD_FACTOR = 2;

// ── 1. Bærer måneden som kommer? ────────────────────────────────────────────

export type MonthAheadInput = {
	/** Lønn inn denne perioden. Null når den ikke er funnet. */
	income: number | null;
	/** Faste utgifter, fra forrige hele periode. */
	fixedCosts: number | null;
	/** Variabelt forbruk per periode, snitt over de foregående hele periodene. */
	variableCostsPerPeriod: number | null;
	/** Hvor mange hele perioder snittet hviler på. */
	periodsObserved: number;
	/** Måneders dekning i bufferen, som kryssjekk. */
	bufferRunwayMonths?: number | null;
};

export type MonthAhead = {
	/** Null når grunnlaget mangler — ikke `false`. */
	carries: boolean | null;
	/** Inntekt minus faste minus forventet variabelt. Null når grunnlaget mangler. */
	margin: number | null;
	reason: string;
};

function nok(value: number): string {
	return `${Math.round(value).toLocaleString('nb-NO')} kr`;
}

/**
 * **`carries: null` er ikke `false`.** «Vi vet ikke om måneden bærer» og «måneden bærer
 * ikke» er helt ulike beskjeder, og den andre skal ikke sies på et tynt grunnlag.
 */
export function assessMonthAhead(input: MonthAheadInput): MonthAhead {
	const { income, fixedCosts, variableCostsPerPeriod, periodsObserved, bufferRunwayMonths } =
		input;

	if (income === null) {
		return {
			carries: null,
			margin: null,
			reason: 'Ingen lønnsutbetaling funnet i perioden, så det er ingenting å regne mot.'
		};
	}
	if (fixedCosts === null || variableCostsPerPeriod === null) {
		return {
			carries: null,
			margin: null,
			reason: 'Mangler fast/variabelt-splitt for forrige periode.'
		};
	}
	if (periodsObserved < MIN_PERIODS_FOR_FORECAST) {
		return {
			carries: null,
			margin: null,
			reason: `Forventet forbruk hviler på ${periodsObserved} hel${periodsObserved === 1 ? '' : 'e'} periode${periodsObserved === 1 ? '' : 'r'} — trenger ${MIN_PERIODS_FOR_FORECAST}.`
		};
	}

	const margin = income - fixedCosts - variableCostsPerPeriod;
	const base = `${nok(income)} inn, ${nok(fixedCosts)} fast og ${nok(variableCostsPerPeriod)} i vanlig variabelt forbruk`;

	if (margin >= 0) {
		return {
			carries: true,
			margin,
			reason: `${base} — det står ${nok(margin)} igjen.`
		};
	}

	// Bufferen nevnes bare når den mangler, ikke som en trøst. En måned som ikke bærer er
	// verdt å si tydelig, og bufferen er svaret på «hva skjer da», ikke på «går det bra».
	const bufferNote =
		bufferRunwayMonths !== null && bufferRunwayMonths !== undefined
			? ` Bufferen dekker ${bufferRunwayMonths.toFixed(1).replace('.', ',')} måneder.`
			: '';

	return {
		carries: false,
		margin,
		reason: `${base} — det mangler ${nok(Math.abs(margin))}.${bufferNote}`
	};
}

// ── 2. Hva var uvanlig forrige måned? ───────────────────────────────────────

export type CategoryHistory = {
	category: string;
	label: string;
	emoji: string;
	/** Beløp denne perioden. */
	current: number;
	/** Beløp i de foregående hele periodene, nyeste først. */
	previous: number[];
};

export type CategoryDeviation = {
	category: string;
	label: string;
	emoji: string;
	current: number;
	/** Kategoriens egen normal (median av de foregående). */
	normal: number;
	/** Kroner over/under normalen. Positiv = mer enn vanlig. */
	delta: number;
	direction: 'over' | 'under';
	reason: string;
};

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Medianavvik — robust mot den ene måneden som var helt annerledes. */
function medianAbsoluteDeviation(values: readonly number[], center: number): number {
	return median(values.map((v) => Math.abs(v - center)));
}

/**
 * Kategorier som skiller seg fra sin EGEN normal.
 *
 * Ikke hele fordelingen — bare avvikene. Brukeren ba om «hva var uvanlig», ikke «hva gikk
 * pengene til»; det siste er forbrukskortet.
 *
 * **Terskelen er utledet av kategoriens egen spredning**, ikke en fast prosent. Dagligvarer
 * svinger lite fra måned til måned mens hobby svinger mye, og en fast prosent ville rapportert
 * de volatile kategoriene hver eneste måned — altså blitt bakgrunnsstøy.
 */
export function findUnusualCategories(
	histories: readonly CategoryHistory[]
): CategoryDeviation[] {
	const deviations: CategoryDeviation[] = [];

	for (const history of histories) {
		if (history.previous.length < MIN_MONTHS_FOR_DEVIATION) continue;

		const normal = median(history.previous);
		const delta = history.current - normal;
		if (Math.abs(delta) < DEVIATION_FLOOR_KR) continue;

		const mad = medianAbsoluteDeviation(history.previous, normal);
		// Er spredningen null (identisk beløp hver måned, typisk et abonnement), holder
		// kronegulvet alene. Ellers må avviket overstige kategoriens egen variasjon.
		const threshold = mad === 0 ? DEVIATION_FLOOR_KR : mad * DEVIATION_MAD_FACTOR;
		if (Math.abs(delta) < threshold) continue;

		const direction = delta > 0 ? 'over' : 'under';
		deviations.push({
			category: history.category,
			label: history.label,
			emoji: history.emoji,
			current: history.current,
			normal,
			delta,
			direction,
			reason:
				direction === 'over'
					? `${nok(history.current)} mot ${nok(normal)} normalt — ${nok(Math.abs(delta))} mer.`
					: `${nok(history.current)} mot ${nok(normal)} normalt — ${nok(Math.abs(delta))} mindre.`
		});
	}

	return deviations.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

// ── 4. Hva er én ting å gjøre noe med? ──────────────────────────────────────

export type ActionCandidate = {
	kind: 'kategori-vokser' | 'over-tak' | 'buffer-eroderer' | 'uklassifisert-vipps';
	/** Hvor mye det står om, i kroner. Brukes til å rangere. */
	amountKr: number;
	text: string;
};

export type OneThing = {
	/** Null er et GYLDIG svar. Se begrunnelsen under. */
	action: ActionCandidate | null;
	reason: string;
};

/**
 * Velger ÉN ting, eller ingenting.
 *
 * **«Ingenting å gjøre noe med» er et gyldig svar**, og det er en bevisst gjentakelse av
 * lærdommen fra øktvurderingen: «avslutt med ett råd» tvang fram «løp mer» på hver eneste
 * økt, og et råd som alltid kommer slutter å bety noe. En måned der alt ser normalt ut skal
 * si det.
 *
 * Rangeres på kroner, ikke på hvor interessant funnet er — samme regel som prioriteringen av
 * fasene selv.
 */
export function pickOneThing(candidates: readonly ActionCandidate[]): OneThing {
	if (candidates.length === 0) {
		return {
			action: null,
			reason: 'Ingenting skiller seg ut denne måneden. Det er også et svar.'
		};
	}

	const ranked = [...candidates].sort((a, b) => b.amountKr - a.amountKr);
	return { action: ranked[0], reason: `Størst utslag: ${nok(ranked[0].amountKr)}.` };
}
