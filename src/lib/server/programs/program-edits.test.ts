import { describe, expect, it } from 'vitest';
import {
	mergePreferences,
	paceFieldForRunType,
	planDayMove,
	scaledRunTargets,
	type SessionDayLite
} from './program-edits';

const sessions: SessionDayLite[] = [
	{ id: 'a', dayNumber: 2 },
	{ id: 'b', dayNumber: 4 },
	{ id: 'c', dayNumber: 6, isTest: true }
];

describe('planDayMove', () => {
	it('flytter til ledig dag uten bytte', () => {
		expect(planDayMove(sessions, 'a', 3)).toEqual({ ok: true, swapWithSessionId: null });
	});

	it('bytter plass når måldagen er opptatt av en vanlig økt', () => {
		expect(planDayMove(sessions, 'a', 4)).toEqual({ ok: true, swapWithSessionId: 'b' });
	});

	it('avviser flytting til en dag med test-økt', () => {
		const res = planDayMove(sessions, 'a', 6);
		expect(res.ok).toBe(false);
	});

	it('avviser ugyldig ukedag', () => {
		expect(planDayMove(sessions, 'a', 8).ok).toBe(false);
		expect(planDayMove(sessions, 'a', 0).ok).toBe(false);
	});

	it('avviser flytting til samme dag', () => {
		expect(planDayMove(sessions, 'a', 2).ok).toBe(false);
	});

	it('avviser ukjent økt', () => {
		expect(planDayMove(sessions, 'ukjent', 3).ok).toBe(false);
	});
});

describe('scaledRunTargets', () => {
	it('skalerer distanse og runder til nærmeste 100 m', () => {
		expect(scaledRunTargets({ targetDistanceMeters: 5000 }, 0.9)).toEqual({ targetDistanceMeters: 4500 });
	});

	it('skalerer varighet og runder til nærmeste minutt', () => {
		expect(scaledRunTargets({ targetDurationSeconds: 1800 }, 1.1)).toEqual({ targetDurationSeconds: 1980 });
	});

	it('skalerer begge når begge finnes', () => {
		const out = scaledRunTargets({ targetDistanceMeters: 8000, targetDurationSeconds: 2400 }, 1.25);
		expect(out.targetDistanceMeters).toBe(10000);
		expect(out.targetDurationSeconds).toBe(3000);
	});

	it('returnerer tomt objekt uten targets', () => {
		expect(scaledRunTargets({}, 1.2)).toEqual({});
	});

	it('holder distanse på minst 100 m', () => {
		expect(scaledRunTargets({ targetDistanceMeters: 100 }, 0.1).targetDistanceMeters).toBe(100);
	});
});

describe('mergePreferences', () => {
	it('rydder pinnedDays til unike, sorterte 1-7', () => {
		const out = mergePreferences(null, { pinnedDays: [6, 6, 2, 9, 0, 4] });
		expect(out.pinnedDays).toEqual([2, 4, 6]);
	});

	it('klemmer volumeBias til [0.5, 1.5]', () => {
		expect(mergePreferences(null, { volumeBias: 3 }).volumeBias).toBe(1.5);
		expect(mergePreferences(null, { volumeBias: 0.1 }).volumeBias).toBe(0.5);
	});

	it('akkumulerer notater og kapper til 10', () => {
		const start = mergePreferences(null, { notes: Array.from({ length: 8 }, (_, i) => `n${i}`) });
		const out = mergePreferences(start, { notes: ['ny1', 'ny2', 'ny3'] });
		expect(out.notes).toHaveLength(10);
		expect(out.notes?.at(-1)).toBe('ny3');
	});

	it('beholder eksisterende felt som ikke patches', () => {
		const out = mergePreferences({ lockPace: true, pinnedDays: [6] }, { volumeBias: 1.1 });
		expect(out.lockPace).toBe(true);
		expect(out.pinnedDays).toEqual([6]);
		expect(out.volumeBias).toBe(1.1);
	});

	it('toggler lockPace eksplisitt av', () => {
		expect(mergePreferences({ lockPace: true }, { lockPace: false }).lockPace).toBe(false);
	});
});

describe('paceFieldForRunType', () => {
	it('mapper runType til pace-sone', () => {
		expect(paceFieldForRunType('easy')).toBe('easy');
		expect(paceFieldForRunType('long')).toBe('easy');
		expect(paceFieldForRunType('tempo')).toBe('tempo');
		expect(paceFieldForRunType('intervals')).toBe('intervals');
	});
});
