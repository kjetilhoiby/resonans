import { describe, it, expect } from 'vitest';
import { applyOrder, compileManuscript, moveDoc, normalizeOrder } from './manuscript';

const d = (id: string, sortOrder: number) => ({ id, sortOrder });

describe('normalizeOrder', () => {
	it('gir tett rekkefølge 0..n-1', () => {
		expect(normalizeOrder([d('a', 5), d('b', 9), d('c', 12)])).toEqual([
			d('a', 0),
			d('b', 1),
			d('c', 2)
		]);
	});

	it('løser opp nuller — alle rader starter på 0, og da ville flytting vært en no-op', () => {
		expect(normalizeOrder([d('a', 0), d('b', 0), d('c', 0)]).map((x) => x.sortOrder)).toEqual([
			0, 1, 2
		]);
	});

	it('muterer ikke inn-lista', () => {
		const input = [d('a', 7)];
		normalizeOrder(input);
		expect(input[0].sortOrder).toBe(7);
	});
});

describe('moveDoc', () => {
	const docs = [d('a', 0), d('b', 1), d('c', 2)];

	it('flytter opp', () => {
		expect(moveDoc(docs, 'b', 'opp').map((x) => x.id)).toEqual(['b', 'a', 'c']);
	});

	it('flytter ned', () => {
		expect(moveDoc(docs, 'b', 'ned').map((x) => x.id)).toEqual(['a', 'c', 'b']);
	});

	it('er en no-op på øverste og nederste — ikke en feil', () => {
		expect(moveDoc(docs, 'a', 'opp')).toBe(docs);
		expect(moveDoc(docs, 'c', 'ned')).toBe(docs);
	});

	it('er en no-op for ukjent id', () => {
		expect(moveDoc(docs, 'finnes-ikke', 'opp')).toBe(docs);
	});

	it('tetter rekkefølgen etter flytting', () => {
		const moved = moveDoc([d('a', 3), d('b', 8), d('c', 40)], 'c', 'opp');
		expect(moved.map((x) => x.sortOrder)).toEqual([0, 1, 2]);
		expect(moved.map((x) => x.id)).toEqual(['a', 'c', 'b']);
	});

	it('sorterer på sortOrder før flytting, ikke på lista-rekkefølgen', () => {
		const rot = [d('c', 2), d('a', 0), d('b', 1)];
		expect(moveDoc(rot, 'c', 'opp').map((x) => x.id)).toEqual(['a', 'c', 'b']);
	});
});

describe('applyOrder', () => {
	const docs = [d('a', 0), d('b', 1), d('c', 2)];

	it('følger id-lista', () => {
		expect(applyOrder(docs, ['c', 'a', 'b']).map((x) => x.id)).toEqual(['c', 'a', 'b']);
	});

	it('ignorerer ukjente id-er', () => {
		expect(applyOrder(docs, ['c', 'spøkelse', 'a', 'b']).map((x) => x.id)).toEqual(['c', 'a', 'b']);
	});

	it('beholder dokumenter klienten glemte — en utdatert klient skal ikke kunne slette et kapittel', () => {
		expect(applyOrder(docs, ['c']).map((x) => x.id)).toEqual(['c', 'a', 'b']);
	});

	it('tåler duplikater i inn-lista', () => {
		expect(applyOrder(docs, ['b', 'b', 'a']).map((x) => x.id)).toEqual(['b', 'a', 'c']);
	});

	it('gir tett rekkefølge', () => {
		expect(applyOrder(docs, ['c', 'b', 'a']).map((x) => x.sortOrder)).toEqual([0, 1, 2]);
	});
});

describe('compileManuscript', () => {
	const doc = (id: string, sortOrder: number, title: string | null, body: string | null) => ({
		id,
		kind: 'scene',
		title,
		body,
		sortOrder
	});

	it('setter sammen i rekkefølge, ikke i lista-rekkefølge', () => {
		const result = compileManuscript([
			doc('b', 1, 'Andre', 'To.'),
			doc('a', 0, 'Første', 'En.')
		]);
		expect(result.text.indexOf('En.')).toBeLessThan(result.text.indexOf('To.'));
	});

	it('teller ord over hele manuset', () => {
		const result = compileManuscript([
			doc('a', 0, 'A', 'en to tre'),
			doc('b', 1, 'B', 'fire fem')
		]);
		expect(result.words).toBe(5);
	});

	it('tar med tomme deler i oversikten, men ikke i teksten', () => {
		const result = compileManuscript([
			doc('a', 0, 'Skrevet', 'noe tekst'),
			doc('b', 1, 'Uskrevet', '')
		]);
		expect(result.parts).toHaveLength(2);
		expect(result.parts[1]).toMatchObject({ title: 'Uskrevet', words: 0 });
		// Ingen blank overskrift midt i lesingen.
		expect(result.text).not.toContain('Uskrevet');
	});

	it('bruker førstelinja når tittelen mangler', () => {
		const result = compileManuscript([doc('a', 0, '', 'Hun så ut av vinduet.\nDet regnet.')]);
		expect(result.parts[0].title).toBe('Hun så ut av vinduet.');
	});

	it('gir offset som peker inn i teksten', () => {
		const result = compileManuscript([
			doc('a', 0, 'Første', 'En.'),
			doc('b', 1, 'Andre', 'To.')
		]);
		expect(result.parts[0].offset).toBe(0);
		expect(result.text.slice(result.parts[1].offset)).toContain('Andre');
	});

	it('tåler tomt manus', () => {
		expect(compileManuscript([])).toEqual({ text: '', words: 0, parts: [] });
	});
});
