import { describe, it, expect } from 'vitest';
import {
	MAX_SUSPECT_EXAMPLES,
	MIN_SESSIONS_FOR_VERDICT,
	WIDESPREAD_SHARE,
	buildHrTrustPeriods,
	describeHrTrust,
	type HrTrustSession
} from './hr-trust-periods';

/** Referansebrukeren: hvile 46, maks 179. Full reserve er 133 slag. */
const baseline = { restHr: 46, maxHr: 179 };

/** `n` økter i et gitt år, med samme puls. */
function year(y: number, n: number, avgHr: number | null, maxHr: number | null): HrTrustSession[] {
	return Array.from({ length: n }, (_, i) => ({
		// Spredt over året, så periodenøkkelen ikke hviler på én dato.
		startTime: new Date(Date.UTC(y, i % 12, 10, 12, 0, 0)),
		avgHr,
		maxHr
	}));
}

describe('buildHrTrustPeriods', () => {
	it('grupperer på Oslo-året, ikke på UTC', () => {
		// 31. desember kl. 23:30 Oslo er 22:30 UTC — samme år i begge. Men
		// 1. januar kl. 00:30 Oslo er 31. desember 23:30 UTC, altså året FØR i UTC.
		const periods = buildHrTrustPeriods(
			[{ startTime: new Date('2019-12-31T23:30:00Z'), avgHr: 140, maxHr: 165 }],
			baseline
		);
		expect(periods.map((p) => p.period)).toEqual(['2020']);
	});

	it('sier «for lite data» framfor å dømme på tre økter', () => {
		const periods = buildHrTrustPeriods(year(2021, 3, 140, 165), baseline);
		expect(periods[0].withHr).toBe(3);
		expect(periods[0].severity).toBe('for-lite-data');
	});

	it('kaller et rent år rent', () => {
		const periods = buildHrTrustPeriods(year(2022, 20, 140, 168), baseline);
		expect(periods[0].suspect).toBe(0);
		expect(periods[0].severity).toBe('ren');
	});

	it('finner beltet: et snitt som ikke kan være en puls', () => {
		// Snitt 215 gir hrr = (215 − 46) / 133 ≈ 1,27, altså over taket på 1,15.
		const periods = buildHrTrustPeriods(
			[...year(2014, 10, 215, 230), ...year(2014, 10, 140, 168)],
			baseline
		);
		expect(periods[0].suspectAvg).toBe(10);
		expect(periods[0].suspectMax).toBe(10);
		// Unionen, ikke summen: de ti øktene feiler på begge.
		expect(periods[0].suspect).toBe(10);
		expect(periods[0].suspectShare).toBeCloseTo(0.5, 3);
		expect(periods[0].severity).toBe('utbredt');
		expect(periods[0].peakHr).toBe(230);
	});

	it('skiller et enkeltavvik fra en ødelagt sensor', () => {
		// Én av tjue er 5 %, altså under terskelen på ti.
		const periods = buildHrTrustPeriods(
			[...year(2023, 19, 140, 168), ...year(2023, 1, 215, 168)],
			baseline
		);
		expect(periods[0].suspectShare).toBeLessThan(WIDESPREAD_SHARE);
		expect(periods[0].severity).toBe('enkeltavvik');
	});

	it('teller bare økter MED puls i nevneren', () => {
		const periods = buildHrTrustPeriods(
			[...year(2024, 10, null, null), ...year(2024, 10, 140, 168)],
			baseline
		);
		expect(periods[0].sessions).toBe(20);
		expect(periods[0].withHr).toBe(10);
		expect(periods[0].suspectShare).toBe(0);
	});

	it('lar en forkastet kurve løfte et ellers rent år', () => {
		const sessions = year(2015, 20, 140, 168);
		const periods = buildHrTrustPeriods(sessions, baseline, [
			{ period: '2015', usable: true, reasons: [] },
			{ period: '2015', usable: false, reasons: ['pinned'] }
		]);
		// Skalarene fant ingenting — kurven gjorde.
		expect(periods[0].suspect).toBe(0);
		expect(periods[0].curvesRejected).toBe(1);
		expect(periods[0].severity).toBe('enkeltavvik');
	});

	it('kaller et flertall forkastede kurver utbredt', () => {
		const periods = buildHrTrustPeriods(year(2016, 20, 140, 168), baseline, [
			{ period: '2016', usable: false, reasons: ['pinned'] },
			{ period: '2016', usable: false, reasons: ['implausible_values'] },
			{ period: '2016', usable: true, reasons: [] }
		]);
		expect(periods[0].severity).toBe('utbredt');
		expect(periods[0].curveReasons.pinned).toBe(1);
	});

	it('lar et funn i sporet overstyre «for lite data»', () => {
		// Én ødelagt kurve er et funn, også når skalarene er for tynne å dømme på —
		// men ETT funn er et enkeltavvik, ikke et utbredt problem.
		const periods = buildHrTrustPeriods(year(2013, 2, 140, 168), baseline, [
			{ period: '2013', usable: false, reasons: ['pinned'] }
		]);
		expect(periods[0].withHr).toBeLessThan(MIN_SESSIONS_FOR_VERDICT);
		expect(periods[0].severity).toBe('enkeltavvik');
	});

	it('krever nok kurver før et flertall betyr noe', () => {
		// Én forkastet av to er ikke et flertall å dømme et år på.
		const thin = buildHrTrustPeriods(year(2017, 20, 140, 168), baseline, [
			{ period: '2017', usable: false, reasons: ['pinned'] },
			{ period: '2017', usable: true, reasons: [] }
		]);
		expect(thin[0].severity).toBe('enkeltavvik');

		// Tre hentede kurver, to forkastet: nå er det et mønster.
		const enough = buildHrTrustPeriods(year(2017, 20, 140, 168), baseline, [
			{ period: '2017', usable: false, reasons: ['pinned'] },
			{ period: '2017', usable: false, reasons: ['pinned'] },
			{ period: '2017', usable: true, reasons: [] }
		]);
		expect(enough[0].severity).toBe('utbredt');
	});

	it('sorterer periodene kronologisk', () => {
		const periods = buildHrTrustPeriods(
			[...year(2022, 2, 140, 168), ...year(2014, 2, 140, 168), ...year(2018, 2, 140, 168)],
			baseline
		);
		expect(periods.map((p) => p.period)).toEqual(['2014', '2018', '2022']);
	});
});

describe('describeHrTrust', () => {
	it('bærer alltid forbeholdet om blindsonen', () => {
		const periods = buildHrTrustPeriods(year(2022, 20, 140, 168), baseline);
		const lines = describeHrTrust(periods);
		expect(lines.some((l) => l.includes('«ingen funn» betyr ikke «ren»'))).toBe(true);
	});

	it('navngir årene som ikke bør importeres', () => {
		const periods = buildHrTrustPeriods(year(2014, 20, 215, 230), baseline);
		const lines = describeHrTrust(periods);
		expect(lines[0]).toContain('2014');
		expect(lines[0]).toContain('bør ikke importeres');
	});

	it('sier at utvalget ikke beviser noe når det er rent', () => {
		const periods = buildHrTrustPeriods(year(2022, 20, 140, 168), baseline, [
			{ period: '2022', usable: true, reasons: [] }
		]);
		const lines = describeHrTrust(periods);
		expect(lines.some((l) => l.includes('beviser ikke'))).toBe(true);
	});

	it('svarer på et tomt datasett uten å kaste', () => {
		expect(describeHrTrust([])).toEqual(['Ingen økter å vurdere.']);
	});
});

describe('flaggede økter navngis', () => {
	/**
	 * «7 av 74» kan ikke handles på — og skillet snitt/maks avgjør hva som skjer:
	 * et umulig SNITT gjør at effort faller til MET for den økta, et umulig MAKS
	 * forurenser bare utledningen av makspuls.
	 */
	it('skiller et umulig snitt fra et umulig maks', () => {
		const periods = buildHrTrustPeriods(
			[
				// Snitt 215 er over taket på 1,15 × reserve; maks 168 er fint.
				{ startTime: new Date(Date.UTC(2026, 2, 3, 12)), avgHr: 215, maxHr: 168 },
				// Snitt 140 er fint; maks 237 er over MAX_PLAUSIBLE_HR.
				{ startTime: new Date(Date.UTC(2026, 3, 4, 12)), avgHr: 140, maxHr: 237 },
				...year(2026, 18, 140, 168)
			],
			baseline
		);
		const p = periods[0];
		expect(p.suspectAvg).toBe(1);
		expect(p.suspectMax).toBe(1);
		// To ulike økter, så unionen er to — ikke én, og ikke summen av noe annet.
		expect(p.suspect).toBe(2);

		const badAvgOnly = p.suspectExamples.find((e) => e.badAvg && !e.badMax);
		const badMaxOnly = p.suspectExamples.find((e) => e.badMax && !e.badAvg);
		expect(badAvgOnly?.date).toBe('2026-03-03');
		expect(badMaxOnly?.date).toBe('2026-04-04');
		expect(badMaxOnly?.maxHr).toBe(237);
	});

	it('teller resten framfor å liste alt', () => {
		const periods = buildHrTrustPeriods(year(2015, 10, 215, 228), baseline);
		expect(periods[0].suspect).toBe(10);
		expect(periods[0].suspectExamples).toHaveLength(MAX_SUSPECT_EXAMPLES);
	});

	it('lar en ren periode stå uten eksempler', () => {
		const periods = buildHrTrustPeriods(year(2022, 20, 140, 168), baseline);
		expect(periods[0].suspectExamples).toEqual([]);
	});

	it('sier i teksten at et umulig SNITT flytter effort til MET', () => {
		const lines = describeHrTrust(
			buildHrTrustPeriods(
				[{ startTime: new Date(Date.UTC(2026, 2, 3, 12)), avgHr: 215, maxHr: 168 }],
				baseline
			)
		);
		expect(lines.some((l) => l.includes('MET'))).toBe(true);
	});

	it('sier INGENTING om MET når bare maksen er umulig', () => {
		// Effort leser `avgHeartRate`, ikke maksen — en påstand om MET her ville
		// vært feil, og den ville sendt brukeren på jakt etter en effekt som ikke finnes.
		const lines = describeHrTrust(
			buildHrTrustPeriods(
				[{ startTime: new Date(Date.UTC(2026, 2, 3, 12)), avgHr: 140, maxHr: 237 }],
				baseline
			)
		);
		expect(lines.some((l) => l.includes('MET'))).toBe(false);
	});
});
