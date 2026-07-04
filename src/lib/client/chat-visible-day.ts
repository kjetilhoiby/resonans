/**
 * «Hvilken dag ser brukeren på nå?» for chat-headeren.
 *
 * Headeren i chat-visningen ligger som et blurret overlay over meldingslisten og viser
 * dagen for meldingene i view som undertittel. Dagen defineres som den siste dato-spaceren
 * som har passert opp under headerkanten — når man scroller midt i en lang dag er ingen
 * spacer synlig i viewporten, så vi kan ikke bruke IntersectionObserver direkte.
 */

export interface SpacerPos {
	/** Dag-nøkkel «YYYY-MM-DD» fra spacerens anker-id. */
	key: string;
	/** Spacerens viewport-topp (getBoundingClientRect().top), i dokumentrekkefølge. */
	top: number;
}

/**
 * Dagen som er «i syne»: siste spacer med `top <= threshold` (spaceren har scrollet opp
 * forbi headerkanten). Har ingen spacer passert ennå, gjelder første spacer — hvert lastet
 * meldingsvindu starter alltid med en dag-spacer. Tom liste gir null.
 */
export function currentDayFromSpacers(spacers: SpacerPos[], threshold: number): string | null {
	if (spacers.length === 0) return null;
	let current = spacers[0].key;
	for (const spacer of spacers) {
		if (spacer.top <= threshold) current = spacer.key;
		else break;
	}
	return current;
}
