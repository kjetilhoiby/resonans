import { listTasks, countTasksByBucket, type TaskBucket, type TaskFilters } from '$lib/server/tasks';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';

const BUCKETS: TaskBucket[] = ['innboks', 'gjores', 'ugjort'];

export const load: PageServerLoad = async ({ locals, url }) => {
	const bucketParam = url.searchParams.get('bucket');
	const bucket: TaskBucket = bucketParam && (BUCKETS as string[]).includes(bucketParam)
		? (bucketParam as TaskBucket)
		: 'innboks';

	const filters: TaskFilters = { bucket };

	const [tasks, userThemes, counts] = await Promise.all([
		listTasks(locals.userId, filters),
		db.query.themes.findMany({
			where: and(eq(themes.userId, locals.userId), eq(themes.archived, false)),
			columns: { id: true, name: true, emoji: true, parentTheme: true }
		}),
		countTasksByBucket(locals.userId)
	]);

	return {
		tasks: tasks.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() })),
		themes: userThemes,
		bucket,
		counts
	};
};
