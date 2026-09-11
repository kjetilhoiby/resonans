import { describe, it, expect } from 'vitest';
import {
	BASELINE_DAYS,
	buildEpisodeTrack,
	buildEpisodeWindow,
	buildSymptomBars,
	describeEpisode,
	describeLevelCourse,
	episodeAxis,
	describeNormalStanding,
	describeReturn,
	describeReturnSummary,
	episodeSleepByDay,
	findRelapse,
	formatEpisodeValue,
	type EpisodeTrackSpec
} from './sick-episode';
import { resolveSymptom, type Symptom } from './symptoms';

const TODAY = '2026-09-10';

const openPeriod = { id: 'p1', startDate: '2026-09-01', endDate: null, note: null };
const closedPeriod = { id: 'p2', startDate: '2026-09-01', endDate: '2026-09-05', note: null };

const weightSpec: EpisodeTrackSpec = {
	id: 'weight',
	label: 'Vekt',
	unit: 'kg',
	source: null,
	decimals: 1,
	notableDirection: null
};

describe('buildEpisodeWindow', () => {
	it('legger baselinedagene foran og sykedagene etter', () => {
		const w = buildEpisodeWindow(openPeriod, TODAY);

		expect(w.baselineKeys).toHaveLength(BASELINE_DAYS);
		expect(w.baselineKeys[0]).toBe('2026-08-18');
		expect(w.baselineKeys[BASELINE_DAYS - 1]).toBe('2026-08-31');
		expect(w.onsetIndex).toBe(BASELINE_DAYS);
		expect(w.days[w.onsetIndex]?.day).toBe('2026-09-01');
		expect(w.sickKeys).toHaveLength(10);
		expect(w.length).toBe(10);
		expect(w.open).toBe(true);
	});

	it('nummererer sykedagene fra 1, og lar de andre dagene stå uten nummer', () => {
		const w = buildEpisodeWindow(openPeriod, TODAY);

		expect(w.days[w.onsetIndex]?.dayOfEpisode).toBe(1);
		expect(w.days[w.onsetIndex + 4]?.dayOfEpisode).toBe(5);
		expect(w.days[0]?.dayOfEpisode).toBeNull();
	});

	it('tar med dagene ETTER en avsluttet periode, så man ser om tallene kom tilbake', () => {
		const w = buildEpisodeWindow(closedPeriod, TODAY);

		expect(w.sickKeys).toEqual([
			'2026-09-01',
			'2026-09-02',
			'2026-09-03',
			'2026-09-04',
			'2026-09-05'
		]);
		// Fem dager etter sluttdatoen, fordi i dag er 10. og taket er sju.
		expect(w.days[w.days.length - 1]?.day).toBe('2026-09-10');
		expect(w.days.filter((d) => !d.sick && d.day > '2026-09-05')).toHaveLength(5);
	});

	it('strekker seg aldri fram i tid', () => {
		const future = { id: 'p3', startDate: '2026-09-08', endDate: '2026-09-30', note: null };
		const w = buildEpisodeWindow(future, TODAY);

		expect(w.days[w.days.length - 1]?.day).toBe(TODAY);
	});
});

describe('buildEpisodeTrack', () => {
	const window = buildEpisodeWindow(openPeriod, TODAY);

	it('måler sykedagene mot medianen av dagene rett før', () => {
		const byDay = new Map<string, number>([
			['2026-08-28', 95.0],
			['2026-08-29', 94.8],
			['2026-08-30', 95.2],
			['2026-08-31', 95.0],
			['2026-09-02', 94.0],
			['2026-09-04', 93.6],
			['2026-09-06', 93.4]
		]);

		const track = buildEpisodeTrack(weightSpec, byDay, window);

		expect(track.baseline).toBe(95.0);
		expect(track.baselineSamples).toBe(4);
		// Medianen av 94,0 / 93,6 / 93,4 — ikke den første eller siste målingen.
		expect(track.during).toBe(93.6);
		expect(track.delta).toBeCloseTo(-1.4, 5);
		expect(track.text).toBe('93,6 kg under forløpet, 1,4 kg under de 14 dagene før (95,0).');
	});

	it('lar dager uten måling være null, ikke 0', () => {
		const byDay = new Map<string, number>([['2026-09-02', 94]]);
		const track = buildEpisodeTrack(weightSpec, byDay, window);

		const onset = track.points[window.onsetIndex];
		expect(onset?.value).toBeNull();
		expect(track.points[window.onsetIndex + 1]?.value).toBe(94);
		expect(track.points.every((p) => p.value === null || p.value === 94)).toBe(true);
	});

	it('rapporterer dekning over sykedagene', () => {
		const byDay = new Map<string, number>([
			['2026-09-01', 94],
			['2026-09-02', 94],
			['2026-09-03', 94],
			['2026-09-04', 94],
			['2026-09-05', 94]
		]);
		const track = buildEpisodeTrack(weightSpec, byDay, window);

		expect(track.measuredSickDays).toBe(5);
		expect(track.sickDays).toBe(10);
		expect(track.coverage).toBe(0.5);
	});

	it('nekter å oppgi et avvik når baselinen er for tynn', () => {
		const byDay = new Map<string, number>([
			['2026-08-30', 95],
			['2026-08-31', 95],
			['2026-09-02', 94]
		]);
		const track = buildEpisodeTrack(weightSpec, byDay, window);

		expect(track.baseline).toBeNull();
		expect(track.delta).toBeNull();
		expect(track.text).toContain('Ingen baseline å måle mot');
		expect(track.text).toContain('2 målinger før');
	});

	it('sier ingenting når ingen sykedager er målt', () => {
		const byDay = new Map<string, number>([
			['2026-08-29', 95],
			['2026-08-30', 95],
			['2026-08-31', 95]
		]);
		const track = buildEpisodeTrack(weightSpec, byDay, window);

		expect(track.during).toBeNull();
		expect(track.text).toBeNull();
	});

	it('måler avviket mot baselinen, aldri mot forløpets egen verdi', () => {
		const skinSpec: EpisodeTrackSpec = {
			id: 'skinTemperature',
			label: 'Hudtemperatur',
			unit: '°C',
			source: 'klokka',
			decimals: 1,
			notableDirection: 'up',
			absoluteIsMeaningless: true
		};
		const byDay = new Map<string, number>([
			['2026-08-29', 34.0],
			['2026-08-30', 34.2],
			['2026-08-31', 34.1],
			['2026-09-02', 34.8]
		]);
		const track = buildEpisodeTrack(skinSpec, byDay, window);

		// Baselinen NAVNGIS — det er det som gir «0,7» en skala. Men verdien
		// under forløpet (34,8) står ikke: det er den som ville blitt lest som
		// en måling med en betydning i seg selv.
		expect(track.text).toBe('0,7 °C over de 14 dagene før (34,1).');
		expect(track.text).not.toContain('34,8');
	});

	it('sier fra framfor å falle tilbake på råtallet når baselinen mangler', () => {
		const skinSpec: EpisodeTrackSpec = {
			id: 'skinTemperature',
			label: 'Hudtemperatur',
			unit: '°C',
			source: 'klokka',
			decimals: 1,
			notableDirection: 'up',
			absoluteIsMeaningless: true
		};
		const byDay = new Map<string, number>([['2026-09-02', 34.8]]);
		const track = buildEpisodeTrack(skinSpec, byDay, window);

		expect(track.text).toBe('Målt under forløpet, men ikke noe å måle mot — ingen målinger de siste to ukene før.');
		expect(track.text).not.toContain('34,8');
	});

	it('kaller en forskjell under visningsoppløsningen uendret', () => {
		const byDay = new Map<string, number>([
			['2026-08-29', 95.0],
			['2026-08-30', 95.0],
			['2026-08-31', 95.0],
			['2026-09-02', 95.02]
		]);
		const track = buildEpisodeTrack(weightSpec, byDay, window);

		expect(track.text).toContain('uendret');
	});
});

describe('notableDirection', () => {
	const window = buildEpisodeWindow(openPeriod, TODAY);

	// Regelen selv bor i flaten (fargen), men fortegnet den leser kommer herfra.
	// HRV er den første raden der FALLET er signalet, og en «stiger»-boolean
	// ville markert den motsatt av sovepuls uten at noe sa fra.
	it('gir et negativt avvik for en rad som faller under forløpet', () => {
		const hrvSpec: EpisodeTrackSpec = {
			id: 'hrv',
			label: 'HRV',
			unit: 'ms',
			source: 'SDNN gjennom natta',
			decimals: 0,
			notableDirection: 'down',
			absoluteIsMeaningless: true
		};
		const byDay = new Map<string, number>([
			['2026-08-28', 46],
			['2026-08-29', 44],
			['2026-08-31', 45],
			['2026-09-02', 33],
			['2026-09-04', 35]
		]);
		const track = buildEpisodeTrack(hrvSpec, byDay, window);

		expect(track.delta).toBeLessThan(0);
		// «11 ms under» uten et tall å måle mot er ingenting: mot 45 er det en
		// fjerdedel, mot 22 er det halvparten. Baselinen er eneste ærlige
		// referanse — en normtabell for SDNN finnes ikke.
		expect(track.text).toBe('11 ms under de 14 dagene før (45).');
		// Forløpets egen verdi står fortsatt ikke.
		expect(track.text).not.toContain('33');
	});
});

describe('findRelapse', () => {
	const at = (day: string, level: number) => ({ day, level });

	it('finner bedringen som snudde', () => {
		const relapse = findRelapse([
			at('2026-09-01', 2),
			at('2026-09-03', 3),
			at('2026-09-05', 4),
			at('2026-09-08', 2)
		]);

		expect(relapse).toEqual({
			peakDay: '2026-09-05',
			peakLevel: 4,
			troughDay: '2026-09-08',
			troughLevel: 2
		});
	});

	it('kaller ikke ett hakk ned et tilbakefall', () => {
		expect(findRelapse([at('2026-09-01', 3), at('2026-09-03', 4), at('2026-09-05', 3)])).toBeNull();
	});

	it('krever at det HAR vært en bedring — en jevn nedtur er ikke et tilbakefall', () => {
		expect(findRelapse([at('2026-09-01', 4), at('2026-09-03', 3), at('2026-09-05', 2)])).toBeNull();
	});

	it('holder kjeft under tre innsjekk', () => {
		expect(findRelapse([at('2026-09-01', 4), at('2026-09-05', 1)])).toBeNull();
	});
});

describe('describeLevelCourse', () => {
	const at = (day: string, level: number) => ({ day, level });

	it('sier tilbakefallet med datoer', () => {
		const text = describeLevelCourse([
			at('2026-09-01', 2),
			at('2026-09-05', 4),
			at('2026-09-08', 2)
		]);

		expect(text).toBe('3 innsjekk. Opp til 4 av 5 5. sep, ned igjen til 2 8. sep. Sist 2.');
	});

	it('sier fra at grunnlaget er for tynt framfor å antyde en retning', () => {
		const text = describeLevelCourse([at('2026-09-01', 2), at('2026-09-05', 4)]);
		expect(text).toContain('For få til å si noe om retningen');
	});

	it('sier retningen når det ikke er noe tilbakefall', () => {
		const text = describeLevelCourse([
			at('2026-09-01', 2),
			at('2026-09-03', 3),
			at('2026-09-05', 4)
		]);
		expect(text).toBe('3 innsjekk. Fra 2 til 4 av 5 — oppover.');
	});
});

describe('buildSymptomBars', () => {
	const window = buildEpisodeWindow(openPeriod, TODAY);
	const symptom = (over: Partial<Symptom>): Symptom => ({
		id: over.id ?? 's1',
		label: over.label ?? 'vondt i halsen',
		kind: over.kind ?? 'luftveier',
		severity: over.severity ?? 'merkbart',
		startDate: over.startDate ?? '2026-09-01',
		endDate: over.endDate ?? null,
		limiting: over.limiting ?? false,
		note: over.note ?? null
	});

	it('klipper til vinduet og merker begge kantene', () => {
		const s = resolveSymptom(symptom({ startDate: '2026-07-01' }), TODAY);
		const [bar] = buildSymptomBars([s], window);

		expect(bar?.fromIndex).toBe(0);
		expect(bar?.startsBefore).toBe(true);
		// Pågår fortsatt, så bjelken går til siste dag i vinduet — men vinduet
		// slutter i dag, så det er ikke en avkorting.
		expect(bar?.toIndex).toBe(window.days.length - 1);
		expect(bar?.endsAfter).toBe(false);
	});

	it('utelater symptomer som ikke overlapper vinduet', () => {
		const s = resolveSymptom(
			symptom({ startDate: '2026-01-01', endDate: '2026-01-10' }),
			TODAY
		);
		expect(buildSymptomBars([s], window)).toEqual([]);
	});

	it('setter det begrensende symptomet øverst', () => {
		const kne = resolveSymptom(
			symptom({ id: 'kne', label: 'ømt kne', startDate: '2026-08-20' }),
			TODAY
		);
		const hals = resolveSymptom(
			symptom({ id: 'hals', label: 'vondt i halsen', limiting: true }),
			TODAY
		);

		const bars = buildSymptomBars([kne, hals], window);
		expect(bars.map((b) => b.id)).toEqual(['hals', 'kne']);
	});
});

describe('describeEpisode', () => {
	it('sier «så langt» om en åpen periode', () => {
		const w = buildEpisodeWindow(openPeriod, TODAY);
		expect(describeEpisode(w, openPeriod.startDate)).toBe(
			'Dag 10 av forløpet, som startet 1. sep. Tallene er så langt.'
		);
	});

	it('sier lengden om en avsluttet periode', () => {
		const w = buildEpisodeWindow(closedPeriod, TODAY);
		expect(describeEpisode(w, closedPeriod.startDate)).toBe('5 dager fra 1. sep.');
	});

	it('ber om et sluttpunkt på en periode som har stått åpen for lenge', () => {
		const stale = { id: 'p4', startDate: '2026-08-01', endDate: null, note: null };
		const w = buildEpisodeWindow(stale, TODAY);
		expect(describeEpisode(w, stale.startDate)).toContain('sett et sluttpunkt');
	});
});

describe('episodeAxis', () => {
	const window = buildEpisodeWindow(openPeriod, TODAY);

	it('holder gulvet så tre hundre gram ikke tegnes som et stup', () => {
		const byDay = new Map<string, number>([
			['2026-08-29', 95.0],
			['2026-08-30', 95.1],
			['2026-08-31', 95.0],
			['2026-09-02', 94.8]
		]);
		const axis = episodeAxis(buildEpisodeTrack(weightSpec, byDay, window));

		expect(axis).not.toBeNull();
		expect(axis!.max - axis!.min).toBeGreaterThanOrEqual(1.5);
	});

	it('lar aksen følge dataene når de sprenger gulvet', () => {
		const byDay = new Map<string, number>([
			['2026-08-29', 95],
			['2026-08-30', 95],
			['2026-08-31', 95],
			['2026-09-02', 85]
		]);
		const axis = episodeAxis(buildEpisodeTrack(weightSpec, byDay, window));

		expect(axis!.max - axis!.min).toBeGreaterThan(10);
	});

	it('gir baselinen plass i domenet', () => {
		const byDay = new Map<string, number>([
			['2026-08-29', 100],
			['2026-08-30', 100],
			['2026-08-31', 100],
			['2026-09-02', 90]
		]);
		const track = buildEpisodeTrack(weightSpec, byDay, window);
		const axis = episodeAxis(track);

		expect(axis!.min).toBeLessThanOrEqual(track.baseline!);
		expect(axis!.max).toBeGreaterThanOrEqual(track.baseline!);
	});

	it('låser nivåskalaen til 1–5', () => {
		const levelSpec: EpisodeTrackSpec = {
			id: 'level',
			label: 'Nivå',
			unit: 'av 5',
			source: null,
			decimals: 0,
			notableDirection: null
		};
		const byDay = new Map<string, number>([
			['2026-09-01', 2],
			['2026-09-03', 3]
		]);
		expect(episodeAxis(buildEpisodeTrack(levelSpec, byDay, window))).toEqual({ min: 1, max: 5 });
	});

	it('gir forløpsmedianen plass i domenet', () => {
		const byDay = new Map<string, number>([
			['2026-08-29', 100],
			['2026-08-30', 100],
			['2026-08-31', 100],
			['2026-09-02', 90],
			['2026-09-03', 90]
		]);
		const track = buildEpisodeTrack(weightSpec, byDay, window);
		const axis = episodeAxis(track);

		expect(track.during).not.toBeNull();
		expect(axis!.min).toBeLessThanOrEqual(track.during!);
		expect(axis!.max).toBeGreaterThanOrEqual(track.during!);
	});

	it('gir null når raden ikke har et eneste punkt', () => {
		expect(episodeAxis(buildEpisodeTrack(weightSpec, new Map(), window))).toBeNull();
	});
});

describe('accumulates — dagen som ikke er omme', () => {
	const window = buildEpisodeWindow(openPeriod, TODAY);

	const stepsSpec: EpisodeTrackSpec = {
		id: 'steps',
		label: 'Skritt',
		unit: 'skritt',
		source: 'fra klokka',
		decimals: 0,
		notableDirection: 'down',
		accumulates: true
	};

	// Kl. 08 står dagens teller på nesten ingenting. Alle disse dagene er
	// ekte døgn unntatt den siste, som er TODAY.
	const byDay = new Map<string, number>([
		['2026-09-01', 4200],
		['2026-09-03', 3800],
		['2026-09-05', 4600],
		['2026-09-08', 4000],
		[TODAY, 0]
	]);

	it('lar ikke dagens uferdige teller bli overskriften', () => {
		// Feilen i prod: «0 skritt» som overskrift ved siden av en setning som
		// sa 1 950 under forløpet.
		const track = buildEpisodeTrack(stepsSpec, byDay, window);

		expect(track.latest).toBe(4000);
		expect(track.latestDay).toBe('2026-09-08');
	});

	it('holder dagens tall utenfor medianen', () => {
		const track = buildEpisodeTrack(stepsSpec, byDay, window);

		// Median av 4200, 3800, 4600, 4000 — uten nullen.
		expect(track.during).toBe(4100);
	});

	it('tegner ingen bunn på dagen som ikke er omme', () => {
		const track = buildEpisodeTrack(stepsSpec, byDay, window);
		const todayPoint = track.points.find((p) => p.day === TODAY);

		// En 0 her ville vært en falsk bunn i kurven, ikke bare i tallet.
		expect(todayPoint?.value).toBeNull();
	});

	it('teller ikke dagen i nevneren, og sier fra', () => {
		const track = buildEpisodeTrack(stepsSpec, byDay, window);

		// «4 av 5 målt» ville påstått at en måling mangler. Den gjør ikke det;
		// døgnet er bare ikke ferdig.
		expect(track.measuredSickDays).toBe(4);
		expect(track.sickDays).toBe(window.sickKeys.length - 1);
		expect(track.todayExcluded).toBe(true);
	});

	it('rører ikke en rad som ikke akkumulerer', () => {
		// Vekt måles på et punkt: morgenens veiing er ferdig når den er tatt.
		const track = buildEpisodeTrack(weightSpec, byDay, window);

		expect(track.latest).toBe(0);
		expect(track.todayExcluded).toBe(false);
		expect(track.sickDays).toBe(window.sickKeys.length);
	});
});

describe('normalområdet i raden', () => {
	const window = buildEpisodeWindow(openPeriod, TODAY);

	const hrvSpec: EpisodeTrackSpec = {
		id: 'hrv',
		label: 'HRV',
		unit: 'ms',
		source: 'SDNN gjennom natta',
		decimals: 0,
		notableDirection: 'down',
		absoluteIsMeaningless: true
	};

	/** 60 friske netter rundt 61 ms, bånd omtrent 53–69. */
	const friske = Array.from({ length: 60 }, (_, i) => 61 + Math.sin(i * 1.7) * 8);

	it('sier hvor langt utenfor forløpet ligger, i brukerens egen skala', () => {
		const byDay = new Map<string, number>([
			['2026-08-29', 60],
			['2026-08-30', 62],
			['2026-08-31', 61],
			['2026-09-02', 44],
			['2026-09-04', 43]
		]);
		const track = buildEpisodeTrack(hrvSpec, byDay, window, friske);

		expect(track.normal).not.toBeNull();
		expect(track.normal!.duringInside).toBe(false);
		// Persentilen er poenget: «lavere enn N %» trenger ingen skala ved
		// siden av seg for å leses.
		expect(track.normalText).toContain('Utenfor ditt vanlige');
		expect(track.normalText).toMatch(/lavere enn \d+ % av dem/);
	});

	it('sier «innenfor» uten å oppgi en persentil', () => {
		// «Høyere enn 43 % av» betyr «midt i normalen» — en presisjon uten
		// innhold.
		const byDay = new Map<string, number>([
			['2026-08-29', 60],
			['2026-08-30', 62],
			['2026-08-31', 61],
			['2026-09-02', 60],
			['2026-09-04', 62]
		]);
		const track = buildEpisodeTrack(hrvSpec, byDay, window, friske);

		expect(track.normal!.duringInside).toBe(true);
		expect(track.normalText).toContain('Innenfor ditt vanlige');
		expect(track.normalText).not.toMatch(/% av dem/);
	});

	it('tier helt uten nok friske dager', () => {
		const byDay = new Map<string, number>([['2026-09-02', 44]]);
		const track = buildEpisodeTrack(hrvSpec, byDay, window, [61, 62, 60]);

		expect(track.normal).toBeNull();
		expect(track.normalText).toBeNull();
		expect(track.returnText).toBeNull();
	});

	it('sier fra når de ferskeste målingene er tilbake', () => {
		const byDay = new Map<string, number>([
			['2026-09-01', 44],
			['2026-09-02', 43],
			['2026-09-08', 60],
			['2026-09-09', 61],
			['2026-09-10', 62]
		]);
		const track = buildEpisodeTrack(hrvSpec, byDay, window, friske);

		expect(track.normal!.recentInside).toBe(true);
		expect(track.returnText).toBe('Siste målinger er tilbake i ditt vanlige.');
	});

	it('skiller «på vei mot» fra «fortsatt utenfor»', () => {
		// Forløpsmedianen dekker HELE perioden, så de bedrede dagene må være få
		// nok til at medianen fortsatt ligger lavt — ellers sammenligner
		// retningen halen med seg selv.
		const byDay = new Map<string, number>([
			['2026-09-01', 40],
			['2026-09-02', 41],
			['2026-09-03', 40],
			['2026-09-04', 42],
			['2026-09-05', 41],
			['2026-09-06', 40],
			['2026-09-09', 50],
			['2026-09-10', 51]
		]);
		const track = buildEpisodeTrack(hrvSpec, byDay, window, friske);

		expect(track.normal!.recentInside).toBe(false);
		expect(track.returnText).toBe('Fortsatt utenfor, men på vei mot.');
	});
});

describe('describeReturnSummary', () => {
	const band = { low: 50, high: 70, median: 60, samples: 60, duringInside: false, duringRank: 0 };

	const rad = (label: string, inside: boolean | null, dir: 'up' | 'down' | null = 'down') => ({
		label,
		notableDirection: dir,
		normal: { ...band, recentInside: inside, direction: null }
	});

	it('teller bare rader med en retning', () => {
		// Nivå og vekt har ingen — nivået ER forløpet, og vekt bærer sitt eget
		// forbehold.
		const text = describeReturnSummary([
			rad('HRV', true),
			rad('Sovepuls', false),
			rad('Vekt', false, null)
		]);

		expect(text).toContain('1 av 2');
		expect(text).not.toContain('vekt');
	});

	it('navngir hva som fortsatt er utenfor', () => {
		const text = describeReturnSummary([rad('HRV', false), rad('Søvn', true)]);

		expect(text).toContain('Utenfor: hrv');
	});

	it('sier alltid at tallene ikke er en klarering', () => {
		// Den ene setningen som ikke får falle bort: et tall som leses som en
		// klarering er verre enn intet tall.
		for (const t of [
			describeReturnSummary([rad('HRV', true)]),
			describeReturnSummary([rad('HRV', false)]),
			describeReturnSummary([rad('HRV', true), rad('Søvn', false)])
		]) {
			expect(t).toContain('om kroppen tåler belastning');
		}
	});

	it('gir null når ingen rad har et normalområde', () => {
		expect(
			describeReturnSummary([{ label: 'HRV', notableDirection: 'down', normal: null }])
		).toBeNull();
	});
});

describe('formatEpisodeValue', () => {
	it('setter tusenskille på heltall', () => {
		// Skritt er den eneste raden som når fire sifre, og «8240» leses ikke som
		// et antall i en kolonne der naboene er «49» og «6,8».
		expect(formatEpisodeValue(8240, 0)).toBe('8\u00A0240');
		expect(formatEpisodeValue(12400, 0)).toBe('12\u00A0400');
	});

	it('lar tresifrede heltall stå urørt', () => {
		// Puls topper på ~200 og nivået går til 5 — ingen av dem skal få skille.
		expect(formatEpisodeValue(49, 0)).toBe('49');
		expect(formatEpisodeValue(192, 0)).toBe('192');
	});

	it('grupperer ikke desimaltall', () => {
		// Regelen henger på decimals, ikke på størrelsen: et desimaltall i denne
		// modulen er kg, timer eller grader, og de når aldri fire sifre.
		expect(formatEpisodeValue(6.8, 1)).toBe('6,8');
		expect(formatEpisodeValue(94.25, 2)).toBe('94,25');
	});

	it('holder skillet unna minustegnet', () => {
		expect(formatEpisodeValue(-3100, 0)).toBe('-3\u00A0100');
	});
});

describe('episodeSleepByDay', () => {
	it('legger duppen til natta samme døgn', () => {
		const byDay = episodeSleepByDay([
			{ date: '2026-09-02', hours: 6.1, isNap: false },
			{ date: '2026-09-02', hours: 2.4, isNap: true },
			{ date: '2026-09-03', hours: 7.2, isNap: false }
		]);

		expect(byDay.get('2026-09-02')).toBe(8.5);
		expect(byDay.get('2026-09-03')).toBe(7.2);
	});

	it('teller en dag med bare dupper', () => {
		// Den som ligger nede sover om dagen. En dag uten nattmåling er ikke en
		// dag uten søvn, og med dupper ute leste raden 0 der svaret var 3,5.
		const byDay = episodeSleepByDay([
			{ date: '2026-09-04', hours: 1.5, isNap: true },
			{ date: '2026-09-04', hours: 2.0, isNap: true }
		]);

		expect(byDay.get('2026-09-04')).toBe(3.5);
	});

	it('runder av så summen ikke får en flyttallshale', () => {
		const byDay = episodeSleepByDay([
			{ date: '2026-09-05', hours: 6.7, isNap: false },
			{ date: '2026-09-05', hours: 0.1, isNap: true }
		]);

		expect(byDay.get('2026-09-05')).toBe(6.8);
	});

	it('lar en dag uten måling være fraværende, ikke null', () => {
		const byDay = episodeSleepByDay([{ date: '2026-09-05', hours: 6.7, isNap: false }]);

		// Hull er hull. `buildEpisodeTrack` gjør fraværet til `null` i punktet;
		// en 0 her ville blitt lest som «sov ingenting».
		expect(byDay.has('2026-09-06')).toBe(false);
	});
});
