import { describe, it, expect } from 'vitest';
import {
	buildDayScale,
	dayVisual,
	distanceSize,
	fieldColor,
	legendSamples,
	MIN_DISTANCE_SPAN_KM,
	MIN_MEASURED_DAYS,
	MIN_PACE_SPAN_SEC,
	NO_METRIC_VISUAL,
	SIZE_MAX_PCT,
	SIZE_MIN_PCT,
	type WorkoutDayMetrics
} from './workout-day-scale';

function day(
	date: string,
	distanceKm: number | null,
	paceSecPerKm: number | null,
	count = 1
): WorkoutDayMetrics {
	return { date, count, distanceKm, paceSecPerKm };
}

/** Ti dager med jevn spredning: 3–12 km, 5:00–6:30 per km. */
const spread = Array.from({ length: 10 }, (_, i) =>
	day(`2026-08-${String(i + 1).padStart(2, '0')}`, 3 + i, 300 + i * 10)
);

describe('buildDayScale', () => {
	it('normaliserer mot brukerens egne persentiler', () => {
		const scale = buildDayScale(spread);

		expect(scale.usable).toBe(true);
		expect(scale.measuredDays).toBe(10);
		// 10.–90. persentil av 3..12 km
		expect(scale.distance.min).toBeCloseTo(3.9, 1);
		expect(scale.distance.max).toBeCloseTo(11.1, 1);
	});

	it('lar en glemt tracker være en ytterlighet, ikke hele skalaen', () => {
		// 2 t 20 min på 9 km er glemt sporing, ikke en treg dag. Med min/maks ville
		// den presset alle andre dager sammen i den lyse enden.
		const withOutlier = [...spread, day('2026-08-20', 9, 933)];
		const scale = buildDayScale(withOutlier);

		expect(scale.pace.max).toBeLessThan(500);
	});

	it('utvider et for smalt spenn til gulvet', () => {
		// Alle turene like: skal SE like ut, ikke spres over hele skalaen.
		const flat = Array.from({ length: 8 }, (_, i) =>
			day(`2026-08-${String(i + 1).padStart(2, '0')}`, 5, 330)
		);
		const scale = buildDayScale(flat);

		expect(scale.distance.max - scale.distance.min).toBeCloseTo(MIN_DISTANCE_SPAN_KM, 5);
		expect(scale.pace.max - scale.pace.min).toBeCloseTo(MIN_PACE_SPAN_SEC, 5);

		const visuals = flat.map((d) => dayVisual(d, scale)!);
		expect(new Set(visuals.map((v) => v.fill)).size).toBe(1);
		expect(new Set(visuals.map((v) => v.sizePct)).size).toBe(1);
	});

	it('gir ingen skala under gulvet for antall dager', () => {
		const few = spread.slice(0, MIN_MEASURED_DAYS - 1);
		expect(buildDayScale(few).usable).toBe(false);
	});

	it('teller bare dager som har BEGGE tallene', () => {
		const mixed = [...spread.slice(0, 4), day('2026-08-11', 5, null), day('2026-08-12', null, 330)];
		expect(buildDayScale(mixed).measuredDays).toBe(4);
	});
});

describe('dayVisual', () => {
	const scale = buildDayScale(spread);

	it('tegner raske dager lysere enn rolige', () => {
		const fast = dayVisual(day('x', 6, 300), scale)!;
		const slow = dayVisual(day('x', 6, 390), scale)!;

		const brightness = (hex: string) =>
			[1, 3, 5].reduce((sum, i) => sum + parseInt(hex.slice(i, i + 2), 16), 0);
		expect(brightness(fast.fill)).toBeGreaterThan(brightness(slow.fill));
	});

	it('tegner lange dager større enn korte', () => {
		const short = dayVisual(day('x', 3, 330), scale)!;
		const long = dayVisual(day('x', 12, 330), scale)!;

		expect(long.sizePct).toBeGreaterThan(short.sizePct);
		expect(short.sizePct).toBeGreaterThanOrEqual(SIZE_MIN_PCT);
		expect(long.sizePct).toBeLessThanOrEqual(SIZE_MAX_PCT);
	});

	it('lar distansen slå ut i BÅDE areal og kulør', () => {
		// Samme tempo, ulik distanse: ulik størrelse og ulik farge. Arealet er
		// redundant med kuløren, og det er meningen — kuløren er den som forsvinner
		// for en rødgrønn-blind leser.
		const a = dayVisual(day('x', 4, 330), scale)!;
		const b = dayVisual(day('x', 10, 330), scale)!;
		expect(a.sizePct).not.toBe(b.sizePct);
		expect(a.fill).not.toBe(b.fill);
	});

	it('bruker gråtonen når dagen mangler tall', () => {
		expect(dayVisual(day('x', null, null), scale)).toEqual(NO_METRIC_VISUAL);
		expect(dayVisual(day('x', 5, null), scale)).toEqual(NO_METRIC_VISUAL);
	});

	it('bruker gråtonen når skalaen ikke er brukbar', () => {
		const thin = buildDayScale(spread.slice(0, 2));
		expect(dayVisual(day('x', 5, 330), thin)).toEqual(NO_METRIC_VISUAL);
	});

	it('gir null for en dag uten hendelser', () => {
		expect(dayVisual(day('x', null, null, 0), scale)).toBeNull();
	});

	it('klipper verdier utenfor spennet framfor å tegne utenfor skalaen', () => {
		const beyond = dayVisual(day('x', 40, 120), scale)!;
		const atMax = dayVisual(day('x', 11.1, 297), scale)!;
		expect(beyond.sizePct).toBe(SIZE_MAX_PCT);
		expect(beyond.fill).toBe(atMax.fill);
	});
});

describe('distanceSize', () => {
	it('er lineær i AREAL, ikke i sidekant', () => {
		// Halvveis i skalaen skal marken dekke halvparten av arealspennet.
		const mid = distanceSize(0.5);
		const midArea = mid ** 2;
		const expected = (SIZE_MIN_PCT ** 2 + SIZE_MAX_PCT ** 2) / 2;
		expect(midArea).toBeCloseTo(expected, 0);
		// …og altså IKKE midt mellom sidekantene.
		expect(mid).toBeGreaterThan((SIZE_MIN_PCT + SIZE_MAX_PCT) / 2);
	});
});

describe('fieldColor', () => {
	it('velger mørk skrift på den lyse enden og lys på den mørke', () => {
		expect(fieldColor(0, 0).ink).toBe('#14130f');
		expect(fieldColor(1, 0).ink).toBe('#f2eee4');
	});

	it('holder LYSHETEN som tempoets akse alene', () => {
		// Kort og lang tur i samme tempo skal ha samme lyshet: ellers leses en lang
		// rask dag som roligere enn en kort rask.
		const luminance = (hex: string) =>
			0.2126 * parseInt(hex.slice(1, 3), 16) +
			0.7152 * parseInt(hex.slice(3, 5), 16) +
			0.0722 * parseInt(hex.slice(5, 7), 16);

		// Samme tempo, ulik distanse: kuløren dreier, men ingen av dem blir markert
		// mørkere enn den andre (gul og rød har ulik iboende luminans, så vi tester
		// mot tempo-aksen: skrittet mellom tempoene skal være mye større).
		const shortFast = luminance(fieldColor(0, 0).fill);
		const longFast = luminance(fieldColor(0, 1).fill);
		const shortSlow = luminance(fieldColor(1, 0).fill);

		expect(Math.abs(shortFast - longFast)).toBeLessThan(shortFast - shortSlow);
	});

	it('dreier kuløren fra gul mot rød med distansen', () => {
		const short = fieldColor(0.5, 0);
		const long = fieldColor(0.5, 1);
		const greenish = (hex: string) => parseInt(hex.slice(3, 5), 16);
		// Gult har mye grønt i seg, rødt lite.
		expect(greenish(short.fill)).toBeGreaterThan(greenish(long.fill) + 40);
	});

	it('interpolerer bilineært — midten er ikke et hjørne', () => {
		const mid = fieldColor(0.5, 0.5).fill;
		for (const corner of [
			fieldColor(0, 0).fill,
			fieldColor(0, 1).fill,
			fieldColor(1, 0).fill,
			fieldColor(1, 1).fill
		]) {
			expect(mid).not.toBe(corner);
		}
	});
});

describe('legendSamples', () => {
	it('gir feltets fire hjørner, i aksenes rekkefølge', () => {
		const grid = legendSamples();

		expect(grid).toHaveLength(2);
		expect(grid[0]).toHaveLength(2);
		// Alle fire er ulike farger.
		expect(new Set(grid.flat().map((s) => s.fill)).size).toBe(4);
		// Kolonnene er distanse, så størrelsen følger dem — ikke radene.
		expect(grid[0][0].sizePct).toBe(grid[1][0].sizePct);
		expect(grid[0][0].sizePct).toBeLessThan(grid[0][1].sizePct);
	});

	it('er prøver av det SAMME feltet cellene bruker', () => {
		const grid = legendSamples();
		expect(grid[0][0].fill).toBe(fieldColor(0, 0).fill);
		expect(grid[1][1].fill).toBe(fieldColor(1, 1).fill);
	});
});
