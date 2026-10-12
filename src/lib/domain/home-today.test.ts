import { describe, expect, it } from 'vitest';
import { buildHomeLetter, type HomeLetterInput, type LetterGoal } from './home-letter';
import { buildHomeToday, groupedGoalLine, MAX_TODAY_LINES } from './home-today';
import type { DigestNugget } from './digest-nugget-rules';

const base: HomeLetterInput = {
	today: '2026-10-08',
	hour: 8,
	sick: false,
	goals: [],
	rollingEffort: null,
	digest: [],
	weight: [],
	lostItems: [],
	unplacedWeek: [],
	daysLeftInWeek: 4,
	todayOpen: [],
	events: [],
	registration: null,
	registrationFocus: [],
	hoursSinceLastVisit: 2,
	sinceLastVisit: null
};

const weightGoal: LetterGoal = {
	id: 'w',
	title: 'Ned til 90 kg',
	shape: 'state',
	unit: 'kg',
	startDate: '2026-08-01',
	endDate: '2027-06-01',
	startValue: 98,
	currentValue: 94.1,
	targetValue: 90,
	rawSeries: [
		{ date: '2026-08-01', value: 98 },
		{ date: '2026-10-08', value: 94.1 }
	]
};

/** Et delmål inni vektmålet som ligger bak: 92 kg innen 15. oktober er urealistisk. */
const behindPhase: LetterGoal = {
	...weightGoal,
	id: 'w-fase',
	title: '92 kg innen 15. oktober',
	startDate: '2026-09-01',
	endDate: '2026-10-15',
	startValue: 95,
	targetValue: 92,
	rawSeries: [
		{ date: '2026-09-01', value: 95 },
		{ date: '2026-10-08', value: 94.1 }
	]
};

const nugget = (kind: DigestNugget['kind'], sentence: string): DigestNugget => ({ kind, headline: sentence, sentence });

function today(input: Partial<HomeLetterInput>) {
	const full = { ...base, ...input };
	return buildHomeToday(buildHomeLetter(full), full.goals, full.today);
}

describe('groupedGoalLine', () => {
	it('sier anslaget én gang og baker delmålet inn med hvordan det ligger an', () => {
		const line = groupedGoalLine(weightGoal, [behindPhase], base.today);
		expect(line.text.startsWith('Ned til 90 kg: 94,1 kg nå, målet er 90,0 kg.')).toBe(true);
		expect(line.text).toContain('Delmålet 92 kg innen 15. oktober ligger bak planen');
		expect(line.text.match(/På dagens tempo/g)?.length ?? 0).toBeLessThanOrEqual(1);
		expect(line.href).toBe('/plan/mal');
		expect(line.kind).toBe('status');
	});

	it('beroliger bare når hovedmålet faktisk holder', () => {
		const line = groupedGoalLine(weightGoal, [behindPhase], base.today);
		expect(line.text).toContain('men hovedmålet holder');
	});

	it('uten delmål er det bare hovedmålets linje', () => {
		const line = groupedGoalLine(weightGoal, [], base.today);
		expect(line.text).not.toContain('elmål');
		expect(line.id).toBe('goal-group:w');
	});
});

describe('buildHomeToday', () => {
	it('gir én linje per hovedmål, ikke én per delmål', () => {
		const result = today({ goals: [weightGoal, behindPhase] });
		const goalLines = result.lines.filter((l) => l.id.startsWith('goal-group:'));
		expect(goalLines).toHaveLength(1);
	});

	it('setter det som venter på deg foran det som bare forteller', () => {
		const result = today({
			goals: [weightGoal],
			todayOpen: ['Ringe rørleggeren'],
			digest: [nugget('load-high', 'Belastningen er høy — ta en rolig dag.')]
		});
		const kinds = result.lines.map((l) => l.kind);
		expect(kinds.indexOf('venter')).toBeLessThan(kinds.indexOf('status'));
		expect(result.lines[0].text).toContain('Ringe rørleggeren');
	});

	it('kapper ved taket og teller resten, i stedet for å la dem forsvinne', () => {
		const result = today({
			goals: [weightGoal],
			todayOpen: ['A'],
			lostItems: ['B'],
			unplacedWeek: [{ label: 'Løp', count: 2 }],
			digest: [
				nugget('load-high', 'Belastningen er høy.'),
				nugget('streak-due', 'Løping forfaller i dag.')
			],
			hoursSinceLastVisit: 48,
			sinceLastVisit: { workouts: 2, distanceKm: 12 }
		});
		expect(result.lines).toHaveLength(MAX_TODAY_LINES);
		expect(result.more).toBeGreaterThan(0);
	});

	it('har ingen ekstra når alt får plass', () => {
		const result = today({ goals: [weightGoal] });
		expect(result.more).toBe(0);
		expect(result.lines).toHaveLength(1);
	});

	it('er tom når brevet er tomt', () => {
		expect(today({})).toEqual({ lines: [], more: 0 });
	});

	it('i en sykeperiode står sykelinja og målene, ingenting som ber om noe', () => {
		const result = today({ sick: true, goals: [weightGoal], todayOpen: ['Ringe rørleggeren'] });
		expect(result.lines.some((l) => l.id === 'sick')).toBe(true);
		expect(result.lines.every((l) => l.kind === 'status')).toBe(true);
	});
});
