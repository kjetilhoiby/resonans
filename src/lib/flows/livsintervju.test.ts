import { describe, it, expect } from 'vitest';
import {
	buildLivsintervjuMarkdown,
	parseLivsintervjuMarkdown,
	parseValueLines,
	livskompassDoorOpeners
} from './livsintervju';

describe('buildLivsintervjuMarkdown', () => {
	it('bygger én seksjon per besvart del i stabil rekkefølge', () => {
		const md = buildLivsintervjuMarkdown({
			ett_aar: 'Om ett år løper jeg tre ganger i uka.',
			verdier: 'Nærvær med barna\nHelse som fundament'
		});
		expect(md).toBe(
			'## Verdiene mine\nNærvær med barna\nHelse som fundament\n\n## Om ett år\nOm ett år løper jeg tre ganger i uka.'
		);
	});

	it('hopper over tomme og ukjente svar', () => {
		expect(buildLivsintervjuMarkdown({ ti_aar: '   ', ukjent: 'noe' })).toBe('');
	});
});

describe('parseLivsintervjuMarkdown', () => {
	it('parser markdown tilbake til svar per seksjons-id', () => {
		const md = '## Verdiene mine\nNærvær\n\n## Om fem år\nSkriver bok.';
		expect(parseLivsintervjuMarkdown(md)).toEqual({
			verdier: 'Nærvær',
			fem_aar: 'Skriver bok.'
		});
	});

	it('er robust mot ukjente overskrifter og tomt innhold', () => {
		expect(parseLivsintervjuMarkdown('## Noe annet\ntekst\n\n## Om ti år\n')).toEqual({});
	});

	it('runder tur-retur med buildLivsintervjuMarkdown', () => {
		const answers = { verdier: 'Ærlighet', ti_aar: 'Fri og frisk.', speil: 'Du sier X, men gjør Y.' };
		expect(parseLivsintervjuMarkdown(buildLivsintervjuMarkdown(answers))).toEqual(answers);
	});
});

describe('parseValueLines', () => {
	it('splitter på linjer og stripper kulepunkt', () => {
		expect(parseValueLines('- Nærvær med barna\n• Helse som fundament\nRomslighet i økonomien')).toEqual([
			'Nærvær med barna',
			'Helse som fundament',
			'Romslighet i økonomien'
		]);
	});

	it('forkaster tomme, altfor korte og altfor lange linjer', () => {
		const lang = 'x'.repeat(201);
		expect(parseValueLines(`\n- ab\n${lang}\nEkte verdi her`)).toEqual(['Ekte verdi her']);
	});

	it('begrenser til maks 7 verdier', () => {
		const lines = Array.from({ length: 10 }, (_, i) => `Verdi nummer ${i + 1}`).join('\n');
		expect(parseValueLines(lines)).toHaveLength(7);
	});

	it('gir tom liste for tom blokk', () => {
		expect(parseValueLines('')).toEqual([]);
	});
});

describe('livskompassDoorOpeners', () => {
	it('grupperer alle fire livsområder med dimensjoner', () => {
		const text = livskompassDoorOpeners();
		expect(text).toContain('relasjoner: Partner, Barn, Venner');
		expect(text).toContain('helse:');
		expect(text).toContain('arbeid:');
		expect(text).toContain('mening:');
	});
});
