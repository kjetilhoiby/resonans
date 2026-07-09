import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, filmPreferences } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { getRegionProviders } from '$lib/server/integrations/tmdb';

// GET — brukerens strømmepreferanser + tilgjengelige tjenester i regionen
export const GET: RequestHandler = async ({ params, url, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const prefs = await db.query.filmPreferences.findFirst({
		where: and(eq(filmPreferences.themeId, params.id), eq(filmPreferences.userId, locals.userId))
	});

	const region = prefs?.region ?? 'NO';
	// Hent tilgjengelige tjenester kun når klienten ber om det (?available=1)
	const available = url.searchParams.get('available') === '1' ? await getRegionProviders(region) : [];

	return json({
		region,
		providerIds: (prefs?.providerIds as number[] | null) ?? [],
		providerNames: (prefs?.providerNames as string[] | null) ?? [],
		available
	});
};

// PATCH — sett strømmepreferanser (upsert per tema)
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const body = await request.json().catch(() => null);
	const providerIds = Array.isArray(body?.providerIds)
		? (body.providerIds as unknown[]).filter((n): n is number => typeof n === 'number')
		: [];
	const providerNames = Array.isArray(body?.providerNames)
		? (body.providerNames as unknown[]).filter((s): s is string => typeof s === 'string')
		: [];
	const region = typeof body?.region === 'string' && body.region.length === 2 ? body.region : 'NO';

	const existing = await db.query.filmPreferences.findFirst({
		where: and(eq(filmPreferences.themeId, params.id), eq(filmPreferences.userId, locals.userId)),
		columns: { id: true }
	});

	if (existing) {
		const [updated] = await db
			.update(filmPreferences)
			.set({ providerIds, providerNames, region, updatedAt: new Date() })
			.where(eq(filmPreferences.id, existing.id))
			.returning();
		return json(updated);
	}

	const [created] = await db
		.insert(filmPreferences)
		.values({
			themeId: params.id,
			userId: locals.userId,
			region,
			providerIds,
			providerNames
		})
		.returning();
	return json(created, { status: 201 });
};
