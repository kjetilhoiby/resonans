import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { reflections } from '$lib/db/schema';
import { and, asc, desc, eq } from 'drizzle-orm';

// Feriedagbok: én notat per dag per ferie-tema, lagret i reflections med
// kind='feriedagbok', periodKey=ISO-dato. Sted + vær-snapshot ligger i scores-jsonb.

const KIND = 'feriedagbok';

interface DiaryWeather {
	emoji?: string;
	temp?: number;
	symbol?: string;
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
		return {
			date: r.periodKey,
			content: r.content,
			place: typeof scores.place === 'string' ? scores.place : undefined,
			weather: (scores.weather as DiaryWeather | undefined) ?? undefined
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

	const existing = await db.query.reflections.findFirst({
		where: and(
			eq(reflections.userId, locals.userId),
			eq(reflections.themeId, params.id),
			eq(reflections.kind, KIND),
			eq(reflections.periodKey, date)
		),
		orderBy: [desc(reflections.createdAt)]
	});

	// Tomt notat uten sted/vær = slett dagen.
	if (!content && !place && !weather) {
		if (existing) {
			await db.delete(reflections).where(eq(reflections.id, existing.id));
		}
		return json({ success: true, deleted: true });
	}

	const scores: Record<string, unknown> = {};
	if (place) scores.place = place;
	if (weather) scores.weather = weather;

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
