/**
 * Feiltekst som skal LAGRES i en kolonne.
 *
 * ## Hvorfor dette finnes
 *
 * `background_jobs.error` og `cron_executions.error` er `text` uten grense, og
 * skrivestien la inn `err.message` rått. Målt i prod 4. september 2026:
 * 28 feilede `workout_projection_refresh`-rader på til sammen ~19 MiB, den
 * største enkeltmeldingen **780 277 tegn**. Alle 28 fingeravtrykk var unike.
 *
 * Kilden er ikke koden vår, det er drizzle. `DrizzleQueryError` bygger
 * meldingen sin som
 *
 * ```
 * Failed query: <hele SQL-en>
 * params: <hver parameter, komma-separert>
 * ```
 *
 * og `refreshForRange` setter inn opptil 2000 canonical-rader i ETT
 * `insert().values(...)`. Det er ~38 000 parametere, hvorav `evidence`,
 * `bestEfforts`, `hrZoneDistribution` og `intensitySplit` er jsonb som
 * serialiseres til fulle JSON-strenger. En feilmelding på 780 KB er ikke en
 * melding, det er en datadump med et prefiks.
 *
 * ## Hvorfor det ikke holder å kappe de første N tegnene
 *
 * Dette er hele poenget med modulen. I en `DrizzleQueryError` ligger
 * *ingenting* om ÅRSAKEN i meldingen — den ligger på `cause`, som er
 * postgres-feilen (`duplicate key value violates unique constraint …`). En
 * naiv `slice(0, 2000)` beholder derfor «Failed query: insert into
 * "canonical_workouts" (…» og kaster nettopp den halvdelen man leter etter.
 * Den lagrede teksten ville sett fyldig ut og vært verdiløs.
 *
 * Derfor: strip `params`-blokka, klipp SQL-en til noe som viser FORMEN
 * (operasjon og tabell), og følg `cause`-kjeden så årsaken blir med.
 *
 * ## Fingeravtrykket blir brukbart av dette, ikke bare kortere
 *
 * `errorFingerprint` i `diagnostics-jobs.ts` svarer på «samme feil som sist?».
 * Med parameterne inne i meldingen var svaret alltid nei — de 28 radene var
 * 28 unike fingeravtrykk av det som antakelig er én feil. Når parameterne er
 * ute, hasher to like brudd likt.
 *
 * Det er grunnen til at kappemerket er en KONSTANT og ikke bærer den
 * opprinnelige lengden: «(kappet, 780277 tegn)» ville gjeninnført
 * variasjonen vi nettopp ble kvitt, siden lengden følger radantallet. Den rå
 * lengden hører i loggen ved siden av stacken — se kallstedene, som logger
 * `errorLength`.
 */

/** Tak for det som lagres i en `error`-kolonne. */
export const MAX_STORED_ERROR_LENGTH = 2000;

/**
 * Tak per ledd i `cause`-kjeden.
 *
 * Klippes hvert ledd for seg, overlever årsaken selv når toppmeldingen er
 * enorm. Klipper vi bare til slutt, spiser en 100 KB toppmelding hele
 * budsjettet og årsaken faller ut — samme feil som en naiv `slice`, ett hakk
 * lenger inn.
 */
export const MAX_ERROR_PART_LENGTH = 500;

/** Hvor mange `cause`-ledd som følges. */
export const MAX_CAUSE_DEPTH = 3;

/** Konstant, se modulkommentaren: et variabelt merke ødelegger fingeravtrykket. */
const TRUNCATION_MARK = '… [kappet]';

const CAUSE_SEPARATOR = '\n← årsak: ';

/**
 * Kapper til `maxLength` med et merke som sier at det skjedde.
 *
 * Merket er en del av lengden, så resultatet er aldri lengre enn `maxLength`.
 */
export function truncateForStorage(text: string, maxLength = MAX_STORED_ERROR_LENGTH): string {
	if (text.length <= maxLength) return text;
	const keep = Math.max(0, maxLength - TRUNCATION_MARK.length);
	return text.slice(0, keep) + TRUNCATION_MARK;
}

/**
 * Én feilmelding, redusert til noe som er verdt å lagre.
 *
 * Fjerner drizzles `params`-blokk i sin helhet — den er ren data og har ingen
 * diagnostisk verdi ved siden av SQL-en som alt sier hva som ble forsøkt — og
 * klipper resten til `MAX_ERROR_PART_LENGTH`.
 */
export function compactErrorMessage(message: string, maxLength = MAX_ERROR_PART_LENGTH): string {
	// Drizzle legger parameterne på en egen linje som starter med `params:`.
	// Alt derfra og ut er datadumpen.
	const withoutParams = message.replace(/\nparams:[\s\S]*$/, '');
	return truncateForStorage(withoutParams.trimEnd(), maxLength);
}

function messageOf(value: unknown): string {
	if (value instanceof Error) return compactErrorMessage(value.message);
	if (typeof value === 'string') return compactErrorMessage(value);
	return compactErrorMessage(String(value));
}

/**
 * Gjør en fanget verdi om til teksten som skal i `error`-kolonnen.
 *
 * Følger `cause`-kjeden, fordi det er DER årsaken ligger når drizzle har
 * pakket feilen. Sykluser brytes; identiske ledd gjentas ikke.
 */
export function describeErrorForStorage(
	err: unknown,
	maxLength = MAX_STORED_ERROR_LENGTH
): string {
	const parts: string[] = [];
	const seen = new Set<unknown>();
	let current: unknown = err;

	for (let depth = 0; depth <= MAX_CAUSE_DEPTH && current != null; depth++) {
		if (typeof current === 'object' && seen.has(current)) break;
		if (typeof current === 'object') seen.add(current);

		const message = messageOf(current);
		if (message && !parts.includes(message)) parts.push(message);

		current = typeof current === 'object' ? (current as { cause?: unknown }).cause : undefined;
	}

	const joined = parts.filter(Boolean).join(CAUSE_SEPARATOR);
	return truncateForStorage(joined || String(err), maxLength);
}
