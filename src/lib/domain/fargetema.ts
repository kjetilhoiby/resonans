/**
 * Fargetemaet: lyst (blekk på krem) eller mørkt (natt), valgt av brukeren eller
 * fulgt etter systemet. Se `docs/changelog/2026-10-08-alle-flater-i-valgt-tema.md`.
 *
 * Ordet er «fargetema», ikke «tema», med vilje: et tema i Resonans er et
 * livsområde (Helse, Hjem, Familie), og to betydninger av samme ord i samme
 * kodebase blir en feil noen gang.
 *
 * Valget bor i en cookie, ikke i localStorage: serveren setter
 * `data-fargetema` på `<html>` før siden sendes, så en side i lyst tema ikke
 * blinker mørkt først. localStorage kan bare leses etter at siden er tegnet.
 */

export const FARGETEMA_VALG = ['system', 'lys', 'mork'] as const;
export type Fargetema = (typeof FARGETEMA_VALG)[number];

export const FARGETEMA_COOKIE = 'resonans_fargetema';

/** Ett år. Valget er en innstilling, ikke en økt. */
export const FARGETEMA_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Standarden er å følge telefonen: nattmodus kommer da når telefonen sier natt. */
export const DEFAULT_FARGETEMA: Fargetema = 'system';

export const FARGETEMA_ETIKETTER: Record<Fargetema, string> = {
	system: 'Følg telefonen',
	lys: 'Lyst',
	mork: 'Mørkt'
};

/**
 * Tolker cookie-verdien. Alt ukjent blir standarden — en gammel eller
 * håndskrevet verdi skal gi en side som virker, ikke en uten farger.
 */
export function parseFargetema(value: string | null | undefined): Fargetema {
	return (FARGETEMA_VALG as readonly string[]).includes(value ?? '') ? (value as Fargetema) : DEFAULT_FARGETEMA;
}

/** Cookie-strengen klienten skriver når brukeren bytter. */
export function fargetemaCookie(valg: Fargetema): string {
	return `${FARGETEMA_COOKIE}=${valg}; Path=/; Max-Age=${FARGETEMA_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Setter attributtet på `<html>` i den ferdige HTML-en. Plassholderen står i
 * `app.html`; finnes den ikke, returneres teksten urørt.
 */
export function applyFargetemaToHtml(html: string, valg: Fargetema): string {
	return html.replace('%resonans.fargetema%', valg);
}
