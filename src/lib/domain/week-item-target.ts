/**
 * Hvor mange ganger et punkt på ukelista skal gjøres, og når det er ferdig.
 *
 * Ukelista har to former for «flere ganger»: tre punkter «Løp (1/3)», «Løp (2/3)»
 * … (én per gang, se `addItem` på /ukeplan), og ETT punkt med målet i parentes,
 * «Dele legging i to med Anita (3 ganger)». Den første formen er ferdig per
 * punkt. Den andre er ferdig først når så mange dagpunkter som peker på den
 * (`metadata.linkedChecklistItemId`) er hakket av.
 *
 * Fram til oktober 2026 speilet avkryssingen av ett dagpunkt rett opp til
 * ukepunktet, så «(3 ganger)» var ferdig etter første gang. Regelen bor her
 * fordi tre steder må være enige: serverens PATCH, ukeplanens optimistiske
 * speiling, og hjemskjermens brev.
 */

export function weekItemTarget(text: string): { label: string; times: number } {
	const match = /^(.*?)\s*\((\d{1,2})\s+(?:ganger|gang|dager|dag)\)\s*$/i.exec(text.trim());
	if (!match) return { label: text.trim(), times: 1 };
	const times = Number(match[2]);
	return { label: match[1].trim(), times: times > 0 ? times : 1 };
}

/**
 * Om ukepunktet er ferdig, gitt hvor mange dagpunkter som peker på det og er
 * hakket av. Et punkt uten mål i parentes følger dagpunktet direkte, som før.
 */
export function isWeekItemComplete(text: string, checkedLinks: number): boolean {
	return checkedLinks >= weekItemTarget(text).times;
}
