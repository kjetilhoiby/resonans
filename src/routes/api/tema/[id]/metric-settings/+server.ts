import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { themes } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

const ALLOWED_KEYS = ['distance', 'sleep', 'sleepLag', 'steps', 'activeMinutes', 'weight'] as const;
const ALLOWED_FIELDS = ['goal', 'thresholdWarn', 'thresholdSuccess'] as const;

export const GET: RequestHandler = async ({ params, locals }) => {
	const theme = await db.query.themes.findFirst({
		where: and(eq(themes.id, params.id), eq(themes.userId, locals.userId)),
		columns: { metricSettings: true }
	});
	if (!theme) return json({ error: 'Not found' }, { status: 404 });
	return json(theme.metricSettings ?? {});
};

export const PUT: RequestHandler = async ({ params, request, locals }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') {
		return json({ error: 'Invalid body' }, { status: 400 });
	}

	const settings: Record<string, Record<string, number>> = {};
	for (const key of ALLOWED_KEYS) {
		if (key in body && body[key] && typeof body[key] === 'object') {
			const entry: Record<string, number> = {};
			for (const field of ALLOWED_FIELDS) {
				const val = body[key][field];
				if (val != null && typeof val === 'number') entry[field] = val;
			}
			if (Object.keys(entry).length > 0) settings[key] = entry;
		}
	}

	await db
		.update(themes)
		.set({ metricSettings: settings, updatedAt: new Date() })
		.where(and(eq(themes.id, params.id), eq(themes.userId, locals.userId)));

	return json({ success: true });
};
