import { json } from '@sveltejs/kit';
import { buildCanonicalActivityFeed } from '$lib/server/activity-layer';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	try {
		const days = Math.min(365, Math.max(7, Number.parseInt(url.searchParams.get('days') ?? '90', 10)));
		const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
		const feed = await buildCanonicalActivityFeed(locals.userId, {
			since,
			limit: 500
		});

		return json({
			success: true,
			days,
			count: feed.length,
			activities: feed
		});
	} catch (error) {
		console.error('Failed to build canonical activity feed:', error);
		return json({ success: false, error: 'Failed to build canonical activity feed' }, { status: 500 });
	}
};