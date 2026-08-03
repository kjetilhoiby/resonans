import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// Delvis oppdatering av kun ferieProfile.note — leser eksisterende profil og fletter,
// så grid/medlemmer/reiser ikke slettes. Brukes fra ferie-tab i familie-dashboardet.
export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid body' }, { status: 400 });
	}
	const note = typeof body.note === 'string' ? body.note.trim() : '';

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { ferieProfile: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });

	const current = (theme.ferieProfile ?? {}) as Record<string, unknown>;
	const updated = { ...current };
	if (note) updated.note = note;
	else delete updated.note;

	await db
		.update(themes)
		.set({ ferieProfile: updated, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({ success: true });
};
