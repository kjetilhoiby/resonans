import { describe, it, expect } from 'vitest';
import {
	buildObservedBehaviorLines,
	classifyBudgetPressure,
	classifyChoreBalance,
	classifyFlokeLoad,
	classifyFlokeStagnation,
	classifyFollowThrough,
	classifyNapLoad,
	classifyMoodTrend,
	classifyRestingHrElevation,
	computeChoreBalance,
	computeMoodTrend,
	projectBudget
} from './observed-behavior';

describe('classifyFollowThrough', () => {
	it('ingen plan → ingen dom', () => {
		const r = classifyFollowThrough({ plannedItems: 0, checkedItems: 0, skippedItems: 0, snoozedItems: 0 });
		expect(r.pct).toBeNull();
		expect(r.band).toBe('ingen_plan');
		expect(r.severity).toBe('info');
	});

	it('høy gjennomføring → info, lav → high', () => {
		expect(classifyFollowThrough({ plannedItems: 10, checkedItems: 9, skippedItems: 0, snoozedItems: 1 })).toMatchObject({ pct: 90, band: 'high', severity: 'info' });
		expect(classifyFollowThrough({ plannedItems: 10, checkedItems: 6, skippedItems: 2, snoozedItems: 2 })).toMatchObject({ pct: 60, band: 'medium', severity: 'low' });
		expect(classifyFollowThrough({ plannedItems: 10, checkedItems: 2, skippedItems: 4, snoozedItems: 4 })).toMatchObject({ pct: 20, band: 'very_low', severity: 'high' });
	});
});

describe('classifyNapLoad', () => {
	it('uten mål: gradert etter antall', () => {
		expect(classifyNapLoad(0, null)).toBe('info');
		expect(classifyNapLoad(2, null)).toBe('low');
		expect(classifyNapLoad(4, null)).toBe('medium');
		expect(classifyNapLoad(6, null)).toBe('high');
	});

	it('med mål: innenfor grensen er alltid info, overskridelse graderes', () => {
		expect(classifyNapLoad(3, 3)).toBe('info');
		expect(classifyNapLoad(4, 3)).toBe('low');
		expect(classifyNapLoad(5, 3)).toBe('medium');
		expect(classifyNapLoad(6, 3)).toBe('high');
	});
});

describe('buildObservedBehaviorLines', () => {
	it('tom input → ingen linjer (blokken utelates)', () => {
		expect(buildObservedBehaviorLines({})).toEqual([]);
		expect(
			buildObservedBehaviorLines({
				followThrough: { plannedItems: 0, checkedItems: 0, skippedItems: 0, snoozedItems: 0, pct: null },
				naps: null,
				proactivity: { quickWins: 0, focusSessions: 0, focusMinutes: 0 }
			})
		).toEqual([]);
	});

	it('gjennomføring med snoozet/skippet nevnes eksplisitt', () => {
		const lines = buildObservedBehaviorLines({
			followThrough: { plannedItems: 8, checkedItems: 5, skippedItems: 1, snoozedItems: 2, pct: 63 }
		});
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('5 av 8');
		expect(lines[0]).toContain('2 snoozet');
		expect(lines[0]).toContain('1 hoppet over');
	});

	it('naps etter korte netter kobles til søvnunderskudd', () => {
		const lines = buildObservedBehaviorLines({
			naps: {
				count: 2,
				totalMinutes: 50,
				maxPerWeek: 2,
				withPriorNights: [
					{ start: new Date('2026-07-16T12:00:00Z'), durationMinutes: 30, priorNightHours: 5.8 },
					{ start: new Date('2026-07-17T13:00:00Z'), durationMinutes: 20, priorNightHours: 7.4 }
				]
			}
		});
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('2 siste uke');
		expect(lines[0]).toContain('innenfor målet på maks 2');
		expect(lines[0]).toContain('1 av dem kom etter netter under 6,5t');
		expect(lines[0]).toContain('5,8t');
	});

	it('over nap-målet markeres tydelig', () => {
		const lines = buildObservedBehaviorLines({
			naps: { count: 4, totalMinutes: 95, maxPerWeek: 2, withPriorNights: [] }
		});
		expect(lines[0]).toContain('OVER målet på maks 2');
	});

	it('proaktivitet og rutine-etterlevelse får egne linjer', () => {
		const lines = buildObservedBehaviorLines({
			proactivity: { quickWins: 3, focusSessions: 2, focusMinutes: 50 },
			routineAdherencePct: 72.4
		});
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain('3 quick wins og 2 fokusøkter (50 min)');
		expect(lines[1]).toContain('72%');
	});

	it('hodedump og floker speiles («skaffer oversikt» / «løser floker»)', () => {
		const lines = buildObservedBehaviorLines({
			oversikt: { daysAgo: 2 },
			floker: { active: 1, open: 2 }
		});
		expect(lines).toHaveLength(2);
		expect(lines[0]).toBe('- Skaffet oversikt: hodedump for 2 dager siden.');
		expect(lines[1]).toBe('- Floker: 1 under nedbryting, 2 åpne som prosjekter.');

		expect(buildObservedBehaviorLines({ oversikt: { daysAgo: 0 } })[0]).toContain('i dag');
		expect(buildObservedBehaviorLines({ floker: { active: 0, open: 0 } })).toEqual([]);
	});

	it('åpne løkker i innboksen telles — de tapper energi så lenge de er åpne', () => {
		expect(buildObservedBehaviorLines({ aapneLokker: { inbox: 14 } })).toEqual([
			'- Åpne løkker: 14 i innboksen.'
		]);
		expect(buildObservedBehaviorLines({ aapneLokker: { inbox: 0 } })).toEqual([]);
	});

	it('stillestående floke nevnes med dager — knute-risiko markeres', () => {
		const lines = buildObservedBehaviorLines({
			floker: {
				active: 1,
				open: 1,
				stillestaaende: [
					{ title: 'Rydde garasjen', status: 'active', daysSinceMovement: 16, stage: 'stillestaaende' },
					{ title: 'Forsikringssaken', status: 'planning', daysSinceMovement: 31, stage: 'knute_risiko' }
				]
			}
		});
		expect(lines).toHaveLength(1);
		// Verste floken (flest dager) trekkes frem
		expect(lines[0]).toContain('«Forsikringssaken» har ligget 31 dager uten bevegelse — på vei til å bli knute');
	});
});

describe('computeMoodTrend + classifyMoodTrend', () => {
	it('retning: nedgang/bedring/stabil rundt ±0,4', () => {
		expect(computeMoodTrend(3.0, 3.2).direction).toBe('stabil');
		expect(computeMoodTrend(2.5, 3.5).direction).toBe('nedgang');
		expect(computeMoodTrend(4.0, 3.2).direction).toBe('bedring');
	});

	it('asymmetrisk severity — bare nedgang hever, bedring er info', () => {
		expect(classifyMoodTrend(computeMoodTrend(4.2, 3.0))).toBe('info'); // bedring
		expect(classifyMoodTrend(computeMoodTrend(3.2, 3.0))).toBe('info'); // stabil
		expect(classifyMoodTrend(computeMoodTrend(3.4, 3.9))).toBe('low'); // −0,5
		expect(classifyMoodTrend(computeMoodTrend(3.0, 3.9))).toBe('medium'); // −0,9
		expect(classifyMoodTrend(computeMoodTrend(2.5, 3.9))).toBe('high'); // −1,4
	});

	it('lavt absolutt nivå (≤2) løfter minst til medium', () => {
		// liten nedgang, men nivået er lavt → medium i stedet for low
		expect(classifyMoodTrend(computeMoodTrend(1.8, 2.3))).toBe('medium');
		// stabil, men lavt nivå → medium i stedet for info
		expect(classifyMoodTrend(computeMoodTrend(1.9, 2.0))).toBe('medium');
	});

	it('OBSERVERT ATFERD-linje kun ved endring, med varm hale ved nedgang', () => {
		const ned = buildObservedBehaviorLines({ moodTrend: computeMoodTrend(2.5, 3.5) });
		expect(ned[0]).toContain('nedgang');
		expect(ned[0]).toContain('verdt å høre hvordan det står til');

		const opp = buildObservedBehaviorLines({ moodTrend: computeMoodTrend(4.0, 3.2) });
		expect(opp[0]).toContain('bedring');

		// stabil → ingen linje
		expect(buildObservedBehaviorLines({ moodTrend: computeMoodTrend(3.0, 3.1) })).toEqual([]);
	});
});

describe('computeChoreBalance + classifyChoreBalance', () => {
	it('regner andel mot 50/50 og signert avvik', () => {
		const b = computeChoreBalance(13, 7)!;
		expect(b.total).toBe(20);
		expect(b.myShare).toBe(0.65);
		expect(b.deviation).toBeCloseTo(0.15, 5);
		expect(classifyChoreBalance(b)).toBe('low');
	});

	it('symmetrisk severity — å bære for lite vurderes likt som for mye', () => {
		expect(classifyChoreBalance(computeChoreBalance(6, 4)!)).toBe('info'); // 60/40 innenfor ±10pp
		expect(classifyChoreBalance(computeChoreBalance(7, 3)!)).toBe('low'); // 70/30
		expect(classifyChoreBalance(computeChoreBalance(8, 2)!)).toBe('medium'); // 80/20
		expect(classifyChoreBalance(computeChoreBalance(9, 1)!)).toBe('high'); // 90/10
		// speilvendt: partner bærer 90 % → jeg 10 %, samme alvor
		expect(classifyChoreBalance(computeChoreBalance(1, 9)!)).toBe('high');
	});

	it('under minimum → null (for få oppgaver til å si noe)', () => {
		expect(computeChoreBalance(2, 1)).toBeNull();
		expect(computeChoreBalance(3, 1)).not.toBeNull(); // 4 = minimum
	});

	it('linje i OBSERVERT ATFERD navngir hvem som bærer mer', () => {
		const over = buildObservedBehaviorLines({ choreBalance: computeChoreBalance(15, 5) });
		expect(over[0]).toContain('du 75 %, partner 25 %');
		expect(over[0]).toContain('du bærer mer enn halvparten');

		const under = buildObservedBehaviorLines({ choreBalance: computeChoreBalance(4, 12) });
		expect(under[0]).toContain('partner bærer mer enn halvparten');

		const jevnt = buildObservedBehaviorLines({ choreBalance: computeChoreBalance(5, 5) });
		expect(jevnt[0]).toContain('jevnt fordelt');
	});
});

describe('projectBudget + classifyBudgetPressure', () => {
	it('framskriver månedsforbruk lineært etter dag-i-måneden', () => {
		// 800 kr brukt på dag 10 av 30 → ligger an til 2400
		const p = projectBudget(800, 2000, 10, 30);
		expect(p.projected).toBe(2400);
		expect(p.exceeded).toBe(false);
		expect(p.onTrackToExceed).toBe(true);
		expect(classifyBudgetPressure(p)).toBe('medium');
	});

	it('over taket allerede → high', () => {
		const p = projectBudget(2200, 2000, 20, 30);
		expect(p.exceeded).toBe(true);
		expect(classifyBudgetPressure(p)).toBe('high');
	});

	it('godt innenfor → info; nær grensen (≥85 %) → low', () => {
		expect(classifyBudgetPressure(projectBudget(300, 2000, 15, 30))).toBe('info');
		// 900 på dag 15 av 30 → framskrevet 1800 = 90 % av 2000
		expect(classifyBudgetPressure(projectBudget(900, 2000, 15, 30))).toBe('low');
	});

	it('tåler dag utenfor [1, daysInMonth]', () => {
		expect(projectBudget(500, 2000, 0, 30).projected).toBe(15000); // dag klemt til 1
		expect(projectBudget(2000, 2000, 40, 30).projected).toBe(2000); // dag klemt til 30
	});
});

describe('classifyRestingHrElevation', () => {
	it('graderer forhøyet hvilepuls: +1,5 low, +3 medium, +5 high', () => {
		expect(classifyRestingHrElevation(0)).toBe('info');
		expect(classifyRestingHrElevation(-2)).toBe('info');
		expect(classifyRestingHrElevation(1.5)).toBe('low');
		expect(classifyRestingHrElevation(3.2)).toBe('medium');
		expect(classifyRestingHrElevation(5.5)).toBe('high');
	});
});

describe('floke-stagnasjon (knute-risiko)', () => {
	it('klassifiserer etter dager uten bevegelse: <14 i bevegelse, ≥14 stillestående, ≥28 knute-risiko', () => {
		expect(classifyFlokeStagnation(3)).toBe('i_bevegelse');
		expect(classifyFlokeStagnation(13)).toBe('i_bevegelse');
		expect(classifyFlokeStagnation(14)).toBe('stillestaaende');
		expect(classifyFlokeStagnation(27)).toBe('stillestaaende');
		expect(classifyFlokeStagnation(28)).toBe('knute_risiko');
	});

	it('signal-severity styres av verste floke', () => {
		const fersk = { title: 'A', status: 'active' as const, daysSinceMovement: 2, stage: 'i_bevegelse' as const };
		const stille = { title: 'B', status: 'planning' as const, daysSinceMovement: 15, stage: 'stillestaaende' as const };
		const knute = { title: 'C', status: 'planning' as const, daysSinceMovement: 30, stage: 'knute_risiko' as const };
		expect(classifyFlokeLoad([fersk])).toBe('info');
		expect(classifyFlokeLoad([fersk, stille])).toBe('medium');
		expect(classifyFlokeLoad([fersk, stille, knute])).toBe('high');
	});
});
