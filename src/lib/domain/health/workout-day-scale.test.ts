import { describe, it, expect } from 'vitest';
import {
	buildDayScale,
	dayVisual,
	FIELD_KREM,
	FIELD_NATT,
	fieldColor,
	legendSamples,
	MIN_DISTANCE_SPAN_KM,
	MIN_MEASURED_DAYS,
	MIN_PACE_SPAN_SEC,
	NO_METRIC_VISUAL,
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

	it('gir hver dimensjon ÉN kanal', () => {
		// Distansen er kulør og bare kulør. Lå den også i arealet, beveget de to seg
		// sammen, og da var bare diagonalen synlig — tempo-aksen druknet.
		const short = dayVisual(day('x', 3, 330), scale)!;
		const long = dayVisual(day('x', 12, 330), scale)!;

		expect(Object.keys(short).sort()).toEqual(['fill', 'ink', 'krem']);
		expect(Object.keys(short.krem).sort()).toEqual(['fill', 'ink']);
		expect(short.fill).not.toBe(long.fill);
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
		expect(beyond.fill).toBe(atMax.fill);
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
		// Alle fire er ulike farger — det er hele tegnforklaringen.
		expect(new Set(grid.flat().map((s) => s.fill)).size).toBe(4);
	});

	it('er prøver av det SAMME feltet cellene bruker', () => {
		const grid = legendSamples();
		expect(grid[0][0].fill).toBe(fieldColor(0, 0).fill);
		expect(grid[1][1].fill).toBe(fieldColor(1, 1).fill);
	});
});

// ── Krem-feltet ─────────────────────────────────────────────────────────────

function linear(hex: string): [number, number, number] {
	return [1, 3, 5].map((i) => {
		const c = parseInt(hex.slice(i, i + 2), 16) / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
}

function contrast(a: string, b: string): number {
	const lum = (hex: string) => {
		const [r, g, b2] = linear(hex);
		return 0.2126 * r + 0.7152 * g + 0.0722 * b2;
	};
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** OKLab-avstand ×100, samme mål som palettvalidatoren. */
function deltaE(a: string, b: string): number {
	const lab = (hex: string) => {
		const [r, g, bl] = linear(hex);
		const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
		const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
		const s2 = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
		return [
			0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s2,
			1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s2,
			0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s2
		];
	};
	const [p, q] = [lab(a), lab(b)];
	return 100 * Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** `--bg-secondary`, `--bg-primary` og `--bg-card` i krem (`uttrykk-a.css`). */
const KREM_FLATER = ['#f0eadd', '#f6f1e7', '#fbf8f1'];
const NATT_FLATE = '#141414';

describe('krem-feltet', () => {
	const corner = (pace: number, distance: number) => fieldColor(pace, distance, FIELD_KREM).fill;
	const corners = [corner(0, 0), corner(0, 1), corner(1, 0), corner(1, 1)];

	it('holder 3:1 mot alle tre krem-flatene i alle fire hjørner', () => {
		for (const fill of corners) {
			for (const surface of KREM_FLATER) {
				expect(contrast(fill, surface), `${fill} mot ${surface}`).toBeGreaterThanOrEqual(3);
			}
		}
	});

	it('skiller hjørner med samme tempo og med samme distanse (ΔE ≥ 15)', () => {
		expect(deltaE(corner(0, 0), corner(0, 1))).toBeGreaterThanOrEqual(15);
		expect(deltaE(corner(1, 0), corner(1, 1))).toBeGreaterThanOrEqual(15);
		expect(deltaE(corner(0, 0), corner(1, 0))).toBeGreaterThanOrEqual(15);
		expect(deltaE(corner(0, 1), corner(1, 1))).toBeGreaterThanOrEqual(15);
	});

	it('snur lysheten: på krem er de raske dagene de MØRKE, så de står fram', () => {
		const fast = contrast(corner(0, 0), KREM_FLATER[0]);
		const slow = contrast(corner(1, 0), KREM_FLATER[0]);
		expect(fast).toBeGreaterThan(slow);
		expect(FIELD_KREM.lFast).toBeLessThan(FIELD_KREM.lSlow);
		expect(FIELD_NATT.lFast).toBeGreaterThan(FIELD_NATT.lSlow);
	});

	it('følger med i hver dag og i tegnforklaringen', () => {
		const scale = buildDayScale(spread);
		const visual = dayVisual(day('x', 3, 300), scale)!;
		expect(visual.krem.fill).toBe(corner(0, 0));
		expect(legendSamples()[1][1].krem.fill).toBe(corner(1, 1));
	});

	it('gråtonen for dager uten tall synes på krem også', () => {
		for (const surface of KREM_FLATER) {
			expect(contrast(NO_METRIC_VISUAL.krem.fill, surface)).toBeGreaterThanOrEqual(3);
		}
	});

	it('natt-feltet holder fortsatt 3:1 mot natt-flaten', () => {
		for (const [p, d] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
			expect(contrast(fieldColor(p, d).fill, NATT_FLATE)).toBeGreaterThanOrEqual(3);
		}
	});
});
