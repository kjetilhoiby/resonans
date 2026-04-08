import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	// Sanitize: only allow known fields
	const allowed = ['destination', 'country', 'lat', 'lng', 'startDate', 'endDate', 'overnightStays'];
	const profile: Record<string, unknown> = {};
	for (const key of allowed) {
		if (key in body) profile[key] = body[key];
	}

	await db
		.update(themes)
		.set({ tripProfile: profile, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({ success: true });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { tripProfile: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });
	return json(theme.tripProfile ?? {});
};
