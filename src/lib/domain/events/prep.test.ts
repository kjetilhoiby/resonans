import { describe, it, expect } from 'vitest';
import {
	addPrep,
	defaultPrep,
	describePrep,
	normalizePrep,
	prepStanding,
	remainingSuggestions,
	removePrep,
	togglePrep
} from './prep';

describe('defaultPrep', () => {
	it('gir transport og barnevakt, uhaket', () => {
		const prep = defaultPrep();
		expect(prep.map((p) => p.id)).toEqual(['transport', 'barnevakt']);
		expect(prep.every((p) => !p.done && p.doneAt === null)).toBe(true);
	});
});

describe('togglePrep', () => {
	it('setter doneAt ved avhaking', () => {
		const now = new Date('2026-09-17T10:00:00Z');
		const prep = togglePrep(defaultPrep(), 'transport', true, now);
		expect(prep[0].done).toBe(true);
		expect(prep[0].doneAt).toBe('2026-09-17T10:00:00.000Z');
	});

	it('nuller doneAt ved av-haking — et tidsstempel uten hake er en påstand', () => {
		const now = new Date('2026-09-17T10:00:00Z');
		const haket = togglePrep(defaultPrep(), 'transport', true, now);
		const angret = togglePrep(haket, 'transport', false, now);
		expect(angret[0].done).toBe(false);
		expect(angret[0].doneAt).toBeNull();
	});

	it('rører ikke de andre punktene', () => {
		const prep = togglePrep(defaultPrep(), 'transport', true);
		expect(prep[1].done).toBe(false);
	});
});

describe('addPrep', () => {
	it('legger til med utledet id', () => {
		const prep = addPrep(defaultPrep(), 'Hente billetter i luka');
		expect(prep).toHaveLength(3);
		expect(prep[2].id).toBe('hente-billetter-i-luka');
	});

	it('translittererer norske tegn i id-en', () => {
		expect(addPrep([], 'Kjøre bil')[0].id).toBe('kjoere-bil');
	});

	it('avviser tom etikett', () => {
		expect(addPrep(defaultPrep(), '   ')).toHaveLength(2);
	});

	it('legger ikke til samme etikett to ganger', () => {
		const en = addPrep(defaultPrep(), 'Overnatting');
		expect(addPrep(en, 'overnatting')).toHaveLength(3);
	});

	it('gir unik id når slug-en kolliderer', () => {
		const first = addPrep([], 'Ringe');
		const second = addPrep([...first, { id: 'x', label: 'noe', done: false, doneAt: null }], 'Ringe!');
		expect(second[2].id).toBe('ringe-2');
	});
});

describe('removePrep og remainingSuggestions', () => {
	it('fjerner punktet', () => {
		expect(removePrep(defaultPrep(), 'transport').map((p) => p.id)).toEqual(['barnevakt']);
	});

	it('tilbyr bare forslag som ikke alt ligger der', () => {
		const ids = remainingSuggestions(defaultPrep()).map((s) => s.id);
		expect(ids).not.toContain('transport');
		expect(ids).toContain('overnatting');
	});
});

describe('prepStanding', () => {
	it('teller og navngir det som gjenstår', () => {
		const prep = togglePrep(defaultPrep(), 'transport', true);
		const standing = prepStanding(prep);
		expect(standing).toEqual({ total: 2, done: 1, openLabels: ['Barnevakt'], allDone: false });
	});

	it('allDone er false på en tom liste — ingenting er ikke alt', () => {
		expect(prepStanding([]).allDone).toBe(false);
	});
});

describe('describePrep', () => {
	it('navngir punktet framfor å telle det', () => {
		const prep = togglePrep(defaultPrep(), 'transport', true);
		expect(describePrep(prep)).toBe('Mangler barnevakt');
	});

	it('binder to med og', () => {
		expect(describePrep(defaultPrep())).toBe('Mangler transport og barnevakt');
	});

	it('binder tre med komma og og', () => {
		const prep = addPrep(defaultPrep(), 'Overnatting');
		expect(describePrep(prep)).toBe('Mangler transport, barnevakt og overnatting');
	});

	it('sier alt klart når alt er haket', () => {
		let prep = togglePrep(defaultPrep(), 'transport', true);
		prep = togglePrep(prep, 'barnevakt', true);
		expect(describePrep(prep)).toBe('Alt klart');
	});

	it('tier når det ikke finnes forberedelser', () => {
		expect(describePrep([])).toBeNull();
	});
});

describe('normalizePrep', () => {
	it('tåler søppel fra jsonb-kolonnen', () => {
		expect(normalizePrep(null)).toEqual([]);
		expect(normalizePrep('nei')).toEqual([]);
		expect(normalizePrep([null, 3, { label: '' }])).toEqual([]);
	});

	it('fyller manglende id fra etiketten', () => {
		expect(normalizePrep([{ label: 'Barnevakt' }])[0]).toEqual({
			id: 'barnevakt',
			label: 'Barnevakt',
			done: false,
			doneAt: null,
			note: null
		});
	});

	it('kaster dubletter på id', () => {
		const rows = [
			{ id: 'transport', label: 'Transport', done: true },
			{ id: 'transport', label: 'Transport igjen' }
		];
		expect(normalizePrep(rows)).toHaveLength(1);
		expect(normalizePrep(rows)[0].done).toBe(true);
	});
});
