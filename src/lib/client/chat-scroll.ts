/**
 * Scroll-reglene for en chat-tråd, som rene funksjoner.
 *
 * En tråd åpnes ved SISTE melding og henter eldre historikk når man scroller opp.
 * De tre reglene under er de som er lette å ta feil av, og som må bety det samme på
 * alle flater — derfor bor de her og ikke i hver `.svelte`-fil.
 */

/** Hvor nær toppen (piksler) man må være før eldre meldinger hentes. */
export const NEAR_TOP_PX = 120;

/** Minimalt utsnitt av et scrollende element — lar reglene testes uten DOM. */
export interface ScrollMetrics {
	scrollTop: number;
	scrollHeight: number;
}

/** Er brukeren nær toppen, altså i ferd med å gå tom for historikk? */
export function isNearTop(el: ScrollMetrics, threshold: number = NEAR_TOP_PX): boolean {
	return el.scrollTop < threshold;
}

/**
 * Ny `scrollTop` etter at eldre meldinger er lagt til på TOPPEN, slik at det brukeren
 * ser på blir stående stille.
 *
 * Uten dette hopper tråden: nettleseren beholder `scrollTop`, men innholdet over har
 * vokst, så man kastes bakover i historikken nøyaktig idet den ankom.
 */
export function scrollTopAfterPrepend(
	before: ScrollMetrics,
	heightAfter: number
): number {
	return heightAfter - before.scrollHeight + before.scrollTop;
}

/**
 * Nøkkel som skal utløse «hold visningen ved bunnen».
 *
 * Poenget er hva den IKKE inneholder: antall meldinger. En effekt som ser på lengden
 * fyrer også når eldre meldinger prepend-es, og river brukeren ned til bunnen i samme
 * øyeblikk som historikken hen ba om dukker opp. Bare siste melding, strømmende tekst
 * og lastetilstand hører hjemme her.
 */
export function bottomAnchorKey(
	lastMessageId: string | undefined,
	streamingTextLength: number,
	loading: boolean
): string {
	return `${lastMessageId ?? ''}:${streamingTextLength}:${loading}`;
}
