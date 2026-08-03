import { describe, it, expect } from 'vitest';
import {
	bestRecoveryNearEffortEnd,
	classifyRecovery,
	computeHrRecovery,
	parseIntradayHeartRate,
	sliceWindow,
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

	it('blander de to Withings-modusene når vinduet er et helt døgn', () => {
		// Ekte form: tett under aktivitet, 10-minutters intervaller i ro. Medianen
		// over døgnet beskriver ingen av dem, og er derfor ubrukelig som test på om
		// HRR60 kan regnes — den lokale tettheten rundt økta er det som teller.
		const active = series('2026-08-01T20:00:00.000Z', 30, [150, 148, 146, 144, 142, 140]);
		const resting = series('2026-08-01T20:30:00.000Z', 600, [80, 78, 76, 74, 72, 70, 68]);
		const summary = summarizeSampling([...active, ...resting]);
		expect(summary.medianGapSeconds).toBe(600);
		// Største hull er overgangen mellom modusene, ikke hvilemodusen selv.
		expect(summary.maxGapSeconds).toBe(1650);
		// Lokalt er det 30 sekunder — rikelig til et 60-sekunders par.
		const local = sliceWindow(
			[...active, ...resting],
			new Date('2026-08-01T20:00:00.000Z').getTime(),
			new Date('2026-08-01T20:03:00.000Z').getTime()
		);
		expect(summarizeSampling(local).medianGapSeconds).toBe(30);
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
		expect(summary.minGapSeconds).toBeNull();
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

/**
 * Ekte serie fra Withings, løpetur 1. august 2026. Oppgitt slutt 19:47:26.
 * Toppen ligger 84 sekunder før slutt: han sluttet å presse, gikk ut, og trykket
 * stopp etterpå.
 */
const RUN_2026_08_01: HrSample[] = [
	{ at: '2026-08-01T19:46:03.000Z', bpm: 154 },
	{ at: '2026-08-01T19:46:05.000Z', bpm: 154 },
	{ at: '2026-08-01T19:46:07.000Z', bpm: 154 },
	{ at: '2026-08-01T19:46:09.000Z', bpm: 154 },
	{ at: '2026-08-01T19:46:11.000Z', bpm: 154 },
	{ at: '2026-08-01T19:46:41.000Z', bpm: 150 },
	{ at: '2026-08-01T19:47:11.000Z', bpm: 132 },
	{ at: '2026-08-01T19:47:41.000Z', bpm: 121 },
	{ at: '2026-08-01T19:48:24.000Z', bpm: 115 },
	{ at: '2026-08-01T19:48:27.000Z', bpm: 120 },
	{ at: '2026-08-01T19:48:29.000Z', bpm: 118 },
	{ at: '2026-08-01T19:48:39.000Z', bpm: 117 },
	{ at: '2026-08-01T19:48:41.000Z', bpm: 118 },
	{ at: '2026-08-01T19:49:01.000Z', bpm: 121 },
	{ at: '2026-08-01T19:49:31.000Z', bpm: 107 },
	{ at: '2026-08-01T19:50:01.000Z', bpm: 96 }
];
const RUN_2026_08_01_END = '2026-08-01T19:47:26.990Z';

/**
 * Ekte serie fra el-sykkeltur 28. juli 2026, oppgitt slutt 13:00:29. Legg merke
 * til 119 → 78 på åtte sekunder: sensorbrudd, ikke fysiologi.
 */
const EBIKE_2026_07_28: HrSample[] = [
	{ at: '2026-07-28T12:58:44.000Z', bpm: 125 },
	{ at: '2026-07-28T12:59:14.000Z', bpm: 119 },
	{ at: '2026-07-28T12:59:44.000Z', bpm: 122 },
	{ at: '2026-07-28T13:00:07.000Z', bpm: 119 },
	{ at: '2026-07-28T13:00:15.000Z', bpm: 78 },
	{ at: '2026-07-28T13:00:17.000Z', bpm: 77 },
	{ at: '2026-07-28T13:01:18.000Z', bpm: 83 }
];
const EBIKE_2026_07_28_END = '2026-07-28T13:00:29.000Z';

describe('bestRecoveryNearEffortEnd', () => {
	it('finner fallet oppgitt sluttid gjemmer bort', () => {
		// Dette er hele grunnen til at funksjonen finnes. Samme serie, samme økt:
		// målt fra oppgitt slutt er fallet 1 slag, i virkeligheten er det 29.
		const fromDeclaredEnd = computeHrRecovery({
			samples: RUN_2026_08_01,
			effortEndAt: RUN_2026_08_01_END
		});
		expect(fromDeclaredEnd!.dropBpm).toBe(1);
		expect(fromDeclaredEnd!.band).toBe('svak');

		const best = bestRecoveryNearEffortEnd({
			samples: RUN_2026_08_01,
			effortEndAt: RUN_2026_08_01_END
		});
		expect(best!.endBpm).toBe(150);
		expect(best!.recoveredBpm).toBe(121);
		expect(best!.dropBpm).toBe(29);
		expect(best!.spanSeconds).toBe(60);
		expect(best!.band).toBe('god');
	});

	it('rapporterer hvor ankeret og toppen ligger, så en dårlig måling er synlig', () => {
		const best = bestRecoveryNearEffortEnd({
			samples: RUN_2026_08_01,
			effortEndAt: RUN_2026_08_01_END
		});
		// Ankeret ligger 46 sekunder før stoppknappen, toppen 84.
		expect(best!.anchorAt).toBe('2026-08-01T19:46:41.000Z');
		expect(best!.anchorOffsetSeconds).toBe(-46);
		expect(best!.peakBpm).toBe(154);
		expect(best!.peakOffsetSeconds).toBe(-84);
	});

	it('avviser sensorbrudd forkledd som pulsfall', () => {
		// Uten vakta ville søket plukket 119 → 77 og meldt et fall på 42 slag, der
		// pulsen «falt» 41 slag på åtte sekunder. Det plausible svaret er at det
		// ikke er noe fall å måle på en el-sykkeltur man tråkket til siste slutt.
		const best = bestRecoveryNearEffortEnd({
			samples: EBIKE_2026_07_28,
			effortEndAt: EBIKE_2026_07_28_END
		});
		expect(best!.dropBpm).toBe(3);
		expect(best!.band).toBe('svak');

		// Og oppgitt sluttid ga negativt fall — motsatt svar.
		expect(
			computeHrRecovery({ samples: EBIKE_2026_07_28, effortEndAt: EBIKE_2026_07_28_END })!.dropBpm
		).toBe(-6);
	});

	it('skiller et bratt men mulig fall fra et umulig', () => {
		const anchor = '2026-08-01T20:30:00.000Z';
		// 20 slag på 11 sekunder er 1,8 slag/s — hardt, men innenfor.
		const steep: HrSample[] = [
			{ at: '2026-08-01T20:30:00.000Z', bpm: 170 },
			{ at: '2026-08-01T20:30:11.000Z', bpm: 150 },
			{ at: '2026-08-01T20:31:00.000Z', bpm: 140 }
		];
		expect(bestRecoveryNearEffortEnd({ samples: steep, effortEndAt: anchor })!.dropBpm).toBe(30);

		// 20 slag på 9 sekunder er 2,2 slag/s — avvist.
		const impossible: HrSample[] = [
			{ at: '2026-08-01T20:30:00.000Z', bpm: 170 },
			{ at: '2026-08-01T20:30:09.000Z', bpm: 150 },
			{ at: '2026-08-01T20:31:00.000Z', bpm: 140 }
		];
		const guarded = bestRecoveryNearEffortEnd({ samples: impossible, effortEndAt: anchor });
		expect(guarded === null || guarded.dropBpm < 30).toBe(true);
	});

	it('lar støy på tettmålte punkter passere', () => {
		// 19 slag er under terskelen selv på to sekunder, fordi ±3 slags jitter på
		// to-sekunders punkter er normalt og ikke skal kunne blokkere en måling.
		const jittery: HrSample[] = [
			{ at: '2026-08-01T20:30:00.000Z', bpm: 160 },
			{ at: '2026-08-01T20:30:02.000Z', bpm: 141 },
			{ at: '2026-08-01T20:31:00.000Z', bpm: 130 }
		];
		expect(bestRecoveryNearEffortEnd({ samples: jittery, effortEndAt: '2026-08-01T20:30:00.000Z' })!.dropBpm).toBe(30);
	});

	it('gir null når vinduet er for tomt', () => {
		expect(
			bestRecoveryNearEffortEnd({
				samples: [{ at: '2026-07-26T09:58:00.000Z', bpm: 106 }],
				effortEndAt: '2026-07-26T09:59:00.000Z'
			})
		).toBeNull();
		// Fotballøkta 26. juli hadde nøyaktig ett pulspunkt i vinduet.
		expect(bestRecoveryNearEffortEnd({ samples: [], effortEndAt: '2026-07-26T09:59:00.000Z' })).toBeNull();
		expect(bestRecoveryNearEffortEnd({ samples: RUN_2026_08_01, effortEndAt: 'tull' })).toBeNull();
	});

	it('ser ikke utenfor søkevinduet', () => {
		// Et fall to timer senere er ikke restitusjon etter denne økta.
		const later = [
			...RUN_2026_08_01.slice(0, 2),
			{ at: '2026-08-01T22:00:00.000Z', bpm: 150 },
			{ at: '2026-08-01T22:01:00.000Z', bpm: 60 }
		];
		const best = bestRecoveryNearEffortEnd({ samples: later, effortEndAt: RUN_2026_08_01_END });
		expect(best).toBeNull();
	});

	it('gir samme svar uansett rekkefølge inn', () => {
		const forward = bestRecoveryNearEffortEnd({
			samples: RUN_2026_08_01,
			effortEndAt: RUN_2026_08_01_END
		});
		const reversed = bestRecoveryNearEffortEnd({
			samples: [...RUN_2026_08_01].reverse(),
			effortEndAt: RUN_2026_08_01_END
		});
		expect(reversed).toEqual(forward);
	});
});

describe('sliceWindow', () => {
	it('tar med endepunktene og sorterer', () => {
		const from = new Date('2026-08-01T19:46:41.000Z').getTime();
		const to = new Date('2026-08-01T19:47:41.000Z').getTime();
		const slice = sliceWindow([...RUN_2026_08_01].reverse(), from, to);
		expect(slice.map((s) => s.bpm)).toEqual([150, 132, 121]);
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
