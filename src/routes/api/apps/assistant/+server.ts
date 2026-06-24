import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { selectContextWindow } from '$lib/server/conversation-window';
import { runAssistantTurn, runAssistantTurnStreaming } from '$lib/server/assistant/assistant';
import {
	appendAssistantTurns,
	createAssistantConversation,
	getOwnedAssistantConversation,
	loadAssistantTurns
} from '$lib/server/assistant/conversation';
import { savePendingTurn } from '$lib/server/assistant/pending-turns';

/**
 * POST /api/apps/assistant
 *
 * Verktøy-bevisst, vedvarende samtaleagent for Ekko (den «avanserte» bruken). Parallell til
 * den raske, statsløse `/api/apps/coach` — uendret. Serveren eier agent-løkken (LLM → verktøy
 * → LLM …) og all dataaksess; klienten ser bare den ferdige teksten.
 *
 * Body (camelCase):
 *   { prompt: string, conversationId?: string | null, context?: string, programId?: string | null,
 *     stream?: boolean }
 *
 * `conversationId`: samme semantikk som coach-tråden — feltet til stede (også `null`) ⇒ tråd-modus.
 *   `null` ⇒ ny tråd (opprettes etter vellykket svar); kjent id ⇒ last historikk; ukjent / eid av
 *   annen bruker / ikke en assistent-tråd ⇒ 404. `context` er EFEMÆR og lagres aldri.
 *
 * Svar (additiv opp-til-klienten streaming):
 *   - Default ⇒ JSON `{ ok, text, conversationId, usedTools }`.
 *   - `Accept: text/event-stream` (eller `stream: true`) ⇒ SSE med events:
 *       `start` { conversationId }            (kun ved eksisterende tråd, før første token)
 *       `delta` { text }                      (tekst-fragmenter av det endelige svaret)
 *       `complete` { ok, text, conversationId, usedTools }
 *       `error` { code: 'assistant_generation_failed' }
 *     JSON-kontrakten er uendret for klienter som ikke ber om streaming.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: {
		prompt?: unknown;
		conversationId?: unknown;
		context?: unknown;
		programId?: unknown;
		stream?: unknown;
	};
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
	if (!prompt) {
		return json({ error: 'prompt is required', code: 'missing_prompt' }, { status: 400 });
	}

	const programId =
		typeof body.programId === 'string' && body.programId.trim() ? body.programId.trim() : null;
	const context = typeof body.context === 'string' && body.context.trim() ? body.context.trim() : null;

	const requestedId =
		typeof body.conversationId === 'string' && body.conversationId.trim()
			? body.conversationId.trim()
			: null;

	// Eksisterende tråd: verifiser eierskap + source (404 ved fremmed/ukjent/feil flate) og last
	// historikk FØR vi ev. åpner en stream — så 401/400/404 fortsatt er rene JSON-svar.
	let history: Awaited<ReturnType<typeof loadAssistantTurns>> = [];
	if (requestedId) {
		const owned = await getOwnedAssistantConversation(userId, requestedId);
		if (!owned) {
			return json({ error: 'Conversation not found', code: 'conversation_not_found' }, { status: 404 });
		}
		history = await loadAssistantTurns(owned.id);
	}

	const { turns, droppedCount } = selectContextWindow(history);
	const turnInput = { userId, prompt, programId, history: turns, droppedCount, context };

	const wantsStream =
		body.stream === true || (request.headers.get('accept')?.includes('text/event-stream') ?? false);

	if (!wantsStream) {
		let text: string;
		let usedTools: string[];
		try {
			({ text, usedTools } = await runAssistantTurn(turnInput));
		} catch (error) {
			console.error('[api/apps/assistant] generering feilet:', error);
			return json(
				{ error: 'Assistant generation failed', code: 'assistant_generation_failed' },
				{ status: 502 }
			);
		}

		const conversationId = requestedId ?? (await createAssistantConversation(userId));
		await appendAssistantTurns(conversationId, [
			{ role: 'user', text: prompt },
			{ role: 'assistant', text }
		]);
		return json({ ok: true, text, conversationId, usedTools });
	}

	// SSE: streamer det endelige svarets tokens. Verktøyrundene løses server-side først;
	// tråden opprettes (ved ny) og turene lagres etter at svaret er ferdig generert.
	const encoder = new TextEncoder();
	const send = (event: string, data: unknown) =>
		encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

	const stream = new ReadableStream({
		async start(controller) {
			try {
				if (requestedId) controller.enqueue(send('start', { conversationId: requestedId }));

				const result = await runAssistantTurnStreaming(turnInput, (chunk) => {
					controller.enqueue(send('delta', { text: chunk }));
				});

				// Samtalen må finnes nå — klienten trenger id-en for å poste tool-resultater / fortsette.
				const conversationId = requestedId ?? (await createAssistantConversation(userId));
				if (!requestedId) controller.enqueue(send('start', { conversationId }));

				if (result.status === 'suspended') {
					// Brukerturen lagres nå; assistentturen lagres når /tool-result fullfører.
					await appendAssistantTurns(conversationId, [{ role: 'user', text: prompt }]);
					await savePendingTurn({
						userId,
						conversationId,
						messages: result.messages,
						pendingToolCalls: result.pendingToolCalls,
						usedTools: result.usedTools
					});
					for (const call of result.pendingToolCalls) {
						controller.enqueue(send('tool_call', call));
					}
					controller.enqueue(
						send('suspended', {
							conversationId,
							toolCallIds: result.pendingToolCalls.map((c) => c.id)
						})
					);
				} else {
					await appendAssistantTurns(conversationId, [
						{ role: 'user', text: prompt },
						{ role: 'assistant', text: result.text }
					]);
					controller.enqueue(
						send('complete', { ok: true, text: result.text, conversationId, usedTools: result.usedTools })
					);
				}
			} catch (error) {
				console.error('[api/apps/assistant] streaming feilet:', error);
				controller.enqueue(send('error', { code: 'assistant_generation_failed' }));
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
