import { db } from '$lib/db';
import { projects, tasks, checklistItems, categorizedEvents } from '$lib/db/schema';
import { ProjectMetricsService } from '$lib/server/services/project-metrics-service';
import { and, eq, desc } from 'drizzle-orm';
import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const userId = locals.userId;
	const projectId = params.id;

	const project = await db.query.projects.findFirst({
		where: and(eq(projects.id, projectId), eq(projects.userId, userId))
	});
	if (!project) throw error(404, 'Prosjekt ikke funnet');

	const [progress, projectTasks, projectItems, projectTransactions] = await Promise.all([
		ProjectMetricsService.getProjectProgress(projectId, userId),
		db
			.select()
			.from(tasks)
			.where(eq(tasks.projectId, projectId))
			.orderBy(desc(tasks.createdAt)),
		db
			.select()
			.from(checklistItems)
			.where(eq(checklistItems.projectId, projectId))
			.orderBy(checklistItems.sortOrder),
		db
			.select()
			.from(categorizedEvents)
			.where(and(eq(categorizedEvents.projectId, projectId), eq(categorizedEvents.userId, userId)))
			.orderBy(desc(categorizedEvents.timestamp))
			.limit(50)
	]);

	return {
		project,
		progress,
		tasks: projectTasks,
		checklistItems: projectItems,
		transactions: projectTransactions.map((t) => ({
			id: t.id,
			timestamp: t.timestamp,
			amount: Number(t.amount),
			description: t.description,
			category: t.resolvedCategory,
			label: t.resolvedLabel
		}))
	};
};
