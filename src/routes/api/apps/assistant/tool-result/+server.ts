import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getOwnedAssistantConversation, appendAssistantTurns } from '$lib/server/assistant/conversation';
import {
	getPendingTurn,
	updatePendingTurn,
	deletePendingTurn
} from '$lib/server/assistant/pending-turns';
import { resumeAgentLoop, type AgentMessages } from '$lib/server/assistant/assistant';

/**
 * POST /api/apps/assistant/tool-result
 *
 * Klient-halvdelen av de hybride verktøyene: Ekko har kjørt et klient-verktøy
 * (driveDistance/resolvePlace/nearestPlace/sendToCar) on-device og POSTer resultatet hit på
 * samme tråd. Serveren legger resultatet inn i den suspenderte agent-tilstanden og GJENOPPTAR.
 *
 * Resume-semantikk (server bestemmer, jf. handoff): NY strøm per etappe. Når alle ventende
 * klient-kall for runden er besvart, fortsetter agent-løkka og dette POST-svaret ER den nye
 * SSE-strømmen (samme event-format som /assistant: delta/tool_call/suspended/complete/error).
 * Er flere klient-kall fortsatt ubesvart, svares et lite JSON-ack i stedet.
 *
 * Body: { conversationId: string, toolCallId: string, result: object }
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { conversationId?: unknown; toolCallId?: unknown; result?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
	const toolCallId = typeof body.toolCallId === 'string' ? body.toolCallId.trim() : '';
	if (!conversationId || !toolCallId) {
		return json({ error: 'conversationId and toolCallId are required', code: 'missing_fields' }, { status: 400 });
	}

	// Source-scopet eierskap (404 ved fremmed/ukjent/feil flate).
	const owned = await getOwnedAssistantConversation(userId, conversationId);
	if (!owned) {
		return json({ error: 'Conversation not found', code: 'conversation_not_found' }, { status: 404 });
	}

	const pending = await getPendingTurn(userId, conversationId);
	if (!pending) {
		return json({ error: 'No suspended turn', code: 'no_pending_turn' }, { status: 409 });
	}

	const match = pending.pendingToolCalls.find((c) => c.id === toolCallId);
	if (!match) {
		return json({ error: 'Unknown toolCallId', code: 'unknown_tool_call' }, { status: 400 });
	}

	// Legg klient-resultatet inn som en tool-melding (matcher tool_call_id i assistent-meldingen).
	const messages: AgentMessages = [
		...pending.messages,
		{
			role: 'tool',
			tool_call_id: toolCallId,
			content: JSON.stringify(body.result ?? {})
		}
	];
	const remaining = pending.pendingToolCalls.filter((c) => c.id !== toolCallId);

	// Flere klient-kall i samme runde gjenstår — vent på dem før vi gjenopptar.
	if (remaining.length > 0) {
		await updatePendingTurn(pending.id, {
			messages,
			pendingToolCalls: remaining,
			usedTools: pending.usedTools
		});
		return json({ ok: true, pending: true, remaining: remaining.map((c) => c.id) });
	}

	// Alle besvart → gjenoppta agent-løkka og strøm videre (ny strøm per etappe).
	const encoder = new TextEncoder();
	const sendEvent = (event: string, data: unknown) =>
		encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

	const stream = new ReadableStream({
		async start(controller) {
			try {
				const result = await resumeAgentLoop(userId, messages, pending.usedTools, (chunk) => {
					controller.enqueue(sendEvent('delta', { text: chunk }));
				});

				if (result.status === 'suspended') {
					await updatePendingTurn(pending.id, {
						messages: result.messages,
						pendingToolCalls: result.pendingToolCalls,
						usedTools: result.usedTools
					});
					for (const call of result.pendingToolCalls) {
						controller.enqueue(sendEvent('tool_call', call));
					}
					controller.enqueue(
						sendEvent('suspended', {
							conversationId,
							toolCallIds: result.pendingToolCalls.map((c) => c.id)
						})
					);
				} else {
					await deletePendingTurn(pending.id);
					await appendAssistantTurns(conversationId, [{ role: 'assistant', text: result.text }]);
					controller.enqueue(
						sendEvent('complete', {
							ok: true,
							text: result.text,
							conversationId,
							usedTools: result.usedTools
						})
					);
				}
			} catch (error) {
				console.error('[api/apps/assistant/tool-result] gjenopptak feilet:', error);
				controller.enqueue(sendEvent('error', { code: 'assistant_generation_failed' }));
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
