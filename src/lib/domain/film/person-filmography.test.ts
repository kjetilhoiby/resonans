import { describe, it, expect } from 'vitest';
import {
	pickPersonMatch,
	sortNewestFirst,
	isCuratable,
	weightedRating,
	pickAcclaimed,
	pickCareerSpan,
	recurringPeople,
	MIN_VOTES
} from './person-filmography';

describe('pickPersonMatch', () => {
	it('godtar bare eksakte navnetreff', () => {
		const hits = [{ personId: 1, name: 'Joachim Trier Jr.' }];
		expect(pickPersonMatch(hits, 'Joachim Trier', 'director')).toBeNull();
	});

	it('ser bort fra store/små bokstaver og ekstra mellomrom', () => {
		const hits = [{ personId: 7, name: 'Renate  Reinsve' }];
		expect(pickPersonMatch(hits, 'renate reinsve', 'actor')?.personId).toBe(7);
	});

	it('foretrekker navnebroren som er kjent for rollen man kom fra', () => {
		const hits = [
			{ personId: 1, name: 'John Smith', knownForDepartment: 'Acting' },
			{ personId: 2, name: 'John Smith', knownForDepartment: 'Directing' }
		];
		expect(pickPersonMatch(hits, 'John Smith', 'director')?.personId).toBe(2);
		expect(pickPersonMatch(hits, 'John Smith', 'actor')?.personId).toBe(1);
	});

	it('faller tilbake på TMDBs rekkefølge uten rolletreff', () => {
		const hits = [
			{ personId: 3, name: 'Ola Nordmann', knownForDepartment: 'Writing' },
			{ personId: 4, name: 'Ola Nordmann', knownForDepartment: 'Sound' }
		];
		expect(pickPersonMatch(hits, 'Ola Nordmann', 'director')?.personId).toBe(3);
	});
});

describe('sortNewestFirst', () => {
	it('sorterer nyeste først og legger filmer uten årstall sist', () => {
		const sorted = sortNewestFirst([
			{ title: 'Oslo, 31. august', year: 2011 },
			{ title: 'Kommende', year: null },
			{ title: 'Verdens verste menneske', year: 2021 },
			{ title: 'Reprise', year: 2006 }
		]);
		expect(sorted.map((f) => f.title)).toEqual([
			'Verdens verste menneske',
			'Oslo, 31. august',
			'Reprise',
			'Kommende'
		]);
	});

	it('muterer ikke inputlista', () => {
		const input = [
			{ title: 'A', year: 2000 },
			{ title: 'B', year: 2010 }
		];
		sortNewestFirst(input);
		expect(input[0].title).toBe('A');
	});
});

const NOW = 2026;
const film = (tmdbId: number, year: number | null, rating: number, voteCount: number, extra = {}) => ({
	tmdbId,
	title: `Film ${tmdbId}`,
	year,
	rating,
	voteCount,
	...extra
});

describe('isCuratable', () => {
	it('godtar en utgitt spillefilm med nok stemmer', () => {
		expect(isCuratable(film(1, 2023, 7.6, 3000), NOW)).toBe(true);
	});
	it('avviser for få stemmer, framtidige og filmer uten årstall', () => {
		expect(isCuratable(film(1, 2023, 9, MIN_VOTES - 1), NOW)).toBe(false);
		expect(isCuratable(film(2, 2027, 7, 500), NOW)).toBe(false);
		expect(isCuratable(film(3, null, 7, 500), NOW)).toBe(false);
	});
	it('avviser dokumentarer og opptredener som seg selv', () => {
		expect(isCuratable(film(1, 2020, 7, 500, { genreIds: [99] }), NOW)).toBe(false);
		expect(isCuratable(film(2, 2020, 7, 500, { character: 'Herself' }), NOW)).toBe(false);
		expect(isCuratable(film(3, 2020, 7, 500, { character: 'Self - Guest' }), NOW)).toBe(false);
		expect(isCuratable(film(4, 2020, 7, 500, { character: 'Selma' }), NOW)).toBe(true);
	});
});

describe('weightedRating', () => {
	it('trekker en film med få stemmer mot snittet', () => {
		const few = weightedRating(film(1, 2020, 8.4, 12));
		const many = weightedRating(film(2, 2020, 7.6, 3000));
		expect(many).toBeGreaterThan(few);
		expect(many).toBeCloseTo(7.6, 1);
	});
});

describe('pickAcclaimed', () => {
	const entries = [
		film(1, 2016, 7.4, 2000),
		film(2, 2023, 7.6, 3000),
		film(3, 2023, 7.1, 2500),
		film(4, 2010, 8.9, 11),
		film(5, 2006, 6.2, 150)
	];
	it('rangerer på vektet snitt og holder sette filmer utenfor', () => {
		const picked = pickAcclaimed(entries, { nowYear: NOW, exclude: new Set([2]) });
		// 8,9 fra elleve stemmer havner under de solide filmene, ikke øverst.
		expect(picked.map((e) => e.tmdbId)).toEqual([1, 3, 4, 5]);
	});
	it('respekterer limit', () => {
		expect(pickAcclaimed(entries, { nowYear: NOW, limit: 2 })).toHaveLength(2);
	});
});

describe('pickCareerSpan', () => {
	const entries = [
		film(10, 2006, 6.9, 200),
		film(11, 2007, 6.0, 100),
		film(12, 2010, 6.5, 120),
		film(13, 2016, 7.4, 2000),
		film(14, 2019, 6.4, 300),
		film(15, 2023, 7.6, 3000),
		film(16, 2023, 7.1, 2500),
		film(17, 2024, 6.8, 400)
	];
	it('velger den beste i hver tidsbolk og returnerer kronologisk', () => {
		const picked = pickCareerSpan(entries, { nowYear: NOW, slots: 3 });
		const years = picked.map((e) => e.year);
		expect(picked).toHaveLength(3);
		expect(years).toEqual([...years].sort((a, b) => (a ?? 0) - (b ?? 0)));
		// Tidlig bolk (2006–2012), midt (2013–2018), sen (2019–2024)
		expect(picked.map((e) => e.tmdbId)).toEqual([10, 13, 15]);
	});
	it('fyller en bolk der alt er sett med de neste beste', () => {
		const picked = pickCareerSpan(entries, { nowYear: NOW, slots: 3, exclude: new Set([13]) });
		expect(picked).toHaveLength(3);
		expect(picked.map((e) => e.tmdbId)).not.toContain(13);
	});
	it('spennet regnes også av sette filmer', () => {
		// Debuten er sett — spennet starter fortsatt i 2006, så bolkene flytter seg ikke.
		const withDebutSeen = pickCareerSpan(entries, { nowYear: NOW, slots: 3, exclude: new Set([10]) });
		expect(withDebutSeen.map((e) => e.tmdbId)).toEqual([12, 13, 15]);
	});
	it('returnerer alle kandidatene når de er færre enn bolkene', () => {
		expect(pickCareerSpan(entries.slice(0, 2), { nowYear: NOW, slots: 6 })).toHaveLength(2);
	});
});

describe('recurringPeople', () => {
	it('finner personer i minst to sette filmer, og ignorerer ønskelista', () => {
		const people = recurringPeople([
			{ status: 'watched', title: 'Anatomie d\'une chute', director: 'Justine Triet', directorTmdbId: 1, cast: [{ name: 'Sandra Hüller', personId: 42 }] },
			{ status: 'watched', title: 'The Zone of Interest', director: 'Jonathan Glazer', directorTmdbId: 2, cast: [{ name: 'Sandra Hüller', personId: 42 }] },
			{ status: 'want_to_watch', title: 'Toni Erdmann', director: 'Maren Ade', cast: [{ name: 'Sandra Hüller', personId: 42 }] }
		]);
		expect(people).toEqual([
			{ personId: 42, name: 'Sandra Hüller', role: 'actor', count: 2, titles: ['Anatomie d\'une chute', 'The Zone of Interest'] }
		]);
	});

	it('slår sammen en rad uten id med en som har id og samme navn', () => {
		const people = recurringPeople([
			{ status: 'watched', title: 'A', cast: [{ name: 'Sandra Hüller', personId: 42 }] },
			{ status: 'watched', title: 'B', cast: [{ name: 'Sandra Hüller' }] }
		]);
		expect(people).toHaveLength(1);
		expect(people[0]).toMatchObject({ personId: 42, count: 2 });
	});

	it('teller regi og rolle i samme film som én film, og merker regissøren', () => {
		const people = recurringPeople([
			{ status: 'watched', title: 'A', director: 'X', directorTmdbId: 7, cast: [{ name: 'X', personId: 7 }] },
			{ status: 'watched', title: 'B', director: 'X', directorTmdbId: 7 }
		]);
		expect(people).toEqual([{ personId: 7, name: 'X', role: 'director', count: 2, titles: ['A', 'B'] }]);
	});

	it('beholder personer uten id når ingen id finnes for navnet', () => {
		const people = recurringPeople([
			{ status: 'watched', title: 'A', cast: [{ name: 'Nina Hoss' }] },
			{ status: 'watched', title: 'B', cast: [{ name: 'nina hoss' }] }
		]);
		expect(people[0]).toMatchObject({ personId: null, count: 2 });
	});
});
