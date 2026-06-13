import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { asc, eq } from 'drizzle-orm';
import {
	getThemeDashboardDefinition,
	resolveThemeDashboardKind
} from '$lib/domain/theme-dashboard-registry';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const rows = await db
		.select({
			id: themes.id,
			name: themes.name,
			emoji: themes.emoji,
			parentTheme: themes.parentTheme,
			archived: themes.archived,
			sortOrder: themes.sortOrder,
			tripProfile: themes.tripProfile,
			ferieProfile: themes.ferieProfile,
			metricSettings: themes.metricSettings
		})
		.from(themes)
		.where(eq(themes.userId, locals.userId))
		.orderBy(asc(themes.sortOrder), asc(themes.createdAt));

	const all = rows.map((t) => ({
		...t,
		kind: resolveThemeDashboardKind(t.name),
		dashboardLabel: getThemeDashboardDefinition(t.name)?.label ?? null
	}));

	return {
		active: all.filter((t) => !t.archived),
		archived: all.filter((t) => t.archived)
	};
};
