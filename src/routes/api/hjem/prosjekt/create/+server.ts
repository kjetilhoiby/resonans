import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { ensureThemeForUser } from '$lib/server/themes';

// Oppretter et hus-prosjekt som undertema av Hjem (parentTheme='Hjem'), analogt med
// hvordan /api/ferie/create lager ferie-undertemaer av Familie. Prosjektet arver
// egen chat, filer-fane og oppgave-fane fra tema-systemet.
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const name = typeof body?.name === 'string' ? body.name.trim() : '';
	const room = typeof body?.room === 'string' ? body.room.trim() : undefined;
	const targetDate = typeof body?.targetDate === 'string' ? body.targetDate.trim() : undefined;
	const emoji = typeof body?.emoji === 'string' && body.emoji.trim() ? body.emoji.trim() : '🔨';

	if (!name) {
		return json({ error: 'Mangler prosjektnavn' }, { status: 400 });
	}

	const { theme, created } = await ensureThemeForUser({
		userId: locals.userId,
		name,
		emoji,
		parentTheme: 'Hjem'
	});

	// Sett prosjekt-metadata kun for nye temaer — aldri overskriv et eksisterende prosjekt.
	if (created) {
		await db
			.update(themes)
			.set({
				projectProfile: {
					...(room ? { room } : {}),
					status: 'planning',
					...(targetDate ? { targetDate } : {})
				},
				updatedAt: new Date()
			})
			.where(and(eq(themes.id, theme.id), eq(themes.userId, locals.userId)));
	}

	return json({ themeId: theme.id, name, created });
};
