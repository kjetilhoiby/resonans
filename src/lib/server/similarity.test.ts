import { describe, it, expect } from 'vitest';
import { calculateSimilarity, areSemanticallySimilar, findSimilar } from './similarity';

describe('calculateSimilarity', () => {
	it('returnerer 100 for identiske strenger', () => {
		expect(calculateSimilarity('Løpe 5 km', 'Løpe 5 km')).toBe(100);
	});

	it('returnerer 100 for to tomme strenger', () => {
		expect(calculateSimilarity('', '')).toBe(100);
	});

	it('er case-insensitive', () => {
		expect(calculateSimilarity('Styrketrening', 'styrketrening')).toBe(100);
	});

	it('gir lav score for helt ulike strenger', () => {
		const score = calculateSimilarity('abc', 'xyz');
		expect(score).toBeLessThan(30);
	});

	it('gir delvis match for lignende strenger', () => {
		const score = calculateSimilarity('Løpe 5 km', 'Løpe 10 km');
		expect(score).toBeGreaterThan(50);
		expect(score).toBeLessThan(100);
	});

	it('håndterer en tom og en ikke-tom streng', () => {
		expect(calculateSimilarity('', 'hei')).toBe(0);
		expect(calculateSimilarity('hei', '')).toBe(0);
	});
});

describe('areSemanticallySimilar', () => {
	it('matcher identiske strenger', () => {
		expect(areSemanticallySimilar('Løpe 5 km', 'Løpe 5 km')).toBe(true);
	});

	it('matcher strenger med omstokket ordrekkefølge', () => {
		expect(areSemanticallySimilar('Gå tur i parken', 'I parken gå tur')).toBe(true);
	});

	it('avviser helt ulike strenger', () => {
		expect(areSemanticallySimilar('Styrketrening', 'Bankoverføring')).toBe(false);
	});

	it('respekterer custom threshold', () => {
		// Med høy threshold kreves nær-identisk match
		expect(areSemanticallySimilar('Løping i skogen', 'Svømming i havet', 95)).toBe(false);
		// Med lav threshold matcher mer løst
		expect(areSemanticallySimilar('Løpe 5 km', 'Løpe 10 km', 50)).toBe(true);
	});

	it('matcher via Jaccard på nøkkelord (ord > 3 tegn)', () => {
		// Deler nøkkelordet "styrketrening" — Jaccard slår inn
		expect(areSemanticallySimilar(
			'Styrketrening mandag kveld',
			'Kveld med styrketrening'
		)).toBe(true);
	});

	it('returnerer false for ulike strenger selv med lav threshold', () => {
		// Helt ulike lange ord — ingen av de tre sjekkene slår inn
		expect(areSemanticallySimilar('Bankoverføring', 'Fjellklatring', 70)).toBe(false);
	});
});

describe('findSimilar', () => {
	const items = [
		{ id: 1, name: 'Løpe 5 km' },
		{ id: 2, name: 'Styrketrening' },
		{ id: 3, name: 'Svømme 1 km' },
		{ id: 4, name: 'Løpe 10 km' },
	];
	const getText = (item: { name: string }) => item.name;

	it('returnerer treff sortert etter likhet (høyest først)', () => {
		const results = findSimilar('Løpe 5 km', items, getText, 50);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].item.name).toBe('Løpe 5 km');
		expect(results[0].similarity).toBe(100);

		// Sjekk at listen er sortert synkende
		for (let i = 1; i < results.length; i++) {
			expect(results[i].similarity).toBeLessThanOrEqual(results[i - 1].similarity);
		}
	});

	it('filtrerer bort treff under threshold', () => {
		const results = findSimilar('Løpe 5 km', items, getText, 95);
		// Kun eksakt match bør passere 95 %
		expect(results.length).toBe(1);
		expect(results[0].item.id).toBe(1);
	});

	it('returnerer tom liste når ingenting matcher', () => {
		const results = findSimilar('Bankoverføring', items, getText, 70);
		expect(results).toEqual([]);
	});

	it('fungerer med streng-array via identity-funksjon', () => {
		const strings = ['Hei', 'Hallo', 'Heisann'];
		const results = findSimilar('Hei', strings, (s) => s, 50);
		expect(results.length).toBeGreaterThanOrEqual(1);
		expect(results[0].item).toBe('Hei');
	});
});
