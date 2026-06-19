import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq } from 'drizzle-orm';
import { loadVehicleMetrics } from '$lib/server/integrations/tesla-metrics';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId))
	});
	if (!theme) return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	if (resolveThemeDashboardKind(theme.name) !== 'vehicle') {
		return json({ error: 'Temaet har ikke kjøretøy-dashboard.' }, { status: 400 });
	}

	try {
		const metrics = await loadVehicleMetrics(userId);
		return json(metrics);
	} catch (err) {
		console.error('[vehicle-dashboard]', err);
		return json({ error: 'Kunne ikke laste kjøretøy-dashboard.' }, { status: 500 });
	}
};
