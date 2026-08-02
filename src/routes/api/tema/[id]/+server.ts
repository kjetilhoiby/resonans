import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes, goals, memories } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

// PATCH /api/tema/[id] — soft-arkivering (skjuler temaet, data beholdes) og
// re-foreldring. Begge felt er valgfrie, men minst ett må være med.
export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	const archived = body?.archived;
	const hasArchived = archived !== undefined;
	const hasParentTheme = body !== null && 'parentTheme' in body;

	if (!hasArchived && !hasParentTheme) {
		return json({ error: 'archived (boolean) eller parentTheme (string|null) kreves' }, { status: 400 });
	}
	if (hasArchived && typeof archived !== 'boolean') {
		return json({ error: 'archived må være boolean' }, { status: 400 });
	}

	const patch: { archived?: boolean; parentTheme?: string | null; updatedAt: Date } = {
		updatedAt: new Date()
	};
	if (hasArchived) patch.archived = archived;

	if (hasParentTheme) {
		const parentTheme = body.parentTheme;
		if (parentTheme === null || parentTheme === '') {
			patch.parentTheme = null;
		} else if (typeof parentTheme !== 'string') {
			return json({ error: 'parentTheme må være string eller null' }, { status: 400 });
		} else {
			// parentTheme er fritekst mot forelderens NAVN, ikke en FK. Vi kan
			// derfor ikke la databasen validere den — sjekk i stedet at brukeren
			// faktisk har et tema med det navnet, så vi ikke lager foreldreløse
			// barn på en skrivefeil. Temaet kan ikke være sin egen forelder.
			const parent = await db.query.themes.findFirst({
				where: and(eq(themes.userId, locals.userId), eq(themes.name, parentTheme)),
				columns: { id: true }
			});
			if (!parent) {
				return json({ error: `Fant ingen tema med navnet «${parentTheme}»` }, { status: 400 });
			}
			if (parent.id === params.id) {
				return json({ error: 'Et tema kan ikke være sin egen forelder' }, { status: 400 });
			}
			patch.parentTheme = parentTheme;
		}
	}

	const res = await db
		.update(themes)
		.set(patch)
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)))
		.returning({ id: themes.id });

	if (res.length === 0) return json({ error: 'Not found' }, { status: 404 });
	return json({ success: true });
};

// DELETE /api/tema/[id] — permanent sletting. De fleste avhengighetene har
// ON DELETE CASCADE / SET NULL i skjemaet og rydder seg selv. goals og memories
// refererer themes uten onDelete (RESTRICT), så de nulles eksplisitt først.
// neon-http støtter ikke transaksjoner, så stegene kjøres sekvensielt.
export const DELETE: RequestHandler = async ({ params, locals }) => {
	const existing = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { id: true }
	});
	if (!existing) return json({ error: 'Not found' }, { status: 404 });

	await db
		.update(goals)
		.set({ themeId: null })
		.where(and(eq(goals.themeId, params.id), eq(goals.userId, locals.userId)));
	await db
		.update(memories)
		.set({ themeId: null })
		.where(and(eq(memories.themeId, params.id), eq(memories.userId, locals.userId)));
	await db.delete(themes).where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({ success: true });
};
