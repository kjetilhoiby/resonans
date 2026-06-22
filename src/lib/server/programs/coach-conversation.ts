import { db } from '$lib/db';
import { conversations, messages } from '$lib/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { addMessage, createConversation, getConversationByIdForUser } from '$lib/server/conversations';
import {
	CONVERSATION_CONTEXT_WINDOW,
	selectContextWindow,
	type ConversationRole,
	type ConversationTurn,
	type ContextWindow
} from '$lib/server/conversation-window';

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
 *
 * Kontekst-vinduet deles med assistenten via `conversation-window.ts`.
 */

export type CoachRole = ConversationRole;
export type CoachTurn = ConversationTurn;
export type { ContextWindow };
export { selectContextWindow };
export const COACH_CONTEXT_WINDOW = CONVERSATION_CONTEXT_WINDOW;

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
 * Slett en tråd server-side («glem samtalen»). `messages.conversation_id` har ingen
 * ON DELETE CASCADE i basen, så vi fjerner meldingene først (deres person-mentions
 * cascader fra messages), deretter selve samtalen. Returnerer `false` hvis tråden ikke
 * finnes / ikke eies av brukeren (→ 404).
 */
export async function deleteCoachConversation(userId: string, conversationId: string): Promise<boolean> {
	const owned = await getConversationByIdForUser(conversationId, userId);
	if (!owned) return false;
	await db.delete(messages).where(eq(messages.conversationId, conversationId));
	await db
		.delete(conversations)
		.where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)));
	return true;
}
