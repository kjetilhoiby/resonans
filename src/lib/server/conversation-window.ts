/**
 * Delt kontekst-vindu for server-holdte samtaletråder (coach + assistent).
 *
 * Serveren er autoritet på hvor mye historikk som sendes til LLM-en. Vi beholder de nyeste
 * turene ordrett og rapporterer hvor mange eldre som ble utelatt, slik at modellen vet at
 * samtalen er lengre enn vinduet uten å fylles av utdaterte detaljer.
 */

export type ConversationRole = 'user' | 'assistant';

export interface ConversationTurn {
	role: ConversationRole;
	text: string;
	timestamp: Date;
}

/** Hvor mange nylige turer som sendes ordrett til LLM-en. */
export const CONVERSATION_CONTEXT_WINDOW = 20;

export interface ContextWindow {
	/** De nyeste turene, ordrett, i kronologisk rekkefølge. */
	turns: ConversationTurn[];
	/** Antall eldre turer som ble utelatt (0 hvis alt fikk plass). */
	droppedCount: number;
}

/**
 * Velg kontekst-vinduet: behold de `limit` nyeste turene ordrett, rapporter hvor mange
 * eldre som ble droppet. Ren funksjon (ingen DB/LLM) — testbar.
 */
export function selectContextWindow(
	turns: ConversationTurn[],
	limit = CONVERSATION_CONTEXT_WINDOW
): ContextWindow {
	if (limit <= 0) return { turns: [], droppedCount: turns.length };
	if (turns.length <= limit) return { turns, droppedCount: 0 };
	return {
		turns: turns.slice(turns.length - limit),
		droppedCount: turns.length - limit
	};
}
