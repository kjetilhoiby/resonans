import { describe, it, expect } from 'vitest';
import {
	tmdbImageUrl,
	parseSearchResult,
	parseDirector,
	parseDirectorId,
	parseCast,
	parseFilmDetails,
	parseWatchProviders,
	parsePersonFilmography
} from './tmdb';

describe('tmdbImageUrl', () => {
	it('bygger full URL fra path', () => {
		expect(tmdbImageUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
	});
	it('respekterer størrelse', () => {
		expect(tmdbImageUrl('/abc.jpg', 'w92')).toBe('https://image.tmdb.org/t/p/w92/abc.jpg');
	});
	it('returnerer undefined for tom path', () => {
		expect(tmdbImageUrl(null)).toBeUndefined();
		expect(tmdbImageUrl(undefined)).toBeUndefined();
	});
});

describe('parseSearchResult', () => {
	it('mapper felter og trekker ut år fra release_date', () => {
		const r = parseSearchResult({
			id: 42,
			title: 'Offeret',
			original_title: 'Offret',
			release_date: '1986-05-09',
			poster_path: '/p.jpg',
			overview: 'En mann inngår en pakt.'
		});
		expect(r).toEqual({
			tmdbId: 42,
			title: 'Offeret',
			originalTitle: 'Offret',
			year: 1986,
			posterUrl: 'https://image.tmdb.org/t/p/w500/p.jpg',
			overview: 'En mann inngår en pakt.'
		});
	});
	it('takler manglende tittel og dato', () => {
		const r = parseSearchResult({ id: 1 });
		expect(r.title).toBe('(uten tittel)');
		expect(r.year).toBeUndefined();
		expect(r.posterUrl).toBeUndefined();
	});
});

describe('parseDirector / parseDirectorId', () => {
	const credits = {
		crew: [
			{ id: 5, name: 'Andrei Tarkovskij', job: 'Director' },
			{ id: 9, name: 'Sven Nykvist', job: 'Director of Photography' }
		]
	};
	it('finner regissøren og id-en', () => {
		expect(parseDirector(credits)).toBe('Andrei Tarkovskij');
		expect(parseDirectorId(credits)).toBe(5);
	});
	it('returnerer undefined uten regissør', () => {
		expect(parseDirector({ crew: [] })).toBeUndefined();
		expect(parseDirectorId(undefined)).toBeUndefined();
	});
});

describe('parseCast', () => {
	it('begrenser til limit og mapper karakter', () => {
		const cast = parseCast(
			{ cast: [{ name: 'A', character: 'X' }, { name: 'B' }, { name: 'C' }] },
			2
		);
		expect(cast).toEqual([{ name: 'A', character: 'X' }, { name: 'B', character: undefined }]);
	});
});

describe('parseFilmDetails', () => {
	it('slår sammen metadata, credits og anbefalinger', () => {
		const details = parseFilmDetails({
			id: 100,
			title: 'Sacrifice',
			runtime: 149,
			genres: [{ id: 18, name: 'Drama' }],
			production_countries: [{ iso_3166_1: 'SE', name: 'Sverige' }],
			original_language: 'sv',
			vote_average: 7.9,
			credits: { crew: [{ id: 5, name: 'Tarkovskij', job: 'Director' }], cast: [{ name: 'Josephson' }] },
			recommendations: { results: [{ id: 200, title: 'Nostalghia', release_date: '1983-01-01' }] }
		});
		expect(details.director).toBe('Tarkovskij');
		expect(details.directorId).toBe(5);
		expect(details.runtime).toBe(149);
		expect(details.genres).toEqual(['Drama']);
		expect(details.country).toBe('Sverige');
		expect(details.tmdbRating).toBe(7.9);
		expect(details.similar).toHaveLength(1);
		expect(details.similar[0].title).toBe('Nostalghia');
	});
	it('faller tilbake til similar når recommendations er tom', () => {
		const details = parseFilmDetails({
			id: 1,
			title: 'X',
			recommendations: { results: [] },
			similar: { results: [{ id: 2, title: 'Y' }] }
		});
		expect(details.similar[0].title).toBe('Y');
	});
	it('utelater rating 0', () => {
		const details = parseFilmDetails({ id: 1, title: 'X', vote_average: 0 });
		expect(details.tmdbRating).toBeUndefined();
	});
});

describe('parseWatchProviders', () => {
	it('plukker riktig region og kategorier', () => {
		const wp = parseWatchProviders(
			{
				results: {
					NO: {
						flatrate: [{ provider_id: 8, provider_name: 'Netflix', logo_path: '/n.jpg' }],
						rent: [{ provider_id: 3, provider_name: 'Google Play' }]
					}
				}
			},
			'NO'
		);
		expect(wp.region).toBe('NO');
		expect(wp.flatrate).toEqual([
			{ provider: 'Netflix', providerId: 8, logoUrl: 'https://image.tmdb.org/t/p/w92/n.jpg' }
		]);
		expect(wp.rent?.[0].provider).toBe('Google Play');
		expect(wp.buy).toBeUndefined();
	});
	it('gir tomme kategorier for ukjent region', () => {
		const wp = parseWatchProviders({ results: {} }, 'NO');
		expect(wp.flatrate).toBeUndefined();
	});
});

describe('parsePersonFilmography', () => {
	const credits = {
		id: 5,
		crew: [
			{ id: 100, title: 'Nostalghia', release_date: '1983-01-01', job: 'Director' },
			{ id: 101, title: 'Offret', release_date: '1986-01-01', job: 'Director' },
			{ id: 102, title: 'Fotograf-jobb', job: 'Cinematography' }
		],
		cast: [{ id: 200, title: 'Cameo', release_date: '1970-01-01', character: 'Mann' }]
	};

	it('regissør-rolle: bare Director-krediteringer, kronologisk', () => {
		const f = parsePersonFilmography(credits, 'Tarkovskij', { role: 'director' });
		expect(f.films.map((x) => x.title)).toEqual(['Nostalghia', 'Offret']);
		expect(f.films[0].job).toBe('Director');
	});

	it('skuespiller-rolle: bare cast-krediteringer', () => {
		const f = parsePersonFilmography(credits, 'Tarkovskij', { role: 'actor' });
		expect(f.films.map((x) => x.title)).toEqual(['Cameo']);
		expect(f.films[0].character).toBe('Mann');
	});

	it('deduper på tmdbId', () => {
		const dup = { id: 1, crew: [
			{ id: 100, title: 'A', release_date: '2000', job: 'Director' },
			{ id: 100, title: 'A', release_date: '2000', job: 'Director' }
		] };
		const f = parsePersonFilmography(dup, 'X', { role: 'director' });
		expect(f.films).toHaveLength(1);
	});
});
