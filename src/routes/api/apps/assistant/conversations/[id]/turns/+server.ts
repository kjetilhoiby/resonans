import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	createAssistantConversation,
	getOwnedAssistantConversation,
	appendAssistantTurns
} from '$lib/server/assistant/conversation';
import {
	parseVoiceTurns,
	VoiceTurnValidationError
} from '$lib/domain/ai/assistant-voice-turns';

/**
 * POST /api/apps/assistant/conversations/{id}/turns  (Bearer rsn_)
 *
 * Tråd-foreningen i fase 2 (`GEMINI_LIVE_VOICE_BRIEF.md` §6): Ekkos Live-stemmesamtale skjer
 * app↔Google direkte, så serveren ser aldri turene — appen poster dem hit etterpå, og de blir
 * en del av SSE-hjernens hukommelse på lik linje med tekstturer. De RE-SPILLES aldri: ingen
 * generering trigges, dette er ren bokføring.
 *
 * `{id}` er en eksisterende assistent-tråd, eller literalen **`new`** (create-if-nil): da
 * opprettes tråden og id-en returneres — appen adopterer den for både stemme og tekst videre.
 * Ukjent/fremmed/feil-source id → 404, samme semantikk som resten av conversations-flaten
 * (klienten svarer med å poste på nytt mot `new`).
 *
 * Kropp: `{ "turns": [{ "role": "user"|"assistant", "text": "…", "at": "…", "source": "voice" }] }`.
 * `at`/`source` aksepteres men brukes ikke ennå — lagringsrekkefølgen er batch-rekkefølgen.
 * Validering (roller, tomme tekster, tak) bor rent og testet i
 * `$lib/domain/ai/assistant-voice-turns.ts`.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let parsed;
	try {
		parsed = parseVoiceTurns(await request.json().catch(() => null));
	} catch (err) {
		if (err instanceof VoiceTurnValidationError) {
			return json({ error: err.message, code: 'invalid_turns' }, { status: 400 });
		}
		throw err;
	}

	let conversationId: string;
	if (params.id === 'new') {
		conversationId = await createAssistantConversation(userId);
	} else {
		const owned = await getOwnedAssistantConversation(userId, params.id);
		if (!owned) {
			return json(
				{ error: 'Conversation not found', code: 'conversation_not_found' },
				{ status: 404 }
			);
		}
		conversationId = owned.id;
	}

	await appendAssistantTurns(conversationId, parsed.turns);
	return json({ ok: true, conversationId, appended: parsed.turns.length });
};
