import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { selectContextWindow } from '$lib/server/conversation-window';
import { runAssistantTurn } from '$lib/server/assistant/assistant';
import {
	appendAssistantTurns,
	createAssistantConversation,
	getOwnedAssistantConversation,
	loadAssistantTurns
} from '$lib/server/assistant/conversation';

/**
 * POST /api/apps/assistant
 *
 * Verktøy-bevisst, vedvarende samtaleagent for Ekko (den «avanserte» bruken). Parallell til
 * den raske, statsløse `/api/apps/coach` — uendret. Serveren eier agent-løkken (LLM → verktøy
 * → LLM …) og all dataaksess; klienten ser bare den ferdige teksten.
 *
 * Body (camelCase):
 *   { prompt: string, conversationId?: string | null, context?: string, programId?: string | null }
 *
 * `conversationId`: samme semantikk som coach-tråden — feltet til stede (også `null`) ⇒ tråd-modus.
 *   `null` ⇒ ny tråd (opprettes etter vellykket svar); kjent id ⇒ last historikk; ukjent / eid av
 *   annen bruker / ikke en assistent-tråd ⇒ 404. `context` er EFEMÆR og lagres aldri.
 *
 * Respons: { ok, text, conversationId?, usedTools? }.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { prompt?: unknown; conversationId?: unknown; context?: unknown; programId?: unknown };
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
	// historikk. Ny tråd (null): opprett først etter vellykket svar, så feil ikke legger igjen
	// tomme tråder.
	let history: Awaited<ReturnType<typeof loadAssistantTurns>> = [];
	if (requestedId) {
		const owned = await getOwnedAssistantConversation(userId, requestedId);
		if (!owned) {
			return json({ error: 'Conversation not found', code: 'conversation_not_found' }, { status: 404 });
		}
		history = await loadAssistantTurns(owned.id);
	}

	const { turns, droppedCount } = selectContextWindow(history);

	let text: string;
	let usedTools: string[];
	try {
		({ text, usedTools } = await runAssistantTurn({
			userId,
			prompt,
			programId,
			history: turns,
			droppedCount,
			context
		}));
	} catch (error) {
		console.error('[api/apps/assistant] generering feilet:', error);
		return json(
			{ error: 'Assistant generation failed', code: 'assistant_generation_failed' },
			{ status: 502 }
		);
	}

	const conversationId = requestedId ?? (await createAssistantConversation(userId));

	// Lagre KUN user- og den endelige assistant-turen (aldri efemær context eller verktøy-meldinger).
	await appendAssistantTurns(conversationId, [
		{ role: 'user', text: prompt },
		{ role: 'assistant', text }
	]);

	return json({ ok: true, text, conversationId, usedTools });
};
