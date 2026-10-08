import { describe, it, expect } from 'vitest';
import { extractNumbers, letterFactsText, proseParagraphs, unknownNumbers, HOME_LETTER_SYSTEM_PROMPT } from './home-letter-prose';
import type { HomeLetter } from '$lib/domain/home-letter';

const letter: HomeLetter = {
	greeting: 'God morgen.',
	lines: [
		{ id: 'goal:w', lens: 'status', section: 'maal', text: 'Redusere vekt til 85 kg: 97,7 kg nå, målet er 85,0 kg.', source: 'mål' },
		{ id: 'effort-7d', lens: 'status', section: 'uka', text: 'Siste sju dager: 1 432 i effort, innenfor rammen din (389–467).', source: 'effort' }
	],
	dropped: [{ id: 'x', lens: 'status', section: 'ellers', text: 'Valgt bort: 42.', source: 'vekt' }]
};

describe('letterFactsText', () => {
	it('grupperer linjene som i brevet, og tar ikke med det som er valgt bort', () => {
		expect(letterFactsText(letter)).toBe(
			'Hilsen: God morgen.\n\nMålene:\n- Redusere vekt til 85 kg: 97,7 kg nå, målet er 85,0 kg.\n\nUka:\n- Siste sju dager: 1 432 i effort, innenfor rammen din (389–467).'
		);
	});
});

describe('extractNumbers', () => {
	it('normaliserer tusenskille og desimaltegn', () => {
		expect(extractNumbers('1 432 i effort, 97,7 kg og 97.7 kg, 30. september 2027')).toEqual(['1432', '97,7', '97,7', '30', '2027']);
	});
});

describe('unknownNumbers', () => {
	const facts = letterFactsText(letter);

	it('godtar tall som står i faktaene, også med annet tusenskille', () => {
		expect(unknownNumbers('Du veier 97,7 kg, og uka står på 1432.', facts)).toEqual([]);
	});

	it('fanger et tall modellen regnet ut selv', () => {
		expect(unknownNumbers('Du har 12,7 kg igjen til 85 kg.', facts)).toEqual(['12,7']);
	});

	it('tar ikke med tall fra det som ble valgt bort', () => {
		expect(unknownNumbers('Noe om 42.', facts)).toEqual(['42']);
	});
});

describe('proseParagraphs', () => {
	it('deler på blanke linjer og slår sammen linjeskift inni et avsnitt', () => {
		expect(proseParagraphs('God morgen.\n\nMålene står\ngodt.\n\n\n')).toEqual(['God morgen.', 'Målene står godt.']);
	});
});

describe('prompten', () => {
	it('har ingen backticks og forbyr nye tall', () => {
		expect(HOME_LETTER_SYSTEM_PROMPT).not.toContain('`');
		expect(HOME_LETTER_SYSTEM_PROMPT).toContain('Ikke rund av, ikke regn om');
	});
});
