import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { ensureThemeForUser } from '$lib/server/themes';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';

// Forfremmer en grov reise-blokk i en ferie til et fullt reise-tema (TripDashboard).
// Oppretter kun temaet og returnerer id-en; klienten skriver linkedThemeId tilbake i
// ferieProfile.trips og lagrer selv — slik unngår vi en race mot klientens autolagring.
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	const label = typeof body.label === 'string' ? body.label.trim() : '';
	const place = typeof body.place === 'string' ? body.place.trim() : '';
	const startDate = typeof body.startDate === 'string' ? body.startDate : undefined;
	const endDate = typeof body.endDate === 'string' ? body.endDate : undefined;

	const baseName = label || place || 'Reise';

	// Verifiser eierskap til ferie-temaet og hent navnet (brukes som parent-kategori).
	const ferieTheme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { name: true }
	});
	if (!ferieTheme) return json({ error: 'Not found' }, { status: 404 });

	// Navnet må resolve til travel-dashboardet. Hvis ikke, legg til «(reise)».
	const themeName = resolveThemeDashboardKind(baseName) === 'travel' ? baseName : `${baseName} (reise)`;

	const { theme } = await ensureThemeForUser({
		userId: locals.userId,
		name: themeName,
		emoji: '🗺️',
		parentTheme: ferieTheme.name
	});

	// Sett reiseprofil (destinasjon + datoer) på det nye temaet.
	await db
		.update(themes)
		.set({
			tripProfile: {
				destination: place || baseName,
				startDate,
				endDate
			},
			updatedAt: new Date()
		})
		.where(and(eq(themes.id, theme.id), eq(themes.userId, locals.userId)));

	return json({ themeId: theme.id, name: theme.name });
};
