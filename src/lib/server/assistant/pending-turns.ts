import { db } from '$lib/db';
import { assistantPendingTurns } from '$lib/db/schema';
import { and, eq, lt } from 'drizzle-orm';
import type { AgentMessages, ClientToolCall } from './assistant';

/**
 * Lagring av suspendert agent-tilstand for de hybride klient-verktøyene. Én aktiv pending-rad pr
 * samtale: en ny suspensjon erstatter en eldre. Rader eldre enn TTL ryddes opportunistisk ved
 * lagring (klienten kom aldri tilbake med et tool-resultat).
 */

const STALE_MS = 2 * 60 * 60 * 1000; // 2 timer

export interface PendingTurn {
	id: string;
	userId: string;
	conversationId: string;
	messages: AgentMessages;
	pendingToolCalls: ClientToolCall[];
	usedTools: string[];
}

/** Lagre (eller erstatt) den suspenderte turen for en samtale. */
export async function savePendingTurn(params: {
	userId: string;
	conversationId: string;
	messages: AgentMessages;
	pendingToolCalls: ClientToolCall[];
	usedTools: string[];
}): Promise<void> {
	await db
		.delete(assistantPendingTurns)
		.where(eq(assistantPendingTurns.conversationId, params.conversationId));
	await db
		.delete(assistantPendingTurns)
		.where(lt(assistantPendingTurns.createdAt, new Date(Date.now() - STALE_MS)));
	await db.insert(assistantPendingTurns).values({
		userId: params.userId,
		conversationId: params.conversationId,
		messages: params.messages,
		pendingToolCalls: params.pendingToolCalls,
		usedTools: params.usedTools
	});
}

/** Hent den aktive pending-turen for en samtale (eid av brukeren), eller null. */
export async function getPendingTurn(
	userId: string,
	conversationId: string
): Promise<PendingTurn | null> {
	const row = await db.query.assistantPendingTurns.findFirst({
		where: and(
			eq(assistantPendingTurns.userId, userId),
			eq(assistantPendingTurns.conversationId, conversationId)
		)
	});
	if (!row) return null;
	return {
		id: row.id,
		userId: row.userId,
		conversationId: row.conversationId,
		messages: row.messages as AgentMessages,
		pendingToolCalls: row.pendingToolCalls,
		usedTools: row.usedTools
	};
}

/** Oppdater en pending-rad (flere klient-kall i samme runde, eller ny suspensjon ved gjenopptak). */
export async function updatePendingTurn(
	id: string,
	patch: { messages: AgentMessages; pendingToolCalls: ClientToolCall[]; usedTools: string[] }
): Promise<void> {
	await db
		.update(assistantPendingTurns)
		.set({
			messages: patch.messages,
			pendingToolCalls: patch.pendingToolCalls,
			usedTools: patch.usedTools,
			updatedAt: new Date()
		})
		.where(eq(assistantPendingTurns.id, id));
}

/** Slett en pending-rad (turen er fullført). */
export async function deletePendingTurn(id: string): Promise<void> {
	await db.delete(assistantPendingTurns).where(eq(assistantPendingTurns.id, id));
}
