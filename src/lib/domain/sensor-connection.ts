/**
 * Når trenger en OAuth-tilkobling en NY INNLOGGING?
 *
 * ## Hvorfor dette er en egen regel med tester
 *
 * Statusendepunktene regnet fram til september 2026 «utløpt» slik:
 *
 *     const isExpired = !hasRefreshToken || (expiresAtMs !== null && expiresAtMs < Date.now());
 *
 * `config.expiresAt` er ACCESS-tokenets utløp — det skrives av innloggingen og
 * av hver refresh med tokenets egen levetid (rundt en time, eller vårt korte
 * fallback-vindu når `expires_in` mangler). SpareBank1 synker hver 6. time, så
 * access-tokenet er utløpt det MESTE av døgnet, og det er helt normalt: det er
 * nettopp det refresh-tokenet er til for.
 *
 * Kortet ba derfor brukeren logge inn på nytt i fem av seks timer, og skjulte
 * samtidig «Synk nå», importvalgene og `lastError` bak den beskjeden. Målt
 * 3. september 2026: en vellykket synk kl. 11:14:57 (som skriver `lastError: null`),
 * og kl. 12:52 sto kortet med «Tilkoblingen har utløpt» og en re-autentiseringsknapp.
 * Brukeren logget inn. Ingenting var galt.
 *
 * **Det er sannsynligvis en stor del av «jeg må alltid logge inn på nytt».**
 * Flaten sa det.
 *
 * Regelen nå: en innlogging er det ENESTE som hjelper når refresh-tokenet er
 * borte. Et refresh-token som FINNES men er avvist av leverandøren ser identisk
 * ut i raden — det er `lastError` som vet, og den vises ved siden av.
 */

export interface ConnectionTokenState {
	/** Har vi et refresh token lagret i det hele tatt? */
	hasRefreshToken: boolean;
	/** Siste synk feilet med denne meldingen, eller null hvis den gikk bra. */
	lastError?: string | null;
}

/**
 * Trenger tilkoblingen en ny innlogging?
 *
 * **Access-tokenets utløp er med vilje IKKE et argument her.** Det er ikke et
 * spørsmål brukeren kan svare på, og et utløpt access-token er normaltilstanden
 * mellom to synker.
 */
export function needsReauthentication(state: ConnectionTokenState): boolean {
	return !state.hasRefreshToken;
}

/**
 * Er det noe galt brukeren bør se på?
 *
 * Enten mangler refresh-tokenet (logg inn), eller så feilet siste synk
 * (`lastError` sier hva). Det andre tilfellet dekker et refresh-token
 * leverandøren har avvist — det ligger fortsatt i raden og kan ikke skilles fra
 * et friskt et uten å prøve.
 */
export function hasConnectionWarning(state: ConnectionTokenState): boolean {
	return needsReauthentication(state) || Boolean(state.lastError);
}
