import { db } from '$lib/db';
import { conversations, messages } from '$lib/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { addMessage, createConversation, getConversationByIdForUser } from '$lib/server/conversations';

/**
 * Server-holdt samtaletilstand for Ekko-coachen.
 *
 * Delt struktur med resonans: coach-trådene lagres i de samme `conversations`/`messages`-
 * tabellene som web-chatten, via den delte tjenesten i `conversations.ts`. En voice-samtale
 * med coachen er dermed samme samtale som dukker opp i `/samtaler` — og får tittel-generering
 * og person-indeksering på kjøpet. Serveren eier tråden, nøklet på (token-bruker, conversationId).
 *
 * Vi lagrer KUN `user`/`assistant`-turer — aldri efemær situasjonskontekst (live-metrikk) og
 * aldri klientens system-notiser.
 */

export type CoachRole = 'user' | 'assistant';

export interface CoachTurn {
	role: CoachRole;
	text: string;
	timestamp: Date;
}

/**
 * Hvor mange nylige turer vi sender ordrett til LLM-en. Eldre turer trunkeres til en
 * kort norsk notis slik at tråden ikke fylles av utdaterte tallremser, men modellen
 * fortsatt vet at samtalen er lengre enn vinduet.
 */
export const COACH_CONTEXT_WINDOW = 20;

export interface ContextWindow {
	/** De nyeste turene, ordrett, i kronologisk rekkefølge. */
	turns: CoachTurn[];
	/** Antall eldre turer som ble utelatt (0 hvis alt fikk plass). */
	droppedCount: number;
}

/**
 * Velg kontekst-vinduet: behold de `limit` nyeste turene ordrett, rapporter hvor mange
 * eldre som ble droppet. Ren funksjon (ingen DB/LLM) — testbar.
 */
export function selectContextWindow(turns: CoachTurn[], limit = COACH_CONTEXT_WINDOW): ContextWindow {
	if (limit <= 0) return { turns: [], droppedCount: turns.length };
	if (turns.length <= limit) return { turns, droppedCount: 0 };
	return {
		turns: turns.slice(turns.length - limit),
		droppedCount: turns.length - limit
	};
}

/** Opprett en ny tom coach-tråd (source 'ekko') og returner den server-genererte id-en. */
export async function createCoachConversation(userId: string): Promise<string> {
	const conversation = await createConversation(userId, 'ekko');
	return conversation.id;
}

/**
 * Hent tråden hvis den finnes OG eies av brukeren. Returnerer `null` ellers — kalleren
 * mapper det til 404 (aldri lekkasje av andres tråder).
 */
export async function getOwnedConversation(
	userId: string,
	conversationId: string
): Promise<{ id: string; title: string | null } | null> {
	const conversation = await getConversationByIdForUser(conversationId, userId);
	return conversation ? { id: conversation.id, title: conversation.title } : null;
}

/**
 * Last trådens `user`/`assistant`-turer i kronologisk rekkefølge. Eventuelle `system`-meldinger
 * (kan finnes hvis tråden også brukes i web-chatten) utelates — coachen bygger sin egen
 * system-prompt.
 */
export async function loadConversationTurns(conversationId: string): Promise<CoachTurn[]> {
	const rows = await db.query.messages.findMany({
		where: and(
			eq(messages.conversationId, conversationId),
			inArray(messages.role, ['user', 'assistant'])
		),
		orderBy: [asc(messages.createdAt)],
		columns: { role: true, content: true, createdAt: true }
	});
	return rows.map((r) => ({
		role: r.role === 'assistant' ? 'assistant' : 'user',
		text: r.content,
		timestamp: r.createdAt
	}));
}

/**
 * Append turer (typisk en `user`- og en `assistant`-tur) via den delte `addMessage` — som
 * også bumper trådens updatedAt, genererer tittel fra første brukermelding og indekserer
 * personer som nevnes. Bevarer rekkefølgen.
 */
export async function appendTurns(
	conversationId: string,
	turns: Array<{ role: CoachRole; text: string }>
): Promise<void> {
	for (const turn of turns) {
		await addMessage({ conversationId, role: turn.role, content: turn.text });
	}
}

/**
 * Slett en tråd server-side («glem samtalen»). Speiler `DELETE /api/conversations/[id]`.
 * Returnerer `false` hvis tråden ikke finnes / ikke eies av brukeren (→ 404).
 */
export async function deleteCoachConversation(userId: string, conversationId: string): Promise<boolean> {
	const deleted = await db
		.delete(conversations)
		.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
		.returning({ id: conversations.id });
	return deleted.length > 0;
}
