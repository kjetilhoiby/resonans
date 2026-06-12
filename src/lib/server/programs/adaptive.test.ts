import { describe, expect, it } from 'vitest';
import {
	ADAPTIVE_PARAMS,
	buildWeekdayProfile,
	classifyRunCharacter,
	estimateActualEffort,
	estimatePlannedEffort,
	evaluateEffortBalance,
	planDayMoves,
	preferredDaysFor,
	recalcWeeklyVdot,
	runCharacterForType,
	type ObservedRun
} from './adaptive';

function run(dayNumber: number, overrides: Partial<ObservedRun> = {}): ObservedRun {
	return { dayNumber, distanceMeters: 5000, durationSeconds: 1800, paceSecPerKm: 360, ...overrides };
}

describe('classifyRunCharacter', () => {
	const ref = { medianDistanceMeters: 5000, medianDurationSeconds: 1800, medianPaceSecPerKm: 360 };

	it('klassifiserer løp godt over median-distanse som langtur', () => {
		expect(classifyRunCharacter({ distanceMeters: 12000, paceSecPerKm: 370 }, ref)).toBe('lang');
	});

	it('klassifiserer tydelig raskere løp enn median som fartsøkt', () => {
		expect(classifyRunCharacter({ distanceMeters: 5000, paceSecPerKm: 320 }, ref)).toBe('fort');
	});

	it('klassifiserer vanlige løp som kort/rolig', () => {
		expect(classifyRunCharacter({ distanceMeters: 5200, paceSecPerKm: 365 }, ref)).toBe('kort');
	});

	it('bruker varighet for langtur-vurdering når distanse mangler', () => {
		expect(classifyRunCharacter({ durationSeconds: 4000 }, ref)).toBe('lang');
	});

	it('krever minst 5 km for langtur selv ved lav median', () => {
		const lowRef = { medianDistanceMeters: 2000, medianPaceSecPerKm: 360 };
		expect(classifyRunCharacter({ distanceMeters: 3000, paceSecPerKm: 360 }, lowRef)).toBe('kort');
	});
});

describe('runCharacterForType', () => {
	it('mapper planlagte run-typer til karakterer', () => {
		expect(runCharacterForType('long')).toBe('lang');
		expect(runCharacterForType('easy')).toBe('kort');
		expect(runCharacterForType('tempo')).toBe('fort');
		expect(runCharacterForType('intervals')).toBe('fort');
	});
});

describe('buildWeekdayProfile + preferredDaysFor', () => {
	it('finner søndag som langtur-dag når langturer ligger der', () => {
		const profile = buildWeekdayProfile([
			run(7, { distanceMeters: 14000 }),
			run(7, { distanceMeters: 15000 }),
			run(7, { distanceMeters: 13000 }),
			run(2),
			run(2),
			run(4)
		]);
		expect(preferredDaysFor(profile, 'lang')).toEqual([7]);
	});

	it('ignorerer dager med færre enn minimum observasjoner', () => {
		const profile = buildWeekdayProfile([run(7, { distanceMeters: 14000 }), run(2), run(2)]);
		expect(preferredDaysFor(profile, 'lang')).toEqual([]);
	});

	it('sorterer foretrukne dager etter frekvens', () => {
		const profile = buildWeekdayProfile([
			run(2, { paceSecPerKm: 300 }),
			run(2, { paceSecPerKm: 300 }),
			run(4, { paceSecPerKm: 300 }),
			run(4, { paceSecPerKm: 300 }),
			run(4, { paceSecPerKm: 300 }),
			run(1),
			run(3),
			run(6),
			run(6),
			run(7),
			run(7)
		]);
		expect(preferredDaysFor(profile, 'fort')).toEqual([4, 2]);
	});
});

describe('planDayMoves', () => {
	const profileWithSundayLong = buildWeekdayProfile([
		run(7, { distanceMeters: 14000 }),
		run(7, { distanceMeters: 15000 }),
		run(2),
		run(2),
		run(4)
	]);

	it('flytter langtur til vanedagen når den er ledig', () => {
		const moves = planDayMoves(
			[
				{ id: 'a', dayNumber: 6, kind: 'run', runType: 'long' },
				{ id: 'b', dayNumber: 1, kind: 'strength' }
			],
			profileWithSundayLong
		);
		expect(moves).toHaveLength(1);
		expect(moves[0]).toMatchObject({ sessionId: 'a', fromDay: 6, toDay: 7, character: 'lang' });
		expect(moves[0].reason).toContain('søndag');
	});

	it('flytter ikke til en dag som allerede er opptatt', () => {
		const moves = planDayMoves(
			[
				{ id: 'a', dayNumber: 6, kind: 'run', runType: 'long' },
				{ id: 'b', dayNumber: 7, kind: 'strength' }
			],
			profileWithSundayLong
		);
		expect(moves).toEqual([]);
	});

	it('lar økten stå når den allerede ligger på en vanedag', () => {
		const moves = planDayMoves(
			[{ id: 'a', dayNumber: 7, kind: 'run', runType: 'long' }],
			profileWithSundayLong
		);
		expect(moves).toEqual([]);
	});

	it('rører aldri test-økter', () => {
		const moves = planDayMoves(
			[{ id: 'a', dayNumber: 6, kind: 'run', runType: 'long', isTest: true }],
			profileWithSundayLong
		);
		expect(moves).toEqual([]);
	});

	it('flytter kort/rolig løp til ledig vanedag uten å kollidere med tidligere flytting', () => {
		const profile = buildWeekdayProfile([
			run(7, { distanceMeters: 14000 }),
			run(7, { distanceMeters: 15000 }),
			run(2),
			run(2)
		]);
		const moves = planDayMoves(
			[
				{ id: 'lang', dayNumber: 3, kind: 'run', runType: 'long' },
				{ id: 'kort', dayNumber: 5, kind: 'run', runType: 'easy' }
			],
			profile
		);
		expect(moves.map((m) => [m.sessionId, m.toDay])).toEqual([
			['lang', 7],
			['kort', 2]
		]);
	});
});

describe('estimatePlannedEffort', () => {
	it('beregner løpseffort fra distanse og pace-hint', () => {
		const { family, effort } = estimatePlannedEffort({
			kind: 'run',
			runType: 'easy',
			targetDistanceMeters: 6000,
			paceHintSecPerKm: 360
		});
		expect(family).toBe('running');
		expect(effort).toBe(36); // 6 km × 6 min/km × 1.0
	});

	it('vekter intervaller høyere enn rolig løp', () => {
		const easy = estimatePlannedEffort({ kind: 'run', runType: 'easy', targetDurationSeconds: 1800 });
		const intervals = estimatePlannedEffort({
			kind: 'run',
			runType: 'intervals',
			targetDurationSeconds: 1800
		});
		expect(intervals.effort).toBeGreaterThan(easy.effort);
	});

	it('gir styrkeøkter et fast effort-estimat', () => {
		const { family, effort } = estimatePlannedEffort({ kind: 'strength' });
		expect(family).toBe('strength');
		expect(effort).toBeGreaterThan(0);
	});
});

describe('estimateActualEffort', () => {
	it('vekter med puls-reserve når puls finnes', () => {
		const hard = estimateActualEffort(
			{ sportFamily: 'cycling', durationSeconds: 3600, avgHeartRate: 160 },
			{ restHr: 50, maxHr: 190 }
		);
		const lett = estimateActualEffort(
			{ sportFamily: 'cycling', durationSeconds: 3600, avgHeartRate: 110 },
			{ restHr: 50, maxHr: 190 }
		);
		expect(hard).toBeGreaterThan(lett);
	});

	it('faller tilbake til ren varighet uten puls', () => {
		expect(estimateActualEffort({ sportFamily: 'running', durationSeconds: 1800 })).toBe(30);
	});
});

describe('evaluateEffortBalance', () => {
	it('regner en hard sykkeltur som dekning for en misset løpeøkt', () => {
		const balance = evaluateEffortBalance({ running: 80, strength: 27 }, { running: 40, cycling: 60 });
		expect(balance.verdict).toBe('ok');
		expect(balance.nextWeekVolumeFactor).toBe(1.0);
		expect(balance.reasons.join(' ')).toContain('sykkel');
	});

	it('demper neste ukes volum ved reell underbelastning', () => {
		const balance = evaluateEffortBalance({ running: 100 }, { running: 30 });
		expect(balance.verdict).toBe('under');
		expect(balance.nextWeekVolumeFactor).toBe(ADAPTIVE_PARAMS.volumeFactorOnUnder);
	});

	it('holder volum ved mer effort enn planlagt', () => {
		const balance = evaluateEffortBalance({ running: 50 }, { running: 60, cycling: 40 });
		expect(balance.verdict).toBe('over');
		expect(balance.nextWeekVolumeFactor).toBe(1.0);
	});

	it('gir dekning 1 når ingenting var planlagt', () => {
		const balance = evaluateEffortBalance({}, { running: 30 });
		expect(balance.coverage).toBe(1);
		expect(balance.verdict).toBe('ok');
	});
});

describe('recalcWeeklyVdot', () => {
	it('beholder gjeldende VDOT uten observasjoner', () => {
		const result = recalcWeeklyVdot({ currentVdot: 45, runs: [run(2, { paceSecPerKm: undefined })] });
		expect(result.changed).toBe(false);
		expect(result.newVdot).toBe(45);
		expect(result.observationCount).toBe(0);
	});

	it('demper store hopp til maks-steget per uke', () => {
		// 5k best effort på 20:00 gir VDOT ~49-50 — langt over gjeldende 42
		const result = recalcWeeklyVdot({
			currentVdot: 42,
			runs: [run(2, { bestEfforts: { '5k': 1200 } })]
		});
		expect(result.changed).toBe(true);
		expect(result.newVdot).toBe(42 + ADAPTIVE_PARAMS.maxVdotStepPerWeek);
	});

	it('justerer VDOT opp når samme pace løpes på lavere puls', () => {
		// 5:30/km på 125 i snittpuls (lav HRR-andel) indikerer bedre form enn VDOT 40
		const result = recalcWeeklyVdot({
			currentVdot: 40,
			runs: [run(2, { paceSecPerKm: 330, avgHeartRate: 125 })],
			restHr: 50,
			maxHr: 190
		});
		expect(result.observationCount).toBe(1);
		expect(result.newVdot).toBeGreaterThan(40);
	});

	it('lar små avvik være urørt (under minste endring)', () => {
		const result = recalcWeeklyVdot({
			currentVdot: 45,
			// VDOT-observasjon svært nær 45: easy pace ~5:45/km på ~70% HRR
			runs: [run(2, { paceSecPerKm: 345, avgHeartRate: 148 })],
			restHr: 50,
			maxHr: 190
		});
		if (!result.changed) {
			expect(result.newVdot).toBe(45);
		} else {
			expect(Math.abs(result.newVdot - 45)).toBeLessThanOrEqual(ADAPTIVE_PARAMS.maxVdotStepPerWeek);
		}
	});

	it('bruker median av observasjonene mot uteliggere', () => {
		const result = recalcWeeklyVdot({
			currentVdot: 45,
			runs: [
				run(1, { bestEfforts: { '5k': 1500 } }), // ~42-43
				run(3, { bestEfforts: { '5k': 1480 } }), // ~43
				run(5, { bestEfforts: { '3k': 600 } }) // urealistisk rask uteligger
			]
		});
		expect(result.observedVdot).toBeLessThan(50);
	});
});
