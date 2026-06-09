import { describe, it, expect } from 'vitest';
import { parseTaskText } from './task-parse';

describe('parseTaskText', () => {
	it('lar vanlig tekst stå urørt', () => {
		expect(parseTaskText('Grav ut grunn')).toEqual({ text: 'Grav ut grunn', shopping: false });
	});

	it('tolker ikke «på» uten kjøp-prefiks', () => {
		expect(parseTaskText('Monter hylle på vegg')).toEqual({
			text: 'Monter hylle på vegg',
			shopping: false
		});
	});

	it('parser «kjøp: X» som innkjøp', () => {
		expect(parseTaskText('kjøp: skruer')).toEqual({ text: 'skruer', shopping: true });
	});

	it('parser «kjøp: X på [butikk]» med butikk', () => {
		expect(parseTaskText('kjøp: skruer på Maxbo')).toEqual({
			text: 'skruer',
			shopping: true,
			store: 'Maxbo'
		});
	});

	it('håndterer kjop uten ø og store bokstaver', () => {
		expect(parseTaskText('KJOP: terrassebord på Byggmax')).toEqual({
			text: 'terrassebord',
			shopping: true,
			store: 'Byggmax'
		});
	});

	it('trimmer whitespace', () => {
		expect(parseTaskText('  kjøp:  spiker  ')).toEqual({ text: 'spiker', shopping: true });
	});

	it('beholder flerords-vare og flerords-butikk', () => {
		expect(parseTaskText('kjøp: 12 mm kryssfiner på Montér Sør')).toEqual({
			text: '12 mm kryssfiner',
			shopping: true,
			store: 'Montér Sør'
		});
	});
});
