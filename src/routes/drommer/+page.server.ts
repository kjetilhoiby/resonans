import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { dreams } from '$lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw redirect(303, '/auth');

	const all = await db.query.dreams.findMany({
		where: eq(dreams.userId, userId),
		orderBy: [desc(dreams.createdAt)],
		limit: 60
	});

	// Grupper: nyeste per kind for "aktive", resten i historikk.
	const seen = new Set<string>();
	const active: typeof all = [];
	const historical: typeof all = [];
	for (const dream of all) {
		if (seen.has(dream.kind)) {
			historical.push(dream);
		} else {
			seen.add(dream.kind);
			active.push(dream);
		}
	}

	const visions = active.filter((d) => d.kind.startsWith('vision_'));
	const synthesis = active.filter((d) => d.kind.endsWith('_dream'));

	return {
		visions: visions.map(serialize),
		synthesis: synthesis.map(serialize),
		historical: historical.map(serialize)
	};
};

function serialize(d: typeof dreams.$inferSelect) {
	return {
		id: d.id,
		kind: d.kind,
		summary: d.summary,
		highlights: d.highlights,
		scopeStart: d.scopeStart.toISOString(),
		scopeEnd: d.scopeEnd.toISOString(),
		relevanceUntil: d.relevanceUntil?.toISOString() ?? null,
		confidence: d.confidence,
		originKind: d.originKind,
		createdAt: d.createdAt.toISOString()
	};
}
