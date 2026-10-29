/**
 * Retningssamtalen — kvartalsvis konfrontasjon mellom uttalt retning og
 * faktisk hverdag. Rene hjelpere: kvartalsnøkkel, chip-vindu og parsing av
 * <visjon>-blokken fra samtalens siste melding.
 */

/** Kvartalsnøkkel for en dato, f.eks. '2026-Q3'. */
export function quarterPeriodKey(date: Date): string {
	const quarter = Math.floor(date.getMonth() / 3) + 1;
	return `${date.getFullYear()}-Q${quarter}`;
}

/** Antall dager inn i inneværende kvartal (1 = første dag). */
export function daysIntoQuarter(date: Date): number {
	const quarterStartMonth = Math.floor(date.getMonth() / 3) * 3;
	const quarterStart = new Date(date.getFullYear(), quarterStartMonth, 1);
	return Math.floor((date.getTime() - quarterStart.getTime()) / 86_400_000) + 1;
}

/** Chip-vindu: de første ~3 ukene av hvert kvartal. */
export function isInQuarterWindow(date: Date, windowDays = 21): boolean {
	return daysIntoQuarter(date) <= windowDays;
}

/**
 * Hent revidert kvartalsvisjon fra samtalens siste melding — innholdet mellom
 * <visjon>-markørene. Tom streng uten markører (bevisst strengt, så vi aldri
 * lagrer løs prosa som visjon).
 */
export function parseVisionBlock(message: string): string {
	const match = message.match(/<visjon>([\s\S]*?)<\/visjon>/i);
	return match ? match[1].trim() : '';
}

/**
 * Samtalens rolle, arbeidsmåte og tone — delt av flyten i appen og
 * `query_direction` (MCP), så Claude og ChatGPT fører samtalen etter samme
 * instruks som appen. To kopier av en prompt driver fra hverandre uten at noen
 * ser det.
 */
export const DIRECTION_CONVERSATION_ROLE =
	'Dette er retningssamtalen — den kvartalsvise ærlighetssjekken. Brukeren har formulert en langsiktig retning; din jobb er å holde den opp mot hvordan livet faktisk har sett ut, og ikke la noen av delene slippe unna.';

export const DIRECTION_CONVERSATION_METHOD =
	'Arbeidsmåte: Åpne med det tydeligste gapet du ser mellom retningen og syntesen — konkret, uten innpakning («du sa X, men perioden viser Y»). Still ETT spørsmål om gangen. Bruk query-verktøyene hvis du trenger tall. La brukeren også fortelle hva syntesene IKKE fanger. Anerkjenn det som faktisk er på linje — ærlighet går begge veier.';

export const DIRECTION_CONVERSATION_TONE =
	'Norsk. Tone: varm og skarp — du peker på gapene fordi retningen er brukerens egen og du vil at den skal bli virkelig. Se først, utfordre så.';

const QUARTER_KEY = /^(\d{4})-Q([1-4])$/;

export function isValidQuarterKey(value: unknown): value is string {
	return typeof value === 'string' && QUARTER_KEY.test(value);
}

/** Kvartalet en ISO-dato (YYYY-MM-DD) ligger i. Tar Oslo-datoen, ikke et tidspunkt. */
export function quarterKeyFromIsoDate(isoDate: string): string {
	const [year, month] = isoDate.split('-').map(Number);
	return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

/** Negativ når `a` er før `b`. */
export function compareQuarterKeys(a: string, b: string): number {
	const [ay, aq] = a.split('-Q').map(Number);
	const [by, bq] = b.split('-Q').map(Number);
	return ay * 4 + aq - (by * 4 + bq);
}

/** Lik tekst for duplikatsjekk av transkripter: et nytt forsøk på samme lagring skal ikke gi to rader. */
export function sameTranscript(a: string, b: string): boolean {
	const norm = (s: string) => s.trim().replace(/\s+/g, ' ');
	return norm(a) === norm(b);
}
