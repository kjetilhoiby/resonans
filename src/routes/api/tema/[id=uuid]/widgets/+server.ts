/**
 * GET /api/tema/[id]/widgets — list widgets for a theme.
 *                              Seeds defaults the first time a user opens a
 *                              theme that has a configurable dashboard.
 */
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { createUserWidget, listUserWidgets } from '$lib/skills/widget-creation/service';
import { resolveThemeDashboardKind } from '$lib/domain/theme-dashboard-registry';
import { getThemeWidgetDefaults } from '$lib/skills/widget-creation/theme-defaults';

export const GET: RequestHandler = async ({ params, locals }) => {
	const userId = locals.userId;
	const themeId = params.id;

	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, themeId), eq(themes.userId, userId))
	});
	if (!theme) throw error(404, 'Tema ikke funnet');

	let widgets = await listUserWidgets(userId, { themeId });

	if (widgets.length === 0) {
		const kind = resolveThemeDashboardKind(theme.name);
		const defaults = getThemeWidgetDefaults(kind);
		if (defaults.length > 0) {
			await Promise.all(
				defaults.map((d, i) =>
					createUserWidget(userId, { ...d, themeId, sortOrder: i })
				)
			);
			widgets = await listUserWidgets(userId, { themeId });
		}
	}

	return json(widgets);
};
