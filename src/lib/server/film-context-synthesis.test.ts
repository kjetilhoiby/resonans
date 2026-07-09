import { describe, it, expect } from 'vitest';
import { buildFilmographySequence } from './film-context-synthesis';
import type { PersonFilmography } from './integrations/tmdb';

const filmography: PersonFilmography = {
	personId: 5,
	name: 'Andrei Tarkovskij',
	films: [
		{ tmdbId: 1, title: 'Ivans barndom', year: 1962 },
		{ tmdbId: 2, title: 'Andrej Rubljov', year: 1966 },
		{ tmdbId: 3, title: 'Solaris', year: 1972 },
		{ tmdbId: 4, title: 'Speilet', year: 1975 },
		{ tmdbId: 5, title: 'Stalker', year: 1979 },
		{ tmdbId: 6, title: 'Nostalghia', year: 1983 },
		{ tmdbId: 7, title: 'Offeret', year: 1986 }
	]
};

describe('buildFilmographySequence', () => {
	it('finner filmen på tmdbId og gir inntil 3 før/etter', () => {
		const seq = buildFilmographySequence(filmography, 4, 'Speilet', 1975);
		expect(seq?.directorName).toBe('Andrei Tarkovskij');
		expect(seq?.currentFilm).toEqual({ title: 'Speilet', year: 1975 });
		// Speilet er index 3 → før = slice(0,3) = Ivans, Rubljov, Solaris
		expect(seq?.before.map((f) => f.title)).toEqual(['Ivans barndom', 'Andrej Rubljov', 'Solaris']);
		expect(seq?.after.map((f) => f.title)).toEqual(['Stalker', 'Nostalghia', 'Offeret']);
	});

	it('gir riktig før-vindu midt i filmografien', () => {
		const seq = buildFilmographySequence(filmography, 5, 'Stalker');
		expect(seq?.before.map((f) => f.title)).toEqual(['Andrej Rubljov', 'Solaris', 'Speilet']);
		expect(seq?.after.map((f) => f.title)).toEqual(['Nostalghia', 'Offeret']);
	});

	it('faller tilbake til tittel-match når tmdbId ikke finnes', () => {
		const seq = buildFilmographySequence(filmography, 999, 'Solaris');
		expect(seq?.currentFilm.title).toBe('Solaris');
		expect(seq?.after.map((f) => f.title)).toEqual(['Speilet', 'Stalker', 'Nostalghia']);
	});

	it('returnerer undefined når filmen ikke finnes i filmografien', () => {
		expect(buildFilmographySequence(filmography, 999, 'Ukjent film')).toBeUndefined();
	});

	it('returnerer undefined for tom/null filmografi', () => {
		expect(buildFilmographySequence(null, 1, 'X')).toBeUndefined();
		expect(
			buildFilmographySequence({ personId: 1, name: 'X', films: [] }, 1, 'X')
		).toBeUndefined();
	});
});
