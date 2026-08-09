import { describe, it, expect } from 'vitest';
import {
	DEFAULT_RUN_PATTERN,
	deriveWeekdayPattern,
	suggestSessionForDate,
	type WeekdayPattern
} from './schedule';
import type { EffortBudget, EnduranceWorkout, SessionSuggestion } from './types';

const LOP: SessionSuggestion = { kind: 'run', name: 'Rolig løp' };

function run(date: string): EnduranceWorkout {
	return { date, family: 'running', effortScore: 100, distanceMeters: 5000, durationSeconds: 2000 };
}

function sykkel(date: string): EnduranceWorkout {
	return { date, family: 'cycling', effortScore: 80, distanceMeters: 20000, durationSeconds: 3600 };
}

function budget(overrides: Partial<EffortBudget> = {}): EffortBudget {
	return {
		bandMin: 200,
		bandMax: 240,
		spentThisWeek: 0,
		remainingMin: 200,
		remainingMax: 240,
		acuteChronicRatio: 1.0,
		restRecommended: false,
		deload: false,
		anchor: 'snitt_uker',
		anchorWeeks: 4,
		maintenance: false,
		...overrides
	};
}

describe('deriveWeekdayPattern', () => {
	it('lærer løpedagene av faktisk atferd: tirsdager og lørdager', () => {
		// 6 uker med løp hver tirsdag (2026-06-02 er tirsdag) og lørdag
		const runs = [
			...['2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30'].map(run),
			...['2026-06-06', '2026-06-13', '2026-06-20', '2026-06-27'].map(run)
		];
		const pattern = deriveWeekdayPattern(runs, '2026-07-12');
		expect(pattern[2]).toBe('utholdenhet'); // tirsdag
		expect(pattern[6]).toBe('utholdenhet'); // lørdag
		expect(pattern[1]).toBe('hvile'); // mandag — aldri løpt
	});

	it('sykkeløkter former IKKE løpedagene', () => {
		// Nok løp til mønster (tirsdager), massiv sykling på mandager
		const runs = ['2026-06-02', '2026-06-09', '2026-06-16', '2026-06-23', '2026-06-30'].map(run);
		const rides = ['2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22', '2026-06-29'].map(sykkel);
		const pattern = deriveWeekdayPattern([...runs, ...rides], '2026-07-12');
		expect(pattern[1]).toBe('hvile'); // mandag forblir uten planlagt løp
		expect(pattern[2]).toBe('utholdenhet');
	});

	it('faller tilbake til default-mønsteret ved tynn historikk', () => {
		const pattern = deriveWeekdayPattern([run('2026-07-07')], '2026-07-12');
		expect(pattern).toEqual(DEFAULT_RUN_PATTERN);
	});
});

describe('suggestSessionForDate', () => {
	const PATTERN: WeekdayPattern = {
		1: 'hvile',
		2: 'utholdenhet',
		3: 'hvile',
		4: 'utholdenhet',
		5: 'hvile',
		6: 'utholdenhet',
		7: 'hvile'
	};

	it('løpedag → løpsforslaget (tirsdag)', () => {
		const result = suggestSessionForDate('2026-07-07', undefined, PATTERN, LOP, budget());
		expect(result.owner).toBe('utholdenhet');
		expect(result.suggestion).toBe(LOP);
	});

	it('hviledag → ingen planlagt økt (styrke/sykkel skjer når det passer)', () => {
		const result = suggestSessionForDate('2026-07-06', undefined, PATTERN, LOP, budget());
		expect(result.owner).toBe('hvile');
		expect(result.suggestion).toBeNull();
		expect(result.restReason).toBeNull();
	});

	it('manuelt satt schedule overstyrer lært mønster', () => {
		const schedule = { '1': 'utholdenhet' };
		const result = suggestSessionForDate('2026-07-06', schedule, PATTERN, LOP, budget());
		expect(result.owner).toBe('utholdenhet');
		expect(result.suggestion).toBe(LOP);
	});

	it('høy akutt belastning → hvile uansett mønster, med begrunnelse', () => {
		const result = suggestSessionForDate(
			'2026-07-07',
			undefined,
			PATTERN,
			LOP,
			budget({ restRecommended: true, acuteChronicRatio: 1.8 })
		);
		expect(result.owner).toBe('hvile');
		expect(result.suggestion).toBeNull();
		expect(result.restReason).toContain('siste 3 dager');
	});

	it('oppbrukt effort-budsjett → hvile på løpedag med begrunnelse', () => {
		const result = suggestSessionForDate(
			'2026-07-07',
			undefined,
			PATTERN,
			LOP,
			budget({ spentThisWeek: 320, remainingMin: 0, remainingMax: 0 })
		);
		expect(result.owner).toBe('hvile');
		expect(result.restReason).toContain('budsjett');
	});

	it('løpsmotoren kan si hvile (null) selv på løpedag — uken i mål', () => {
		const result = suggestSessionForDate('2026-07-07', undefined, PATTERN, null, budget());
		expect(result.owner).toBe('utholdenhet');
		expect(result.suggestion).toBeNull();
	});
});
