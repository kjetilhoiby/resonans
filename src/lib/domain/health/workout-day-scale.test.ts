import { describe, it, expect } from 'vitest';
import {
	buildDayScale,
	dayVisual,
	distanceSize,
	legendSamples,
	paceFill,
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

	it('holder distanse og tempo uavhengige', () => {
		// Samme tempo, ulik distanse: samme farge, ulik størrelse.
		const a = dayVisual(day('x', 4, 330), scale)!;
		const b = dayVisual(day('x', 10, 330), scale)!;
		expect(a.fill).toBe(b.fill);
		expect(a.sizePct).not.toBe(b.sizePct);
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
		const atMax = dayVisual(day('x', 11.1, 300), scale)!;
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

describe('paceFill', () => {
	it('velger mørk skrift på den lyse enden og lys på den mørke', () => {
		expect(paceFill(0).ink).toBe('#14130f');
		expect(paceFill(1).ink).toBe('#f2eee4');
	});
});

describe('legendSamples', () => {
	it('lar hver skala vise ÉN ting', () => {
		const { pace, distance } = legendSamples();

		// Tempo-raden varierer farge og holder størrelsen fast.
		expect(new Set(pace.map((s) => s.fill)).size).toBe(3);
		expect(new Set(pace.map((s) => s.sizePct)).size).toBe(1);

		// Distanse-raden varierer størrelse og holder fargen fast.
		expect(new Set(distance.map((s) => s.sizePct)).size).toBe(3);
		expect(new Set(distance.map((s) => s.fill)).size).toBe(1);
	});
});
