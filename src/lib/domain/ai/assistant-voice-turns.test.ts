import { describe, it, expect } from 'vitest';
import {
	MAX_TURNS_PER_BATCH,
	MAX_TURN_TEXT_LENGTH,
	parseVoiceTurns,
	VoiceTurnValidationError
} from './assistant-voice-turns';

describe('parseVoiceTurns', () => {
	it('godtar en typisk flush: én brukertur og én assistenttur', () => {
		const parsed = parseVoiceTurns({
			turns: [
				{ role: 'user', text: 'start løp på fem kilometer', at: '2026-08-14T18:00:00Z', source: 'voice' },
				{ role: 'assistant', text: 'Skal jeg starte økta?' }
			]
		});
		expect(parsed.turns).toEqual([
			{ role: 'user', text: 'start løp på fem kilometer' },
			{ role: 'assistant', text: 'Skal jeg starte økta?' }
		]);
	});

	it('trimmer tekst og avviser turer som blir tomme', () => {
		expect(parseVoiceTurns({ turns: [{ role: 'user', text: '  hei  ' }] }).turns[0].text).toBe('hei');
		expect(() => parseVoiceTurns({ turns: [{ role: 'user', text: '   ' }] })).toThrow(
			VoiceTurnValidationError
		);
	});

	it('avviser system-rollen — klientens notiser skal aldri inn i modellens hukommelse', () => {
		expect(() => parseVoiceTurns({ turns: [{ role: 'system', text: 'Samtale avsluttet.' }] })).toThrow(
			/system/
		);
	});

	it('avviser hele batchen over taket framfor å trunkere stille', () => {
		const turns = Array.from({ length: MAX_TURNS_PER_BATCH + 1 }, () => ({
			role: 'user',
			text: 'hei'
		}));
		expect(() => parseVoiceTurns({ turns })).toThrow(String(MAX_TURNS_PER_BATCH));
	});

	it('avviser tekster over lengdetaket med presis grunn', () => {
		const text = 'a'.repeat(MAX_TURN_TEXT_LENGTH + 1);
		expect(() => parseVoiceTurns({ turns: [{ role: 'user', text }] })).toThrow(
			String(MAX_TURN_TEXT_LENGTH)
		);
	});

	it('avviser kropper uten turns-liste, med indeks i feilmeldingen for rad-feil', () => {
		expect(() => parseVoiceTurns(null)).toThrow(VoiceTurnValidationError);
		expect(() => parseVoiceTurns({})).toThrow(/turns/);
		expect(() => parseVoiceTurns({ turns: [] })).toThrow(/tom/);
		expect(() => parseVoiceTurns({ turns: [{ role: 'user', text: 'ok' }, null] })).toThrow(/Tur 1/);
	});

	it('ignorerer ukjente felter — kontrakten kan vokse uten å knekke gamle klienter', () => {
		const parsed = parseVoiceTurns({
			turns: [{ role: 'user', text: 'hei', at: 'i går', source: 'voice', helt: 'ukjent' }]
		});
		expect(parsed.turns).toHaveLength(1);
	});
});
