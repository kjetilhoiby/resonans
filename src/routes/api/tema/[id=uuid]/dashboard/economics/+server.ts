import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { loadEconomicsDashboardData } from '$lib/server/economics-dashboard';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});

	if (!theme) {
		return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	}

	if (resolveThemeDashboardKind(theme.name) !== 'economics') {
		return json({ error: 'Temaet har ikke økonomidashboard.' }, { status: 400 });
	}

	const dashboard = await loadEconomicsDashboardData(locals.userId);
	return json(dashboard);
};