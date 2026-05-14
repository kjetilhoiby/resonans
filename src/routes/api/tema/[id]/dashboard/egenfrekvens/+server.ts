import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { loadEgenfrekvensDashboardData } from '$lib/server/egenfrekvens-dashboard';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals, url }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId))
	});

	if (!theme) {
		return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	}

	if (resolveThemeDashboardKind(theme.name) !== 'egenfrekvens') {
		return json({ error: 'Temaet har ikke egenfrekvens-dashboard.' }, { status: 400 });
	}

	const rangeParam = Number(url.searchParams.get('rangeDays'));
	const rangeDays = Number.isFinite(rangeParam) && rangeParam > 0 && rangeParam <= 365 ? rangeParam : 30;

	const dashboard = await loadEgenfrekvensDashboardData(locals.userId, rangeDays);
	return json(dashboard);
};
