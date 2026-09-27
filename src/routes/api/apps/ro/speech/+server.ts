import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { MAX_SPEECH_CHARS } from '$lib/server/ro/ro-speech-logic';
import { RoSpeechUnavailableError, synthesizeRoLine } from '$lib/server/ro/ro-speech';

/**
 * POST /api/apps/ro/speech — én Ro-linje lest av Gemini TTS, som WAV (docs/ekko-ro.md).
 *
 * Body: { text: string }  →  audio/wav
 *
 * 503 betyr «ikke konfigurert» (ingen GEMINI_API_KEY / ingen TTS-modell): Ekko bruker da
 * telefonens stemme for resten av økta og prøver ikke igjen. 502 er en feil hos Google.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const userId = locals.userId;
	if (!userId) return json({ error: 'Unauthorized' }, { status: 401 });

	let body: { text?: unknown };
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}
	const text = typeof body.text === 'string' ? body.text.trim() : '';
	if (!text) return json({ error: 'text is required', code: 'missing_text' }, { status: 400 });
	if (text.length > MAX_SPEECH_CHARS) {
		return json({ error: 'text is too long', code: 'text_too_long' }, { status: 400 });
	}

	try {
		const { wav, model, voice } = await synthesizeRoLine(text);
		return new Response(Buffer.from(wav), {
			headers: {
				'content-type': 'audio/wav',
				'content-length': String(wav.byteLength),
				'x-ro-voice': `${model}/${voice}`
			}
		});
	} catch (error) {
		if (error instanceof RoSpeechUnavailableError) {
			return json({ error: error.message, code: 'speech_unavailable' }, { status: 503 });
		}
		console.error('[api/apps/ro/speech] feilet:', error);
		return json({ error: 'Speech generation failed', code: 'speech_failed' }, { status: 502 });
	}
};
