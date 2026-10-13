import { describe, it, expect } from 'vitest';
import { buildTtsRequest, DEFAULT_TTS_VOICE, parseSpeechSetting, RO_READING_STYLE, extractAudio, pcmSampleRate, pcmToWav, pickTtsModel, toWav } from './ro-speech-logic';

describe('pickTtsModel', () => {
	it('foretrekker flash framfor pro og lite, og nyeste versjon', () => {
		const payload = {
			models: [
				{ name: 'models/gemini-2.5-pro-preview-tts', supportedGenerationMethods: ['generateContent'] },
				{ name: 'models/gemini-3.1-flash-tts-preview', supportedGenerationMethods: ['generateContent'] },
				{ name: 'models/gemini-3.8-flash-lite-tts', supportedGenerationMethods: ['generateContent'] },
				{ name: 'models/gemini-3.8-flash-tts', supportedGenerationMethods: ['generateContent'] },
				{ name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }
			]
		};
		expect(pickTtsModel(payload)).toBe('gemini-3.8-flash-tts');
	});
	it('hopper over modeller uten generateContent', () => {
		expect(pickTtsModel({ models: [{ name: 'models/x-tts', supportedGenerationMethods: ['bidiGenerateContent'] }] })).toBeNull();
	});
	it('tåler søppel', () => {
		expect(pickTtsModel(null)).toBeNull();
		expect(pickTtsModel({ models: 'nei' })).toBeNull();
	});
});

describe('buildTtsRequest', () => {
	it('ber om lyd på norsk med valgt stemme, og teksten står ordrett til slutt', () => {
		const req = buildTtsRequest('Kjenn føttene.', 'Sulafat');
		expect(req.generationConfig.responseModalities).toEqual(['AUDIO']);
		expect(req.generationConfig.speechConfig.languageCode).toBe('nb-NO');
		expect(req.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Sulafat');
		expect(req.contents[0].parts[0].text.endsWith('\n\nKjenn føttene.')).toBe(true);
	});
	it('bruker løpeinstruksen uten setting, og stillhetens med', () => {
		expect(buildTtsRequest('Pust.', 'Sulafat').contents[0].parts[0].text.startsWith(RO_READING_STYLE.moving)).toBe(true);
		const still = buildTtsRequest('Pust.', 'Vindemiatrix', 'still').contents[0].parts[0].text;
		expect(still.startsWith(RO_READING_STYLE.still)).toBe(true);
		expect(still).not.toMatch(/running/);
	});
});

describe('setting', () => {
	it('er bevegelse med mindre det står «still»', () => {
		expect(parseSpeechSetting('still')).toBe('still');
		expect(parseSpeechSetting('moving')).toBe('moving');
		expect(parseSpeechSetting(undefined)).toBe('moving');
		expect(parseSpeechSetting('STILL')).toBe('moving');
	});
	it('har hver sin stemme', () => {
		expect(DEFAULT_TTS_VOICE.moving).toBe('Sulafat');
		expect(DEFAULT_TTS_VOICE.still).not.toBe(DEFAULT_TTS_VOICE.moving);
	});
});

describe('lyd', () => {
	it('leser raten fra mimetypen, med 24 kHz som standard', () => {
		expect(pcmSampleRate('audio/L16;codec=pcm;rate=24000')).toBe(24000);
		expect(pcmSampleRate('audio/L16;rate=16000')).toBe(16000);
		expect(pcmSampleRate('audio/L16')).toBe(24000);
	});
	it('lager en gyldig WAV-header rundt PCM', () => {
		const wav = pcmToWav(new Uint8Array([1, 2, 3, 4]), 24000);
		const v = new DataView(wav.buffer);
		expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
		expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
		expect(v.getUint32(24, true)).toBe(24000);
		expect(v.getUint32(40, true)).toBe(4);
		expect(wav.byteLength).toBe(48);
	});
	it('plukker lyden ut av svaret og pakker den som WAV', () => {
		const payload = { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from([0, 0, 1, 1]).toString('base64') } }] } }] };
		const audio = extractAudio(payload)!;
		expect(audio.data.byteLength).toBe(4);
		expect(toWav(audio).byteLength).toBe(48);
	});
	it('gir null når svaret ikke har lyd', () => {
		expect(extractAudio({ candidates: [{ content: { parts: [{ text: 'hei' }] } }] })).toBeNull();
	});
});
