import { describe, it, expect } from 'vitest';
import { isWeekItemComplete, weekItemTarget } from './week-item-target';

describe('weekItemTarget', () => {
	it('leser målet i parentes', () => {
		expect(weekItemTarget('Dele legging i to med Anita (3 ganger)')).toEqual({ label: 'Dele legging i to med Anita', times: 3 });
		expect(weekItemTarget('Måltidslogg (7 dager)')).toEqual({ label: 'Måltidslogg', times: 7 });
		expect(weekItemTarget('Løp (1/3)')).toEqual({ label: 'Løp (1/3)', times: 1 });
		expect(weekItemTarget('Handle')).toEqual({ label: 'Handle', times: 1 });
	});
});

describe('isWeekItemComplete', () => {
	it('krever alle gangene før et «(3 ganger)»-punkt er ferdig', () => {
		expect(isWeekItemComplete('Dele legging (3 ganger)', 1)).toBe(false);
		expect(isWeekItemComplete('Dele legging (3 ganger)', 3)).toBe(true);
	});

	it('lar et vanlig punkt følge dagpunktet, som før', () => {
		expect(isWeekItemComplete('Handle', 1)).toBe(true);
		expect(isWeekItemComplete('Handle', 0)).toBe(false);
	});
});
