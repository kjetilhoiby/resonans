import { describe, it, expect } from 'vitest';
import { buildCheckinEventCard, truncateReflection } from './event-cards';

describe('truncateReflection', () => {
	it('normaliserer whitespace og lar korte tekster stå', () => {
		expect(truncateReflection('  Hei   verden \n her ')).toBe('Hei verden her');
	});

	it('kutter lange tekster med ellipsis', () => {
		const long = 'a'.repeat(200);
		const out = truncateReflection(long, 50);
		expect(out.length).toBe(50);
		expect(out.endsWith('…')).toBe(true);
	});
});

describe('buildCheckinEventCard', () => {
	it('mapper nivå til ord og emoji, og tar med refleksjon', () => {
		const card = buildCheckinEventCard({ level: 4, reflection: 'God dag på jobb.' });
		expect(card.kind).toBe('checkin');
		expect(card.title).toBe('Egenfrekvens: Bra');
		expect(card.icon).toBe('🌤️');
		expect(card.detail).toBe('God dag på jobb.');
	});

	it('klipper nivå utenfor 1–5 til nærmeste gyldige', () => {
		expect(buildCheckinEventCard({ level: 0 }).title).toBe('Egenfrekvens: Tungt');
		expect(buildCheckinEventCard({ level: 9 }).title).toBe('Egenfrekvens: Full resonans');
	});

	it('gir null detail uten refleksjon', () => {
		expect(buildCheckinEventCard({ level: 3, reflection: '   ' }).detail).toBeNull();
	});
});
