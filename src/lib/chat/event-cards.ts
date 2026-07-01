/**
 * Inline hendelseskort i den kanoniske «dagbok»-tråden.
 *
 * Relevante Resonans-hendelser (egenfrekvens-refleksjoner, fullførte økter, nudge-svar …)
 * kan dukke opp i dagboken som kompakte kort i stedet for vanlig chattekst. Kortet lagres
 * i `message.metadata.eventCard` og rendres av `ChatMessages.svelte`.
 *
 * Denne modulen er ren og rammeverk-agnostisk — den deles av server (som skriver kort)
 * og klient (som rendrer dem).
 */

export type ChatEventCardKind = 'checkin' | 'workout' | 'nudge' | 'flow' | 'generic';

export interface ChatEventCard {
	kind: ChatEventCardKind;
	/** Emoji som vises til venstre i kortet. */
	icon?: string;
	title: string;
	detail?: string | null;
	/** Deep-link til kilden (tema, flyt, aktivitet …). */
	href?: string | null;
}

const CHECKIN_LEVELS: Record<number, { icon: string; word: string }> = {
	1: { icon: '🌫️', word: 'Tungt' },
	2: { icon: '🌧️', word: 'Litt ned' },
	3: { icon: '⛅', word: 'Midt på treet' },
	4: { icon: '🌤️', word: 'Bra' },
	5: { icon: '☀️', word: 'Full resonans' }
};

/** Kort en refleksjon slik at den kler et kompakt kort. */
export function truncateReflection(text: string, max = 160): string {
	const clean = text.replace(/\s+/g, ' ').trim();
	if (clean.length <= max) return clean;
	return clean.slice(0, max - 1).trimEnd() + '…';
}

/**
 * Bygger et dagbok-kort for en egenfrekvens-innsjekk med skreven refleksjon.
 * `level` er 1–5; verdier utenfor klippes til nærmeste gyldige nivå.
 */
export function buildCheckinEventCard(input: {
	level: number;
	reflection?: string | null;
	slot?: string | null;
}): ChatEventCard {
	const level = Math.min(5, Math.max(1, Math.round(input.level)));
	const meta = CHECKIN_LEVELS[level];
	const reflection = input.reflection?.trim();
	return {
		kind: 'checkin',
		icon: meta.icon,
		title: `Egenfrekvens: ${meta.word}`,
		detail: reflection ? truncateReflection(reflection) : null,
		href: null
	};
}
