import { listTasks, type TaskFilters, type TaskStatusFilter, type TaskTimeframeFilter } from '$lib/server/tasks';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

const STATUSES: TaskStatusFilter[] = ['open', 'done', 'all'];
const TIMEFRAMES: TaskTimeframeFilter[] = ['overdue', 'today', 'this_week', 'next_week', 'no_due', 'all'];

export const load: PageServerLoad = async ({ locals, url }) => {
	const filters: TaskFilters = {};
	const status = url.searchParams.get('status');
	filters.status = status && (STATUSES as string[]).includes(status) ? (status as TaskStatusFilter) : 'open';
	const timeframe = url.searchParams.get('timeframe');
	filters.timeframe = timeframe && (TIMEFRAMES as string[]).includes(timeframe) ? (timeframe as TaskTimeframeFilter) : 'all';
	const theme = url.searchParams.get('theme');
	filters.theme = theme ?? 'all';
	filters.unsortedOnly = url.searchParams.get('usortert') === '1';

	const [tasks, userThemes] = await Promise.all([
		listTasks(locals.userId, filters),
		db.query.themes.findMany({
			where: and(eq(themes.userId, locals.userId), eq(themes.archived, false)),
			columns: { id: true, name: true, emoji: true, parentTheme: true }
		})
	]);

	return {
		tasks: tasks.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
		themes: userThemes,
		filters
	};
};
