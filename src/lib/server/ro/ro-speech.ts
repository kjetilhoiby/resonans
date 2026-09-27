import { env } from '$env/dynamic/private';
import { MODELS_ENDPOINT, redactApiKeys } from '$lib/domain/ai/gemini-live-token';
import { buildTtsRequest, DEFAULT_TTS_VOICE, extractAudio, pickTtsModel, toWav } from './ro-speech-logic';

/**
 * Ro-stemmen: Gemini TTS som leser én linje og svarer med WAV. Ekko cacher lyden per
 * linje, så de faste øvelsene hentes én gang per telefon; bare linjene med brukerens egne
 * fraser lages per økt. Se docs/ekko-ro.md.
 */

export class RoSpeechUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RoSpeechUnavailableError';
	}
}

export class RoSpeechError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RoSpeechError';
	}
}

function readKey(): string {
	const key = env.GEMINI_API_KEY?.trim();
	if (!key) throw new RoSpeechUnavailableError('GEMINI_API_KEY er ikke satt i miljøet.');
	return key;
}

/**
 * Modellen slås opp i katalogen og huskes i en time. Ikke en datacache: en modell-id
 * er konfigurasjon, og uten den måtte hver linje betalt et ekstra kall mot Google.
 */
let resolved: { model: string; at: number } | null = null;
const MODEL_TTL_MS = 60 * 60 * 1000;

async function ttsModel(key: string): Promise<string> {
	const configured = env.GEMINI_TTS_MODEL?.trim();
	if (configured) return configured;
	if (resolved && Date.now() - resolved.at < MODEL_TTL_MS) return resolved.model;
	const response = await fetch(MODELS_ENDPOINT, { headers: { 'x-goog-api-key': key } });
	const text = await response.text();
	if (!response.ok) throw new RoSpeechError(redactApiKeys(`Modellkatalogen svarte ${response.status}: ${text.slice(0, 300)}`, key));
	const model = pickTtsModel(JSON.parse(text));
	if (!model) throw new RoSpeechUnavailableError('Fant ingen TTS-modell i Googles katalog.');
	resolved = { model, at: Date.now() };
	return model;
}

export function ttsVoice(): string {
	return env.GEMINI_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;
}

export async function synthesizeRoLine(text: string): Promise<{ wav: Uint8Array; model: string; voice: string }> {
	const key = readKey();
	const model = await ttsModel(key);
	const voice = ttsVoice();
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
			body: JSON.stringify(buildTtsRequest(text, voice))
		});
	} catch (err) {
		throw new RoSpeechError(redactApiKeys(`Nådde ikke Google: ${err instanceof Error ? err.message : String(err)}`, key));
	}
	const body = await response.text();
	if (!response.ok) {
		// En modell som har forsvunnet fra katalogen: glem den, så neste kall slår opp på nytt.
		if (response.status === 404) resolved = null;
		throw new RoSpeechError(redactApiKeys(`Google svarte ${response.status}: ${body.slice(0, 300)}`, key));
	}
	const audio = extractAudio(JSON.parse(body));
	if (!audio) throw new RoSpeechError('Svaret fra Google hadde ingen lyd.');
	return { wav: toWav(audio), model, voice };
}
