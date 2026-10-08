import { describe, it, expect } from 'vitest';
import {
	buildProseInput,
	extractNumbers,
	omittedLines,
	parseProse,
	plainProse,
	unknownNumbers,
	HOME_LETTER_SYSTEM_PROMPT
} from './home-letter-prose';
import type { HomeLetter } from '$lib/domain/home-letter';

const letter: HomeLetter = {
	greeting: 'God morgen.',
	lines: [
		{
			id: 'goal:w',
			lens: 'status',
			section: 'maal',
			text: 'Redusere vekt til 85 kg: 97,7 kg nå, målet er 85,0 kg.',
			source: 'mål',
			href: '/plan/mal',
			facts: [
				['mål', 'Redusere vekt til 85 kg'],
				['frist', '30. juni 2028']
			]
		},
		{ id: 'effort-7d', lens: 'status', section: 'uka', text: 'Siste sju dager: 1 432 i effort, innenfor rammen din (389–467).', source: 'effort', href: '/tema/helse' },
		{ id: 'note', lens: 'status', section: 'ellers', text: 'En linje uten lenke.', source: 'vekt' }
	],
	dropped: [{ id: 'x', lens: 'status', section: 'ellers', text: 'Valgt bort: 42.', source: 'vekt' }]
};

describe('buildProseInput', () => {
	it('gir hver linje en bokstav-id, med tallene bak under, og tar ikke med det som er valgt bort', () => {
		const input = buildProseInput(letter);
		expect(input.text).toBe(
			[
				'Hilsen: God morgen.',
				'',
				'Målene:',
				'[a] Redusere vekt til 85 kg: 97,7 kg nå, målet er 85,0 kg.',
				'    mål: Redusere vekt til 85 kg',
				'    frist: 30. juni 2028',
				'',
				'Uka:',
				'[b] Siste sju dager: 1 432 i effort, innenfor rammen din (389–467).',
				'',
				'Ellers:',
				'[c] En linje uten lenke.'
			].join('\n')
		);
		expect([...input.refs.keys()]).toEqual(['a', 'b', 'c']);
	});
});

describe('parseProse', () => {
	const { refs } = buildProseInput(letter);

	it('gjør merkede ord til lenker mot linjens adresse', () => {
		expect(parseProse('Du ligger an mot [vektmålet](#a), og uka er [innenfor rammen](#b).', refs)).toEqual([
			[
				{ text: 'Du ligger an mot ' },
				{ text: 'vektmålet', ref: 'a', href: '/plan/mal' },
				{ text: ', og uka er ' },
				{ text: 'innenfor rammen', ref: 'b', href: '/tema/helse' },
				{ text: '.' }
			]
		]);
	});

	it('en ukjent id blir vanlig tekst, en linje uten adresse blir en uthevelse', () => {
		expect(parseProse('[Noe](#z) og [annet](#c).', refs)).toEqual([
			[{ text: 'Noe' }, { text: ' og ' }, { text: 'annet', ref: 'c', href: null }, { text: '.' }]
		]);
	});

	it('deler på blanke linjer og slår sammen linjeskift inni et avsnitt', () => {
		expect(plainProse(parseProse('God morgen.\n\nMålene står\ngodt.\n\n\n', refs))).toBe('God morgen.\n\nMålene står godt.');
	});
});

describe('omittedLines', () => {
	it('lister linjene teksten aldri lenker til', () => {
		const { refs } = buildProseInput(letter);
		const paragraphs = parseProse('Hei. [Vektmålet](#a) går bra.', refs);
		expect(omittedLines(paragraphs, refs).map((l) => l.id)).toEqual(['effort-7d', 'note']);
	});
});

describe('extractNumbers', () => {
	it('normaliserer tusenskille og desimaltegn', () => {
		expect(extractNumbers('1 432 i effort, 97,7 kg og 97.7 kg, 30. september 2027')).toEqual(['1432', '97,7', '97,7', '30', '2027']);
	});
});

describe('unknownNumbers', () => {
	const facts = buildProseInput(letter).text;

	it('godtar tall som står i faktaene, også med annet tusenskille', () => {
		expect(unknownNumbers('Du veier 97,7 kg, og uka står på 1432.', facts)).toEqual([]);
	});

	it('godtar tall som bare står i tallene bak linja', () => {
		expect(unknownNumbers('Fristen er 30. juni 2028.', facts)).toEqual([]);
	});

	it('fanger et tall modellen regnet ut selv', () => {
		expect(unknownNumbers('Du har 12,7 kg igjen til 85 kg.', facts)).toEqual(['12,7']);
	});

	it('tar ikke med tall fra det som ble valgt bort', () => {
		expect(unknownNumbers('Noe om 42.', facts)).toEqual(['42']);
	});

	it('lenkemerkingen gir ingen tall når teksten leses uten den', () => {
		const { refs } = buildProseInput(letter);
		expect(unknownNumbers(plainProse(parseProse('[Vektmålet](#a).', refs)), facts)).toEqual([]);
	});
});

describe('prompten', () => {
	it('har ingen backticks, forbyr nye tall og ber om lenker', () => {
		expect(HOME_LETTER_SYSTEM_PROMPT).not.toContain('`');
		expect(HOME_LETTER_SYSTEM_PROMPT).toContain('Ikke rund av, ikke regn om');
		expect(HOME_LETTER_SYSTEM_PROMPT).toContain('[ord](#id)');
	});
});
