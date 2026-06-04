import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { ensureThemeForUser } from '$lib/server/themes';
import { FERIE_SEASONS, ferieWindow, toISODate, type FerieSeasonKey } from '$lib/ferie/seasons';

// Oppretter et ferie-tema for en sesong+år fra «Planlegg ferie»-quick-actionen.
// Navnet («Sommerferie 2026») resolver til ferie-dashboardet, og det omtrentlige
// vinduet prefylles i ferieProfile (kan justeres i dashboardet).
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = await request.json().catch(() => null);
	const key = body?.season as FerieSeasonKey | undefined;
	const year = Number(body?.year);

	if (!key || !FERIE_SEASONS[key] || !Number.isInteger(year)) {
		return json({ error: 'Invalid season or year' }, { status: 400 });
	}

	const def = FERIE_SEASONS[key];
	const name = `${def.label} ${year}`;
	const win = ferieWindow(key, year);

	const { theme, created } = await ensureThemeForUser({
		userId: locals.userId,
		name,
		emoji: def.emoji,
		parentTheme: 'Familie'
	});

	// Prefyll det omtrentlige vinduet. For nye temaer settes det rett; for
	// eksisterende etterfylles kun manglende datoer (aldri overskriv en
	// populert oppholdsplan med grid/medlemmer/reiser eller justerte datoer).
	if (created) {
		await db
			.update(themes)
			.set({
				ferieProfile: { startDate: toISODate(win.start), endDate: toISODate(win.end) },
				updatedAt: new Date()
			})
			.where(and(eq(themes.id, theme.id), eq(themes.userId, locals.userId)));
	} else {
		const existing = await db.query.themes.findFirst({
			where: and(eq(themes.id, theme.id), eq(themes.userId, locals.userId)),
			columns: { ferieProfile: true }
		});
		const cur = (existing?.ferieProfile ?? {}) as {
			startDate?: string;
			endDate?: string;
			[k: string]: unknown;
		};
		if (!cur.startDate || !cur.endDate) {
			await db
				.update(themes)
				.set({
					ferieProfile: {
						...cur,
						startDate: cur.startDate ?? toISODate(win.start),
						endDate: cur.endDate ?? toISODate(win.end)
					},
					updatedAt: new Date()
				})
				.where(and(eq(themes.id, theme.id), eq(themes.userId, locals.userId)));
		}
	}

	return json({ themeId: theme.id, name });
};
