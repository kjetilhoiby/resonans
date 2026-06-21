import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runProgramCoach, runCoachConversationTurn } from '$lib/server/programs/coach';
import {
	appendTurns,
	createCoachConversation,
	getOwnedConversation,
	loadConversationTurns,
	selectContextWindow
} from '$lib/server/programs/coach-conversation';

/**
 * POST /api/apps/coach
 *
 * Fri-tekst coach for Ekko («Spør coachen» + etter-økt-vurdering), med valgfri
 * server-holdt samtaletilstand.
 *
 * Body (camelCase):
 *   { prompt: string, conversationId?: string | null, context?: string, programId?: string | null }
 *
 * Tråd-modus aktiveres når feltet `conversationId` er med i bodyen (også som `null`):
 *   - `null`        ⇒ opprett ny tråd, returner fersk id.
 *   - kjent id      ⇒ last trådens turer som kontekst.
 *   - ukjent/eid av annen bruker ⇒ 404 (klienten starter ny tråd med null).
 * Uten `conversationId`-feltet oppfører kallet seg nøyaktig som før (statsløst engangssvar) —
 * fullt bakoverkompatibelt for etter-økt-vurderinger og andre eksisterende kallere.
 *
 * `context` er EFEMÆR situasjonskontekst (live-metrikk): injiseres i LLM-kallet for denne
 * turen, men lagres ALDRI som en tur.
 *
 * Respons: { ok, text, conversationId? } — `text` er alltid satt ved 200; `conversationId`
 * settes når en tråd er i bruk.
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

	// Tråd-modus krever at feltet er til stede (selv som null). Mangler feltet helt ⇒ statsløs
	// som før — vi vil ikke at eksisterende kallere uventet begynner å persistere tråd-tilstand.
	const threadMode = 'conversationId' in body && body.conversationId !== undefined;

	if (!threadMode) {
		try {
			const { text } = await runProgramCoach(userId, prompt, programId);
			return json({ ok: true, text });
		} catch (error) {
			console.error('[api/apps/coach] generering feilet:', error);
			return json({ error: 'Coach generation failed', code: 'coach_generation_failed' }, { status: 502 });
		}
	}

	const requestedId =
		typeof body.conversationId === 'string' && body.conversationId.trim()
			? body.conversationId.trim()
			: null;

	// Eksisterende tråd: verifiser eierskap (404 ved fremmed/ukjent) og last historikk.
	// Ny tråd (null): vent med å opprette til LLM-svaret er i havn, så vi ikke legger igjen
	// tomme «Ny samtale»-rader i /samtaler hvis genereringen feiler.
	let history: Awaited<ReturnType<typeof loadConversationTurns>> = [];
	if (requestedId) {
		const owned = await getOwnedConversation(userId, requestedId);
		if (!owned) {
			return json({ error: 'Conversation not found', code: 'conversation_not_found' }, { status: 404 });
		}
		history = await loadConversationTurns(owned.id);
	}

	const { turns, droppedCount } = selectContextWindow(history);

	let text: string;
	try {
		({ text } = await runCoachConversationTurn({
			userId,
			prompt,
			programId,
			history: turns,
			droppedCount,
			context
		}));
	} catch (error) {
		console.error('[api/apps/coach] generering feilet:', error);
		return json({ error: 'Coach generation failed', code: 'coach_generation_failed' }, { status: 502 });
	}

	const conversationId = requestedId ?? (await createCoachConversation(userId));

	// Lagre KUN user- og assistant-turene (aldri efemær context).
	await appendTurns(conversationId, [
		{ role: 'user', text: prompt },
		{ role: 'assistant', text }
	]);

	return json({ ok: true, text, conversationId });
};
