import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireTheme } from '$lib/server/project-tasks';
import { isProjectKind } from '$lib/domain/project-kinds';

// Oppdater prosjekt-profilen til et hjem-prosjekt (tema). Brukes til å bytte
// prosjekttype (kind), sette rom, frist eller status i etterkant av opprettelsen.
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const userId = locals.userId;
	const theme = await requireTheme(userId, params.id);

	const body = await request.json().catch(() => null);
	const profile = { ...((theme.projectProfile ?? {}) as Record<string, unknown>) };

	if ('kind' in (body ?? {})) {
		if (!isProjectKind(body.kind)) throw error(400, 'Ukjent prosjekttype');
		profile.kind = body.kind;
	}
	if ('room' in (body ?? {})) {
		profile.room = typeof body.room === 'string' && body.room.trim() ? body.room.trim() : undefined;
	}
	if ('targetDate' in (body ?? {})) {
		profile.targetDate =
			typeof body.targetDate === 'string' && body.targetDate.trim() ? body.targetDate.trim() : undefined;
	}
	if ('status' in (body ?? {})) {
		const allowed = ['planning', 'active', 'paused', 'done'];
		if (typeof body.status === 'string' && allowed.includes(body.status)) {
			profile.status = body.status;
		}
	}

	await db
		.update(themes)
		.set({ projectProfile: profile, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, userId)));

	return json({ ok: true, projectProfile: profile });
};
