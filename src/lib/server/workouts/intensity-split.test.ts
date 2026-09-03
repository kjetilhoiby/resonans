import { describe, it, expect } from 'vitest';
import {
	MAX_SAMPLE_GAP_SECONDS,
	MIN_QUALITY_BLOCK_SECONDS,
	analyzeWorkout,
	computeHrZoneDistribution,
	computeIntensitySplit,
	type TrackPoint
} from './workout-analytics';

/**
 * Referansebrukeren: hvile 46, maks 179 (målt 3. september 2026).
 * Bånd: Z2 126–138, Z3 139–151, Z4 152–165, Z5 166–179.
 * Altså er rolig-taket 138 og kvalitetsgulvet 152.
 */
const baseline = { restHr: 46, maxHr: 179 };

/** Bygger et spor der hvert punkt er ett sekund, med oppgitt pulsserie. */
function track(hrs: number[]): TrackPoint[] {
	const t0 = Date.parse('2026-09-02T10:00:00Z');
	return hrs.map((hr, i) => ({
		lat: 59.9 + i * 1e-5,
		lon: 10.7,
		time: new Date(t0 + i * 1000).toISOString(),
		hr
	}));
}

/** `n` sekunder på gitt puls. */
function at(hr: number, n: number): number[] {
	return Array.from({ length: n }, () => hr);
}

describe('computeIntensitySplit', () => {
	it('legger tid under Z2-taket i rolig', () => {
		const split = computeIntensitySplit(track(at(130, 600)), baseline)!;
		expect(split.easySeconds).toBeGreaterThan(560);
		expect(split.greySeconds).toBe(0);
		expect(split.qualitySeconds).toBe(0);
	});

	it('teller et sammenhengende drag over Z4 som kvalitet', () => {
		const split = computeIntensitySplit(
			track([...at(130, 300), ...at(158, 240), ...at(130, 300)]),
			baseline
		)!;
		expect(split.qualitySeconds).toBeGreaterThan(230);
		expect(split.easySeconds).toBeGreaterThan(590);
	});

	it('lar SPREDTE bakketopper bli grått, ikke kvalitet', () => {
		// **Dette er hele rettelsen.** Fire bakker à 30 s over Z4 er fire oppsamlede
		// minutter — nok til at det gamle regimet stemplet hele økta «hard».
		// Ingen av dem holder et minutt, så ingen av dem er et drag.
		const hills = [
			...at(130, 300), ...at(156, 30),
			...at(130, 300), ...at(156, 30),
			...at(130, 300), ...at(156, 30),
			...at(130, 300), ...at(156, 30)
		];
		const split = computeIntensitySplit(track(hills), baseline)!;
		expect(split.qualitySeconds).toBe(0);
		expect(split.greySeconds).toBeGreaterThan(100);
		expect(MIN_QUALITY_BLOCK_SECONDS).toBe(60);
	});

	it('teller en LANG bakke som kvalitet, og det er meningen', () => {
		// Som mengde er to kvalitetsminutter fra en bakke både sant og harmløst.
		// Under det gamle regimet gjorde samme bakke hele økta «hard».
		const split = computeIntensitySplit(
			track([...at(130, 300), ...at(156, 120), ...at(130, 300)]),
			baseline
		)!;
		expect(split.qualitySeconds).toBeGreaterThan(110);
		expect(split.qualitySeconds).toBeLessThan(130);
	});

	it('legger vedvarende Z3 i grått — hverken rolig nor kvalitet', () => {
		const split = computeIntensitySplit(track(at(145, 900)), baseline)!;
		expect(split.easySeconds).toBe(0);
		expect(split.qualitySeconds).toBe(0);
		expect(split.greySeconds).toBeGreaterThan(860);
	});

	it('bryter en blokk over et pulshull framfor å skjøte den', () => {
		// Uten grensa skjøter et BLE-drop to korte drag til én lang blokk, og tida i
		// hullet — der vi ikke vet noe — tilskrives kvalitet.
		const t0 = Date.parse('2026-09-02T10:00:00Z');
		const points: TrackPoint[] = [];
		let t = 0;
		for (const hr of at(158, 40)) {
			points.push({ lat: 59.9, lon: 10.7, time: new Date(t0 + t * 1000).toISOString(), hr });
			t += 1;
		}
		t += 300; // fem minutters hull
		for (const hr of at(158, 40)) {
			points.push({ lat: 59.9, lon: 10.7, time: new Date(t0 + t * 1000).toISOString(), hr });
			t += 1;
		}
		const split = computeIntensitySplit(points, baseline)!;
		expect(split.qualitySeconds).toBe(0);
		// Hullet skal heller ikke telles som målt tid.
		expect(split.measuredSeconds).toBeLessThan(120);
		expect(MAX_SAMPLE_GAP_SECONDS).toBe(30);
	});

	it('lar de tre delene summere til den målte tida', () => {
		const split = computeIntensitySplit(
			track([...at(130, 300), ...at(145, 200), ...at(158, 180), ...at(156, 30)]),
			baseline
		)!;
		expect(split.easySeconds + split.greySeconds + split.qualitySeconds).toBe(
			split.measuredSeconds
		);
	});

	it('bærer baselinen den ble regnet mot', () => {
		// Samme grunn som `hrZoneDistribution`: et lagret tall må kunne revideres
		// mot dagens bånd. Se `isBaselineComparable`.
		const split = computeIntensitySplit(track(at(130, 600)), baseline)!;
		expect(split).toMatchObject({ basis: 'hrr', restHr: 46, maxHr: 179 });
		expect(split.minBlockSeconds).toBe(MIN_QUALITY_BLOCK_SECONDS);
	});

	it('gir undefined uten brukbar baseline framfor å gjette bånd', () => {
		expect(computeIntensitySplit(track(at(130, 600)), { restHr: 60, maxHr: 70 })).toBeUndefined();
	});

	it('gir undefined under ti pulspunkter', () => {
		expect(computeIntensitySplit(track(at(130, 5)), baseline)).toBeUndefined();
	});

	it('behandler grensepulsen 138 som rolig og 152 som kvalitet', () => {
		// Samme grenser coachen leser høyt: Z2 er 126–138, Z4 starter på 152.
		const easy = computeIntensitySplit(track(at(138, 600)), baseline)!;
		expect(easy.easySeconds).toBeGreaterThan(560);

		const quality = computeIntensitySplit(track(at(152, 600)), baseline)!;
		expect(quality.qualitySeconds).toBeGreaterThan(560);

		const grey = computeIntensitySplit(track(at(139, 600)), baseline)!;
		expect(grey.greySeconds).toBeGreaterThan(560);
	});
});

/**
 * Det gamle brystbeltet: 130 → 230 på ett sekund, og fast der oppe resten av
 * økta. Uten vakta i `hr-artefacts.ts` er dette den verste inputen tidsdelingen
 * kan få — hele økta blir ÉN sammenhengende blokk over Z4s gulv, altså 100 %
 * kvalitet og null rolig, i nøyaktig den grafen som skal svare på om de rolige
 * øktene er rolige.
 */
describe('ødelagt pulsbelte', () => {
	const brokenBelt = track([...at(130, 300), ...at(230, 2100)]);

	it('gir ingen tidsdeling', () => {
		expect(computeIntensitySplit(brokenBelt, baseline)).toBeUndefined();
	});

	it('gir ingen sonefordeling', () => {
		expect(computeHrZoneDistribution(brokenBelt, baseline)).toBeUndefined();
	});

	it('beholder distanse og terreng, og sier hvorfor pulsen falt ut', () => {
		const result = analyzeWorkout(brokenBelt, baseline);
		expect(result.bestEfforts).toBeDefined();
		expect(result.hrDiagnosis?.usable).toBe(false);
		expect(result.hrDiagnosis?.reasons).toContain('pinned');
	});

	it('lar en ekte økt beholde begge', () => {
		// Puls som vandrer et par slag rundt kvalitetsgulvet.
		const real = track(Array.from({ length: 1200 }, (_, i) => 154 + (i % 5) - 2));
		const result = analyzeWorkout(real, baseline);
		expect(result.hrDiagnosis?.usable).toBe(true);
		expect(result.intensitySplit?.qualitySeconds).toBeGreaterThan(1000);
		expect(result.hrZoneDistribution).toBeDefined();
	});
});
