/**
 * Ren logikk for Ro-stemmen: Gemini TTS leser øvelsene (docs/ekko-ro.md).
 *
 * TTS, ikke Live. Live er en modell som omformulerer – en sonekorreksjon ble omskrevet
 * til sin egen motsetning 31. august, og i Ro er ordlyden selve øvelsen. TTS leser teksten
 * den får. Stilen («rolig, lavt, sakte») gis som en leseinstruks foran teksten.
 */

/**
 * To settinger, to stemmer. I bevegelse må stemmen bære over vind og pust; i stillhet
 * (og på yogamatta) er rommet stille og stemmen kan komme nærmere. Uten `setting` er det
 * bevegelse, så eldre Ekko-versjoner får det de alltid har fått.
 */
export type RoSpeechSetting = 'moving' | 'still';

export const DEFAULT_TTS_VOICE: Record<RoSpeechSetting, string> = {
	moving: 'Sulafat', // «warm» – hørt på løpetur 27. september 2026
	still: 'Vindemiatrix' // «gentle»
};
/** Lengste tekst vi leser. En Ro-linje er to–tre setninger; mer enn dette er ikke en linje. */
export const MAX_SPEECH_CHARS = 600;

export function parseSpeechSetting(value: unknown): RoSpeechSetting {
	return value === 'still' ? 'still' : 'moving';
}

/**
 * Leseinstruksen. På engelsk fordi det er slik TTS-modellene er instruert i Googles egne
 * eksempler; teksten som leses er norsk. «Exactly as written» fordi ordlyden er øvelsen.
 * Endrer du en av dem, må Ekko bumpe `RoVoice`-versjonen for den settingen.
 */
export const RO_READING_STYLE: Record<RoSpeechSetting, string> = {
	moving:
		'Read the following Norwegian text aloud exactly as written. Speak calmly, warmly and slowly, ' +
		'in a low, quiet voice, like a meditation guide speaking to someone who is out running. ' +
		'Leave small natural pauses between sentences.',
	still:
		'Read the following Norwegian text aloud exactly as written. Speak very softly, gently and slowly, ' +
		'close and unhurried, like a meditation guide in a quiet room speaking to someone who is sitting, ' +
		'lying down or doing slow yoga. Let the voice settle at the end of each sentence, ' +
		'and leave longer pauses between sentences.'
};

export function buildTtsPrompt(text: string, setting: RoSpeechSetting = 'moving'): string {
	return `${RO_READING_STYLE[setting]}\n\n${text}`;
}

export function buildTtsRequest(text: string, voice: string, setting: RoSpeechSetting = 'moving') {
	return {
		contents: [{ role: 'user', parts: [{ text: buildTtsPrompt(text, setting) }] }],
		generationConfig: {
			responseModalities: ['AUDIO'],
			speechConfig: {
				languageCode: 'nb-NO',
				voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }
			}
		}
	};
}

/**
 * Velg TTS-modell fra Googles katalog. Modellnavn hardkodes ikke som en påstand (de
 * skifter fra uke til uke): foretrekk «flash» framfor «pro» (latens) og ikke-«lite»,
 * og de uten «preview» foran preview. Høyeste versjonsnummer vinner innen samme klasse.
 */
export function pickTtsModel(payload: unknown): string | null {
	const models = (payload as { models?: unknown })?.models;
	if (!Array.isArray(models)) return null;
	const candidates = models
		.filter((m): m is { name: string; supportedGenerationMethods?: string[] } => typeof m?.name === 'string')
		.filter((m) => /tts/i.test(m.name))
		.filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
		.map((m) => m.name.replace(/^models\//, ''));
	if (candidates.length === 0) return null;
	const version = (name: string) => Number(name.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
	const score = (name: string) =>
		(/flash/.test(name) ? 100 : 0) + (/lite/.test(name) ? -50 : 0) + (/preview/.test(name) ? -10 : 0);
	return candidates.sort((a, b) => score(b) - score(a) || version(b) - version(a))[0];
}

/** `audio/L16;codec=pcm;rate=24000` → 24000. Mangler raten, er 24 kHz Googles standard. */
export function pcmSampleRate(mimeType: string): number {
	const rate = Number(mimeType.match(/rate=(\d+)/)?.[1]);
	return Number.isFinite(rate) && rate > 0 ? rate : 24000;
}

/** Legg en WAV-header rundt rå 16-bit mono PCM, så AVAudioPlayer kan spille den direkte. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
	const header = new ArrayBuffer(44);
	const v = new DataView(header);
	const ascii = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
	ascii(0, 'RIFF');
	v.setUint32(4, 36 + pcm.byteLength, true);
	ascii(8, 'WAVE');
	ascii(12, 'fmt ');
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, 1, true); // mono
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * 2, true);
	v.setUint16(32, 2, true);
	v.setUint16(34, 16, true);
	ascii(36, 'data');
	v.setUint32(40, pcm.byteLength, true);
	const out = new Uint8Array(44 + pcm.byteLength);
	out.set(new Uint8Array(header), 0);
	out.set(pcm, 44);
	return out;
}

/** Plukk lyden ut av et generateContent-svar. `null` når svaret ikke har lyd. */
export function extractAudio(payload: unknown): { data: Uint8Array; mimeType: string } | null {
	const parts = (payload as { candidates?: { content?: { parts?: unknown[] } }[] })?.candidates?.[0]?.content?.parts;
	if (!Array.isArray(parts)) return null;
	for (const part of parts) {
		const inline = (part as { inlineData?: { data?: unknown; mimeType?: unknown } })?.inlineData;
		if (typeof inline?.data === 'string' && inline.data) {
			return {
				data: new Uint8Array(Buffer.from(inline.data, 'base64')),
				mimeType: typeof inline.mimeType === 'string' ? inline.mimeType : 'audio/L16;rate=24000'
			};
		}
	}
	return null;
}

/** Svaret til appen er alltid WAV, uansett hva Google sendte. */
export function toWav(audio: { data: Uint8Array; mimeType: string }): Uint8Array {
	if (/wav/i.test(audio.mimeType)) return audio.data;
	return pcmToWav(audio.data, pcmSampleRate(audio.mimeType));
}
