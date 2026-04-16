import type { PageServerLoad } from './$types';
import { ensureUser } from '$lib/server/users';
import { db } from '$lib/db';
import { backgroundJobs } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	await ensureUser(locals.userId);

	const jobs = await db
		.select()
		.from(backgroundJobs)
		.where(eq(backgroundJobs.userId, locals.userId))
		.orderBy(desc(backgroundJobs.createdAt))
		.limit(100);

	return { jobs };
};
