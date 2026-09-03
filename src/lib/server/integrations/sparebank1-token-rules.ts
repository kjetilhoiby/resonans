/**
 * Når skal et SpareBank1-token fornyes, og hvor lenge varer det nye?
 *
 * Skilt ut av `sparebank1-token.ts` fordi begge avgjørelsene er rene og
 * fortjener tester — og fordi begge tok feil på hver sin måte fram til
 * september 2026.
 */

export interface BankCredentials {
	access_token: string;
	refresh_token?: string;
	expires_at?: number;
	token_type?: string;
	scope?: string;
}

/** Slingringsmonn mot klokkeavvik og tid i transitt. */
export const EXPIRY_SKEW_SECONDS = 60;

/**
 * Levetiden vi antar når SB1 ikke oppgir `expires_in`.
 *
 * Konservativt kort med vilje: et for kort anslag koster én ekstra refresh, et
 * for langt koster en 401 midt i en synk. Ti minutter er godt under enhver
 * OAuth-levetid vi kan komme til å møte.
 */
export const FALLBACK_TTL_SECONDS = 600;

/**
 * Skal tokenet fornyes nå?
 *
 * **Manglende `expires_at` betyr JA, ikke nei.** Den gamle gaten var
 * `if (credentials.expires_at && now >= credentials.expires_at - 60)`, altså
 * hoppet den helt over refresh når feltet manglet — og feltet mangler så snart
 * SB1 utelater `expires_in` i ett eneste svar. Da ble tokenet brukt til det
 * døde, og brukeren måtte logge inn. Å tvile skal føre til et refresh, ikke til
 * å la være.
 */
export function shouldRefresh(credentials: BankCredentials, nowSeconds: number): boolean {
	if (!credentials.access_token) return true;
	if (typeof credentials.expires_at !== 'number' || !Number.isFinite(credentials.expires_at)) {
		return true;
	}
	return nowSeconds >= credentials.expires_at - EXPIRY_SKEW_SECONDS;
}

/**
 * Utløpstidspunktet for et ferskt token.
 *
 * **Arver ALDRI en gammel verdi.** Den gamle koden gjorde
 * `expires_at: refreshed.expires_in ? now + refreshed.expires_in : credentials.expires_at`
 * — og den gamle verdien lå per definisjon i fortida, siden det var derfor vi
 * refresha. Resultatet var et token som var permanent «utløpt», så hvert eneste
 * kall utløste et nytt refresh. Med rotasjon ble det en kjede av rotasjoner, og
 * det er slik en refresh-kjede dør.
 */
export function resolveExpiresAt(expiresIn: unknown, nowSeconds: number): number {
	const seconds = typeof expiresIn === 'number' ? expiresIn : Number(expiresIn);
	if (Number.isFinite(seconds) && seconds > 0) return nowSeconds + Math.floor(seconds);
	return nowSeconds + FALLBACK_TTL_SECONDS;
}
