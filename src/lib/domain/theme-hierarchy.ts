/**
 * Hierarkiet mellom tema, og vakta mot selvløkker.
 *
 * `themes.parentTheme` er fritekst mot forelderens NAVN, ikke en fremmednøkkel.
 * Databasen kan derfor ikke hindre at et tema peker på seg selv, og prod hadde
 * nettopp det: Helse med `parentTheme = 'Helse'`.
 *
 * Konsekvensen var ikke en feilmelding, men noe verre — tittelen på temasiden ER
 * tilbakeknappen (se `docs/DESIGN.md`), og med en selvløkke pekte den til samme
 * side. Trykket gjorde tilsynelatende ingenting, og «Gå til forsiden» ble aldri
 * tilbudt. En stille navigasjonsblindvei.
 *
 * Klientsikker: ingen db- eller server-import.
 */

export interface ThemeIdentity {
	id: string;
	name: string;
}

/**
 * Forelderens id, eller null når temaet ikke har en reell forelder.
 *
 * Null når:
 * - `parentTheme` er tomt (temaet er på toppnivå)
 * - forelderen ikke finnes som rad (fritekstnavnet peker i løse lufta)
 * - **forelderen er temaet selv**, målt på både id og navn
 *
 * Navnesjekken er med i tillegg til id-sjekken fordi navnet er det hierarkiet
 * faktisk bæres av: to rader med samme navn ville gitt to ulike id-er, og en
 * «forelder» med samme navn er like sirkulær selv om id-en er en annen.
 */
export function resolveParentThemeId(
	theme: { id: string; name: string; parentTheme?: string | null },
	parent: ThemeIdentity | null
): string | null {
	if (!theme.parentTheme) return null;
	if (!parent) return null;
	if (parent.id === theme.id) return null;
	if (parent.name === theme.name) return null;
	return parent.id;
}

/**
 * Er dette temaet sin egen forelder?
 *
 * Brukes til å luke selvløkker ut av barnelister, slik at et mortema ikke dukker
 * opp som sitt eget undertema.
 */
export function isSelfParented(theme: { name: string; parentTheme?: string | null }): boolean {
	return Boolean(theme.parentTheme) && theme.parentTheme === theme.name;
}
