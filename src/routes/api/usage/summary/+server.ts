import { json } from '@sveltejs/kit';
import { and, eq, gte } from 'drizzle-orm';
import { db } from '$lib/db';
import { usageEvents } from '$lib/db/schema';
import { summarizeUsage } from '$lib/server/services/usage-summary';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) return json({ error: 'Ikke innlogget' }, { status: 401 });

	const daysParam = Number(url.searchParams.get('days'));
	const days = Number.isFinite(daysParam) ? Math.min(Math.max(daysParam, 1), 365) : 30;
	const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

	const events = await db
		.select({
			eventType: usageEvents.eventType,
			path: usageEvents.path,
			metadata: usageEvents.metadata,
			createdAt: usageEvents.createdAt
		})
		.from(usageEvents)
		.where(and(eq(usageEvents.userId, locals.userId), gte(usageEvents.createdAt, since)));

	return json({ days, since: since.toISOString(), ...summarizeUsage(events) });
};
