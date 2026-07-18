import { describe, it, expect } from 'vitest';
import {
	buildObservedBehaviorLines,
	classifyFlokeLoad,
	classifyFlokeStagnation,
	classifyFollowThrough,
	classifyNapLoad,
	classifyRestingHrElevation
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
