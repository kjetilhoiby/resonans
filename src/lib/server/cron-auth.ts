/**
 * Autentisering av cron- og scheduler-kall.
 *
 * ## Hvorfor en delt vakt
 *
 * Sjekken lå inline i 24 endepunkter, kopiert fra hverandre. Seks av kopiene
 * hadde drevet fra de øvrige:
 *
 * ```ts
 * if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) { … }
 * ```
 *
 * På Vercel er `VERCEL_ENV` alltid satt, så forskjellen var usynlig. Utenfor
 * Vercel er betingelsen **alltid falsk**, og de seks endepunktene — nudge-utsending,
 * daglig innsjekk, research — står åpne for hvem som helst. Det er nøyaktig den
 * klassen feil en flytting avdekker: koden er riktig for én vert og gal for enhver
 * annen, uten at noe sier fra.
 *
 * `/api/scheduler/trigger` hadde ingen sjekk i det hele tatt, og ligger i
 * `PUBLIC_API_PREFIXES`.
 *
 * ## Hvorfor fail-closed
 *
 * De 18 «riktige» kopiene gater på `env.CRON_SECRET &&` — altså: er hemmeligheten
 * ikke satt, slipper alt gjennom. Det er praktisk lokalt og farlig deployet, og en
 * glemt miljøvariabel er ikke en usannsynlig hendelse midt i en plattformflytting.
 *
 * Vakta krever derfor en hemmelighet så snart vi ikke er i `dev`. For at en glemt
 * variabel ikke skal bli 24 stille 401-er, sjekkes den også ved **oppstart**
 * (`boot-checks.ts`): mangler den, nekter appen å starte. Da feiler deployet,
 * framfor at cronjobbene forsvinner uten at noen merker det.
 *
 * ## Testbarhet
 *
 * `$env/dynamic/private` og `$app/environment` finnes ikke under vitest, så
 * miljøet sendes inn framfor å leses her. Kallstedene bruker `cronAuthContext()`
 * i `cron-auth-env.ts`.
 */

export interface CronAuthContext {
	/** `true` i lokal utvikling, der hemmeligheten er valgfri. */
	isDev: boolean;
	expectedSecret: string | undefined;
}

/** Sammenligning uten tidslekkasje. */
function safeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * Hvorfor kallet skal avvises — eller `null` når det slipper gjennom.
 *
 * Grunnen returneres som tekst fordi et 401 uten forklaring på et cron-endepunkt
 * ser identisk ut enten hemmeligheten mangler, er feilstavet eller ikke ble sendt.
 * Kallstedet logger den; klienten får bare statuskoden.
 */
export function cronAuthProblem(
	headers: { get(name: string): string | null },
	context: CronAuthContext
): string | null {
	const expected = context.expectedSecret;

	if (!expected) {
		if (context.isDev) return null;
		return 'CRON_SECRET er ikke satt — cron-endepunkter avvises. Sett variabelen i miljøet.';
	}

	const provided = headers.get('authorization');
	if (!provided) return 'mangler Authorization-header.';

	return safeEqual(provided, `Bearer ${expected}`) ? null : 'Authorization stemmer ikke.';
}
