import { describe, it, expect } from 'vitest';
import { computeRoutineStats } from './routine-stats';

// Mandag 19. – søndag 25. oktober 2026. Rutinen går mandag–fredag.
const WEEK = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
const morning = {
	daysOfWeek: [1, 2, 3, 4, 5],
	createdAt: new Date('2026-01-01T00:00:00Z'),
	items: [
		{ text: 'Vann', estimateMinutes: 1 },
		{ text: 'Strekk', estimateMinutes: 10 },
		{ text: 'Les', estimateMinutes: 15 }
	]
};

describe('computeRoutineStats', () => {
	it('skiller planlagte dager fra målte', () => {
		const stats = computeRoutineStats(morning, WEEK, [
			{ date: '2026-10-19', items: [{ text: 'Vann', checked: true, skipped: false }, { text: 'Strekk', checked: false, skipped: false }, { text: 'Les', checked: true, skipped: false }] },
			{ date: '2026-10-20', items: [{ text: 'Vann', checked: true, skipped: false }, { text: 'Strekk', checked: false, skipped: true }, { text: 'Les', checked: true, skipped: false }] }
		]);
		expect(stats.scheduledDays).toBe(5);
		expect(stats.daysOpened).toBe(2);
		expect(stats.daysCompleted).toBe(1);
		expect(stats.items.map((i) => [i.text, i.done, i.skipped, i.notDone, i.doneRate])).toEqual([
			['Vann', 2, 0, 0, 1],
			['Strekk', 0, 1, 1, 0],
			['Les', 2, 0, 0, 1]
		]);
		expect(stats.note).toContain('2 av 5');
	});

	// En uke uten appen skal ikke se ut som en uke der rutinen ble droppet.
	it('uten åpnede dager er andelene ukjente, ikke null', () => {
		const stats = computeRoutineStats(morning, WEEK, []);
		expect(stats.items.every((i) => i.doneRate === null)).toBe(true);
		expect(stats.note).toContain('ikke målt');
	});

	it('teller ikke dager før rutinen fantes eller utenfor ukedagene', () => {
		const fresh = { ...morning, createdAt: new Date('2026-10-22T08:00:00Z') };
		const stats = computeRoutineStats(fresh, WEEK, [
			{ date: '2026-10-24', items: [{ text: 'Vann', checked: true, skipped: false }] }
		]);
		expect(stats.scheduledDays).toBe(2);
		expect(stats.daysOpened).toBe(0);
	});

	it('matcher på tekst, og teller punkter som er tatt ut av rutinen for seg', () => {
		const stats = computeRoutineStats(morning, WEEK, [
			{ date: '2026-10-21', items: [{ text: '  vann ', checked: true, skipped: false }, { text: 'Gammelt punkt', checked: true, skipped: false }] }
		]);
		expect(stats.items[0].done).toBe(1);
		expect(stats.retiredItemsSeen).toBe(1);
	});
});
