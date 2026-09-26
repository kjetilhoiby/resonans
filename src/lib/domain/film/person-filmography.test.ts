import { describe, it, expect } from 'vitest';
import { pickPersonMatch, sortNewestFirst } from './person-filmography';

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
