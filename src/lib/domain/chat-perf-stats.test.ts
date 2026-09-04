import { describe, it, expect } from 'vitest';
import {
	MIN_SAMPLES_FOR_VERDICT,
	SLOW_PHASE_MS,
	parsePhases,
	percentile,
	summarizeChatPerf,
	type ChatPerfSample
} from './chat-perf-stats';

/** n målinger der «helsebriefing» dominerer, og én utligger til slutt. */
function manySamples(n: number, briefingMs = 400): ChatPerfSample[] {
	return Array.from({ length: n }, (_, i) => ({
		wallMs: 500,
		phases: [
			{ name: 'helsebriefing', ms: briefingMs },
			{ name: 'minne', ms: 40 },
			{ name: 'mål', ms: i === n - 1 ? 900 : 30 }
		]
	}));
}

describe('parsePhases', () => {
	it('slipper gjennom gyldige faser', () => {
		expect(parsePhases([{ name: 'minne', ms: 12 }])).toEqual([{ name: 'minne', ms: 12 }]);
	});

	// jsonb er en generell beholder; et felt noen legger til senere skal ikke
	// følge med ut av seg selv. Samme regel som toPublicCronRun.
	it('tar bare name og ms, aldri andre felt', () => {
		const p = parsePhases([{ name: 'minne', ms: 12, hemmelig: 'brukerdata' }]);
		expect(p).toEqual([{ name: 'minne', ms: 12 }]);
		expect(JSON.stringify(p)).not.toContain('hemmelig');
	});

	it('hopper over søppel framfor å kaste', () => {
		expect(parsePhases([null, 'tekst', 42, { name: 'a' }, { ms: 1 }, { name: 1, ms: 1 }])).toEqual(
			[]
		);
		expect(parsePhases(null)).toEqual([]);
		expect(parsePhases({ name: 'a', ms: 1 })).toEqual([]);
	});

	it('avviser NaN og Infinity — de ødelegger enhver aggregering', () => {
		expect(parsePhases([{ name: 'a', ms: NaN }, { name: 'b', ms: Infinity }])).toEqual([]);
	});
});

describe('percentile', () => {
	it('er nærmeste rang, altså alltid en målt verdi', () => {
		const s = [10, 20, 30, 40];
		expect(percentile(s, 0.5)).toBe(20);
		expect(percentile(s, 0.95)).toBe(40);
		expect(percentile(s, 0)).toBe(10);
		expect(percentile(s, 1)).toBe(40);
	});

	it('takler én måling og ingen', () => {
		expect(percentile([7], 0.5)).toBe(7);
		expect(percentile([], 0.5)).toBeNull();
	});
});

describe('summarizeChatPerf', () => {
	it('sier fra om tomt vindu framfor å late som', () => {
		const s = summarizeChatPerf([]);
		expect(s.samples).toBe(0);
		expect(s.wall).toBeNull();
		expect(s.summary).toContain('Ingen målinger');
	});

	// Under terskelen skal tallene sies, men ikke dommen — et cache-grep tatt
	// på tre målinger kan fjerne arbeid som ikke var problemet.
	it('holder dommen tilbake under terskelen', () => {
		const s = summarizeChatPerf(manySamples(3));
		expect(s.summary).toContain('For få til å si noe');
		expect(s.summary).toContain(`trengs ${MIN_SAMPLES_FOR_VERDICT}`);
		// men tallene er der
		expect(s.wall?.medianMs).toBe(500);
	});

	it('rangerer tyngste fase først og navngir den i dommen', () => {
		const s = summarizeChatPerf(manySamples(30));
		expect(s.phases[0].name).toBe('helsebriefing');
		expect(s.summary).toContain('helsebriefing');
		expect(s.summary).toContain('der ligger gevinsten');
	});

	// Poenget med persentiler: én utligger skal synes i maks, ikke drukne.
	it('skiller median fra maks per fase', () => {
		const s = summarizeChatPerf(manySamples(30));
		const mal = s.phases.find((p) => p.name === 'mål')!;
		expect(mal.medianMs).toBe(30);
		expect(mal.maxMs).toBe(900);
	});

	it('leser wall mot sum som parallelliseringens helse', () => {
		// sum = 400+40+30 = 470, wall = 500 → fasene kjører etter hverandre
		const seriell = summarizeChatPerf(manySamples(30));
		expect(seriell.parallelismRatio).toBeGreaterThan(0.9);
		expect(seriell.summary).toContain('nærmest etter hverandre');

		// samme faser, men wall 150 → parallelliseringen virker
		const parallell = summarizeChatPerf(
			manySamples(30).map((s) => ({ ...s, wallMs: 150 }))
		);
		expect(parallell.parallelismRatio).toBeLessThan(0.6);
		expect(parallell.summary).toContain('parallelliseringen virker');
	});

	it('sier at ingen fase peker seg ut når alle er raske', () => {
		const s = summarizeChatPerf(manySamples(30, SLOW_PHASE_MS - 100));
		expect(s.summary).toContain('ingen fase peker seg ut');
	});

	it('teller faser hver for seg — en fase kan mangle i noen meldinger', () => {
		const blandet: ChatPerfSample[] = [
			{ wallMs: 100, phases: [{ name: 'a', ms: 10 }, { name: 'b', ms: 20 }] },
			{ wallMs: 100, phases: [{ name: 'a', ms: 10 }] }
		];
		const s = summarizeChatPerf(blandet);
		expect(s.phases.find((p) => p.name === 'a')?.samples).toBe(2);
		expect(s.phases.find((p) => p.name === 'b')?.samples).toBe(1);
	});

	it('deler ikke på null når alle faser er 0 ms', () => {
		const s = summarizeChatPerf([{ wallMs: 5, phases: [{ name: 'a', ms: 0 }] }]);
		expect(s.parallelismRatio).toBeNull();
		expect(s.summary).not.toContain('NaN');
	});
});
