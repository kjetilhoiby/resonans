import { ProjectMetricsService } from '$lib/server/services/project-metrics-service';
import { db } from '$lib/db';
import { themes, sensorEvents, tasks, projects } from '$lib/db/schema';
import { and, eq, gte, desc, sql, inArray } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const now = new Date();
	const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

	const [jobbProjects, userThemes, focusSessions] = await Promise.all([
		ProjectMetricsService.listProjectsWithProgress(locals.userId, { domain: 'jobb' }),
		db
			.select({ id: themes.id, name: themes.name, emoji: themes.emoji })
			.from(themes)
			.where(eq(themes.userId, locals.userId)),
		db
			.select()
			.from(sensorEvents)
			.where(
				and(
					eq(sensorEvents.userId, locals.userId),
					eq(sensorEvents.dataType, 'focus_session'),
					gte(sensorEvents.timestamp, weekAgo)
				)
			)
			.orderBy(desc(sensorEvents.timestamp))
			.limit(20)
	]);

	const jobbProjectIds = jobbProjects.map((p) => p.id);
	const recentTasks = jobbProjectIds.length > 0
		? await db
			.select({
				id: tasks.id,
				title: tasks.title,
				status: tasks.status,
				projectId: tasks.projectId,
				createdAt: tasks.createdAt
			})
			.from(tasks)
			.where(
				and(
					eq(tasks.status, 'active'),
					inArray(tasks.projectId, jobbProjectIds)
				)
			)
			.orderBy(desc(tasks.createdAt))
			.limit(20)
		: [];

	const themeMap = new Map(userThemes.map((t) => [t.id, t]));

	const focusThisWeek = focusSessions.reduce((sum, s) => {
		const data = s.data as Record<string, unknown> | null;
		return sum + (typeof data?.durationMinutes === 'number' ? data.durationMinutes : 0);
	}, 0);

	return {
		projects: jobbProjects.map((p) => ({
			id: p.id,
			title: p.title,
			description: p.description,
			type: p.type,
			status: p.status,
			budgetNok: p.budgetNok,
			emoji: (p.metadata as Record<string, unknown>)?.emoji as string | null ?? null,
			themeId: p.themeId,
			themeName: p.themeId ? themeMap.get(p.themeId)?.name ?? null : null,
			themeEmoji: p.themeId ? themeMap.get(p.themeId)?.emoji ?? null : null,
			targetCompletionAt: p.targetCompletionAt?.toISOString() ?? null,
			createdAt: p.createdAt.toISOString(),
			progress: p.progress
		})),
		focusSessions: focusSessions.map((s) => {
			const data = s.data as Record<string, unknown> | null;
			return {
				id: s.id,
				task: typeof data?.task === 'string' ? data.task : '',
				durationMinutes: typeof data?.durationMinutes === 'number' ? data.durationMinutes : 0,
				timestamp: s.timestamp.toISOString()
			};
		}),
		focusMinutesThisWeek: focusThisWeek,
		tasks: recentTasks.map((t) => ({
			id: t.id,
			title: t.title,
			status: t.status,
			projectId: t.projectId,
			createdAt: t.createdAt.toISOString()
		}))
	};
};
