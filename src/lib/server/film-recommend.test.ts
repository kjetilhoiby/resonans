import { describe, it, expect } from 'vitest';
import { rankRecommendations, type RecommendCandidate } from './film-recommend';

function candidate(partial: Partial<RecommendCandidate> & { title: string }): RecommendCandidate {
	return { source: 'library', ...partial };
}

describe('rankRecommendations', () => {
	it('prioriterer filmer på mine tjenester øverst', () => {
		const ranked = rankRecommendations(
			[
				candidate({ title: 'Ikke tilgjengelig', runtime: 100, availableProviders: ['Disney+'] }),
				candidate({ title: 'På Netflix', runtime: 100, availableProviders: ['Netflix'] })
			],
			{ minutes: 120, providerNames: ['Netflix'] }
		);
		expect(ranked[0].title).toBe('På Netflix');
		expect(ranked[0].availableOnMyServices).toBe(true);
		expect(ranked[1].availableOnMyServices).toBe(false);
	});

	it('markerer filmer som ikke passer tiden (men ikke filtreres bort)', () => {
		// 145 min > 120+10 buffer (ikke fitsTime), men <= 120+30 (ikke filtrert bort)
		const ranked = rankRecommendations(
			[candidate({ title: 'Lang', runtime: 145 })],
			{ minutes: 120 }
		);
		expect(ranked[0].fitsTime).toBe(false);
	});

	it('godtar buffer på 10 min', () => {
		const ranked = rankRecommendations(
			[candidate({ title: 'Litt over', runtime: 128 })],
			{ minutes: 120 }
		);
		expect(ranked[0].fitsTime).toBe(true);
	});

	it('filtrerer bort filmer som er mye for lange (>30 min over)', () => {
		const ranked = rankRecommendations(
			[
				candidate({ title: 'Altfor lang', runtime: 200 }),
				candidate({ title: 'Grei', runtime: 110 })
			],
			{ minutes: 120 }
		);
		expect(ranked.map((r) => r.title)).toEqual(['Grei']);
	});

	it('inkluderer filmer med ukjent kjøretid (fitsTime=true)', () => {
		const ranked = rankRecommendations(
			[candidate({ title: 'Ukjent lengde', runtime: null })],
			{ minutes: 90 }
		);
		expect(ranked).toHaveLength(1);
		expect(ranked[0].fitsTime).toBe(true);
	});

	it('sorterer passende foran ikke-passende, deretter på rating', () => {
		const ranked = rankRecommendations(
			[
				candidate({ title: 'Passer lav rating', runtime: 100, rating: 5 }),
				candidate({ title: 'Passer høy rating', runtime: 100, rating: 9 }),
				candidate({ title: 'For lang', runtime: 145 })
			],
			{ minutes: 120 }
		);
		expect(ranked.map((r) => r.title)).toEqual([
			'Passer høy rating',
			'Passer lav rating',
			'For lang'
		]);
	});

	it('matcher tjenestenavn uavhengig av store/små bokstaver', () => {
		const ranked = rankRecommendations(
			[candidate({ title: 'X', runtime: 90, availableProviders: ['netflix'] })],
			{ minutes: 120, providerNames: ['Netflix'] }
		);
		expect(ranked[0].availableOnMyServices).toBe(true);
		expect(ranked[0].matchedProviders).toEqual(['netflix']);
	});
});
