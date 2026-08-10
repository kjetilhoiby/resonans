import { describe, it, expect } from 'vitest';
import {
	aerobicDecoupling,
	efficiencyFactor,
	efficiencySeries,
	efficiencyTrend,
	qualifiesForEfficiency,
	EF_NOISE_SHARE,
	MAX_HARD_SHARE,
	MIN_DURATION_SEC,
	MIN_SAMPLES_PER_HALF,
	MIN_SESSIONS_FOR_TREND,
	type DecouplingSample,
	type EfficiencySession
} from './aerobic-efficiency';

const NOW = new Date('2026-08-11T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

function session(overrides: Partial<EfficiencySession> = {}): EfficiencySession {
	return {
		startTime: NOW,
		sportFamily: 'running',
		gapSecPerKm: 300, // 5:00/km → 200 m/min
		avgHeartRate: 150,
		durationSeconds: 45 * 60,
		hardShare: 0.1,
		...overrides
	};
}

describe('qualifiesForEfficiency', () => {
	it('godtar en jevn løpeøkt med puls og bakkekorrigert tempo', () => {
		expect(qualifiesForEfficiency(session())).toBe(true);
	});

	it('avviser sykling — der måler fart per slag utstyret, ikke deg', () => {
		expect(qualifiesForEfficiency(session({ sportFamily: 'cycling' }))).toBe(false);
	});

	it('avviser en intervalløkt', () => {
		expect(qualifiesForEfficiency(session({ hardShare: MAX_HARD_SHARE + 0.1 }))).toBe(false);
	});

	it('avviser en for kort økt — oppvarmingen ville dominert', () => {
		expect(qualifiesForEfficiency(session({ durationSeconds: MIN_DURATION_SEC - 60 }))).toBe(false);
	});

	it('avviser økter uten puls eller uten bakkekorrigert tempo', () => {
		expect(qualifiesForEfficiency(session({ avgHeartRate: null }))).toBe(false);
		expect(qualifiesForEfficiency(session({ gapSecPerKm: null }))).toBe(false);
	});

	it('slipper gjennom en økt uten sonedata — ellers tømmes serien for eldre økter', () => {
		expect(qualifiesForEfficiency(session({ hardShare: null }))).toBe(true);
	});
});

describe('efficiencyFactor', () => {
	it('regner meter per minutt per slag', () => {
		// 5:00/km = 200 m/min, puls 150 → 1,333
		expect(efficiencyFactor(session())).toBeCloseTo(200 / 150, 4);
	});

	it('gir høyere EF for samme fart på lavere puls', () => {
		const før = efficiencyFactor(session({ avgHeartRate: 160 })) as number;
		const nå = efficiencyFactor(session({ avgHeartRate: 145 })) as number;
		expect(nå).toBeGreaterThan(før);
	});

	it('bruker bakkekorrigert tempo, ikke rått', () => {
		// Samme økt, men GAP sier at terrenget var tungt → høyere EF.
		const flatt = efficiencyFactor(session({ gapSecPerKm: 300 })) as number;
		const kupert = efficiencyFactor(session({ gapSecPerKm: 270 })) as number;
		expect(kupert).toBeGreaterThan(flatt);
	});

	it('gir null for en økt som ikke kvalifiserer', () => {
		expect(efficiencyFactor(session({ sportFamily: 'cycling' }))).toBeNull();
	});
});

describe('efficiencySeries', () => {
	it('sorterer eldst først og hopper over økter som ikke kvalifiserer', () => {
		const points = efficiencySeries([
			session({ startTime: new Date(NOW.getTime() - 2 * DAY) }),
			session({ startTime: new Date(NOW.getTime() - 10 * DAY), sportFamily: 'cycling' }),
			session({ startTime: new Date(NOW.getTime() - 5 * DAY) })
		]);

		expect(points).toHaveLength(2);
		expect(points[0].date.getTime()).toBeLessThan(points[1].date.getTime());
	});
});

describe('efficiencyTrend', () => {
	/** n økter med gitt puls, jevnt fordelt i et 28-dagersvindu som ender `endDaysAgo` dager før nå. */
	function block(n: number, hr: number, endDaysAgo: number): EfficiencySession[] {
		return Array.from({ length: n }, (_, i) =>
			session({
				startTime: new Date(NOW.getTime() - (endDaysAgo + i * 5) * DAY),
				avgHeartRate: hr
			})
		);
	}

	it('melder framgang når pulsen har falt for samme fart', () => {
		// Nå: puls 143. For åtte uker siden: puls 155.
		const points = efficiencySeries([...block(4, 143, 1), ...block(4, 155, 57)]);
		const trend = efficiencyTrend(points, NOW);

		expect(trend.direction).toBe('bedre');
		expect(trend.changeShare).toBeGreaterThan(EF_NOISE_SHARE);
		expect(trend.insufficient).toBe(false);
	});

	it('melder tilbakegang når pulsen har steget', () => {
		const points = efficiencySeries([...block(4, 158, 1), ...block(4, 145, 57)]);
		expect(efficiencyTrend(points, NOW).direction).toBe('dårligere');
	});

	it('kaller en endring under støygulvet uendret', () => {
		// 150 → 149 er ~0,7 %, godt under gulvet på 3 %.
		const points = efficiencySeries([...block(4, 149, 1), ...block(4, 150, 57)]);
		const trend = efficiencyTrend(points, NOW);

		expect(trend.direction).toBe('uendret');
		expect(Math.abs(trend.changeShare as number)).toBeLessThan(EF_NOISE_SHARE);
	});

	it('nekter å konkludere på for få økter', () => {
		const points = efficiencySeries([
			...block(MIN_SESSIONS_FOR_TREND - 2, 143, 1),
			...block(4, 155, 57)
		]);
		const trend = efficiencyTrend(points, NOW);

		expect(trend.insufficient).toBe(true);
		expect(trend.direction).toBe('ukjent');
	});

	it('sier ukjent når det ikke finnes noe å sammenligne med', () => {
		const trend = efficiencyTrend(efficiencySeries(block(4, 143, 1)), NOW);
		expect(trend.direction).toBe('ukjent');
		expect(trend.previous).toBeNull();
	});

	it('bruker medianen, så én tur i tretti grader ikke flytter «vanlig»', () => {
		const normale = block(4, 145, 1);
		const varmedag = session({ startTime: new Date(NOW.getTime() - 3 * DAY), avgHeartRate: 185 });
		const medUtligger = efficiencyTrend(efficiencySeries([...normale, varmedag, ...block(4, 145, 57)]), NOW);

		expect(medUtligger.direction).toBe('uendret');
	});

	it('teller økter i hvert vindu', () => {
		const trend = efficiencyTrend(efficiencySeries([...block(4, 143, 1), ...block(5, 155, 57)]), NOW);
		expect(trend.currentCount).toBe(4);
		expect(trend.previousCount).toBe(5);
	});
});

describe('aerobicDecoupling', () => {
	/**
	 * Bygger en økt med konstant fart der pulsen stiger lineært fra `hrStart`
	 * til `hrEnd`.
	 */
	function steadyRun(hrStart: number, hrEnd: number, n = 120): DecouplingSample[] {
		return Array.from({ length: n }, (_, i) => ({
			tSec: i * 30,
			distanceM: i * 100, // 200 m/min hele veien
			hr: Math.round(hrStart + ((hrEnd - hrStart) * i) / (n - 1))
		}));
	}

	it('melder lav drift når pulsen holdt seg', () => {
		const result = aerobicDecoupling(steadyRun(150, 152));
		expect(result?.driftPct).toBeLessThan(5);
		expect(result?.good).toBe(true);
	});

	it('melder høy drift når pulsen dro oppover på samme fart', () => {
		const result = aerobicDecoupling(steadyRun(145, 175));
		expect(result?.driftPct).toBeGreaterThan(5);
		expect(result?.good).toBe(false);
	});

	it('gir negativ drift når pulsen falt — det er ikke en feil', () => {
		const result = aerobicDecoupling(steadyRun(170, 150));
		expect(result?.driftPct).toBeLessThan(0);
	});

	it('nekter å regne når en halvdel mangler puls', () => {
		const samples = steadyRun(150, 160).map((s, i) => (i > 60 ? { ...s, hr: null } : s));
		expect(aerobicDecoupling(samples)).toBeNull();
	});

	it('nekter å regne på for få punkter', () => {
		expect(aerobicDecoupling(steadyRun(150, 160, MIN_SAMPLES_PER_HALF))).toBeNull();
	});

	it('tåler en tom serie', () => {
		expect(aerobicDecoupling([])).toBeNull();
	});
});
