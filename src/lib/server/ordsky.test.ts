import { describe, expect, it } from 'vitest';
import { buildOrdsky, tokenize } from './ordsky';

describe('tokenize', () => {
	it('senker case, beholder æøå og fjerner stoppord', () => {
		expect(tokenize('Kjøpe BLÅBÆR til frokost og rydde')).toEqual(['kjøpe', 'blåbær', 'frokost', 'rydde']);
	});

	it('fjerner korte ord, tall og løse bindestreker', () => {
		expect(tokenize('GP kl 12 - husk e-post')).toEqual(['husk', 'e-post']);
	});
});

describe('buildOrdsky', () => {
	it('teller, sorterer og vekter ord 0..1', () => {
		const words = buildOrdsky([
			'rydde garasjen',
			'rydde kjelleren',
			'rydde loftet',
			'kjøpe melk',
			'kjøpe brød',
			'ringe tannlegen'
		], { minCount: 2 });
		expect(words.map((w) => w.word)).toEqual(['rydde', 'kjøpe']);
		expect(words[0]).toEqual({ word: 'rydde', count: 3, weight: 1 });
		expect(words[1].weight).toBe(0);
	});

	it('gir alle ord vekt 1 når frekvensene er like', () => {
		const words = buildOrdsky(['rydde rydde', 'kjøpe kjøpe'], { minCount: 2 });
		expect(words.every((w) => w.weight === 1)).toBe(true);
	});

	it('respekterer maxWords og bruker alfabetisk sortering ved lik frekvens', () => {
		const words = buildOrdsky(['banan eple', 'banan eple', 'agurk agurk'], {
			maxWords: 2,
			minCount: 2
		});
		expect(words.map((w) => w.word)).toEqual(['agurk', 'banan']);
	});

	it('returnerer tom liste uten gjentatte ord', () => {
		expect(buildOrdsky(['helt unike ordformer overalt'])).toEqual([]);
	});
});
