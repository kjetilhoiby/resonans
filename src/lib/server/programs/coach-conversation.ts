import { db } from '$lib/db';
import { coachConversations, coachMessages } from '$lib/db/schema';
import { and, asc, eq } from 'drizzle-orm';

/**
 * Server-holdt samtaletilstand for Ekko-coachen.
 *
 * Serveren eier tråden, nøklet på (token-bruker, conversationId). Klienten sender bare
 * ny ytring + en opak server-generert conversationId; vi setter sammen full kontekst fra
 * de lagrede turene. Vi lagrer KUN `user`/`assistant`-turer — aldri efemær situasjonskontekst
 * (live-metrikk) og aldri klientens system-notiser.
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

/** Opprett en ny tom tråd for brukeren og returner den server-genererte id-en. */
export async function createCoachConversation(userId: string, title?: string | null): Promise<string> {
	const [row] = await db
		.insert(coachConversations)
		.values({ userId, title: title ?? null })
		.returning({ id: coachConversations.id });
	return row.id;
}

/**
 * Hent tråden hvis den finnes OG eies av brukeren. Returnerer `null` ellers — kalleren
 * mapper det til 404 (aldri lekkasje av andres tråder).
 */
export async function getOwnedConversation(
	userId: string,
	conversationId: string
): Promise<{ id: string; title: string | null } | null> {
	const row = await db.query.coachConversations.findFirst({
		where: and(eq(coachConversations.id, conversationId), eq(coachConversations.userId, userId)),
		columns: { id: true, title: true }
	});
	return row ?? null;
}

/** Last alle turer i en tråd i kronologisk rekkefølge. */
export async function loadConversationTurns(conversationId: string): Promise<CoachTurn[]> {
	const rows = await db.query.coachMessages.findMany({
		where: eq(coachMessages.conversationId, conversationId),
		orderBy: [asc(coachMessages.createdAt)],
		columns: { role: true, text: true, createdAt: true }
	});
	return rows.map((r) => ({
		role: r.role === 'assistant' ? 'assistant' : 'user',
		text: r.text,
		timestamp: r.createdAt
	}));
}

/** Append turer (typisk en `user`- og en `assistant`-tur) og bump trådens updatedAt. */
export async function appendTurns(
	conversationId: string,
	turns: Array<{ role: CoachRole; text: string }>
): Promise<void> {
	if (turns.length === 0) return;
	await db.insert(coachMessages).values(turns.map((t) => ({ conversationId, role: t.role, text: t.text })));
	await db
		.update(coachConversations)
		.set({ updatedAt: new Date() })
		.where(eq(coachConversations.id, conversationId));
}

/**
 * Slett en tråd server-side («glem samtalen»). Meldinger fjernes via ON DELETE CASCADE.
 * Returnerer `false` hvis tråden ikke finnes / ikke eies av brukeren (→ 404).
 */
export async function deleteCoachConversation(userId: string, conversationId: string): Promise<boolean> {
	const deleted = await db
		.delete(coachConversations)
		.where(and(eq(coachConversations.id, conversationId), eq(coachConversations.userId, userId)))
		.returning({ id: coachConversations.id });
	return deleted.length > 0;
}
