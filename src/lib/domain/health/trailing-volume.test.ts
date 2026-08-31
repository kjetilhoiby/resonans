import { describe, it, expect } from 'vitest';
import {
	BAND_DAY_WINDOW,
	MIN_BAND_SAMPLES,
	RAMP_CAUTION_PCT,
	buildTrailingSeries,
	describeTrailingVolume,
	levelAgainstReference,
	trailingBandForDate,
	trailingRamp
} from './trailing-volume';
import type { DayValue } from './cycle-series';

/** Én dag med `km` kilometer. */
function day(date: string, km: number): DayValue {
	return { date, value: km };
}

/** Alle datoer i et spenn, inklusiv. */
function range(from: string, to: string): string[] {
	const out: string[] = [];
	let at = from;
	while (at <= to) {
		out.push(at);
		const [y, m, d] = at.split('-').map(Number);
		at = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
	}
	return out;
}

describe('buildTrailingSeries', () => {
	it('summerer vinduet som ender på hver dag', () => {
		const days = [day('2026-08-01', 10), day('2026-08-02', 5), day('2026-08-03', 7)];
		const series = buildTrailingSeries(days, {
			windowDays: 3,
			today: '2026-08-03',
			historyDays: 3
		});
		expect(series.current).toBe(22);
	});

	it('lar et ufullstendig vindu være null, ikke en stigende rampe fra 0', () => {
		// Dette er hele grunnen til at feltet er nullbart. Med 0 i de to første
		// dagene ville kurven vist en oppbygging som aldri skjedde — og den ser
		// helt ekte ut.
		const days = [day('2026-08-01', 10), day('2026-08-02', 5), day('2026-08-03', 7)];
		const series = buildTrailingSeries(days, {
			windowDays: 3,
			today: '2026-08-03',
			historyDays: 3
		});
		expect(series.points.map((p) => p.value)).toEqual([null, null, 22]);
		expect(series.firstCompleteDate).toBe('2026-08-03');
	});

	it('behandler en dag uten løping som en ekte null i summen', () => {
		// Sparsom input: 2. august mangler fordi det ikke var noen tur. Det er en
		// 0 i summen — i motsetning til en dag før målingene begynte.
		const days = [day('2026-08-01', 10), day('2026-08-03', 7)];
		const series = buildTrailingSeries(days, {
			windowDays: 3,
			today: '2026-08-03',
			historyDays: 3
		});
		expect(series.current).toBe(17);
	});

	it('slipper dager som faller ut bakerst i vinduet', () => {
		const days = [day('2026-08-01', 10), day('2026-08-02', 5), day('2026-08-03', 7)];
		const series = buildTrailingSeries(days, {
			windowDays: 2,
			today: '2026-08-03',
			historyDays: 2
		});
		// Vinduet 2.–3. august: 12, ikke 22.
		expect(series.current).toBe(12);
	});

	it('summerer flere økter samme dag', () => {
		const days = [day('2026-08-03', 7), day('2026-08-03', 5)];
		const series = buildTrailingSeries(days, {
			windowDays: 1,
			today: '2026-08-03',
			historyDays: 1
		});
		expect(series.current).toBe(12);
	});

	it('tar med dager som ligger før historikkvinduet men inni dagens sleip', () => {
		// Regresjonsvakt for oppfyllingen: tegner vi bare siste 2 dager, må
		// vinduet likevel se de 28 foran.
		const days = range('2026-07-01', '2026-08-03').map((d) => day(d, 1));
		const series = buildTrailingSeries(days, {
			windowDays: 30,
			today: '2026-08-03',
			historyDays: 2
		});
		expect(series.current).toBe(30);
	});
});

describe('trailingBandForDate', () => {
	/** Tre år med jevn løping, med ett år som skiller seg ut. */
	function threeYears(): DayValue[] {
		return [
			...range('2024-01-01', '2024-12-31').map((d) => day(d, 1)),
			...range('2025-01-01', '2025-12-31').map((d) => day(d, 2)),
			...range('2026-01-01', '2026-08-31').map((d) => day(d, 3))
		];
	}

	it('regner kvartilene av TIDLIGERE år, ikke av inneværende', () => {
		// Inneværende år er det vi måler MOT. Lå det i båndet, ville en tung sesong
		// hevet båndet og skjult seg selv.
		const series = buildTrailingSeries(threeYears(), {
			windowDays: 30,
			today: '2026-08-15',
			historyDays: 1200
		});
		const band = trailingBandForDate(series, '2026-08-15')!;
		// 2024 ga 30 km/30 dager, 2025 ga 60. Inneværende år (90) skal ikke være med.
		expect(band.upper).toBeLessThanOrEqual(60);
		expect(band.lower).toBeGreaterThanOrEqual(30);
	});

	it('gir null under minimumsantallet observasjoner', () => {
		const series = buildTrailingSeries(
			range('2026-01-01', '2026-08-31').map((d) => day(d, 2)),
			{ windowDays: 30, today: '2026-08-15', historyDays: 400 }
		);
		// Bare inneværende år finnes, altså ingen tidligere observasjoner.
		expect(trailingBandForDate(series, '2026-08-15')).toBeNull();
	});

	it('samler nok observasjoner fra to år med ±10-dagers vinduet', () => {
		const series = buildTrailingSeries(threeYears(), {
			windowDays: 30,
			today: '2026-08-15',
			historyDays: 1200
		});
		const band = trailingBandForDate(series, '2026-08-15')!;
		// 21 dager × 2 tidligere år.
		expect(band.samples).toBe(42);
		expect(band.samples).toBeGreaterThanOrEqual(MIN_BAND_SAMPLES);
	});

	it('ser bare på datoer innenfor dagvinduet', () => {
		const series = buildTrailingSeries(threeYears(), {
			windowDays: 30,
			today: '2026-08-15',
			historyDays: 1200
		});
		// `minSamples` må senkes med: et smalere dagvindu gir færre observasjoner,
		// og minimumskravet slår inn før vinduet får vist seg. At de to henger
		// sammen er nettopp derfor båndet er `null` så ofte i praksis.
		const band = trailingBandForDate(series, '2026-08-15', { dayWindow: 2, minSamples: 4 })!;
		expect(band.samples).toBe(2 * (2 * 2 + 1));
		expect(BAND_DAY_WINDOW).toBe(10);
	});

	it('har medianen mellom kvartilene', () => {
		const series = buildTrailingSeries(threeYears(), {
			windowDays: 30,
			today: '2026-08-15',
			historyDays: 1200
		});
		const band = trailingBandForDate(series, '2026-08-15')!;
		expect(band.median).toBeGreaterThanOrEqual(band.lower);
		expect(band.median).toBeLessThanOrEqual(band.upper);
	});
});

describe('trailingRamp', () => {
	it('sammenligner mot et IKKE-overlappende vindu', () => {
		// Juli: 1 km/dag → 31 km. August 1.–30.: 2 km/dag.
		const days = [
			...range('2026-07-01', '2026-07-31').map((d) => day(d, 1)),
			...range('2026-08-01', '2026-08-30').map((d) => day(d, 2))
		];
		const series = buildTrailingSeries(days, {
			windowDays: 30,
			today: '2026-08-30',
			historyDays: 200
		});
		const ramp = trailingRamp(series, '2026-08-30')!;
		// Vinduet 30 dager tilbake (31. juli) er ren juli-løping.
		expect(ramp.previous).toBeCloseTo(30, 0);
		expect(ramp.pctChange).toBeGreaterThan(90);
		expect(ramp.steep).toBe(true);
	});

	it('flagger ikke en flat periode', () => {
		const days = range('2026-06-01', '2026-08-30').map((d) => day(d, 2));
		const series = buildTrailingSeries(days, {
			windowDays: 30,
			today: '2026-08-30',
			historyDays: 200
		});
		const ramp = trailingRamp(series, '2026-08-30')!;
		expect(ramp.pctChange).toBe(0);
		expect(ramp.steep).toBe(false);
	});

	it('gir null når forrige vindu var tomt — en prosent fra null finnes ikke', () => {
		const days = range('2026-08-01', '2026-08-30').map((d) => day(d, 2));
		const series = buildTrailingSeries(days, {
			windowDays: 30,
			today: '2026-08-30',
			historyDays: 200
		});
		expect(trailingRamp(series, '2026-08-30')).toBeNull();
	});
});

describe('levelAgainstReference', () => {
	const band = { lower: 60, upper: 90, median: 75, samples: 40 };

	it('lar målet vinne over båndet', () => {
		const level = levelAgainstReference(100, { goalKm: 120, band })!;
		expect(level.reference).toBe('goal');
		expect(level.standing).toBe('under');
		expect(level.deltaKm).toBe(-20);
		expect(level.pctOfGoal).toBe(83);
	});

	it('bruker båndet når det ikke finnes et mål', () => {
		expect(levelAgainstReference(75, { band })!.standing).toBe('inside');
		expect(levelAgainstReference(95, { band })!.standing).toBe('over');
		expect(levelAgainstReference(50, { band })!.standing).toBe('under');
	});

	it('måler avviket mot nærmeste båndkant, ikke mot medianen', () => {
		// «5 km under det vanlige» er handlingsbart. «25 km under medianen» er en
		// annen påstand, og en strengere en.
		expect(levelAgainstReference(55, { band })!.deltaKm).toBe(-5);
	});

	it('gir null uten både mål og bånd', () => {
		expect(levelAgainstReference(80, {})).toBeNull();
		expect(levelAgainstReference(80, { goalKm: 0, band: null })).toBeNull();
	});

	it('gir null uten et komplett vindu', () => {
		expect(levelAgainstReference(null, { goalKm: 120 })).toBeNull();
	});
});

describe('describeTrailingVolume', () => {
	const band = { lower: 60, upper: 90, median: 75, samples: 40 };

	it('sier hva sammenligningen ble gjort mot', () => {
		const text = describeTrailingVolume({
			current: 75,
			windowDays: 30,
			level: levelAgainstReference(75, { band }),
			ramp: null,
			band
		});
		expect(text).toContain('vanlige for deg');
		expect(text).toContain('60');
		expect(text).toContain('90');
	});

	it('sier tydelig fra når spørsmålet ikke kan besvares', () => {
		const text = describeTrailingVolume({
			current: 75,
			windowDays: 30,
			level: null,
			ramp: null,
			band: null
		});
		expect(text).toContain('Ingen målverdi satt');
	});

	it('kaller en bratt rampe en oppbygging, ikke en overtrening', () => {
		// Regresjonsvakt: dette er ikke et helsevarsel. Restitusjonsdommen bor i
		// formkurven, og to modeller som begge sier «du overdriver» blir aldri enige.
		const text = describeTrailingVolume({
			current: 120,
			windowDays: 30,
			level: levelAgainstReference(120, { band }),
			ramp: { previous: 80, pctChange: 50, steep: true },
			band
		});
		expect(text).toContain('oppbygging');
		expect(text).toContain('formkurven');
		expect(text).not.toContain('overtren');
	});

	it('sier fra om ufullstendig historikk framfor å vise et tall', () => {
		const text = describeTrailingVolume({
			current: null,
			windowDays: 30,
			level: null,
			ramp: null,
			band: null
		});
		expect(text).toContain('Ikke nok historikk');
	});

	it('tier om en rampe innenfor terskelen', () => {
		const text = describeTrailingVolume({
			current: 80,
			windowDays: 30,
			level: levelAgainstReference(80, { band }),
			ramp: { previous: 78, pctChange: 2.6, steep: false },
			band
		});
		expect(text).not.toContain('%');
		expect(RAMP_CAUTION_PCT).toBe(10);
	});
});
