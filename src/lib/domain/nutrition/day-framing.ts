/**
 * Hvilket tall dagen skal vises som — og hvorfor «underskudd» er feil før midnatt.
 *
 * ## Feilen
 *
 * Kl. 07:27 viste flaten: spist 62 kcal, forbrent 2 458, **underskudd 2 396** i
 * grønt. Det ser ut som en prestasjon og er bare at dagen ikke har begynt.
 *
 * Årsaken er at de to sidene måler ulike ting. Forbruket er et **anslag for hele
 * døgnet** — hvilestoffskiftet ligger der fra midnatt — mens inntaket er **så
 * langt**. Å trekke det ene fra det andre gir et tall som starter maksimalt og
 * krymper utover dagen, altså det motsatte av hva det ser ut som.
 *
 * Teksten under gjorde det verre: «begge tallene vokser fram til midnatt». Vårt
 * forbruksanslag vokser ikke — bare øktene legges til.
 *
 * ## Løsningen: framoverskuende framfor bakoverskuende
 *
 * Før dagen er omme er det ene meningsfulle tallet **hvor mye som er igjen å
 * spise**. Det er handlingsrettet kl. 07 og kl. 15, det krymper naturlig gjennom
 * dagen, og det later ikke som dagen er gjort opp.
 *
 * «Underskudd» eller «overskudd» hører til en **avsluttet** dag, der begge sider
 * dekker samme døgn.
 *
 * ## Hva «igjen» måles mot
 *
 * Har brukeren satt et kcal-mål, er det målet man styrer etter. Ellers brukes
 * forbruksanslaget, som tilsvarer å holde vekta. Vi sier hvilken av dem som er
 * grunnlaget, siden svaret er ulikt.
 */

export type DayFramingMode = 'remaining' | 'settled';

export interface DayFraming {
	mode: DayFramingMode;
	/** Etiketten som skal stå foran tallet. */
	label: string;
	/** Tallet, alltid positivt. Fortegnet ligger i `label` og `direction`. */
	kcal: number;
	/** For en avsluttet dag: under eller over. Null for «igjen». */
	direction: 'deficit' | 'surplus' | 'even' | null;
	/** Hva «igjen» er regnet mot. Null i settled-modus. */
	basis: 'target' | 'expenditure' | null;
	/** Sant når man alt har spist mer enn grunnlaget — «igjen» er da negativt. */
	overBasis: boolean;
}

export function frameDay(input: {
	intakeKcal: number;
	/** Forbruksanslag for hele døgnet. */
	expenditureKcal: number;
	/** Brukerens dagsmål, om satt. */
	targetKcal?: number | null;
	/** Dagen er omme (historisk dag, eller etter midnatt). */
	dayComplete: boolean;
}): DayFraming {
	const { intakeKcal, expenditureKcal, dayComplete } = input;

	if (dayComplete) {
		const balance = Math.round(intakeKcal - expenditureKcal);
		return {
			mode: 'settled',
			label: balance < 0 ? 'Underskudd' : balance > 0 ? 'Overskudd' : 'Balanse',
			kcal: Math.abs(balance),
			direction: balance < 0 ? 'deficit' : balance > 0 ? 'surplus' : 'even',
			basis: null,
			overBasis: false
		};
	}

	const target = typeof input.targetKcal === 'number' && input.targetKcal > 0 ? input.targetKcal : null;
	const basisKcal = target ?? expenditureKcal;
	const remaining = Math.round(basisKcal - intakeKcal);

	return {
		mode: 'remaining',
		label: remaining >= 0 ? 'Igjen i dag' : 'Over for i dag',
		kcal: Math.abs(remaining),
		direction: null,
		basis: target !== null ? 'target' : 'expenditure',
		overBasis: remaining < 0
	};
}
