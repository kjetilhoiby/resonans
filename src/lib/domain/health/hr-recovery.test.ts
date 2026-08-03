import { describe, it, expect } from 'vitest';
import {
	classifyRecovery,
	computeHrRecovery,
	MAX_USABLE_GAP_SECONDS,
	parseIntradayHeartRate,
	summarizeSampling,
	type HrSample
} from './hr-recovery';

/** Lager en serie med jevn avstand fra et starttidspunkt. */
function series(startIso: string, gapSeconds: number, bpms: number[]): HrSample[] {
	const start = new Date(startIso).getTime();
	return bpms.map((bpm, i) => ({
		at: new Date(start + i * gapSeconds * 1000).toISOString(),
		bpm
	}));
}

describe('summarizeSampling', () => {
	it('regner median-, min- og maksavstand', () => {
		const samples = [
			{ at: '2026-08-01T20:00:00.000Z', bpm: 150 },
			{ at: '2026-08-01T20:00:10.000Z', bpm: 148 },
			{ at: '2026-08-01T20:00:20.000Z', bpm: 140 },
			{ at: '2026-08-01T20:01:20.000Z', bpm: 110 }
		];
		const summary = summarizeSampling(samples);
		expect(summary.count).toBe(4);
		expect(summary.medianGapSeconds).toBe(10);
		expect(summary.minGapSeconds).toBe(10);
		expect(summary.maxGapSeconds).toBe(60);
	});

	it('sier at 10 sekunders oppløsning holder til HRR60', () => {
		expect(summarizeSampling(series('2026-08-01T20:00:00.000Z', 10, [150, 145, 140, 130, 120, 110])).sufficientForRecovery).toBe(true);
	});

	it('sier at 10 minutters oppløsning IKKE holder', () => {
		// Dette er scenariet som avgjør om Withings intraday er brukbart:
		// ScanWatch måler ofte hvert 10. minutt i ro.
		const summary = summarizeSampling(series('2026-08-01T20:00:00.000Z', 600, [150, 90, 75, 70]));
		expect(summary.medianGapSeconds).toBe(600);
		expect(summary.sufficientForRecovery).toBe(false);
	});

	it('treffer grensen presist', () => {
		expect(summarizeSampling(series('2026-08-01T20:00:00.000Z', MAX_USABLE_GAP_SECONDS, [150, 140, 130])).sufficientForRecovery).toBe(true);
		expect(summarizeSampling(series('2026-08-01T20:00:00.000Z', MAX_USABLE_GAP_SECONDS + 1, [150, 140, 130])).sufficientForRecovery).toBe(false);
	});

	it('sorterer før den regner, så rekkefølgen inn ikke betyr noe', () => {
		const forward = summarizeSampling(series('2026-08-01T20:00:00.000Z', 10, [150, 140, 130]));
		const reversed = summarizeSampling([...series('2026-08-01T20:00:00.000Z', 10, [150, 140, 130])].reverse());
		expect(reversed).toEqual(forward);
	});

	it('filtrerer bort ugyldige punkter', () => {
		const summary = summarizeSampling([
			{ at: 'tull', bpm: 150 },
			{ at: '2026-08-01T20:00:00.000Z', bpm: 0 },
			{ at: '2026-08-01T20:00:10.000Z', bpm: 148 },
			{ at: '2026-08-01T20:00:20.000Z', bpm: 140 }
		]);
		expect(summary.count).toBe(2);
	});

	it('gir tomt svar for ingen punkter', () => {
		const summary = summarizeSampling([]);
		expect(summary.count).toBe(0);
		expect(summary.medianGapSeconds).toBeNull();
		expect(summary.sufficientForRecovery).toBe(false);
	});
});

describe('computeHrRecovery', () => {
	it('regner fallet 60 sekunder etter slutt', () => {
		// 20:30:00 → 168, og 20:31:00 → 138. Fall på 30.
		const samples = series('2026-08-01T20:30:00.000Z', 10, [168, 162, 155, 148, 143, 140, 138]);
		const recovery = computeHrRecovery({ samples, effortEndAt: '2026-08-01T20:30:00.000Z' });
		expect(recovery!.endBpm).toBe(168);
		expect(recovery!.recoveredBpm).toBe(138);
		expect(recovery!.dropBpm).toBe(30);
		expect(recovery!.atSeconds).toBe(60);
		expect(recovery!.band).toBe('god');
	});

	it('bruker nærmeste punkt når ingen ligger på nøyaktig 60 s', () => {
		// Serien slutter på +50 s. Innenfor toleransen, så det brukes — men
		// atSeconds sier 50, ikke 60, slik at leseren vet hva som ble målt.
		const samples = series('2026-08-01T20:30:00.000Z', 10, [168, 162, 155, 148, 143, 140]);
		const recovery = computeHrRecovery({ samples, effortEndAt: '2026-08-01T20:30:00.000Z' });
		expect(recovery!.atSeconds).toBe(50);
		expect(recovery!.recoveredBpm).toBe(140);
	});

	it('godtar et punkt litt ved siden av måltidspunktet', () => {
		// Uten toleranse ville et punkt på 57 sekunder blitt forkastet, og da
		// finner man nesten aldri et treff.
		const samples = [
			{ at: '2026-08-01T20:30:00.000Z', bpm: 165 },
			{ at: '2026-08-01T20:30:57.000Z', bpm: 142 }
		];
		const recovery = computeHrRecovery({ samples, effortEndAt: '2026-08-01T20:30:00.000Z' });
		expect(recovery!.dropBpm).toBe(23);
		expect(recovery!.atSeconds).toBe(57);
	});

	it('gir null når serien er for grov', () => {
		// 10 minutter mellom punktene: ingenting nær 60-sekundersmerket.
		const samples = series('2026-08-01T20:30:00.000Z', 600, [165, 95, 80]);
		expect(computeHrRecovery({ samples, effortEndAt: '2026-08-01T20:30:00.000Z' })).toBeNull();
	});

	it('gir null når nærmeste punkt til slutt er for langt unna', () => {
		const samples = series('2026-08-01T21:00:00.000Z', 10, [120, 110, 100]);
		expect(computeHrRecovery({ samples, effortEndAt: '2026-08-01T20:30:00.000Z' })).toBeNull();
	});

	it('gir null når samme punkt treffer både slutt og mål', () => {
		// Ett enkelt punkt kan ikke vise et fall.
		const samples = [
			{ at: '2026-08-01T20:30:30.000Z', bpm: 150 },
			{ at: '2026-08-01T22:00:00.000Z', bpm: 70 }
		];
		expect(
			computeHrRecovery({ samples, effortEndAt: '2026-08-01T20:30:00.000Z', toleranceSeconds: 60 })
		).toBeNull();
	});

	it('godtar et annet vindu enn 60 sekunder', () => {
		const samples = series('2026-08-01T20:30:00.000Z', 10, [170, 165, 158, 150, 145, 140, 138, 136, 134, 132, 130, 128, 126]);
		const recovery = computeHrRecovery({ samples, effortEndAt: '2026-08-01T20:30:00.000Z', windowSeconds: 120 });
		expect(recovery!.atSeconds).toBe(120);
		expect(recovery!.recoveredBpm).toBe(126);
	});

	it('gir negativt fall når pulsen steg — og skjuler det ikke', () => {
		const samples = [
			{ at: '2026-08-01T20:30:00.000Z', bpm: 140 },
			{ at: '2026-08-01T20:31:00.000Z', bpm: 150 }
		];
		const recovery = computeHrRecovery({ samples, effortEndAt: '2026-08-01T20:30:00.000Z' });
		expect(recovery!.dropBpm).toBe(-10);
		expect(recovery!.band).toBe('svak');
	});

	it('gir null for ugyldig sluttid eller for få punkter', () => {
		expect(computeHrRecovery({ samples: [], effortEndAt: '2026-08-01T20:30:00.000Z' })).toBeNull();
		expect(
			computeHrRecovery({
				samples: series('2026-08-01T20:30:00.000Z', 10, [150, 140]),
				effortEndAt: 'tull'
			})
		).toBeNull();
	});
});

describe('classifyRecovery', () => {
	it('deler i svak, moderat og god', () => {
		expect(classifyRecovery(8)).toBe('svak');
		expect(classifyRecovery(16)).toBe('moderat');
		expect(classifyRecovery(25)).toBe('god');
	});

	it('treffer grensene', () => {
		expect(classifyRecovery(11)).toBe('svak');
		expect(classifyRecovery(12)).toBe('moderat');
		expect(classifyRecovery(20)).toBe('moderat');
		expect(classifyRecovery(21)).toBe('god');
	});
});

describe('parseIntradayHeartRate', () => {
	it('tolker Withings-serien, som er et OBJEKT nøklet på unix-tid', () => {
		// fetchAllWithingsData antar at body.series er en liste og ville stille
		// droppet alt. Derfor egen parsing.
		const samples = parseIntradayHeartRate({
			'1785700800': { steps: 0, duration: 60, heart_rate: 152 },
			'1785700860': { steps: 0, duration: 60, heart_rate: 148 }
		});
		expect(samples).toHaveLength(2);
		expect(samples[0].bpm).toBe(152);
		expect(samples[0].at).toBe(new Date(1785700800 * 1000).toISOString());
	});

	it('sorterer kronologisk uansett nøkkelrekkefølge', () => {
		const samples = parseIntradayHeartRate({
			'1785700860': { heart_rate: 148 },
			'1785700800': { heart_rate: 152 }
		});
		expect(samples.map((s) => s.bpm)).toEqual([152, 148]);
	});

	it('hopper over punkter uten puls', () => {
		const samples = parseIntradayHeartRate({
			'1785700800': { steps: 40, duration: 60 },
			'1785700860': { heart_rate: 148 }
		});
		expect(samples).toHaveLength(1);
	});

	it('tåler tull inn', () => {
		expect(parseIntradayHeartRate(null)).toEqual([]);
		expect(parseIntradayHeartRate([])).toEqual([]);
		expect(parseIntradayHeartRate('nei')).toEqual([]);
		expect(parseIntradayHeartRate({ ikketall: { heart_rate: 150 } })).toEqual([]);
		expect(parseIntradayHeartRate({ '1785700800': null })).toEqual([]);
	});
});
