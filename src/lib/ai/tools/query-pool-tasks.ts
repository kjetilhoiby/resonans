import { z } from 'zod';
import { and, eq, lte, isNull, or, asc } from 'drizzle-orm';
import { db } from '$lib/db';
import { tasks, projects } from '$lib/db/schema';
import { isActiveOn, formatYearlyWindowNo } from '$lib/server/pool/yearly-window';

export const queryPoolTasksTool = {
	name: 'query_pool_tasks',
	description: `Hent oppgaver fra brukerens huskeliste (pool). Bruk når brukeren spør "hva har jeg på huskelista?", "hva må gjøres før mai?", "hva er knyttet til prosjekt X?", eller når AI trenger å se stubs som mangler info.

Filtre:
- projectId: kun tasks knyttet til ett prosjekt
- needsClarification: kun stubs som mangler både estimat og frist
- dueBefore: kun tasks med dueDate ≤ denne ISO-datoen
- includeYearlyActive: ta også med tasks med aktiv yearlyWindow nå (default true)
- limit: maks antall (default 20)`,
	parameters: z.object({
		userId: z.string(),
		projectId: z.string().optional(),
		needsClarification: z.boolean().optional(),
		dueBefore: z.string().optional(),
		includeYearlyActive: z.boolean().optional(),
		limit: z.number().int().positive().max(100).optional()
	}),
	execute: async (args: {
		userId: string;
		projectId?: string;
		needsClarification?: boolean;
		dueBefore?: string;
		includeYearlyActive?: boolean;
		limit?: number;
	}) => {
		const conditions = [
			eq(tasks.userId, args.userId),
			eq(tasks.isPool, true),
			eq(tasks.status, 'active')
		];
		if (args.projectId) conditions.push(eq(tasks.projectId, args.projectId));
		if (args.dueBefore) conditions.push(lte(tasks.dueDate, args.dueBefore));

		const rows = await db
			.select({
				id: tasks.id,
				title: tasks.title,
				description: tasks.description,
				estimatedMinutes: tasks.estimatedMinutes,
				effort: tasks.effort,
				dueDate: tasks.dueDate,
				availableFrom: tasks.availableFrom,
				availableTo: tasks.availableTo,
				yearlyWindow: tasks.yearlyWindow,
				poolPriority: tasks.poolPriority,
				projectId: tasks.projectId,
				projectTitle: projects.title,
				contextTags: tasks.contextTags
			})
			.from(tasks)
			.leftJoin(projects, eq(tasks.projectId, projects.id))
			.where(and(...conditions))
			.orderBy(asc(tasks.dueDate), asc(tasks.createdAt))
			.limit(args.limit ?? 20);

		const now = new Date();
		let filtered = rows;
		if (args.needsClarification) {
			filtered = filtered.filter((r) => r.estimatedMinutes === null && !r.dueDate && !r.yearlyWindow);
		}

		return {
			tasks: filtered.map((r) => ({
				id: r.id,
				title: r.title,
				description: r.description,
				estimatedMinutes: r.estimatedMinutes,
				effort: r.effort,
				dueDate: r.dueDate,
				availableFrom: r.availableFrom,
				availableTo: r.availableTo,
				yearlyWindow: r.yearlyWindow,
				yearlyWindowLabel: r.yearlyWindow ? formatYearlyWindowNo(r.yearlyWindow) : null,
				yearlyActiveNow: r.yearlyWindow ? isActiveOn(r.yearlyWindow, now) : false,
				projectId: r.projectId,
				projectTitle: r.projectTitle,
				contextTags: r.contextTags,
				needsClarification: r.estimatedMinutes === null && !r.dueDate && !r.yearlyWindow
			}))
		};
	}
};
