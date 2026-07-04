import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { reflections } from '$lib/db/schema';
import { and, asc, desc, eq } from 'drizzle-orm';

// Feriedagbok: én notat per dag per ferie-tema, lagret i reflections med
// kind='feriedagbok', periodKey=ISO-dato. Sted, vær-snapshot og bilde-URLer
// ligger i scores-jsonb.

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

interface DiaryImage {
	url: string;
	caption?: string;
	place?: string;
	geo?: DiaryGeo;
	geoManual?: boolean;
}

// Bilder lagres som objekter med valgfri bildetekst/sted, men eldre notater har
// rene URL-strenger — begge former godtas og normaliseres til objektform.
function parseImages(value: unknown): DiaryImage[] {
	if (!Array.isArray(value)) return [];
	const out: DiaryImage[] = [];
	for (const raw of value) {
		if (typeof raw === 'string') {
			out.push({ url: raw });
			continue;
		}
		if (!raw || typeof raw !== 'object') continue;
		const img = raw as Record<string, unknown>;
		if (typeof img.url !== 'string' || !img.url) continue;
		const entry: DiaryImage = { url: img.url };
		if (typeof img.caption === 'string' && img.caption.trim()) entry.caption = img.caption.trim();
		if (typeof img.place === 'string' && img.place.trim()) entry.place = img.place.trim();
		const geo = parseGeo(img.geo);
		if (geo) entry.geo = geo;
		// Manuelt satt nål (kartvelger) — bare meningsfullt sammen med koordinat.
		if (geo && img.geoManual === true) entry.geoManual = true;
		out.push(entry);
	}
	return out;
}

export const GET: RequestHandler = async ({ params, locals }) => {
	const rows = await db.query.reflections.findMany({
		where: and(
			eq(reflections.userId, locals.userId),
			eq(reflections.themeId, params.id),
			eq(reflections.kind, KIND)
		),
		orderBy: [asc(reflections.periodKey)]
	});

	const entries = rows.map((r) => {
		const scores = (r.scores ?? {}) as Record<string, unknown>;
		const images = parseImages(scores.images);
		return {
			date: r.periodKey,
			content: r.content,
			place: typeof scores.place === 'string' ? scores.place : undefined,
			weather: (scores.weather as DiaryWeather | undefined) ?? undefined,
			images: images.length > 0 ? images : undefined,
			geo: parseGeo(scores.geo)
		};
	});

	return json({ entries });
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
	const images = parseImages(body.images);
	const geo = parseGeo(body.geo);

	const existing = await db.query.reflections.findFirst({
		where: and(
			eq(reflections.userId, locals.userId),
			eq(reflections.themeId, params.id),
			eq(reflections.kind, KIND),
			eq(reflections.periodKey, date)
		),
		orderBy: [desc(reflections.createdAt)]
	});

	// Tomt notat uten sted/vær/bilder = slett dagen.
	if (!content && !place && !weather && images.length === 0) {
		if (existing) {
			await db.delete(reflections).where(eq(reflections.id, existing.id));
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
			themeId: params.id,
			kind: KIND,
			periodKey: date,
			content,
			scores
		});
	}

	return json({ success: true });
};
