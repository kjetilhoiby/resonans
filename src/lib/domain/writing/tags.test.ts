import { describe, it, expect } from 'vitest';
import { countTags, hasTag, normalizeTag, normalizeTags, sameTag, sharesTag } from './tags';

describe('normalizeTag', () => {
	it('trimmer og kollapser mellomrom', () => {
		expect(normalizeTag('  Idas   bue ')).toBe('Idas bue');
	});

	it('bevarer store bokstaver — tags vises i flaten', () => {
		expect(normalizeTag('Ida')).toBe('Ida');
	});

	it('fjerner ledende havelåser', () => {
		expect(normalizeTag('#spenning')).toBe('spenning');
	});

	it('avviser tomt', () => {
		expect(normalizeTag('')).toBeNull();
		expect(normalizeTag('   ')).toBeNull();
		expect(normalizeTag('#')).toBeNull();
	});

	it('kutter en tag som har blitt en setning', () => {
		expect(normalizeTag('a'.repeat(100))).toHaveLength(48);
	});
});

describe('sameTag / hasTag', () => {
	it('sammenligner uten hensyn til store bokstaver', () => {
		expect(sameTag('Ida', 'ida')).toBe(true);
		expect(sameTag('Ida', 'Ada')).toBe(false);
	});

	it('finner tag i liste', () => {
		expect(hasTag(['Ida', 'kaia'], 'IDA')).toBe(true);
		expect(hasTag(['Ida'], 'Ada')).toBe(false);
		expect(hasTag(null, 'Ida')).toBe(false);
	});
});

describe('normalizeTags', () => {
	it('fjerner duplikater case-insensitivt, første skrivemåte vinner', () => {
		expect(normalizeTags(['Ida', 'ida', 'IDA'])).toEqual(['Ida']);
	});

	it('fjerner tomme og ikke-strenger', () => {
		expect(normalizeTags(['Ida', '', '  ', 42, null, 'Kaia'])).toEqual(['Ida', 'Kaia']);
	});

	it('tåler at input ikke er en liste', () => {
		expect(normalizeTags(null)).toEqual([]);
		expect(normalizeTags('Ida')).toEqual([]);
	});

	it('bevarer rekkefølgen', () => {
		expect(normalizeTags(['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
	});
});

describe('sharesTag', () => {
	it('er sann ved minst én felles tag', () => {
		expect(sharesTag(['Ida', 'kaia'], ['KAIA'])).toBe(true);
	});

	it('er usann uten overlapp', () => {
		expect(sharesTag(['Ida'], ['Kaia'])).toBe(false);
	});

	it('tåler tomme og null', () => {
		expect(sharesTag([], ['Ida'])).toBe(false);
		expect(sharesTag(null, null)).toBe(false);
	});
});

describe('countTags', () => {
	it('teller på tvers av dokumenter', () => {
		const counts = countTags([
			{ tags: ['Ida', 'spenning'] },
			{ tags: ['Ida'] },
			{ tags: ['Ida', 'kaia'] }
		]);
		expect(counts[0]).toEqual({ tag: 'Ida', count: 3 });
	});

	it('slår sammen ulike skrivemåter', () => {
		expect(countTags([{ tags: ['Ida'] }, { tags: ['ida'] }])).toEqual([{ tag: 'Ida', count: 2 }]);
	});

	it('sorterer mest brukt først, så alfabetisk', () => {
		const counts = countTags([{ tags: ['b', 'a'] }, { tags: ['a'] }]);
		expect(counts.map((c) => c.tag)).toEqual(['a', 'b']);
	});

	it('tåler dokumenter uten tags', () => {
		expect(countTags([{}, { tags: null }, { tags: [] }])).toEqual([]);
	});
});
