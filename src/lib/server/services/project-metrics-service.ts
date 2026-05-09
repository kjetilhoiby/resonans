import { db } from '$lib/db';
import { projects, tasks, checklistItems, categorizedEvents } from '$lib/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DomainType } from '$lib/domains';

export type ProjectStatus = 'planning' | 'active' | 'paused' | 'done' | 'cancelled';

export interface ProjectProgress {
	projectId: string;
	tasksTotal: number;
	tasksDone: number;
	itemsTotal: number;
	itemsDone: number;
	spentNok: number;
	budgetNok: number | null;
	percentComplete: number; // 0-100, based on tasks+items completion
	budgetPercent: number | null; // 0-100, null if no budget
}

export class ProjectMetricsService {
	/**
	 * Compute burn-up + spend for a single project. Aggregates from tasks,
	 * checklist_items and categorized_events that point at the project.
	 */
	static async getProjectProgress(projectId: string, userId: string): Promise<ProjectProgress | null> {
		const project = await db.query.projects.findFirst({
			where: and(eq(projects.id, projectId), eq(projects.userId, userId)),
			columns: { id: true, budgetNok: true }
		});
		if (!project) return null;

		const [taskCounts, itemCounts, spendRow] = await Promise.all([
			db
				.select({
					total: sql<number>`count(*)::int`,
					done: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`
				})
				.from(tasks)
				.where(eq(tasks.projectId, projectId)),
			db
				.select({
					total: sql<number>`count(*)::int`,
					done: sql<number>`count(*) filter (where ${checklistItems.checked} = true)::int`
				})
				.from(checklistItems)
				.where(eq(checklistItems.projectId, projectId)),
			db
				.select({
					spent: sql<string | null>`coalesce(sum(${categorizedEvents.amount}), 0)`
				})
				.from(categorizedEvents)
				.where(and(eq(categorizedEvents.projectId, projectId), eq(categorizedEvents.userId, userId)))
		]);

		const tasksTotal = taskCounts[0]?.total ?? 0;
		const tasksDone = taskCounts[0]?.done ?? 0;
		const itemsTotal = itemCounts[0]?.total ?? 0;
		const itemsDone = itemCounts[0]?.done ?? 0;
		const totalUnits = tasksTotal + itemsTotal;
		const doneUnits = tasksDone + itemsDone;
		const percentComplete = totalUnits === 0 ? 0 : Math.round((doneUnits / totalUnits) * 100);
		// Bank transactions are signed: outflows are negative. Spend = abs(sum of negatives).
		// For simplicity, treat any negative sum as spend; positive as net-inflow (refund/deposit).
		const rawSpent = Number(spendRow[0]?.spent ?? 0);
		const spentNok = Math.abs(Math.min(rawSpent, 0));
		const budgetNok = project.budgetNok ?? null;
		const budgetPercent =
			budgetNok && budgetNok > 0 ? Math.round((spentNok / budgetNok) * 100) : null;

		return {
			projectId,
			tasksTotal,
			tasksDone,
			itemsTotal,
			itemsDone,
			spentNok,
			budgetNok,
			percentComplete,
			budgetPercent
		};
	}

	/**
	 * Bulk-fetch progress for multiple projects in a single roundtrip per source.
	 */
	static async getProgressForProjects(projectIds: string[], userId: string): Promise<Record<string, ProjectProgress>> {
		if (projectIds.length === 0) return {};

		const [projectRows, taskRows, itemRows, spendRows] = await Promise.all([
			db
				.select({ id: projects.id, budgetNok: projects.budgetNok })
				.from(projects)
				.where(and(eq(projects.userId, userId), sql`${projects.id} = ANY(${projectIds})`)),
			db
				.select({
					projectId: tasks.projectId,
					total: sql<number>`count(*)::int`,
					done: sql<number>`count(*) filter (where ${tasks.status} = 'completed')::int`
				})
				.from(tasks)
				.where(sql`${tasks.projectId} = ANY(${projectIds})`)
				.groupBy(tasks.projectId),
			db
				.select({
					projectId: checklistItems.projectId,
					total: sql<number>`count(*)::int`,
					done: sql<number>`count(*) filter (where ${checklistItems.checked} = true)::int`
				})
				.from(checklistItems)
				.where(sql`${checklistItems.projectId} = ANY(${projectIds})`)
				.groupBy(checklistItems.projectId),
			db
				.select({
					projectId: categorizedEvents.projectId,
					spent: sql<string | null>`sum(${categorizedEvents.amount})`
				})
				.from(categorizedEvents)
				.where(and(eq(categorizedEvents.userId, userId), sql`${categorizedEvents.projectId} = ANY(${projectIds})`))
				.groupBy(categorizedEvents.projectId)
		]);

		const result: Record<string, ProjectProgress> = {};
		const taskMap = new Map(taskRows.filter((r) => r.projectId).map((r) => [r.projectId!, r]));
		const itemMap = new Map(itemRows.filter((r) => r.projectId).map((r) => [r.projectId!, r]));
		const spendMap = new Map(spendRows.filter((r) => r.projectId).map((r) => [r.projectId!, r]));

		for (const proj of projectRows) {
			const t = taskMap.get(proj.id);
			const i = itemMap.get(proj.id);
			const s = spendMap.get(proj.id);
			const tasksTotal = t?.total ?? 0;
			const tasksDone = t?.done ?? 0;
			const itemsTotal = i?.total ?? 0;
			const itemsDone = i?.done ?? 0;
			const totalUnits = tasksTotal + itemsTotal;
			const doneUnits = tasksDone + itemsDone;
			const rawSpent = Number(s?.spent ?? 0);
			const spentNok = Math.abs(Math.min(rawSpent, 0));
			const budgetNok = proj.budgetNok ?? null;
			result[proj.id] = {
				projectId: proj.id,
				tasksTotal,
				tasksDone,
				itemsTotal,
				itemsDone,
				spentNok,
				budgetNok,
				percentComplete: totalUnits === 0 ? 0 : Math.round((doneUnits / totalUnits) * 100),
				budgetPercent: budgetNok && budgetNok > 0 ? Math.round((spentNok / budgetNok) * 100) : null
			};
		}
		return result;
	}

	/**
	 * List projects for a user filtered by domain/status, with progress attached.
	 */
	static async listProjectsWithProgress(
		userId: string,
		filter?: { domain?: DomainType | null; status?: ProjectStatus; themeId?: string }
	) {
		const conditions = [eq(projects.userId, userId)];
		if (filter?.domain !== undefined) {
			conditions.push(filter.domain === null ? isNull(projects.domain) : eq(projects.domain, filter.domain));
		}
		if (filter?.status) conditions.push(eq(projects.status, filter.status));
		if (filter?.themeId) conditions.push(eq(projects.themeId, filter.themeId));

		const rows = await db
			.select()
			.from(projects)
			.where(and(...conditions))
			.orderBy(projects.createdAt);

		const ids = rows.map((r) => r.id);
		const progress = await this.getProgressForProjects(ids, userId);
		return rows.map((r) => ({ ...r, progress: progress[r.id] ?? null }));
	}
}
