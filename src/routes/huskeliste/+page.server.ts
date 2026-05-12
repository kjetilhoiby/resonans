import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { tasks, projects } from '$lib/db/schema';
import { parseYearlyWindow, isActiveOn, formatYearlyWindowNo } from '$lib/server/pool/yearly-window';

type PoolRow = {
	id: string;
	title: string;
	description: string | null;
	estimatedMinutes: number | null;
	effort: string | null;
	dueDate: string | null;
	availableFrom: string | null;
	availableTo: string | null;
	yearlyWindow: string | null;
	contextTags: string[] | null;
	poolPriority: number;
	projectId: string | null;
	projectTitle: string | null;
	lastSurfacedAt: Date | null;
	createdAt: Date;
};

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;

	const rows: PoolRow[] = await db
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
			contextTags: tasks.contextTags,
			poolPriority: tasks.poolPriority,
			projectId: tasks.projectId,
			projectTitle: projects.title,
			lastSurfacedAt: tasks.lastSurfacedAt,
			createdAt: tasks.createdAt
		})
		.from(tasks)
		.leftJoin(projects, eq(tasks.projectId, projects.id))
		.where(and(eq(tasks.userId, userId), eq(tasks.isPool, true), eq(tasks.status, 'active')))
		.orderBy(asc(tasks.dueDate), desc(tasks.poolPriority), asc(tasks.createdAt));

	const now = new Date();
	const tasksOut = rows.map((r) => {
		const yearlyActive = r.yearlyWindow ? isActiveOn(r.yearlyWindow, now) : false;
		const yearlyLabel = r.yearlyWindow ? formatYearlyWindowNo(r.yearlyWindow) : null;
		const needsClarification = r.estimatedMinutes === null && !r.dueDate && !r.yearlyWindow;
		return {
			id: r.id,
			title: r.title,
			description: r.description,
			estimatedMinutes: r.estimatedMinutes,
			effort: r.effort,
			dueDate: r.dueDate,
			availableFrom: r.availableFrom,
			availableTo: r.availableTo,
			yearlyWindow: r.yearlyWindow,
			yearlyLabel,
			yearlyActiveNow: yearlyActive,
			contextTags: r.contextTags,
			projectId: r.projectId,
			projectTitle: r.projectTitle,
			needsClarification
		};
	});

	const projectList = await db
		.select({ id: projects.id, title: projects.title })
		.from(projects)
		.where(and(eq(projects.userId, userId)))
		.orderBy(asc(projects.title));

	return {
		tasks: tasksOut,
		projects: projectList
	};
};

export const actions = {
	add: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const titlesRaw = String(data.get('titles') || '').trim();
		if (!titlesRaw) return fail(400, { error: 'Mangler tittel.' });

		const titles = titlesRaw
			.split(/\n+|,/)
			.map((s) => s.trim())
			.filter(Boolean);
		if (titles.length === 0) return fail(400, { error: 'Mangler tittel.' });

		const projectId = String(data.get('projectId') || '').trim() || null;

		await db.insert(tasks).values(
			titles.map((title) => ({
				userId,
				title,
				projectId,
				isPool: true
			}))
		);

		return { success: true, addedCount: titles.length };
	},

	clarify: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const taskId = String(data.get('taskId') || '').trim();
		if (!taskId) return fail(400, { error: 'Mangler taskId.' });

		const estMinutesRaw = String(data.get('estimatedMinutes') || '').trim();
		const dueDateRaw = String(data.get('dueDate') || '').trim();
		const yearlyWindowRaw = String(data.get('yearlyWindow') || '').trim();

		const updates: Record<string, unknown> = { updatedAt: new Date() };
		if (estMinutesRaw) {
			const v = Number(estMinutesRaw);
			if (Number.isFinite(v) && v > 0) updates.estimatedMinutes = Math.round(v);
		}
		if (dueDateRaw && /^\d{4}-\d{2}-\d{2}$/.test(dueDateRaw)) {
			updates.dueDate = dueDateRaw;
		}
		if (yearlyWindowRaw && parseYearlyWindow(yearlyWindowRaw)) {
			updates.yearlyWindow = yearlyWindowRaw;
			updates.recurrenceYearly = true;
		}

		if (Object.keys(updates).length === 1) return { success: true, noop: true };

		await db
			.update(tasks)
			.set(updates)
			.where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
		return { success: true };
	},

	snooze: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const taskId = String(data.get('taskId') || '').trim();
		const days = Math.max(1, Math.round(Number(data.get('days') || '1')) || 1);
		if (!taskId) return fail(400, { error: 'Mangler taskId.' });

		const target = new Date();
		target.setUTCDate(target.getUTCDate() + days);
		const iso = target.toISOString().slice(0, 10);
		await db
			.update(tasks)
			.set({ availableFrom: iso, lastSurfacedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
		return { success: true };
	},

	complete: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const taskId = String(data.get('taskId') || '').trim();
		if (!taskId) return fail(400, { error: 'Mangler taskId.' });
		await db
			.update(tasks)
			.set({ status: 'done', updatedAt: new Date() })
			.where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
		return { success: true };
	},

	delete: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const taskId = String(data.get('taskId') || '').trim();
		if (!taskId) return fail(400, { error: 'Mangler taskId.' });
		await db.delete(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
		return { success: true };
	},

	promoteToWeek: async ({ locals, request }) => {
		const userId = locals.userId;
		const data = await request.formData();
		const taskId = String(data.get('taskId') || '').trim();
		const periodId = String(data.get('periodId') || '').trim();
		if (!taskId || !/^\d{4}-W\d{2}$/.test(periodId)) {
			return fail(400, { error: 'Mangler taskId eller ugyldig periodId.' });
		}
		const existing = await db.query.tasks.findFirst({
			where: and(eq(tasks.id, taskId), eq(tasks.userId, userId))
		});
		if (!existing) return fail(404, { error: 'Fant ikke oppgaven.' });
		const metadata = { ...((existing.metadata as Record<string, unknown> | null) ?? {}), promotedFromPool: true };
		await db
			.update(tasks)
			.set({ isPool: false, periodType: 'week', periodId, metadata, updatedAt: new Date() })
			.where(eq(tasks.id, taskId));
		return { success: true };
	}
} satisfies Actions;
