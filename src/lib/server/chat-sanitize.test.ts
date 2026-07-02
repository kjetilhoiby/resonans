import { describe, it, expect } from 'vitest';
import { stripToolLeakage } from './chat-sanitize';

describe('stripToolLeakage', () => {
	it('fjerner inline JSON-args og rydder tegnsetting', () => {
		const input = 'Jeg knytter dette til personene. {"personName":"Anita"}';
		expect(stripToolLeakage(input)).toBe('Jeg knytter dette til personene.');
	});

	it('fjerner JSON på egen linje uten å etterlate tom linje', () => {
		const input = 'Puh, det var intenst.\n{"personName":"Anita"}\nIkke rart du er trett.';
		expect(stripToolLeakage(input)).toBe('Puh, det var intenst.\nIkke rart du er trett.');
	});

	it('lar vanlig prosa være i fred', () => {
		const input = 'Både treg hyttemorgen og en maraton hjemme. Ikke rart du er trett 🥴';
		expect(stripToolLeakage(input)).toBe(input);
	});

	it('rører ikke markdown-lenker eller braketter', () => {
		const input = 'Se [ukeplanen](/ukeplan) for detaljer.';
		expect(stripToolLeakage(input)).toBe(input);
	});

	it('håndterer tom streng', () => {
		expect(stripToolLeakage('')).toBe('');
	});
});
