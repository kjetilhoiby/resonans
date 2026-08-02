import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { loadSleepDashboardData } from '$lib/server/sleep-dashboard';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { findHealthThemeId } from '$lib/server/themes';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});

	if (!theme) {
		return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	}

	if (resolveThemeDashboardKind(theme.name) !== 'sleep') {
		return json({ error: 'Temaet har ikke søvndashboard.' }, { status: 400 });
	}

	const [dashboard, healthThemeId] = await Promise.all([
		loadSleepDashboardData(locals.userId),
		findHealthThemeId(locals.userId)
	]);

	// Søvnterskler (mål, varsel, suksess) bor på mortemaet — én kilde.
	const parent = healthThemeId
		? await db.query.themes.findFirst({
				where: eq(themes.id, healthThemeId),
				columns: { metricSettings: true }
			})
		: null;

	return json({ ...dashboard, metricSettings: parent?.metricSettings ?? {} });
};
