import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, films, filmLists, filmPreferences } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { rankRecommendations, type RecommendCandidate } from '$lib/server/film-recommend';
import { discoverFilms } from '$lib/server/integrations/tmdb';

// POST — «hva ser jeg i kveld?» { minutes, mood? }
// Prioriterer ønskeliste/liste-filmer som passer tiden og finnes på brukerens
// tjenester; supplerer med TMDB discover hvis biblioteket er tynt.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const minutes = typeof body?.minutes === 'number' && body.minutes > 0 ? Math.round(body.minutes) : 120;

	const prefs = await db.query.filmPreferences.findFirst({
		where: and(eq(filmPreferences.themeId, params.id), eq(filmPreferences.userId, locals.userId))
	});
	const providerNames = (prefs?.providerNames as string[] | null) ?? [];
	const providerIds = (prefs?.providerIds as number[] | null) ?? [];

	const candidates: RecommendCandidate[] = [];

	// Ønskeliste-filmer med cachet strømmetilgjengelighet
	const wantFilms = await db.query.films.findMany({
		where: and(
			eq(films.themeId, params.id),
			eq(films.userId, locals.userId),
			eq(films.status, 'want_to_watch')
		),
		columns: {
			tmdbId: true,
			title: true,
			year: true,
			runtime: true,
			posterUrl: true,
			watchProviders: true
		}
	});
	for (const f of wantFilms) {
		const wp = f.watchProviders as { flatrate?: Array<{ provider: string }> } | null;
		candidates.push({
			tmdbId: f.tmdbId,
			title: f.title,
			year: f.year,
			runtime: f.runtime,
			posterUrl: f.posterUrl,
			availableProviders: wp?.flatrate?.map((p) => p.provider) ?? [],
			source: 'library'
		});
	}

	// Elementer fra navngitte lister (uten cachet tilgjengelighet)
	const lists = await db.query.filmLists.findMany({
		where: and(eq(filmLists.themeId, params.id), eq(filmLists.userId, locals.userId)),
		with: { items: { columns: { tmdbId: true, title: true, year: true, runtime: true, posterUrl: true } } }
	});
	const seenTmdb = new Set(candidates.map((c) => c.tmdbId).filter(Boolean) as number[]);
	for (const list of lists) {
		for (const item of list.items) {
			if (item.tmdbId && seenTmdb.has(item.tmdbId)) continue;
			if (item.tmdbId) seenTmdb.add(item.tmdbId);
			candidates.push({
				tmdbId: item.tmdbId,
				title: item.title,
				year: item.year,
				runtime: item.runtime,
				posterUrl: item.posterUrl,
				source: 'list'
			});
		}
	}

	let ranked = rankRecommendations(candidates, { minutes, providerNames });

	// Supplér med TMDB discover hvis vi har få gode kandidater
	const goodEnough = ranked.filter((r) => r.fitsTime).length;
	let discoverNote: string | null = null;
	if (goodEnough < 3) {
		try {
			const discovered = await discoverFilms({
				maxRuntime: minutes + 10,
				providerIds: providerIds.length ? providerIds : undefined,
				minRating: 6.5,
				region: prefs?.region ?? 'NO'
			});
			const extra: RecommendCandidate[] = discovered
				.filter((d) => !d.tmdbId || !seenTmdb.has(d.tmdbId))
				.slice(0, 12)
				.map((d) => ({
					tmdbId: d.tmdbId,
					title: d.title,
					year: d.year,
					runtime: null,
					posterUrl: d.posterUrl,
					// discover-filtrert på tjeneste → antas tilgjengelig på mine tjenester
					availableProviders: providerNames,
					source: 'discover' as const
				}));
			ranked = rankRecommendations([...candidates, ...extra], { minutes, providerNames });
			if (extra.length) discoverNote = 'Supplert med forslag fra TMDB.';
		} catch {
			// Ikke-fatalt
		}
	}

	return json({
		minutes,
		providerNames,
		hasPreferences: providerNames.length > 0,
		recommendations: ranked.slice(0, 20),
		note: discoverNote
	});
};
