import { describe, it, expect } from 'vitest';
import {
	describeGoalProjection,
	describeSpanDays,
	formatProjectionDate,
	projectGoal,
	MAX_PROJECTION_DAYS
} from './goal-projection';

/** Et nedadgående vektmål: 104 kg 14. april, mål 85 kg innen 16. juni 2028. */
const weight = {
	startDate: '2026-04-14',
	endDate: '2028-06-16',
	startValue: 104,
	targetValue: 85,
	today: '2026-08-28'
};

describe('projectGoal — nedadgående mål', () => {
	it('regner datoen ut av tempoet så langt', () => {
		// 104 → 98,2 på 136 dager er 0,0426 kg/dag. De siste 13,2 kilo tar da
		// rundt 310 dager til, altså sommeren 2027 — ikke 2028.
		const p = projectGoal({ ...weight, currentValue: 98.2 });
		expect(p.projectedDate).not.toBeNull();
		expect(p.projectedDate!.slice(0, 4)).toBe('2027');
		expect(p.projectedDaysBeforeDeadline).toBeGreaterThan(0);
		expect(p.blocker).toBeNull();
	});

	it('sier fra når utviklingen går motsatt vei', () => {
		// Vekta har steget: da finnes det ingen dato, og å regne en ut ville gitt
		// et negativt antall dager.
		const p = projectGoal({ ...weight, currentValue: 106 });
		expect(p.projectedDate).toBeNull();
		expect(p.blocker).toBe('wrong-direction');
	});

	it('sier fra når det ikke er bevegelse', () => {
		const p = projectGoal({ ...weight, currentValue: 104 });
		expect(p.projectedDate).toBeNull();
		expect(p.blocker).toBe('no-progress');
	});

	it('avviser en dato som ligger absurd langt fram', () => {
		// 100 gram på fire måneder gir en dato i neste århundre. Det er en
		// divisjon, ikke et estimat.
		const p = projectGoal({ ...weight, currentValue: 103.9 });
		expect(p.projectedInDays === null || p.projectedInDays <= MAX_PROJECTION_DAYS).toBe(true);
		expect(p.projectedDate).toBeNull();
	});

	it('finner dagen målet ble passert, og beholder den etter et tilbakefall', () => {
		const p = projectGoal({
			...weight,
			currentValue: 88,
			series: [
				{ date: '2026-04-14', value: 104 },
				{ date: '2027-01-10', value: 84.6 },
				{ date: '2027-03-01', value: 88 }
			]
		});
		expect(p.reachedOn).toBe('2027-01-10');
		expect(p.reachedDaysBeforeDeadline).toBeGreaterThan(0);
	});

	it('gir ingen dato når målet alt er nådd', () => {
		const p = projectGoal({ ...weight, currentValue: 84 });
		expect(p.blocker).toBe('already-there');
		expect(p.projectedDate).toBeNull();
	});
});

describe('projectGoal — oppadgående volummål', () => {
	const running = {
		startDate: '2026-08-01',
		endDate: '2026-08-31',
		startValue: 0,
		targetValue: 80,
		today: '2026-08-28'
	};

	it('finner dagen målet ble passert', () => {
		const p = projectGoal({
			...running,
			currentValue: 103.7,
			series: [
				{ date: '2026-08-10', value: 40 },
				{ date: '2026-08-25', value: 81.2 },
				{ date: '2026-08-28', value: 103.7 }
			]
		});
		expect(p.reachedOn).toBe('2026-08-25');
		expect(p.reachedDaysBeforeDeadline).toBe(6);
	});

	it('estimerer datoen når målet ennå ikke er nådd', () => {
		// 40 km på 27 dager er 1,48 km/dag; de siste 40 tar 28 dager til, altså
		// et stykke ut i september — etter fristen.
		const p = projectGoal({ ...running, currentValue: 40 });
		expect(p.projectedDate!.slice(0, 7)).toBe('2026-09');
		expect(p.projectedDaysBeforeDeadline).toBeLessThan(0);
	});
});

describe('describeSpanDays', () => {
	it('bruker et spenn, ikke et presist tall', () => {
		expect(describeSpanDays(1)).toBe('1 dag');
		expect(describeSpanDays(6)).toBe('6 dager');
		expect(describeSpanDays(21)).toBe('3 uker');
		expect(describeSpanDays(90)).toBe('3 måneder');
		expect(describeSpanDays(550)).toBe('1,5 år');
	});

	it('tåler negative dager', () => {
		expect(describeSpanDays(-21)).toBe('3 uker');
	});
});

describe('formatProjectionDate', () => {
	it('utelater året når det er inneværende', () => {
		expect(formatProjectionDate('2026-03-12', '2026-08-28')).toBe('12. mars');
	});

	it('tar med året ellers', () => {
		expect(formatProjectionDate('2027-03-12', '2026-08-28')).toBe('12. mars 2027');
	});
});

describe('describeGoalProjection', () => {
	it('sier NÅR målet ble nådd, og hvor tidlig', () => {
		const p = projectGoal({
			startDate: '2026-08-01',
			endDate: '2026-08-31',
			startValue: 0,
			targetValue: 80,
			today: '2026-08-28',
			currentValue: 103.7,
			series: [{ date: '2026-08-25', value: 81.2 }]
		});
		const text = describeGoalProjection(p, { today: '2026-08-28', shape: 'volume' })!;
		expect(text.label).toBe('Nådd 25. august — 6 dager før fristen.');
		expect(text.tone).toBe('ahead');
	});

	it('svarer med en dato, ikke med en tilstand', () => {
		const p = projectGoal({ ...weight, currentValue: 98.2 });
		const text = describeGoalProjection(p, { today: weight.today, shape: 'state' })!;
		expect(text.label).toMatch(/^På dagens tempo er du der rundt \d+\. \w+ 2027 — .+ før fristen\.$/);
	});

	it('sier at målet er nådd også uten en serie å datere det i', () => {
		const p = projectGoal({ ...weight, currentValue: 84 });
		const text = describeGoalProjection(p, { today: weight.today, shape: 'state' })!;
		expect(text.label).toBe('Målet er nådd.');
		expect(text.tone).toBe('ahead');
	});

	it('sier hvorfor det ikke finnes en dato', () => {
		// En tom linje ser ut som en funksjon som ikke virker.
		const p = projectGoal({ ...weight, currentValue: 106 });
		const text = describeGoalProjection(p, { today: weight.today, shape: 'state' })!;
		expect(text.label).toBe('Utviklingen går motsatt vei, så det finnes ingen dato ennå.');
		expect(text.tone).toBe('behind');
	});
});
