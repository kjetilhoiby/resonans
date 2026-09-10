import { describe, it, expect } from 'vitest';
import {
	BASELINE_DAYS,
	buildEpisodeTrack,
	buildEpisodeWindow,
	buildSymptomBars,
	describeEpisode,
	describeLevelCourse,
	episodeAxis,
	findRelapse,
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
	risingIsNotable: false
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

	it('viser aldri råtallet for en rad der det absolutte er meningsløst', () => {
		const skinSpec: EpisodeTrackSpec = {
			id: 'skinTemperature',
			label: 'Hudtemperatur',
			unit: '°C',
			source: 'klokka',
			decimals: 1,
			risingIsNotable: true,
			absoluteIsMeaningless: true
		};
		const byDay = new Map<string, number>([
			['2026-08-29', 34.0],
			['2026-08-30', 34.2],
			['2026-08-31', 34.1],
			['2026-09-02', 34.8]
		]);
		const track = buildEpisodeTrack(skinSpec, byDay, window);

		expect(track.text).toBe('0,7 °C over de 14 dagene før.');
		expect(track.text).not.toContain('34,8');
	});

	it('sier fra framfor å falle tilbake på råtallet når baselinen mangler', () => {
		const skinSpec: EpisodeTrackSpec = {
			id: 'skinTemperature',
			label: 'Hudtemperatur',
			unit: '°C',
			source: 'klokka',
			decimals: 1,
			risingIsNotable: true,
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
			risingIsNotable: false
		};
		const byDay = new Map<string, number>([
			['2026-09-01', 2],
			['2026-09-03', 3]
		]);
		expect(episodeAxis(buildEpisodeTrack(levelSpec, byDay, window))).toEqual({ min: 1, max: 5 });
	});

	it('gir null når raden ikke har et eneste punkt', () => {
		expect(episodeAxis(buildEpisodeTrack(weightSpec, new Map(), window))).toBeNull();
	});
});
