import { db } from '$lib/db';
import { conversations, messages } from '$lib/db/schema';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { addMessage, createConversation } from '$lib/server/conversations';
import type { ConversationRole, ConversationTurn } from '$lib/server/conversation-window';

/**
 * Server-holdt samtaletilstand for den verktøy-bevisste Ekko-assistenten.
 *
 * Deler underliggende infrastruktur med coach-tråden (samme `conversations`/`messages`-tabeller
 * og den delte `conversations.ts`-tjenesten), men eksponeres som en egen, parallell flate via
 * `source = 'ekko-assistant'`. Eierskaps-oppslagene er derfor source-scopet: en assistent-tråd
 * og en coach-tråd kan aldri forveksles på tvers av endepunktene. Web-chatlisten viser kun 'web',
 * så assistent-tråder dukker ikke opp der.
 *
 * Vi lagrer KUN `user`/`assistant`-turer — aldri efemær situasjonskontekst og aldri verktøy-interne
 * meldinger.
 */

export const ASSISTANT_SOURCE = 'ekko-assistant';

/** Opprett en ny tom assistent-tråd og returner den server-genererte id-en. */
export async function createAssistantConversation(userId: string): Promise<string> {
	const conversation = await createConversation(userId, ASSISTANT_SOURCE);
	return conversation.id;
}

/**
 * Hent tråden hvis den finnes, eies av brukeren OG er en assistent-tråd. Returnerer `null`
 * ellers — kalleren mapper det til 404 (aldri lekkasje, og aldri en coach-/web-tråd).
 */
export async function getOwnedAssistantConversation(
	userId: string,
	conversationId: string
): Promise<{ id: string; title: string | null } | null> {
	const conversation = await db.query.conversations.findFirst({
		where: and(
			eq(conversations.id, conversationId),
			eq(conversations.userId, userId),
			eq(conversations.source, ASSISTANT_SOURCE)
		),
		columns: { id: true, title: true }
	});
	return conversation ?? null;
}

/**
 * Last trådens `user`/`assistant`-turer i kronologisk rekkefølge. Eventuelle `system`-meldinger
 * utelates — assistenten bygger sin egen system-prompt.
 */
export async function loadAssistantTurns(conversationId: string): Promise<ConversationTurn[]> {
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
 * Append turer (typisk en `user`- og den endelige `assistant`-turen) via den delte `addMessage` —
 * som bumper trådens updatedAt, genererer tittel fra første brukermelding og indekserer personer.
 */
export async function appendAssistantTurns(
	conversationId: string,
	turns: Array<{ role: ConversationRole; text: string }>
): Promise<void> {
	for (const turn of turns) {
		await addMessage({ conversationId, role: turn.role, content: turn.text });
	}
}

/**
 * Slett en assistent-tråd server-side («glem samtalen»). Source-scopet, så en coach-/web-tråd
 * aldri slettes herfra. Returnerer `false` hvis tråden ikke finnes / ikke eies / feil source (→ 404).
 */
export async function deleteAssistantConversation(
	userId: string,
	conversationId: string
): Promise<boolean> {
	// Source-scopet eierskap først, så vi aldri rører en coach-/web-tråd.
	const owned = await getOwnedAssistantConversation(userId, conversationId);
	if (!owned) return false;
	// `messages.conversation_id` cascader ikke i basen — fjern meldingene først
	// (person-mentions cascader fra messages), deretter samtalen.
	await db.delete(messages).where(eq(messages.conversationId, conversationId));
	await db
		.delete(conversations)
		.where(
			and(
				eq(conversations.id, conversationId),
				eq(conversations.userId, userId),
				eq(conversations.source, ASSISTANT_SOURCE)
			)
		);
	return true;
}
