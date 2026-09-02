import { env } from '$env/dynamic/private';

/**
 * Appens egen adresse, til lenker i nudger og e-post.
 *
 * ## Hvorfor den ikke bare er `env.ORIGIN || '<noe>'`
 *
 * Fire steder sto det `env.ORIGIN || '<hardkodet adresse>'`. Fallbacken er
 * usynlig så lenge appen faktisk bor der. Flyttet man appen og glemte `ORIGIN`,
 * ville nudger og e-poster fortsatt bli sendt — med lenker til den gamle
 * adressen. Feilen rammer altså mottakeren, ikke systemet, og er stille: ingen
 * logglinje, ingen feilkode, bare en lenke som tar deg feil sted.
 *
 * Nå: `ORIGIN` når den er satt, ellers **et kast**. Den siste grenen er poenget
 * — det finnes ingen adresse å gjette, og et kast er det eneste svaret som ikke
 * lyver. Cron-dispatcheren nekter dessuten å starte uten `ORIGIN`, så en glemt
 * variabel melder seg i oppstartsloggen framfor i en e-post som peker feil.
 */
export function appOrigin(): string {
	const origin = env.ORIGIN?.trim();
	if (origin) return origin.replace(/\/$/, '');

	throw new Error(
		'ORIGIN er ikke satt. Appen trenger sin egen adresse for å bygge lenker i ' +
			'nudger og e-post — en gjettet adresse ville sendt brukeren til feil sted.'
	);
}

/**
 * Samme, men uten å kaste: `null` når adressen er ukjent.
 *
 * For kallsteder der en manglende adresse skal føre til at noe **ikke** gjøres,
 * framfor at en forespørsel feiler.
 */
export function appOriginOrNull(): string | null {
	try {
		return appOrigin();
	} catch {
		return null;
	}
}
