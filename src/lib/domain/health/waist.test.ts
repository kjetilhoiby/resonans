import { describe, it, expect } from 'vitest';
import {
	dailyWaist,
	buildWaistSeries,
	waistTrendSegments,
	waistToHeightRatio,
	waistChange,
	summarizeWaist,
	waistAxis,
	validateWaistCm,
	parseWaistInput,
	WAIST_CADENCE_DAYS,
	WAIST_MIN_TREND_SAMPLES,
	MIN_WAIST_AXIS_SPAN_CM,
	WAIST_NOISE_CM,
	WAIST_STALE_DAYS
} from './waist';

/** Datoer n dager etter en fast start, så testene ikke avhenger av i dag. */
function date(offset: number): string {
	return new Date(Date.UTC(2026, 0, 1) + offset * 86_400_000).toISOString().slice(0, 10);
}

/** Ukentlige målinger, som er kadensen flaten legger opp til. */
function weekly(values: number[], startOffset = 0) {
	return values.map((waistCm, i) => ({ date: date(startOffset + i * 7), waistCm }));
}

describe('validateWaistCm', () => {
	it('godtar et vanlig livmål', () => {
		expect(validateWaistCm(94)).toBeNull();
	});

	it('avviser tall utenfor menneskelig spenn', () => {
		expect(validateWaistCm(20)).not.toBeNull();
		expect(validateWaistCm(250)).not.toBeNull();
	});

	it('avviser noe som ikke er et tall', () => {
		expect(validateWaistCm('94')).not.toBeNull();
		expect(validateWaistCm(null)).not.toBeNull();
		expect(validateWaistCm(NaN)).not.toBeNull();
	});
});

describe('parseWaistInput', () => {
	it('tar imot et tall, slik bind:value faktisk leverer det', () => {
		// Regresjonen: `bind:value` mot type="number" konverterer til tall, og
		// kortet kalte `.replace()` på verdien. Den kastet inne i en $derived, den
		// reaktive oppdateringen stoppet, og Lagre-knappen ble aldri aktiv.
		expect(parseWaistInput(102.3)).toBe(102.3);
	});

	it('tar imot en streng med punktum og med komma', () => {
		expect(parseWaistInput('102.3')).toBe(102.3);
		expect(parseWaistInput('102,3')).toBe(102.3);
	});

	it('gir null for tomt felt', () => {
		expect(parseWaistInput('')).toBeNull();
		expect(parseWaistInput('   ')).toBeNull();
	});

	it('gir null for det som ikke er et tall', () => {
		expect(parseWaistInput('nitti')).toBeNull();
		expect(parseWaistInput(null)).toBeNull();
		expect(parseWaistInput(undefined)).toBeNull();
		expect(parseWaistInput(NaN)).toBeNull();
		expect(parseWaistInput(0)).toBeNull();
		expect(parseWaistInput(-94)).toBeNull();
	});

	it('slipper gjennom et tall utenfor spennet — validatoren eier den beskjeden', () => {
		// Parsing og validering er to spørsmål. Ville parsingen også avvist 300,
		// hadde brukeren fått en død knapp framfor «må være mellom 40 og 200».
		expect(parseWaistInput(300)).toBe(300);
		expect(validateWaistCm(parseWaistInput(300))).not.toBeNull();
	});
});

describe('dailyWaist', () => {
	it('snitter flere målinger samme dag', () => {
		// To målinger rett etter hverandre er måten å dempe båndfeilen på.
		const days = dailyWaist([
			{ date: '2026-08-01', waistCm: 94 },
			{ date: '2026-08-01', waistCm: 95 }
		]);
		expect(days).toHaveLength(1);
		expect(days[0].waistCm).toBe(94.5);
		expect(days[0].measurementCount).toBe(2);
	});

	it('sorterer stigende og forkaster ubrukelige rader', () => {
		const days = dailyWaist([
			{ date: '2026-08-03', waistCm: 93 },
			{ date: 'i går', waistCm: 94 },
			{ date: '2026-08-01', waistCm: 500 },
			{ date: '2026-08-02', waistCm: 94 }
		]);
		expect(days.map((d) => d.date)).toEqual(['2026-08-02', '2026-08-03']);
	});
});

describe('buildWaistSeries', () => {
	it('regner trend på ukentlige målinger', () => {
		// Regresjonen dette hindrer: med vektas 7-dagersvindu ville ukentlig
		// måling gitt én observasjon i vinduet, og trenden aldri blitt regnet.
		const series = buildWaistSeries(dailyWaist(weekly([96, 95.5, 95, 94.5])));
		expect(series.latest!.trend).not.toBeNull();
	});

	it('holder kjeft til det finnes nok målinger', () => {
		const series = buildWaistSeries(dailyWaist(weekly([96, 95.5])));
		expect(series.points.every((p) => p.trend === null)).toBe(true);
	});

	it('setter lavpunktet fra trenden, ikke fra en enkeltmåling', () => {
		// Måling nr. 4 er den laveste rå verdien, men den er en båndbom.
		const series = buildWaistSeries(dailyWaist(weekly([96, 96, 96, 90, 95.5, 95, 95])));
		expect(series.nadir!.date).not.toBe(date(21));
		expect(series.nadir!.value).toBeGreaterThan(90);
	});

	it('tåler en tom serie', () => {
		const series = buildWaistSeries([]);
		expect(series.points).toEqual([]);
		expect(series.latest).toBeNull();
		expect(series.nadir).toBeNull();
		expect(series.range).toBeNull();
	});
});

describe('waistTrendSegments', () => {
	it('bryter linja over en lang pause', () => {
		const before = weekly([96, 95.5, 95, 94.5]);
		const after = weekly([93, 92.5, 92, 91.5], 100);
		const series = buildWaistSeries(dailyWaist([...before, ...after]));
		expect(waistTrendSegments(series.points).length).toBeGreaterThan(1);
	});

	it('holder sammen en serie uten hull', () => {
		const series = buildWaistSeries(dailyWaist(weekly([96, 95.5, 95, 94.5, 94])));
		expect(waistTrendSegments(series.points)).toHaveLength(1);
	});
});

describe('waistToHeightRatio', () => {
	it('regner forholdet', () => {
		expect(waistToHeightRatio(94, 188)).toBe(0.5);
	});

	it('gir null framfor et gjettet tall når høyden mangler', () => {
		expect(waistToHeightRatio(94, null)).toBeNull();
		expect(waistToHeightRatio(null, 188)).toBeNull();
		expect(waistToHeightRatio(94, 0)).toBeNull();
	});
});

describe('waistChange', () => {
	it('måler på trenden, ikke på rå målinger', () => {
		// 20 uker med jevn nedgang: 0,25 cm i uka.
		const values = Array.from({ length: 20 }, (_, i) => 100 - i * 0.25);
		const series = buildWaistSeries(dailyWaist(weekly(values)));
		const change = waistChange(series.points, 90);
		expect(change.deltaCm).toBeLessThan(0);
		expect(change.spanDays).toBeGreaterThanOrEqual(90);
	});

	it('flagger en endring som er mindre enn båndets egen feil', () => {
		const values = Array.from({ length: 20 }, () => 94);
		const series = buildWaistSeries(dailyWaist(weekly(values)));
		const change = waistChange(series.points, 90);
		expect(change.deltaCm).toBe(0);
		expect(change.withinNoise).toBe(true);
	});

	it('gir null når historikken ikke rekker vinduet', () => {
		const series = buildWaistSeries(dailyWaist(weekly([96, 95.5, 95, 94.5])));
		const change = waistChange(series.points, 90);
		expect(change.deltaCm).toBeNull();
		expect(change.spanDays).toBeNull();
	});

	it('bruker et referansepunkt som er minst så gammelt som vinduet', () => {
		const values = Array.from({ length: 20 }, (_, i) => 100 - i * 0.25);
		const series = buildWaistSeries(dailyWaist(weekly(values)));
		// Aldri kortere enn det som ble spurt om — ellers underrapporteres endringen.
		expect(waistChange(series.points, 90).spanDays!).toBeGreaterThanOrEqual(90);
	});
});

describe('summarizeWaist', () => {
	const height = 188;

	it('ber om den første målingen når det ikke finnes noen', () => {
		const status = summarizeWaist([], { heightCm: height, today: date(0) });
		expect(status.due).toBe(true);
		expect(status.latestCm).toBeNull();
		expect(status.measurementsUntilTrend).toBe(WAIST_MIN_TREND_SAMPLES);
	});

	it('sier hvor mange målinger som gjenstår før trenden kan regnes', () => {
		const days = dailyWaist(weekly([96]));
		const status = summarizeWaist(days, { heightCm: height, today: date(0) });
		expect(status.measurementsUntilTrend).toBe(WAIST_MIN_TREND_SAMPLES - 1);
	});

	it('er ikke due dagen etter en måling', () => {
		const days = dailyWaist(weekly([96]));
		const status = summarizeWaist(days, { heightCm: height, today: date(1) });
		expect(status.due).toBe(false);
	});

	it('er due igjen etter en uke', () => {
		const days = dailyWaist(weekly([96]));
		const status = summarizeWaist(days, { heightCm: height, today: date(WAIST_CADENCE_DAYS) });
		expect(status.due).toBe(true);
	});

	it('merker en gammel serie som avbrutt', () => {
		const days = dailyWaist(weekly([96, 95.5, 95]));
		const status = summarizeWaist(days, {
			heightCm: height,
			today: date(14 + WAIST_STALE_DAYS + 1)
		});
		expect(status.stale).toBe(true);
	});

	it('sier fra at høyden mangler framfor å skjule forholdstallet', () => {
		const days = dailyWaist(weekly([94]));
		const status = summarizeWaist(days, { heightCm: null, today: date(0) });
		expect(status.whtr).toBeNull();
		expect(status.heightMissing).toBe(true);
	});

	it('regner forholdstallet av siste måling', () => {
		const days = dailyWaist(weekly([94]));
		const status = summarizeWaist(days, { heightCm: 188, today: date(0) });
		expect(status.whtr).toBe(0.5);
	});
});

describe('waistAxis', () => {
	it('holder gulvet når livvidda nesten ikke beveget seg', () => {
		const series = buildWaistSeries(dailyWaist(weekly([94, 94.2, 94.1, 94, 93.9])));
		const axis = waistAxis(series)!;
		expect(axis.max - axis.min).toBeGreaterThanOrEqual(MIN_WAIST_AXIS_SPAN_CM);
		expect(axis.spanFloored).toBe(true);
	});

	it('lar aksen følge dataene når spennet er stort nok', () => {
		const series = buildWaistSeries(dailyWaist(weekly([104, 102, 100, 98, 96, 94])));
		const axis = waistAxis(series)!;
		expect(axis.spanFloored).toBe(false);
		expect(axis.min).toBeLessThanOrEqual(94);
		expect(axis.max).toBeGreaterThanOrEqual(104);
	});

	it('gir hele aksetall', () => {
		const series = buildWaistSeries(dailyWaist(weekly([104, 102, 100, 98])));
		for (const tick of waistAxis(series)!.ticks) {
			expect(Number.isInteger(tick)).toBe(true);
		}
	});

	it('gir null uten data', () => {
		expect(waistAxis(buildWaistSeries([]))).toBeNull();
	});
});

describe('støygulvet', () => {
	it('er stort nok til å dekke båndfeilen', () => {
		// Målefeilen er 1–2 cm. Et gulv under 1 ville latt flaten rapportere
		// «ned 0,4 cm» som om båndet var mer presist enn det er.
		expect(WAIST_NOISE_CM).toBeGreaterThanOrEqual(1);
	});
});
