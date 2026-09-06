import { describe, it, expect } from 'vitest';
import {
	planHistoryRepair,
	REPAIR_WINDOW_WEEKS,
	MAX_REPAIR_WINDOWS
} from './history-repair-plan';

const NOW = '2026-09-06T14:30:00.000Z';

describe('planHistoryRepair', () => {
	it('dekker en kort historikk med ett vindu', () => {
		const plan = planHistoryRepair({
			historyStartIso: '2026-06-01T08:00:00.000Z',
			nowIso: NOW
		});
		expect(plan.windows).toHaveLength(1);
		expect(plan.truncated).toBe(false);
		expect(plan.historyStartDay).toBe('2026-06-01');
	});

	it('lar første vindu slutte «nå», ikke på en dato', () => {
		// En dato tolkes som midnatt UTC og ville latt dagens økter stå igjen.
		const plan = planHistoryRepair({ historyStartIso: '2026-06-01T00:00:00Z', nowIso: NOW });
		expect(plan.windows[0].until).toBeNull();
	});

	it('legger vinduene nyeste først', () => {
		const plan = planHistoryRepair({ historyStartIso: '2024-01-01T00:00:00Z', nowIso: NOW });
		const days = plan.windows.map((w) => w.toDay);
		const sortedDescending = [...days].sort().reverse();
		expect(days).toEqual(sortedDescending);
		expect(plan.windows[0].index).toBe(1);
	});

	it('overlapper med én dag, så ingen dag faller mellom to vinduer', () => {
		const plan = planHistoryRepair({ historyStartIso: '2024-01-01T00:00:00Z', nowIso: NOW });
		expect(plan.windows.length).toBeGreaterThan(1);
		for (let i = 1; i < plan.windows.length; i += 1) {
			const previous = plan.windows[i - 1];
			const current = plan.windows[i];
			// Forrige vindu starter dagen FØR dette vinduet slutter — altså overlapp,
			// aldri et gap.
			expect(current.toDay).toBe(addDays(previous.fromDay, 1));
		}
	});

	it('dekker hele historikken: siste vindu starter på eller før eldste økt', () => {
		const historyStartIso = '2012-04-17T06:00:00.000Z';
		const plan = planHistoryRepair({ historyStartIso, nowIso: NOW });
		const last = plan.windows[plan.windows.length - 1];
		expect(plan.truncated).toBe(false);
		expect(last.fromDay <= historyStartIso.slice(0, 10)).toBe(true);
	});

	it('bruker taket på spennet per vindu', () => {
		const plan = planHistoryRepair({ historyStartIso: '2015-01-01T00:00:00Z', nowIso: NOW });
		for (const window of plan.windows) {
			expect(window.weeks).toBe(REPAIR_WINDOW_WEEKS);
		}
	});

	it('kapper planen og sier det når historikken er absurd gammel', () => {
		const plan = planHistoryRepair({ historyStartIso: '1970-01-01T00:00:00Z', nowIso: NOW });
		expect(plan.truncated).toBe(true);
		expect(plan.windows).toHaveLength(MAX_REPAIR_WINDOWS);
		// Dagen planen ikke rakk forbi må navngis — «kappet» uten et sted er
		// ikke noe man kan gjøre noe med.
		expect(plan.uncoveredBeforeDay).toBe(plan.windows[MAX_REPAIR_WINDOWS - 1].fromDay);
	});

	it('gir en tom plan på ugyldige datoer framfor å gjette', () => {
		const plan = planHistoryRepair({ historyStartIso: 'tull', nowIso: NOW });
		expect(plan.windows).toEqual([]);
		expect(plan.truncated).toBe(false);
	});

	it('respekterer et lavere maxWindows', () => {
		const plan = planHistoryRepair({
			historyStartIso: '2012-01-01T00:00:00Z',
			nowIso: NOW,
			maxWindows: 3
		});
		expect(plan.windows).toHaveLength(3);
		expect(plan.truncated).toBe(true);
	});

	it('en historikk som starter i framtida gir ett vindu, ikke en tom plan', () => {
		// Et ødelagt tidsstempel skal ikke gjøre knappen død: første vindu
		// dekker nåtida uansett, og det er der noe kan repareres.
		const plan = planHistoryRepair({ historyStartIso: '2030-01-01T00:00:00Z', nowIso: NOW });
		expect(plan.windows).toHaveLength(1);
		expect(plan.truncated).toBe(false);
	});
});

function addDays(day: string, days: number): string {
	const date = new Date(`${day}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}
