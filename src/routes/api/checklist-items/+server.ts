import { json } from '@sveltejs/kit';
import { listTasks, type TaskBucket, type TaskFilters } from '$lib/server/tasks';
import type { RequestHandler } from './$types';

const BUCKETS: TaskBucket[] = ['innboks', 'gjores', 'ugjort'];

export const GET: RequestHandler = async ({ locals, url }) => {
	const filters: TaskFilters = {};
	const bucket = url.searchParams.get('bucket');
	if (bucket && (BUCKETS as string[]).includes(bucket)) filters.bucket = bucket as TaskBucket;
	const theme = url.searchParams.get('theme');
	if (theme) filters.theme = theme;

	const tasks = await listTasks(locals.userId, filters);
	return json({
		tasks: tasks.map((t) => ({
			...t,
			createdAt: t.createdAt.toISOString()
		}))
	});
};
