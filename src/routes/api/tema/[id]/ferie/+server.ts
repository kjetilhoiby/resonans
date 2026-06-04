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

	// Felt-vis merge: les eksisterende profil og overlay kun feltene som er
	// eksplisitt med i requesten. Felter som ikke nevnes beholdes urørt — så en
	// delvis lagring aldri sletter grid/medlemmer/reiser den ikke rører.
	// Eksplisitt `null`/`undefined` betyr «fjern feltet».
	const allowed = ['startDate', 'endDate', 'note', 'members', 'grid', 'trips'] as const;

	const existing = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { ferieProfile: true }
	});
	if (!existing) return json({ error: 'Not found' }, { status: 404 });

	const merged: Record<string, unknown> = {
		...((existing.ferieProfile ?? {}) as Record<string, unknown>)
	};
	for (const key of allowed) {
		if (!(key in body)) continue;
		const value = (body as Record<string, unknown>)[key];
		if (value === null || value === undefined) delete merged[key];
		else merged[key] = value;
	}

	await db
		.update(themes)
		.set({ ferieProfile: merged, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({ success: true });
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { ferieProfile: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });
	return json(theme.ferieProfile ?? {});
};
