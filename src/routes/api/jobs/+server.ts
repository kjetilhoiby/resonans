import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { backgroundJobs } from '$lib/db/schema';
import { eq, desc } from 'drizzle-orm';

export const GET: RequestHandler = async ({ locals }) => {
	const rows = await db
		.select()
		.from(backgroundJobs)
		.where(eq(backgroundJobs.userId, locals.userId))
		.orderBy(desc(backgroundJobs.createdAt))
		.limit(100);

	return json({ success: true, jobs: rows });
};
