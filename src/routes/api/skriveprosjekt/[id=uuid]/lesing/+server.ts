/**
 * Kompislesing — streaming chat med prosjektets eget materiale som kontekst.
 *
 * Eget endepunkt framfor `/api/chat-stream-messages` fordi systemprompten skal
 * bygges HER, på serveren (se docs/changelog/2026-08-07-skriveprosjekt.md).
 * Bok-chatten bygger sin i en Svelte-komponent; det går når konteksten er en
 * ferdig `contextPack`, men et manus må hentes selektivt, og modusen avgjør
 * hvor bredt.
 *
 * Ingen verktøy. Dette er et smalt kontekstmodus, ikke et agent-løp — 48
 * verktøydeklarasjoner ≈ 7 000 tokens, og de har ingenting å gjøre i en samtale
 * om en scene.
 */

import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { openai } from '$lib/server/openai';
import { addMessage, getConversationHistory } from '$lib/server/conversations';
import { getProject, getPromptMaterial } from '$lib/server/writing/projects';
import { getDoc } from '$lib/server/writing/docs';
import { buildWritingChatPrompt, resolveWritingChatMode } from '$lib/domain/writing/coach-prompt';
import { resolveDocKind } from '$lib/domain/writing/doc-kinds';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const HISTORY_LIMIT = 20;

function sse(type: string, data: unknown, encoder: TextEncoder): Uint8Array {
	return encoder.encode(`data: ${JSON.stringify({ type, data })}\n\n`);
}

export const POST: RequestHandler = async ({ locals, params, request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Ugyldig forespørsel.');
	const payload = body as Record<string, unknown>;

	const message = typeof payload.message === 'string' ? payload.message.trim() : '';
	if (!message) throw error(400, 'Tom melding.');

	const project = await getProject(locals.userId, params.id);
	if (!project) throw error(404, 'Fant ikke skriveprosjektet.');
	if (!project.conversationId) throw error(409, 'Prosjektet mangler samtale — opprett det på nytt.');

	const mode = resolveWritingChatMode(payload.mode);

	// Fokusdokumentet er teksten samtalen handler om. Sparring trenger det ikke,
	// og leser trenger ikke noe annet.
	let focusDoc = null;
	if (mode.scope !== 'prosjekt' && typeof payload.focusDocId === 'string') {
		const doc = await getDoc(locals.userId, payload.focusDocId);
		if (doc) {
			focusDoc = {
				kind: resolveDocKind(doc.kind).label.toLowerCase(),
				title: doc.title,
				body: doc.body
			};
		}
	}

	const { material, outline } =
		mode.scope === 'tekst'
			? { material: [], outline: [] }
			: await getPromptMaterial(locals.userId, params.id);

	const systemPrompt = buildWritingChatPrompt({
		project: { title: project.title, genre: project.genre, summary: project.summary },
		mode: mode.key,
		focusDoc,
		material,
		outline
	});

	const history = await getConversationHistory(project.conversationId, HISTORY_LIMIT);

	await addMessage({
		conversationId: project.conversationId,
		role: 'user',
		content: message,
		metadata: { writingProjectId: project.id, mode: mode.key }
	});

	const openaiMessages: ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemPrompt },
		...history
			.filter((m) => m.role === 'user' || m.role === 'assistant')
			.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
		{ role: 'user', content: message }
	];

	const encoder = new TextEncoder();
	let full = '';

	const stream = new ReadableStream({
		async start(controller) {
			try {
				controller.enqueue(sse('stream_start', { mode: mode.key }, encoder));

				const completion = await openai.chat.completions.create({
					model: 'gpt-4o',
					messages: openaiMessages,
					temperature: 0.7,
					stream: true
				});

				for await (const chunk of completion) {
					const token = chunk.choices[0]?.delta?.content;
					if (!token) continue;
					full += token;
					controller.enqueue(sse('token', { token }, encoder));
				}

				await addMessage({
					conversationId: project.conversationId!,
					role: 'assistant',
					content: full,
					metadata: { writingProjectId: project.id, mode: mode.key }
				});

				controller.enqueue(sse('complete', { message: full, mode: mode.key }, encoder));
			} catch (err) {
				console.error('[kompislesing] streaming feilet:', err);
				// Feilen skal nå fram til flaten — en generisk tekst her ville gjort
				// en prod-feil uløselig (jf. CLAUDE.md om extractApiErrorMessage).
				controller.enqueue(
					sse('error', { message: err instanceof Error ? err.message : 'Ukjent feil' }, encoder)
				);
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
