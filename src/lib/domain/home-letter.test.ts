import { describe, it, expect } from 'vitest';
import {
	buildHomeLetter,
	goalLine,
	joinNorwegian,
	letterGreeting,
	SECTION_CAPS,
	type HomeLetterInput,
	type LetterGoal
} from './home-letter';
import type { DigestNugget } from './digest-nugget-rules';
import type { WeightNugget } from './health/weight-nugget-rules';

const base: HomeLetterInput = {
	today: '2026-10-08',
	hour: 8,
	sick: false,
	goals: [],
	rollingEffort: null,
	digest: [],
	weight: [],
	lostItems: [],
	unplacedWeek: [],
	todayOpen: [],
	events: [],
	hoursSinceLastVisit: 2,
	sinceLastVisit: null
};

const nugget = (kind: DigestNugget['kind'], sentence: string): DigestNugget => ({ kind, headline: sentence, sentence });
const weight = (kind: WeightNugget['kind'], sentence: string): WeightNugget => ({ kind, headline: sentence, sentence });

const weightGoal: LetterGoal = {
	id: 'w',
	title: 'Ned til 90 kg',
	shape: 'state',
	unit: 'kg',
	startDate: '2026-08-01',
	endDate: '2027-06-01',
	startValue: 98,
	currentValue: 94.1,
	targetValue: 90,
	rawSeries: [
		{ date: '2026-08-01', value: 98 },
		{ date: '2026-10-08', value: 94.1 }
	]
};

const runGoal: LetterGoal = {
	id: 'r',
	title: 'Løp 300 km i høst',
	shape: 'volume',
	unit: 'km',
	startDate: '2026-09-01',
	endDate: '2026-11-30',
	startValue: 0,
	currentValue: 120,
	targetValue: 300,
	rawSeries: [
		{ date: '2026-09-10', value: 60 },
		{ date: '2026-10-01', value: 60 }
	]
};

describe('letterGreeting', () => {
	it('følger døgnet', () => {
		expect(letterGreeting(7)).toBe('God morgen.');
		expect(letterGreeting(13)).toBe('Hei.');
		expect(letterGreeting(20)).toBe('God kveld.');
		expect(letterGreeting(2)).toBe('Sent oppe.');
	});
});

describe('goalLine', () => {
	it('sier hvor vektmålet står og hvor tempoet tar deg', () => {
		const line = goalLine(weightGoal, '2026-10-08');
		expect(line.section).toBe('maal');
		expect(line.text).toMatch(/^Ned til 90 kg: 94,1 kg nå, målet er 90,0 kg\. På dagens tempo er du der rundt /);
	});

	it('akkumulerer løpemålet før datoen anslås', () => {
		const line = goalLine(runGoal, '2026-10-08');
		expect(line.text).toMatch(/^Løp 300 km i høst: 120 av 300 km\. /);
	});
});

describe('buildHomeLetter', () => {
	it('er tomt når kildene ikke har noe å si — et brev uten innhold lager ikke innhold', () => {
		expect(buildHomeLetter(base).lines).toEqual([]);
	});

	it('legger målene først, så uka, så de løse trådene', () => {
		const letter = buildHomeLetter({
			...base,
			goals: [weightGoal, runGoal],
			rollingEffort: { spentLast7Days: 420, bandMin: 391, bandMax: 469 },
			lostItems: ['Ring verkstedet']
		});
		expect(letter.lines.map((l) => l.section)).toEqual(['maal', 'maal', 'uka', 'trader']);
		expect(letter.lines[2].text).toBe('Siste sju dager: 420 i effort, innenfor rammen din (391–469).');
		expect(letter.lines[3].text).toBe('Ring verkstedet står igjen på dager som har gått.');
	});

	it('bruker ikke kalenderuka, overliggerne fra i går eller ukas vekt — de er erstattet', () => {
		const letter = buildHomeLetter({
			...base,
			digest: [
				nugget('load-high', 'Ta en rolig dag.'),
				nugget('carryover', 'Fra i går.'),
				nugget('week-change', 'Uka på vekta.'),
				nugget('week-load', 'Under ukas plan.')
			]
		});
		expect(letter.lines.map((l) => l.id)).toEqual(['digest:load-high']);
		expect(letter.dropped.map((l) => l.id)).toEqual(['digest:carryover', 'digest:week-change', 'digest:week-load']);
	});

	it('viser vektkrydderet bare når det ikke finnes et vektmål', () => {
		const nuggets = [weight('year-over-year', '2,2 kg under i fjor.')];
		expect(buildHomeLetter({ ...base, weight: nuggets }).lines.map((l) => l.id)).toEqual(['weight:year-over-year']);
		const withGoal = buildHomeLetter({ ...base, weight: nuggets, goals: [weightGoal] });
		expect(withGoal.lines.map((l) => l.id)).toEqual(['goal:w']);
		expect(withGoal.dropped.map((l) => l.id)).toEqual(['weight:year-over-year']);
	});

	it('navngir det som står på ukelista uten en dag', () => {
		const letter = buildHomeLetter({ ...base, unplacedWeek: [{ label: 'Løp', count: 2 }, { label: 'Handle', count: 1 }] });
		expect(letter.lines[0]).toMatchObject({ lens: 'venter', section: 'uka', text: 'På ukelista uten en dag: Løp ×2 og Handle.' });
	});

	it(`kapper de løse trådene på ${SECTION_CAPS.trader} og viser resten som valgt bort`, () => {
		const letter = buildHomeLetter({
			...base,
			digest: [nugget('streak-due', 'Løperekka forfaller i morgen.')],
			lostItems: ['Ring verkstedet'],
			todayOpen: ['Handle'],
			events: [
				{
					id: 'e1',
					title: 'Konsert',
					eventDate: '2026-10-10',
					startTime: '19:00',
					prep: [{ id: 'b', label: 'Barnevakt', done: false, doneAt: null }]
				}
			]
		});
		const trader = letter.lines.filter((l) => l.section === 'trader');
		expect(trader.map((l) => l.id)).toEqual(['digest:streak-due', 'event-prep:e1', 'lost-items']);
		expect(letter.dropped.map((l) => l.id)).toEqual(['today-open']);
	});

	it('navngir det som mangler før et arrangement', () => {
		const letter = buildHomeLetter({
			...base,
			events: [
				{
					id: 'e1',
					title: 'Konsert',
					eventDate: '2026-10-11',
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
				{ id: 'e1', title: 'Kamp', eventDate: '2026-10-09', startTime: null, prep: [] },
				{ id: 'e2', title: 'Teater', eventDate: '2026-10-14', startTime: '18:00', prep: [] }
			]
		});
		expect(letter.lines.map((l) => [l.text, l.section])).toEqual([['I morgen: Kamp.', 'ellers']]);
	});

	it('sier «siden sist» bare etter et fravær, og bare når noe har skjedd', () => {
		const away = { ...base, hoursSinceLastVisit: 80, sinceLastVisit: { workouts: 2, distanceKm: 14.2 } };
		expect(buildHomeLetter(away).lines[0].text).toBe('Siden du var innom for 3 dager siden: 2 økter, 14 km.');
		expect(buildHomeLetter({ ...away, hoursSinceLastVisit: 5 }).lines).toEqual([]);
		expect(buildHomeLetter({ ...away, sinceLastVisit: { workouts: 0, distanceKm: 0 } }).lines).toEqual([]);
	});

	it('ber ikke om noe når brukeren er syk, men lar målene stå', () => {
		const letter = buildHomeLetter({
			...base,
			sick: true,
			goals: [weightGoal],
			digest: [nugget('streak-due', 'Løperekka forfaller.')],
			lostItems: ['Ring verkstedet']
		});
		expect(letter.lines.map((l) => l.id)).toEqual(['sick', 'goal:w']);
		expect(letter.lines.some((l) => l.lens === 'venter')).toBe(false);
		expect(letter.dropped.map((l) => l.id)).toEqual(['digest:streak-due', 'lost-items']);
	});
});

describe('joinNorwegian', () => {
	it('binder med komma og «og»', () => {
		expect(joinNorwegian(['a'])).toBe('a');
		expect(joinNorwegian(['a', 'b', 'c'])).toBe('a, b og c');
	});
});
