import { z } from 'zod';
import { ProjectMetricsService, type ProjectStatus } from '$lib/server/services/project-metrics-service';
import { db } from '$lib/db';
import { projects } from '$lib/db/schema';
import { and, eq, ilike } from 'drizzle-orm';
import type { DomainType } from '$lib/domains';

export const queryProjectsTool = {
	name: 'query_projects',
	description: `List projects (with burn-up + cost-vs-budget) for the user. Filter by domain, status, theme, or search by title.
Returns each project with progress: { tasksTotal, tasksDone, itemsTotal, itemsDone, spentNok, budgetNok, percentComplete, budgetPercent }.

Use this BEFORE manage_project.update/complete to look up the projectId.`,
	parameters: z.object({
		userId: z.string(),
		domain: z.string().optional().describe("Filter by domain, e.g. 'home'"),
		status: z.enum(['planning', 'active', 'paused', 'done', 'cancelled']).optional(),
		themeId: z.string().optional(),
		searchTitle: z.string().optional().describe('Case-insensitive partial title match'),
		projectId: z.string().optional().describe('Fetch a single project by id with progress')
	}),
	execute: async (args: {
		userId: string;
		domain?: string;
		status?: ProjectStatus;
		themeId?: string;
		searchTitle?: string;
		projectId?: string;
	}) => {
		if (args.projectId) {
			const project = await db.query.projects.findFirst({
				where: and(eq(projects.id, args.projectId), eq(projects.userId, args.userId))
			});
			if (!project) return { error: 'Project not found' };
			const progress = await ProjectMetricsService.getProjectProgress(args.projectId, args.userId);
			return { project: { ...project, progress } };
		}

		if (args.searchTitle) {
			const conditions = [eq(projects.userId, args.userId), ilike(projects.title, `%${args.searchTitle}%`)];
			if (args.domain) conditions.push(eq(projects.domain, args.domain));
			if (args.status) conditions.push(eq(projects.status, args.status));
			if (args.themeId) conditions.push(eq(projects.themeId, args.themeId));
			const rows = await db
				.select()
				.from(projects)
				.where(and(...conditions))
				.orderBy(projects.createdAt);
			const ids = rows.map((r) => r.id);
			const progress = await ProjectMetricsService.getProgressForProjects(ids, args.userId);
			return { projects: rows.map((r) => ({ ...r, progress: progress[r.id] ?? null })) };
		}

		const list = await ProjectMetricsService.listProjectsWithProgress(args.userId, {
			domain: args.domain as DomainType | undefined,
			status: args.status,
			themeId: args.themeId
		});
		return { projects: list };
	}
};
