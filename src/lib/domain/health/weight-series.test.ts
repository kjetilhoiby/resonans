import { describe, it, expect } from 'vitest';
import {
	dailyWeights,
	withTrend,
	weightMetric,
	buildMetricSeries,
	trendSegments,
	filterByRange,
	seriesForRange,
	daysBetween,
	dayNumber,
	axisForSeries,
	axisForRange,
	clipSeriesToWindow,
	WEIGHT_RANGES,
	MIN_AXIS_SPAN,
	MIN_TREND_SAMPLES,
	MAX_TREND_GAP_DAYS,
	type WeightMeasurement
} from './weight-series';

/** Datoer n dager etter en fast start, så testene ikke avhenger av i dag. */
function date(offset: number): string {
	return new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
}

function series(values: Array<number | null>, from = 0): WeightMeasurement[] {
	const rows: WeightMeasurement[] = [];
	values.forEach((value, index) => {
		if (value === null) return;
		rows.push({ date: date(from + index), weightKg: value });
	});
	return rows;
}

describe('dailyWeights', () => {
	it('slår sammen flere veiinger samme dag til snittet', () => {
		const days = dailyWeights([
			{ date: '2026-08-01', weightKg: 82.0 },
			{ date: '2026-08-01', weightKg: 83.0 }
		]);
		expect(days).toHaveLength(1);
		expect(days[0].weightKg).toBe(82.5);
		expect(days[0].weighInCount).toBe(2);
	});

	it('sorterer stigende uansett inputrekkefølge', () => {
		const days = dailyWeights([
			{ date: '2026-08-03', weightKg: 82 },
			{ date: '2026-08-01', weightKg: 83 },
			{ date: '2026-08-02', weightKg: 82.5 }
		]);
		expect(days.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-02', '2026-08-03']);
	});

	it('forkaster rader uten brukbar vekt eller dato', () => {
		const days = dailyWeights([
			{ date: '2026-08-01', weightKg: 0 },
			{ date: 'i går', weightKg: 82 },
			{ date: '2026-08-02', weightKg: 82 }
		]);
		expect(days.map((d) => d.date)).toEqual(['2026-08-02']);
	});

	it('tar kroppssammensetning fra de målingene som har den', () => {
		// Vekta poster ikke alltid alt. Én måling med fett og én uten skal ikke
		// gi «ingen fettmåling denne dagen».
		const days = dailyWeights([
			{ date: '2026-08-01', weightKg: 82, fatMassKg: null },
			{ date: '2026-08-01', weightKg: 82, fatMassKg: 18.2, fatRatio: 22.2 }
		]);
		expect(days[0].fatMassKg).toBe(18.2);
		expect(days[0].fatRatio).toBe(22.2);
	});

	it('gir null for felter ingen av dagens målinger har', () => {
		const days = dailyWeights([{ date: '2026-08-01', weightKg: 82 }]);
		expect(days[0].muscleMassKg).toBeNull();
		expect(days[0].fatFreeMassKg).toBeNull();
	});
});

describe('withTrend', () => {
	const metric = weightMetric('weight');

	it('krever minst MIN_TREND_SAMPLES målinger i vinduet', () => {
		const points = withTrend(dailyWeights(series([82, 82, 82])), metric);
		expect(points[0].trend).toBeNull();
		expect(points[1].trend).toBeNull();
		expect(points[MIN_TREND_SAMPLES - 1].trend).toBe(82);
	});

	it('er etterslepende, ikke sentrert — siste punkt har alltid en trend', () => {
		const points = withTrend(dailyWeights(series([84, 84, 84, 80, 80, 80, 80])), metric);
		expect(points.at(-1)!.trend).not.toBeNull();
		// Etterslepet er poenget: snittet drar fortsatt på de høye dagene.
		expect(points.at(-1)!.trend).toBeGreaterThan(80);
	});

	it('demper en enkelt utliggende måling', () => {
		const noisy = withTrend(dailyWeights(series([82, 82, 82, 79, 82, 82, 82])), metric);
		const spike = noisy[3];
		expect(spike.raw).toBe(79);
		// Trenden flytter seg under ett kilo der målingen falt tre.
		expect(spike.trend! - 82).toBeGreaterThan(-1);
	});

	it('mister trenden når vinduet tømmes av et hull', () => {
		const withGap = dailyWeights([...series([82, 82, 82]), ...series([81], 40)]);
		const points = withTrend(withGap, metric);
		expect(points.at(-1)!.trend).toBeNull();
	});

	it('hopper over dager der metrikken mangler', () => {
		const days = dailyWeights([
			{ date: '2026-08-01', weightKg: 82, muscleMassKg: 60 },
			{ date: '2026-08-02', weightKg: 82 },
			{ date: '2026-08-03', weightKg: 82, muscleMassKg: 60.2 }
		]);
		const points = withTrend(days, weightMetric('muscleMass'));
		expect(points.map((p) => p.date)).toEqual(['2026-08-01', '2026-08-03']);
	});
});

describe('buildMetricSeries', () => {
	it('setter lavpunktet fra trenden, ikke fra en enkeltmåling', () => {
		// Dag 4 har den laveste RÅ verdien, men trenden bunner senere.
		const built = buildMetricSeries(dailyWeights(series([84, 84, 84, 78, 83, 82, 81, 80])), 'weight');
		expect(built.nadir!.date).not.toBe('2026-01-04');
		expect(built.nadir!.value).toBeLessThan(84);
	});

	it('spennet dekker både rå målinger og trend', () => {
		const built = buildMetricSeries(dailyWeights(series([84, 84, 84, 78])), 'weight');
		expect(built.range!.min).toBe(78);
		expect(built.range!.max).toBe(84);
	});

	it('tåler en tom serie', () => {
		const built = buildMetricSeries([], 'weight');
		expect(built.points).toEqual([]);
		expect(built.latest).toBeNull();
		expect(built.nadir).toBeNull();
		expect(built.range).toBeNull();
	});
});

describe('trendSegments', () => {
	it('bryter på manglende trendverdi', () => {
		const points = [
			{ date: date(0), raw: 82, trend: 82 },
			{ date: date(1), raw: 82, trend: null },
			{ date: date(2), raw: 82, trend: 82 }
		];
		expect(trendSegments(points)).toHaveLength(2);
	});

	it('bryter på hull større enn MAX_TREND_GAP_DAYS', () => {
		const points = [
			{ date: date(0), raw: 82, trend: 82 },
			{ date: date(MAX_TREND_GAP_DAYS + 1), raw: 81, trend: 81 }
		];
		expect(trendSegments(points)).toHaveLength(2);
	});

	it('holder sammen et hull innenfor grensa', () => {
		const points = [
			{ date: date(0), raw: 82, trend: 82 },
			{ date: date(MAX_TREND_GAP_DAYS), raw: 81, trend: 81 }
		];
		expect(trendSegments(points)).toHaveLength(1);
	});
});

describe('filterByRange', () => {
	const days = dailyWeights(series(Array.from({ length: 200 }, () => 82)));

	it('måler bakover fra siste måling, ikke fra i dag', () => {
		// Serien slutter for lenge siden. «30 d» skal likevel gi 30 dager med data.
		const filtered = filterByRange(days, '30d');
		expect(filtered.length).toBeGreaterThan(28);
		expect(filtered.at(-1)!.date).toBe(days.at(-1)!.date);
	});

	it('gir hele serien for «alt»', () => {
		expect(filterByRange(days, 'alt')).toHaveLength(days.length);
	});
});

describe('axisForSeries', () => {
	function axis(values: number[], goal?: number | null) {
		return axisForSeries(buildMetricSeries(dailyWeights(series(values)), 'weight'), { goal });
	}

	it('holder gulvet når vekta nesten ikke beveget seg', () => {
		// 0,3 kg spenn. Uten gulvet blir de tre desiliterne et stup.
		const built = axis([82.0, 82.1, 82.2, 82.3, 82.2, 82.1, 82.0]);
		expect(built!.max - built!.min).toBeGreaterThanOrEqual(MIN_AXIS_SPAN.kg);
		expect(built!.spanFloored).toBe(true);
	});

	it('lar aksen følge dataene når spennet er stort nok', () => {
		const built = axis([90, 88, 86, 84, 82, 80, 78]);
		expect(built!.spanFloored).toBe(false);
		expect(built!.min).toBeLessThanOrEqual(78);
		expect(built!.max).toBeGreaterThanOrEqual(90);
	});

	it('utvider domenet så en mållinje innen rekkevidde får plass', () => {
		// En stiplet strek utenfor feltet er en strek brukeren ikke ser.
		const built = axis([84.0, 83.6, 83.2, 82.8, 82.4, 82.0, 81.6], 81);
		expect(built!.min).toBeLessThanOrEqual(81);
		expect(built!.goalOutside).toBeNull();
	});

	it('lar ikke et fjernt mål flate ut utviklingen', () => {
		/**
		 * Regresjonen brukeren så: aksen sto 80–110 kg på en 30-dagersvisning der
		 * vekta gikk fra 100,6 til 98,0. Et mål femten kilo unna ber om et felt der
		 * de to kiloene er en flat strek. Målet vises i kanten i stedet.
		 */
		const built = axis([100.6, 100.2, 99.8, 99.4, 99.0, 98.4, 98.0], 85);
		expect(built!.goalOutside).toBe('under');
		expect(built!.min).toBeGreaterThan(90);
		expect(built!.max - built!.min).toBeLessThan(6);
	});

	it('slipper inn et mål man nærmer seg', () => {
		// Samme data, men målet er innen rekkevidde: da er det verdt plassen.
		const built = axis([100.6, 100.2, 99.8, 99.4, 99.0, 98.4, 98.0], 95);
		expect(built!.goalOutside).toBeNull();
		expect(built!.min).toBeLessThanOrEqual(95);
	});

	it('dytter ikke ut et nært mål i en rolig periode', () => {
		// Spennet er ~0, så sammenligningen må skje mot det gulvede spennet —
		// ellers ville ethvert mål havnet utenfor når vekta står stille.
		const built = axis([82.0, 82.1, 82.0, 82.1, 82.0, 82.1, 82.0], 81.5);
		expect(built!.goalOutside).toBeNull();
		expect(built!.min).toBeLessThanOrEqual(81.5);
	});

	it('gir pene aksetall', () => {
		const built = axis([84, 83, 82, 81, 80, 79, 78]);
		for (const tick of built!.ticks) {
			expect(Number(tick.toFixed(2))).toBe(tick);
		}
	});

	it('gir null uten data', () => {
		expect(axisForSeries(buildMetricSeries([], 'weight'), {})).toBeNull();
	});

	it('sløser ikke bort feltet når mållinja utvider domenet', () => {
		/**
		 * Regresjonen: dataene lå 80,8–83,4 med mål på 80. Aksen ble tegnet 78–84,
		 * altså med en tredjedel av feltet tomt, fordi luften ble lagt rundt
		 * midtpunktet av et bredere spenn og steget rundet opp fra 1,02 til 2.
		 */
		const built = axis([83.4, 83.0, 82.6, 82.2, 81.6, 81.0, 80.8], 80);
		expect(built!.min).toBeGreaterThanOrEqual(78.5);
		expect(built!.max).toBeLessThanOrEqual(85);
	});

	it('legger luften rundt dataene, ikke rundt midtpunktet', () => {
		const built = axis([90, 89, 88, 87, 86, 85, 84]);
		// Like mye luft over som under, altså symmetrisk om dataene selv.
		expect(Math.abs((built!.max - 90) - (84 - built!.min))).toBeLessThanOrEqual(1);
	});
});

describe('clipSeriesToWindow', () => {
	/**
	 * Lang historikk mellom 88 og 107, der de siste tretti dagene ligger rolig
	 * rundt 99. Det er formen på brukerens egen kurve, og det var her aksen sto
	 * 80–110 i alle perioder.
	 */
	const days = dailyWeights(
		series([
			...Array.from({ length: 300 }, (_, i) => 107 - (i % 40) * 0.475),
			...Array.from({ length: 30 }, (_, i) => 100.6 - i * 0.09)
		])
	);
	const full = buildMetricSeries(days, 'weight');
	const lastDay = dayNumber(days.at(-1)!.date);
	const window = { firstDay: lastDay - 29, lastDay };

	it('regner spennet av vinduet, ikke av historikken', () => {
		const clipped = clipSeriesToWindow(full, window);
		expect(full.range!.max - full.range!.min).toBeGreaterThan(15);
		expect(clipped.range!.max - clipped.range!.min).toBeLessThan(5);
	});

	it('gir en akse som viser utviklingen i en kort periode', () => {
		// Selve regresjonen: aksen skal ikke lenger spenne 80–110 for tretti dager.
		const built = axisForSeries(clipSeriesToWindow(full, window))!;
		expect(built.max - built.min).toBeLessThan(6);
		expect(built.min).toBeGreaterThan(90);
	});

	it('beholder lavpunktet fra hele historikken', () => {
		// Et «lavpunkt» som bare gjelder de tretti dagene man ser på, er ikke et
		// lavpunkt — det er den minste av dem.
		const clipped = clipSeriesToWindow(full, window);
		expect(clipped.nadir).toEqual(full.nadir);
		expect(clipped.nadir!.date < clipped.points[0].date).toBe(true);
	});

	it('flytter siste punkt til vinduets siste måling', () => {
		const earlier = { firstDay: lastDay - 200, lastDay: lastDay - 100 };
		const clipped = clipSeriesToWindow(full, earlier);
		expect(clipped.latest!.date).toBe(clipped.points.at(-1)!.date);
		expect(clipped.latest!.date).not.toBe(full.latest!.date);
	});

	it('gir en tom serie uten vindu', () => {
		const clipped = clipSeriesToWindow(full, null);
		expect(clipped.points).toHaveLength(0);
		expect(clipped.range).toBeNull();
		expect(clipped.latest).toBeNull();
	});
});

describe('seriesForRange', () => {
	it('regner trenden på hele historikken før den klipper', () => {
		// Uten dette ville første dag i perioden manglet trend, siden vinduet
		// trenger dagene FØR perioden.
		const days = dailyWeights(series(Array.from({ length: 120 }, () => 82)));
		const ranged = seriesForRange(days, 'weight', '30d');
		expect(ranged.points[0].trend).not.toBeNull();
	});

	it('beholder lavpunktet fra hele historikken', () => {
		// 200 dager der bunnen ligger tidlig; en 30-dagersvisning skal fortsatt
		// vite hva lavpunktet er, ellers er «over lavpunktet» meningsløst.
		const values = Array.from({ length: 200 }, (_, i) => (i < 20 ? 78 : 82));
		const days = dailyWeights(series(values));
		const ranged = seriesForRange(days, 'weight', '30d');
		expect(ranged.nadir!.value).toBeLessThan(80);
		expect(daysBetween(ranged.nadir!.date, ranged.points[0].date)).toBeGreaterThan(100);
	});
});

describe('periodevalgene', () => {
	it('har et trinn mellom ett år og alt', () => {
		// Nesten ni år med veiinger hoppet fra «1 år» rett til «Alt», og det er to
		// helt ulike grafer.
		const ids = WEIGHT_RANGES.map((r) => r.id);
		expect(ids).toContain('3y');
		expect(ids.indexOf('3y')).toBeGreaterThan(ids.indexOf('1y'));
		expect(ids.indexOf('3y')).toBeLessThan(ids.indexOf('alt'));
	});

	it('stiger monotont, med «Alt» ubundet', () => {
		const days = WEIGHT_RANGES.map((r) => r.days);
		expect(days.at(-1)).toBeNull();
		const bounded = days.slice(0, -1) as number[];
		for (let i = 1; i < bounded.length; i++) {
			expect(bounded[i]).toBeGreaterThan(bounded[i - 1]);
		}
	});
});

describe('axisForRange med gulv', () => {
	it('lar ikke luften ta aksen under gulvet', () => {
		// Akkumulerte kilometer: 0–830 ga en akse fra −250, altså en fjerdedel av
		// feltet brukt på et område kurven ikke kan være i.
		const built = axisForRange({ min: 0, max: 830 }, { minSpan: 50, floorAt: 0 })!;
		expect(built.min).toBe(0);
		expect(built.ticks[0]).toBe(0);
	});

	it('respekterer data som faktisk ligger under gulvet', () => {
		// Gulvet er en beskyttelse mot padding, ikke en påstand om dataene. Går
		// kurven under, må aksen følge med.
		const built = axisForRange({ min: -4, max: 2 }, { minSpan: 2, floorAt: 0 })!;
		expect(built.min).toBeLessThanOrEqual(-4);
	});
});
