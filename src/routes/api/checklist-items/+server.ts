import { json } from '@sveltejs/kit';
import { listTasks, type TaskFilters, type TaskStatusFilter, type TaskTimeframeFilter } from '$lib/server/tasks';
import type { RequestHandler } from './$types';

const STATUSES: TaskStatusFilter[] = ['open', 'done', 'all'];
const TIMEFRAMES: TaskTimeframeFilter[] = ['overdue', 'today', 'this_week', 'next_week', 'no_due', 'all'];

export const GET: RequestHandler = async ({ locals, url }) => {
	const filters: TaskFilters = {};
	const status = url.searchParams.get('status');
	if (status && (STATUSES as string[]).includes(status)) filters.status = status as TaskStatusFilter;
	const timeframe = url.searchParams.get('timeframe');
	if (timeframe && (TIMEFRAMES as string[]).includes(timeframe)) filters.timeframe = timeframe as TaskTimeframeFilter;
	const theme = url.searchParams.get('theme');
	if (theme) filters.theme = theme;
	if (url.searchParams.get('unsorted') === '1') filters.unsortedOnly = true;

	const tasks = await listTasks(locals.userId, filters);
	return json({
		tasks: tasks.map((t) => ({
			...t,
			createdAt: t.createdAt.toISOString()
		}))
	});
};
