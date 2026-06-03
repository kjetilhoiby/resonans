import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	const themeId = params.id;

	// Verify theme ownership
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId))
	});

	if (!theme) {
		return new Response('Theme not found', { status: 404 });
	}

	// Selve oppholdsplanen lever i themes.ferie_profile og rendres direkte av
	// FerieDashboard via PUT/GET på /api/tema/[id]/ferie. Dette er kun en placeholder
	// for den generiske dashboard-loaderen (speiler /dashboard/travel).
	const ferieDashboard = {
		themeName: theme.name,
		themeEmoji: theme.emoji,
		status: 'active'
	};

	return json(ferieDashboard);
};
