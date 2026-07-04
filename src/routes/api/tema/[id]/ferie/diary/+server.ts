import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { reflections, themes } from '$lib/db/schema';
import { and, asc, desc, eq } from 'drizzle-orm';
import {
	findParentFerieLink,
	isWithinWindow,
	mergeInheritedDiary,
	type ParentFerieLink
} from '$lib/ferie/trip-diary-inherit';

// Feriedagbok: én notat per dag per tema, lagret i reflections med
// kind='feriedagbok', periodKey=ISO-dato. Sted, vær-snapshot og bilde-URLer
// ligger i scores-jsonb.
//
// Reise-temaer forfremmet fra en ferie deler dagbok med ferien: GET fletter
// inn feriens notater for datoer i reisevinduet, og PUT skriver tilbake til
// ferie-temaet — én dagbok per dag, ferien eier den.

const KIND = 'feriedagbok';

interface DiaryWeather {
	emoji?: string;
	temp?: number;
	symbol?: string;
}

interface DiaryGeo {
	lat: number;
	lon: number;
}

function parseGeo(value: unknown): DiaryGeo | undefined {
	if (!value || typeof value !== 'object') return undefined;
	const g = value as Record<string, unknown>;
	if (typeof g.lat === 'number' && typeof g.lon === 'number') return { lat: g.lat, lon: g.lon };
	return undefined;
}

type ReflectionRow = typeof reflections.$inferSelect;

function rowToEntry(r: ReflectionRow) {
	const scores = (r.scores ?? {}) as Record<string, unknown>;
	const images = Array.isArray(scores.images)
		? (scores.images as unknown[]).filter((u): u is string => typeof u === 'string')
		: undefined;
	return {
		date: r.periodKey ?? '',
		content: r.content ?? '',
		place: typeof scores.place === 'string' ? scores.place : undefined,
		weather: (scores.weather as DiaryWeather | undefined) ?? undefined,
		images: images && images.length > 0 ? images : undefined,
		geo: parseGeo(scores.geo)
	};
}

async function fetchEntries(userId: string, themeId: string) {
	const rows = await db.query.reflections.findMany({
		where: and(
			eq(reflections.userId, userId),
			eq(reflections.themeId, themeId),
			eq(reflections.kind, KIND)
		),
		orderBy: [asc(reflections.periodKey)]
	});
	return rows.map(rowToEntry);
}

/** Ferie-temaet dette reise-temaet arver dagbok fra, hvis noe. */
async function resolveParentLink(userId: string, themeId: string): Promise<ParentFerieLink | null> {
	const rows = await db.query.themes.findMany({
		where: eq(themes.userId, userId),
		columns: { id: true, name: true, tripProfile: true, ferieProfile: true }
	});
	return findParentFerieLink(rows, themeId);
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const own = await fetchEntries(locals.userId, params.id);

	const link = await resolveParentLink(locals.userId, params.id);
	if (!link) return json({ entries: own });

	const parentEntries = await fetchEntries(locals.userId, link.parent.id);
	const entries = mergeInheritedDiary(own, parentEntries, link.window);
	return json({
		entries,
		inheritsFrom: { themeId: link.parent.id, name: link.parent.name }
	});
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object' || typeof body.date !== 'string') {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	const date = body.date;
	const content = typeof body.content === 'string' ? body.content.trim() : '';
	const place = typeof body.place === 'string' ? body.place.trim() : '';
	const weather = body.weather && typeof body.weather === 'object' ? (body.weather as DiaryWeather) : undefined;
	const images = Array.isArray(body.images)
		? (body.images as unknown[]).filter((u): u is string => typeof u === 'string')
		: [];
	const geo = parseGeo(body.geo);

	// Reise med ferie-kobling: dagboka bor på ferie-temaet for datoer i vinduet.
	const link = await resolveParentLink(locals.userId, params.id);
	const targetThemeId =
		link && isWithinWindow(date, link.window) ? link.parent.id : params.id;

	const findExisting = (themeId: string) =>
		db.query.reflections.findFirst({
			where: and(
				eq(reflections.userId, locals.userId),
				eq(reflections.themeId, themeId),
				eq(reflections.kind, KIND),
				eq(reflections.periodKey, date)
			),
			orderBy: [desc(reflections.createdAt)]
		});

	const existing = await findExisting(targetThemeId);

	// Tomt notat uten sted/vær/bilder = slett dagen.
	if (!content && !place && !weather && images.length === 0) {
		if (existing) {
			await db.delete(reflections).where(eq(reflections.id, existing.id));
		}
		// Rydd også reisens egen rad (f.eks. Ekko-seedet sted), ellers gjenoppstår den.
		if (targetThemeId !== params.id) {
			const ownRow = await findExisting(params.id);
			if (ownRow) await db.delete(reflections).where(eq(reflections.id, ownRow.id));
		}
		return json({ success: true, deleted: true });
	}

	const scores: Record<string, unknown> = {};
	if (place) scores.place = place;
	if (weather) scores.weather = weather;
	if (images.length > 0) scores.images = images;
	if (geo) scores.geo = geo;

	if (existing) {
		await db
			.update(reflections)
			.set({ content, scores })
			.where(eq(reflections.id, existing.id));
	} else {
		await db.insert(reflections).values({
			userId: locals.userId,
			themeId: targetThemeId,
			kind: KIND,
			periodKey: date,
			content,
			scores
		});
	}

	return json({ success: true });
};
