import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { and, eq } from 'drizzle-orm';
import { loadFamilyDashboardData } from '$lib/server/family-dashboard';

export const GET: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, userId))
	});
	if (!theme) return json({ error: 'Tema ikke funnet.' }, { status: 404 });
	if (resolveThemeDashboardKind(theme.name) !== 'family') {
		return json({ error: 'Temaet har ikke familiedashboard.' }, { status: 400 });
	}
	const data = await loadFamilyDashboardData(userId);
	return json(data);
};
