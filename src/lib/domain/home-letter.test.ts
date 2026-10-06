import { describe, it, expect } from 'vitest';
import {
	buildHomeLetter,
	joinNorwegian,
	letterGreeting,
	MAX_LINES_PER_LENS,
	type HomeLetterInput
} from './home-letter';
import type { DigestNugget } from './digest-nugget-rules';
import type { WeightNugget } from './health/weight-nugget-rules';

const base: HomeLetterInput = {
	today: '2026-10-06',
	hour: 8,
	sick: false,
	digest: [],
	weight: [],
	todayOpen: [],
	events: [],
	hoursSinceLastVisit: 2,
	sinceLastVisit: null
};

const nugget = (kind: DigestNugget['kind'], sentence: string): DigestNugget => ({ kind, headline: sentence, sentence });
const weight = (kind: WeightNugget['kind'], sentence: string): WeightNugget => ({ kind, headline: sentence, sentence });

describe('letterGreeting', () => {
	it('følger døgnet', () => {
		expect(letterGreeting(7)).toBe('God morgen.');
		expect(letterGreeting(13)).toBe('Hei.');
		expect(letterGreeting(20)).toBe('God kveld.');
		expect(letterGreeting(2)).toBe('Sent oppe.');
	});
});

describe('buildHomeLetter', () => {
	it('er tomt når reglene ikke har noe å si — et brev uten innhold lager ikke innhold', () => {
		expect(buildHomeLetter(base).lines).toEqual([]);
	});

	it('legger påminnelser i «venter» og tilstander i «status»', () => {
		const letter = buildHomeLetter({
			...base,
			digest: [nugget('streak-due', 'Løperekka forfaller i morgen.'), nugget('week-load', 'Uka er på plan.')]
		});
		expect(letter.lines.map((l) => [l.id, l.lens])).toEqual([
			['digest:streak-due', 'venter'],
			['digest:week-load', 'status']
		]);
	});

	it('tar bare den sterkeste vektsetningen inn, resten er valgt bort', () => {
		const letter = buildHomeLetter({
			...base,
			weight: [weight('month-change', 'September ble ned 1,2 kg.'), weight('weigh-in-streak', '27 av 30 dager.')]
		});
		expect(letter.lines.map((l) => l.id)).toEqual(['weight:month-change']);
		expect(letter.dropped.map((l) => l.id)).toEqual(['weight:weigh-in-streak']);
	});

	it(`kapper hver linse på ${MAX_LINES_PER_LENS} og viser resten som valgt bort`, () => {
		const letter = buildHomeLetter({
			...base,
			digest: [nugget('streak-due', 'a.'), nugget('carryover', 'b.')],
			todayOpen: ['Ring verkstedet', 'Handle'],
			events: [
				{ id: 'e1', title: 'Konsert', eventDate: '2026-10-09', startTime: '19:00', prep: [{ id: 'b', label: 'Barnevakt', done: false, doneAt: null }] }
			]
		});
		const venter = letter.lines.filter((l) => l.lens === 'venter');
		expect(venter).toHaveLength(MAX_LINES_PER_LENS);
		expect(venter.map((l) => l.id)).toEqual(['digest:streak-due', 'digest:carryover', 'event-prep:e1']);
		expect(letter.dropped.map((l) => l.id)).toEqual(['today-open']);
	});

	it('navngir det som mangler før et arrangement', () => {
		const letter = buildHomeLetter({
			...base,
			events: [
				{
					id: 'e1',
					title: 'Konsert',
					eventDate: '2026-10-09',
					startTime: '19:00',
					prep: [
						{ id: 'b', label: 'Barnevakt', done: false, doneAt: null },
						{ id: 't', label: 'Transport', done: false, doneAt: null },
						{ id: 'm', label: 'Middag før', done: true, doneAt: '2026-10-05' }
					]
				}
			]
		});
		expect(letter.lines[0].text).toBe('Om 3 dager: Konsert kl. 19:00. Mangler barnevakt og transport.');
	});

	it('nevner et arrangement uten åpne punkter bare når det er i dag eller i morgen', () => {
		const letter = buildHomeLetter({
			...base,
			events: [
				{ id: 'e1', title: 'Kamp', eventDate: '2026-10-07', startTime: null, prep: [] },
				{ id: 'e2', title: 'Teater', eventDate: '2026-10-12', startTime: '18:00', prep: [] }
			]
		});
		expect(letter.lines.map((l) => [l.text, l.lens])).toEqual([['I morgen: Kamp.', 'status']]);
	});

	it('sier «siden sist» bare etter et fravær, og bare når noe har skjedd', () => {
		const away = { ...base, hoursSinceLastVisit: 80, sinceLastVisit: { workouts: 2, distanceKm: 14.2 } };
		expect(buildHomeLetter(away).lines[0].text).toBe('Siden du var innom for 3 dager siden: 2 økter, 14 km.');
		expect(buildHomeLetter({ ...away, hoursSinceLastVisit: 5 }).lines).toEqual([]);
		expect(buildHomeLetter({ ...away, sinceLastVisit: { workouts: 0, distanceKm: 0 } }).lines).toEqual([]);
	});

	it('ber ikke om noe når brukeren er syk, og viser det reglene ellers ville sagt', () => {
		const letter = buildHomeLetter({ ...base, sick: true, digest: [nugget('streak-due', 'Løperekka forfaller.')] });
		expect(letter.lines.map((l) => l.id)).toEqual(['sick']);
		expect(letter.lines.every((l) => l.lens === 'status')).toBe(true);
		expect(letter.dropped.map((l) => l.id)).toEqual(['digest:streak-due']);
	});
});

describe('joinNorwegian', () => {
	it('binder med komma og «og»', () => {
		expect(joinNorwegian(['a'])).toBe('a');
		expect(joinNorwegian(['a', 'b', 'c'])).toBe('a, b og c');
	});
});
