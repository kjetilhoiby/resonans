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

	// Felt-vis merge: behold eksisterende felter (særlig geoByDay, som skrives av
	// live-session-flyten og ikke av dette skjemaet) og overlay kun feltene som er
	// eksplisitt med i requesten. null/undefined fjerner feltet.
	const allowed = [
		'destination',
		'country',
		'lat',
		'lng',
		'startDate',
		'endDate',
		'accountIds',
		'overnightStays',
		'geoByDay',
		'imagePins'
	];

	const existing = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { tripProfile: true }
	});

	const merged: Record<string, unknown> = { ...(existing?.tripProfile ?? {}) };
	for (const key of allowed) {
		if (!(key in body)) continue;
		const value = body[key];
		if (value === null || value === undefined) delete merged[key];
		else merged[key] = value;
	}

	await db
		.update(themes)
		.set({ tripProfile: merged, updatedAt: new Date() })
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
