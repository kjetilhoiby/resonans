import { ProjectMetricsService } from '$lib/server/services/project-metrics-service';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const [allProjects, userThemes] = await Promise.all([
		ProjectMetricsService.listProjectsWithProgress(locals.userId),
		db
			.select({ id: themes.id, name: themes.name, emoji: themes.emoji })
			.from(themes)
			.where(eq(themes.userId, locals.userId))
	]);

	const themeMap = new Map(userThemes.map((t) => [t.id, t]));

	return {
		projects: allProjects.map((p) => ({
			id: p.id,
			title: p.title,
			description: p.description,
			domain: p.domain,
			type: p.type,
			status: p.status,
			budgetNok: p.budgetNok,
			emoji: (p.metadata as Record<string, unknown>)?.emoji as string | null ?? null,
			themeId: p.themeId,
			themeName: p.themeId ? themeMap.get(p.themeId)?.name ?? null : null,
			themeEmoji: p.themeId ? themeMap.get(p.themeId)?.emoji ?? null : null,
			createdAt: p.createdAt.toISOString(),
			progress: p.progress
		}))
	};
};
