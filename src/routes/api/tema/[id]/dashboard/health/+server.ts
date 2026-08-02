import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { loadHealthDashboardData } from '$lib/server/health-dashboard';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { ensureHealthSubthemes } from '$lib/server/themes';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});

	if (!theme) {
		return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	}

	if (resolveThemeDashboardKind(theme.name) !== 'health') {
		return json({ error: 'Temaet har ikke helsedashboard.' }, { status: 400 });
	}

	// Selvhelbredende: undertemaene skal finnes når mordashboardet åpnes, også
	// for brukere som koblet Withings før mortema-strukturen fantes. Idempotent.
	await ensureHealthSubthemes(locals.userId);

	const dashboard = await loadHealthDashboardData(locals.userId);
	return json(dashboard);
};