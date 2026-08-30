/**
 * Hvor et modalt ark skal ta deg når du lukker det.
 *
 * ## Feilen dette retter
 *
 * Øktarket (`/aktivitet/[id]`) lukket seg med `history.back()`. Det virker når du
 * kom dit ved å trykke på en økt i en liste — men **ikke** når du kom fra en
 * push-varsling. Da er arket den første oppføringen i dokumentets historikk, og
 * `history.back()` gjør ingenting i det hele tatt.
 *
 * Resultatet var et ark uten utgang: tilbakeknappen, bakteppet og Escape pekte
 * alle på samme døde kall. Brukeren måtte lukke fanen.
 *
 * ## Hvorfor `history.length` ikke brukes
 *
 * Den teller oppføringer i hele fanen, også fra sider før vår, og i en
 * PWA i standalone-modus er den upålitelig. Signalet vi faktisk trenger er «kom
 * denne visningen fra en navigasjon INNE i appen», og det er nøyaktig det
 * SvelteKits `afterNavigate` sier: `from` er `null` ved første lasting.
 */

export type SheetExit =
	/** Det finnes en side å gå tilbake til i appen. */
	| { action: 'back' }
	/** Arket var inngangen — vi må navigere et sted, ikke bakover. */
	| { action: 'navigate'; href: string };

export interface SheetExitInput {
	/** Sann når visningen ble nådd via en navigasjon inne i appen. */
	cameFromApp: boolean;
	/**
	 * Stedet arket hører hjemme, når det ikke finnes historikk. Typisk lista arket
	 * ble åpnet fra. Null når vi ikke vet.
	 */
	fallbackHref?: string | null;
}

/** Siste utpost når vi ikke vet hvor arket hører hjemme. */
export const SHEET_EXIT_HOME = '/';

export function resolveSheetExit({ cameFromApp, fallbackHref = null }: SheetExitInput): SheetExit {
	if (cameFromApp) return { action: 'back' };

	const href = fallbackHref?.trim();
	return { action: 'navigate', href: href && href.length > 0 ? href : SHEET_EXIT_HOME };
}
