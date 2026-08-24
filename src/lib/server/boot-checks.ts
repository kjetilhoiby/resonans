/**
 * Vakter som må holde før serveren tar imot den første forespørselen.
 *
 * ## Hvorfor de finnes
 *
 * To av konfigurasjonsfeilene i denne appen er *stille*: appen starter, svarer
 * 200, og ser ut til å virke — mens grensa den skulle håndheve ikke finnes.
 *
 * 1. **Google-auth er ikke konfigurert.** `authorizationHandle` innledes med
 *    `if (!isGoogleAuthConfigured() || isPublicPath(…)) return resolve(event)`.
 *    Mangler `AUTH_SECRET` eller Google-nøklene, er altså **hele appen åpen** —
 *    hver rute, hvert API, alle data. Grenen finnes for at en fersk klone skal
 *    kunne kjøres uten OAuth-oppsett, og det er riktig lokalt. Deployet er det en
 *    dør uten lås, og den eneste måten å oppdage den på er å prøve.
 * 2. **`CRON_SECRET` mangler.** Cron-vakta er fail-closed (se `cron-auth.ts`), så
 *    en glemt variabel gir 24 endepunkter som svarer 401 til dispatcheren.
 *    Synkjobber og nudger stopper, og ingenting sier fra — `withCronTracking`
 *    kjører aldri, så monitoreringen ser ikke engang et forsøk.
 *
 * Begge er miljøfeil, ikke kodefeil, og begge oppdages først i drift. En
 * container som **nekter å starte** er det motsatte: deployet feiler, forrige
 * versjon står, og feilmeldingen sier hva som mangler.
 *
 * ## Testbarhet
 *
 * Ren funksjon over et miljøobjekt; `hooks.server.ts` leser miljøet og kaller.
 * Samme arbeidsdeling som `user-header-auth.ts` og `cron-auth.ts`.
 */

export interface BootContext {
	/** `true` i lokal utvikling, der begge kravene er valgfrie. */
	isDev: boolean;
	/** Resultatet av `isGoogleAuthConfigured()`. */
	authConfigured: boolean;
	cronSecret: string | undefined;
}

/**
 * Hva som mangler, som ferdige setninger. Tom liste betyr klar til å starte.
 */
export function bootProblems(context: BootContext): string[] {
	if (context.isDev) return [];

	const problems: string[] = [];

	if (!context.authConfigured) {
		problems.push(
			'Google-innlogging er ikke konfigurert (AUTH_SECRET + AUTH_GOOGLE_ID/GOOGLE_CLIENT_ID + ' +
				'AUTH_GOOGLE_SECRET/GOOGLE_CLIENT_SECRET). Uten den slipper autorisasjonshooken ' +
				'ALLE forespørsler gjennom — hele appen ville stått åpen.'
		);
	}

	if (!context.cronSecret) {
		problems.push(
			'CRON_SECRET er ikke satt. Cron-endepunktene avviser da alt, så synkjobber og ' +
				'nudger ville stoppet uten at monitoreringen ser et forsøk.'
		);
	}

	return problems;
}

/**
 * Kaster hvis noe mangler. Kalles én gang ved oppstart.
 *
 * Meldingen er skrevet for å leses i en deploy-logg av noen som ikke har koden
 * foran seg: hva som mangler, og hva konsekvensen ville vært.
 */
export function assertBootReady(context: BootContext): void {
	const problems = bootProblems(context);
	if (problems.length === 0) return;

	throw new Error(
		`[boot] Nekter å starte — ${problems.length} manglende konfigurasjon:\n` +
			problems.map((problem, index) => `  ${index + 1}. ${problem}`).join('\n')
	);
}
