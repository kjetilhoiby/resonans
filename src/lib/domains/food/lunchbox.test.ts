import { describe, it, expect } from 'vitest';
import {
	scoreComponent,
	suggestLunchbox,
	APPETITE_SLICES,
	type LunchboxComponentLike,
	type LunchboxProfileLike
} from './lunchbox';

function profile(overrides: Partial<LunchboxProfileLike> = {}): LunchboxProfileLike {
	return {
		personId: 'barn-1',
		likes: [],
		dislikes: [],
		allergies: [],
		appetite: 'middels',
		...overrides
	};
}

function component(overrides: Partial<LunchboxComponentLike> & { id: string; name: string }): LunchboxComponentLike {
	return { kind: 'palegg', tags: [], ...overrides };
}

const BASE = {
	recentEntries: [],
	recentReturns: [],
	date: '2026-08-17'
};

describe('scoreComponent', () => {
	it('ekskluderer allergier', () => {
		const result = scoreComponent(component({ id: '1', name: 'Peanøttsmør' }), {
			...BASE,
			profile: profile({ allergies: ['peanøtt'] })
		});
		expect(result.excluded).toBe(true);
		expect(result.reason).toBe('allergi');
	});

	it('ekskluderer dislikes', () => {
		const result = scoreComponent(component({ id: '1', name: 'Leverpostei' }), {
			...BASE,
			profile: profile({ dislikes: ['leverpostei'] })
		});
		expect(result.excluded).toBe(true);
	});

	it('booster likes', () => {
		const liked = scoreComponent(component({ id: '1', name: 'Hvitost' }), {
			...BASE,
			profile: profile({ likes: ['hvitost'] })
		});
		const neutral = scoreComponent(component({ id: '2', name: 'Salami' }), {
			...BASE,
			profile: profile()
		});
		expect(liked.score).toBeGreaterThan(neutral.score);
		expect(liked.reason).toBe('favoritt');
	});

	it('straffer komponenter brukt i går (rotasjon)', () => {
		const usedYesterday = scoreComponent(component({ id: '1', name: 'Hvitost' }), {
			...BASE,
			profile: profile(),
			recentEntries: [
				{ personId: 'barn-1', date: '2026-08-16', items: [{ componentId: '1', name: 'Hvitost', kind: 'palegg' }] }
			]
		});
		const fresh = scoreComponent(component({ id: '2', name: 'Makrell i tomat' }), {
			...BASE,
			profile: profile()
		});
		expect(usedYesterday.score).toBeLessThan(fresh.score);
	});

	it('straffer komponenter som kom i retur, vektet etter grad', () => {
		const returnedAll = scoreComponent(component({ id: '1', name: 'Salami' }), {
			...BASE,
			profile: profile(),
			recentReturns: [
				{ personId: 'barn-1', date: '2026-08-10', componentId: '1', itemName: 'salami', degree: 'alt' }
			]
		});
		const returnedSome = scoreComponent(component({ id: '2', name: 'Salami' }), {
			...BASE,
			profile: profile(),
			recentReturns: [
				{ personId: 'barn-1', date: '2026-08-10', componentId: '2', itemName: 'salami', degree: 'noe' }
			]
		});
		expect(returnedAll.score).toBeLessThan(returnedSome.score);
		expect(returnedAll.reason).toBe('kom i retur sist');
	});

	it('ignorerer returer fra andre barn', () => {
		const result = scoreComponent(component({ id: '1', name: 'Salami' }), {
			...BASE,
			profile: profile(),
			recentReturns: [
				{ personId: 'barn-2', date: '2026-08-10', componentId: '1', itemName: 'salami', degree: 'alt' }
			]
		});
		expect(result.reason).not.toBe('kom i retur sist');
	});
});

describe('suggestLunchbox', () => {
	const components = [
		component({ id: 'p1', name: 'Hvitost' }),
		component({ id: 'p2', name: 'Makrell i tomat' }),
		component({ id: 'p3', name: 'Leverpostei' }),
		component({ id: 'f1', name: 'Eple', kind: 'frukt' }),
		component({ id: 'f2', name: 'Banan', kind: 'frukt' }),
		component({ id: 'g1', name: 'Gulrot', kind: 'gront' }),
		component({ id: 'n1', name: 'Cashewnøtter', kind: 'notter' })
	];

	it('plukker to pålegg, frukt, grønt og nøtter for middels appetitt', () => {
		const result = suggestLunchbox({
			profile: profile(),
			components,
			...BASE
		});
		const kinds = result.items.map((i) => i.kind);
		expect(kinds.filter((k) => k === 'palegg')).toHaveLength(2);
		expect(kinds).toContain('frukt');
		expect(kinds).toContain('gront');
		expect(kinds).toContain('notter');
		expect(result.sliceCount).toBe(APPETITE_SLICES.middels);
	});

	it('plukker kun ett pålegg for liten appetitt', () => {
		const result = suggestLunchbox({
			profile: profile({ appetite: 'liten' }),
			components,
			...BASE
		});
		expect(result.items.filter((i) => i.kind === 'palegg')).toHaveLength(1);
		expect(result.sliceCount).toBe(1);
	});

	it('utelater allergener helt', () => {
		const result = suggestLunchbox({
			profile: profile({ allergies: ['cashew'] }),
			components,
			...BASE
		});
		expect(result.items.some((i) => i.name === 'Cashewnøtter')).toBe(false);
	});

	it('er deterministisk med samme seed', () => {
		const input = { profile: profile(), components, ...BASE, seed: 42 };
		expect(suggestLunchbox(input)).toEqual(suggestLunchbox(input));
	});

	it('gir variasjon med ny seed når kandidatene er likeverdige', () => {
		const first = suggestLunchbox({ profile: profile(), components, ...BASE, seed: 1 });
		const results = new Set<string>();
		for (let seed = 1; seed <= 10; seed++) {
			results.add(
				suggestLunchbox({ profile: profile(), components, ...BASE, seed })
					.items.map((i) => i.componentId)
					.join(',')
			);
		}
		expect(results.size).toBeGreaterThan(1);
		expect(first.items.length).toBeGreaterThan(0);
	});

	it('takler tom komponentliste', () => {
		const result = suggestLunchbox({ profile: profile(), components: [], ...BASE });
		expect(result.items).toEqual([]);
	});
});
