import { describe, it, expect } from 'vitest';
import { computeWeekGoalCredits, type WeekCreditGoal, type WeekCreditWorkout } from './checklist-autocheck';

function slots(n: number, checked = 0): WeekCreditGoal['slots'] {
	return Array.from({ length: n }, (_, i) => ({ id: `s${i}`, checked: i < checked, sortOrder: i }));
}
function goal(p: Partial<WeekCreditGoal> & Pick<WeekCreditGoal, 'baseLabel' | 'activityType'>): WeekCreditGoal {
	return { durationMin: null, distanceKm: null, slots: slots(4), ...p };
}
const run = (distanceKm: number | null, day: string): WeekCreditWorkout => ({
	sportType: 'running',
	distanceKm,
	durationMin: 40,
	day
});

const byLabel = (credits: ReturnType<typeof computeWeekGoalCredits>, label: string) =>
	credits.find((c) => c.baseLabel === label)!;

describe('computeWeekGoalCredits', () => {
	it('lang jogg krediterer både «jogge» og «jogge langt» (uavhengig per mål)', () => {
		const credits = computeWeekGoalCredits({
			goals: [
				goal({ baseLabel: 'jogge', activityType: 'running' }),
				goal({ baseLabel: 'jogge langt', activityType: 'running', distanceKm: 6 })
			],
			workouts: [run(7, '2026-06-01')],
			manualDaysByActivity: new Map()
		});
		expect(byLabel(credits, 'jogge').slotIdsToCheck.length).toBe(1);
		expect(byLabel(credits, 'jogge langt').slotIdsToCheck.length).toBe(1);
	});

	it('kort løp krediterer ikke «jogge langt» (under distanse-terskel)', () => {
		const credits = computeWeekGoalCredits({
			goals: [
				goal({ baseLabel: 'jogge', activityType: 'running' }),
				goal({ baseLabel: 'jogge langt', activityType: 'running', distanceKm: 6 })
			],
			workouts: [run(3, '2026-06-01')],
			manualDaysByActivity: new Map()
		});
		expect(byLabel(credits, 'jogge').slotIdsToCheck.length).toBe(1);
		expect(byLabel(credits, 'jogge langt').slotIdsToCheck.length).toBe(0);
	});

	it('80%-terskel: 4,9 km krediterer et 6 km-mål, 4,0 km gjør ikke', () => {
		const above = computeWeekGoalCredits({
			goals: [goal({ baseLabel: 'jogge langt', activityType: 'running', distanceKm: 6, slots: slots(2) })],
			workouts: [run(4.9, '2026-06-01')],
			manualDaysByActivity: new Map()
		});
		expect(byLabel(above, 'jogge langt').slotIdsToCheck.length).toBe(1);

		const below = computeWeekGoalCredits({
			goals: [goal({ baseLabel: 'jogge langt', activityType: 'running', distanceKm: 6, slots: slots(2) })],
			workouts: [run(4.0, '2026-06-01')],
			manualDaysByActivity: new Map()
		});
		expect(byLabel(below, 'jogge langt').slotIdsToCheck.length).toBe(0);
	});

	it('elsykkel og sykkel teller ikke mot hverandre', () => {
		const goals = [
			goal({ baseLabel: 'tråkke', activityType: 'cycling', slots: slots(2) }),
			goal({ baseLabel: 'rulle', activityType: 'ebike', slots: slots(2) })
		];
		const onEbike = computeWeekGoalCredits({
			goals,
			workouts: [{ sportType: 'e_bike', distanceKm: 9, durationMin: 25, day: '2026-06-01' }],
			manualDaysByActivity: new Map()
		});
		expect(byLabel(onEbike, 'rulle').slotIdsToCheck.length).toBe(1);
		expect(byLabel(onEbike, 'tråkke').slotIdsToCheck.length).toBe(0);

		const onBike = computeWeekGoalCredits({
			goals,
			workouts: [{ sportType: 'cycling', distanceKm: 9, durationMin: 25, day: '2026-06-01' }],
			manualDaysByActivity: new Map()
		});
		expect(byLabel(onBike, 'tråkke').slotIdsToCheck.length).toBe(1);
		expect(byLabel(onBike, 'rulle').slotIdsToCheck.length).toBe(0);
	});

	it('dag-bevis teller bare på dager uten matchende økt', () => {
		const credits = computeWeekGoalCredits({
			goals: [goal({ baseLabel: 'jogge', activityType: 'running' })],
			workouts: [run(5, '2026-06-01')],
			// 06-01 har økt (skal ikke dobles), 06-02 er manuelt avhukt uten økt
			manualDaysByActivity: new Map([['running', new Set(['2026-06-01', '2026-06-02'])]])
		});
		expect(byLabel(credits, 'jogge').slotIdsToCheck.length).toBe(2);
	});

	it('respekterer allerede avkryssede slots', () => {
		const credits = computeWeekGoalCredits({
			goals: [goal({ baseLabel: 'jogge', activityType: 'running', slots: slots(4, 2) })],
			workouts: [run(5, '2026-06-01'), run(5, '2026-06-02'), run(5, '2026-06-03')],
			manualDaysByActivity: new Map()
		});
		// 3 økter, 2 alt hakt → kun 1 ny
		expect(byLabel(credits, 'jogge').slotIdsToCheck.length).toBe(1);
	});

	it('onlyBaseLabel begrenser hvilket mål som returneres', () => {
		const credits = computeWeekGoalCredits({
			goals: [
				goal({ baseLabel: 'jogge', activityType: 'running' }),
				goal({ baseLabel: 'jogge langt', activityType: 'running', distanceKm: 6 })
			],
			workouts: [run(7, '2026-06-01')],
			manualDaysByActivity: new Map(),
			onlyBaseLabel: 'jogge langt'
		});
		expect(credits.length).toBe(1);
		expect(credits[0].baseLabel).toBe('jogge langt');
	});
});
