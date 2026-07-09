/**
 * Film-kontekst-collector — orkestrerer en pipeline av eksterne kilder for å
 * bygge en kontekstpakke som chatten kan grunne seg i. Speiler
 * book-context-collector.ts.
 *
 * Pipeline:
 *   1. TMDB      — metadata, cast, regissørens filmografi, strømmetilgjengelighet (NO)
 *   2. Tavily    — norske filmanmeldelser
 *   3. Tavily    — Letterboxd-rating + review-snippets
 *   4. gpt-4o    — strukturert pakke med ordrette sitater
 *
 * Lagrer i films.contextPack + watchProviders og setter contextStatus til
 * 'ready' eller 'partial'. Skriver løpende framdrift til
 * background_jobs.result.progress når en jobId følger med.
 */

import { db } from '$lib/db';
import { films, backgroundJobs } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';

import {
	getFilmDetails,
	getPersonFilmography,
	getWatchProviders,
	type FilmDetails,
	type PersonFilmography,
	type WatchProviders
} from '$lib/server/integrations/tmdb';
import { collectFilmCriticReviews } from '$lib/server/integrations/film-critics';
import { scrapeLetterboxd } from '$lib/server/integrations/letterboxd';
import { synthesizeFilmContextPack, type FilmContextPack } from '$lib/server/film-context-synthesis';

export type { FilmContextPack } from '$lib/server/film-context-synthesis';

export type FilmContextProgress = {
	stepIndex: number;
	totalSteps: number;
	label: string;
	sourcesCompleted: number;
	sourcesTotal: number;
	sources: {
		tmdb?: { ok: boolean; filmographyFound?: number; error?: string };
		criticReviews?: { ok: boolean; count?: number; error?: string };
		letterboxd?: { ok: boolean; reviewCount?: number; error?: string };
	};
	updatedAt: string;
};

const TOTAL_STEPS = 5; // 1 start + 3 sources + 1 synthesis
const SOURCES_TOTAL = 3;

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

interface TmdbBundle {
	details: FilmDetails | null;
	filmography: PersonFilmography | null;
	providers: WatchProviders | null;
}

export async function processFilmContextCollectJob(payload: {
	filmId: string;
	tmdbId: number | null;
	title: string;
	director: string | null;
	year: number | null;
	jobId?: string;
}): Promise<FilmContextPack> {
	const { filmId, tmdbId, title, director, year, jobId } = payload;

	const sourcesProgress: FilmContextProgress['sources'] = {};
	let sourcesCompleted = 0;
	let stepIndex = 1;

	async function writeProgress(label: string) {
		if (!jobId) return;
		const progress: FilmContextProgress = {
			stepIndex,
			totalSteps: TOTAL_STEPS,
			label,
			sourcesCompleted,
			sourcesTotal: SOURCES_TOTAL,
			sources: sourcesProgress,
			updatedAt: new Date().toISOString()
		};
		try {
			await db
				.update(backgroundJobs)
				.set({
					result: sql`jsonb_set(COALESCE(${backgroundJobs.result}, '{}'::jsonb), '{progress}', ${JSON.stringify(progress)}::jsonb)`,
					updatedAt: new Date()
				})
				.where(eq(backgroundJobs.id, jobId));
		} catch (err) {
			console.warn(`[film-context-collector] failed to write progress: ${errMsg(err)}`);
		}
	}

	await writeProgress('Starter kontekstinnsamling…');

	async function trackedFetch<T>(
		key: 'tmdb' | 'criticReviews' | 'letterboxd',
		humanLabel: string,
		describe: (value: T) => FilmContextProgress['sources'][typeof key],
		fetcher: () => Promise<T>
	): Promise<T | null> {
		try {
			const value = await fetcher();
			sourcesProgress[key] = describe(value);
			sourcesCompleted++;
			stepIndex = 1 + sourcesCompleted;
			await writeProgress(`Hentet ${humanLabel} (${sourcesCompleted}/${SOURCES_TOTAL} kilder)`);
			return value;
		} catch (err) {
			const error = errMsg(err);
			sourcesProgress[key] = { ok: false, error } as FilmContextProgress['sources'][typeof key];
			sourcesCompleted++;
			stepIndex = 1 + sourcesCompleted;
			await writeProgress(`Klarte ikke å hente ${humanLabel} (${sourcesCompleted}/${SOURCES_TOTAL} kilder)`);
			console.warn(`[film-context-collector] ${key} failed for "${title}": ${error}`);
			return null;
		}
	}

	const [tmdbBundle, criticReviewsRaw, letterboxd] = await Promise.all([
		trackedFetch<TmdbBundle>(
			'tmdb',
			'metadata fra TMDB',
			(v) => ({ ok: !!v.details, filmographyFound: v.filmography?.films.length ?? 0 }),
			async () => {
				const details = tmdbId ? await getFilmDetails(tmdbId) : null;
				const directorId = details?.directorId;
				const [filmography, providers] = await Promise.all([
					directorId ? getPersonFilmography(directorId, { role: 'director' }) : Promise.resolve(null),
					tmdbId ? getWatchProviders(tmdbId, 'NO') : Promise.resolve(null)
				]);
				return { details, filmography, providers };
			}
		),
		trackedFetch(
			'criticReviews',
			'norske filmanmeldelser',
			(v) => ({ ok: true, count: v.length }),
			() => collectFilmCriticReviews(title, director, year)
		),
		trackedFetch(
			'letterboxd',
			'Letterboxd',
			(v) => ({ ok: !!v, reviewCount: v?.topReviews.length ?? 0 }),
			() => scrapeLetterboxd(title, director, year)
		)
	]);

	const bundle = tmdbBundle ?? { details: null, filmography: null, providers: null };
	const criticReviews = criticReviewsRaw ?? [];

	const extractorErrors: Array<{ url: string; error: string }> = [];
	for (const [name, src] of Object.entries(sourcesProgress) as Array<
		[string, { ok: boolean; error?: string }]
	>) {
		if (!src.ok && src.error) {
			extractorErrors.push({ url: name, error: src.error });
		}
	}

	stepIndex = 4;
	await writeProgress('Synteserer kontekst med GPT-4o…');

	let contextPack: FilmContextPack;
	try {
		contextPack = await synthesizeFilmContextPack({
			title,
			director,
			year,
			tmdbId,
			details: bundle.details,
			filmography: bundle.filmography,
			providers: bundle.providers,
			criticReviews,
			letterboxd,
			extractorErrors
		});
	} catch (err) {
		const msg = errMsg(err);
		console.error(`[film-context-collector] synthesis failed for "${title}": ${msg}`);
		contextPack = {
			sources: {
				collectedAt: new Date().toISOString(),
				tmdb: { ok: !!bundle.details, filmographyFound: bundle.filmography?.films.length },
				criticDomainsHit: [],
				criticDomainsMissed: criticReviews.map((r) => r.domain),
				letterboxdBlocked: !letterboxd,
				extractorErrors: [...extractorErrors, { url: 'synthesis', error: msg }]
			}
		};
	}

	const hasFilmography = !!contextPack.filmographySequence;
	const hasCriticReviews = (contextPack.criticReviews?.length ?? 0) >= 1;
	const status: 'ready' | 'partial' = hasFilmography && hasCriticReviews ? 'ready' : 'partial';

	await db
		.update(films)
		.set({
			contextPack,
			contextStatus: status,
			// Cache strømmetilgjengelighet for rask visning i biblioteket
			...(bundle.providers
				? { watchProviders: bundle.providers, watchProvidersUpdatedAt: new Date() }
				: {}),
			updatedAt: new Date()
		})
		.where(eq(films.id, filmId));

	stepIndex = 5;
	await writeProgress(status === 'ready' ? 'Kontekst klar ✦' : 'Delvis kontekst klar ◐');

	return contextPack;
}
