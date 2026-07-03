import { describe, it, expect } from 'vitest';
import { markdownToPlain } from './plan-text';

describe('markdownToPlain', () => {
	it('fjerner fet og kursiv, beholder teksten', () => {
		expect(markdownToPlain('Her er **5 konkrete juli-mål** og *litt* til')).toBe(
			'Her er 5 konkrete juli-mål og litt til'
		);
	});

	it('fjerner overskrifter og gjør punktlister til «- »', () => {
		expect(markdownToPlain('# Tittel\n* Punkt A\n+ Punkt B\n- Punkt C')).toBe(
			'Tittel\n- Punkt A\n- Punkt B\n- Punkt C'
		);
	});

	it('beholder nummererte lister', () => {
		expect(markdownToPlain('1. **Ta en runde hver dag**\n   Se etter rot')).toBe(
			'1. Ta en runde hver dag\n   Se etter rot'
		);
	});

	it('rører ikke snake_case inne i ord', () => {
		expect(markdownToPlain('bruk running_distance her')).toBe('bruk running_distance her');
	});

	it('fjerner inline-kode og lenker', () => {
		expect(markdownToPlain('se `koden` og [dokene](https://x.no)')).toBe('se koden og dokene');
	});

	it('beholder punktlister som innhold (fjerner bare inline-støy)', () => {
		const raw = 'Planen min:\n- **Løpe** 30 km\n- Yoga hver uke';
		expect(markdownToPlain(raw)).toBe('Planen min:\n- Løpe 30 km\n- Yoga hver uke');
	});

	it('tåler tom input', () => {
		expect(markdownToPlain('')).toBe('');
	});
});
