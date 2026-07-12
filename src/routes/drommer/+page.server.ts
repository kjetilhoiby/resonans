import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { db } from '$lib/db';
import { dreams, memories } from '$lib/db/schema';
import { and, desc, eq, isNull } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.userId;
	if (!userId) throw redirect(303, '/auth');

	const [all, valueMemories] = await Promise.all([
		db.query.dreams.findMany({
			where: eq(dreams.userId, userId),
			orderBy: [desc(dreams.createdAt)],
			limit: 100
		}),
		db.query.memories.findMany({
			where: and(
				eq(memories.userId, userId),
				eq(memories.category, 'values'),
				isNull(memories.supersededBy)
			),
			orderBy: [desc(memories.importance), desc(memories.createdAt)],
			limit: 12
		})
	]);

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
	// Retningen: brukerforfattede visjoner er selve siden; LLM-utkast er sekundært.
	const authored = visions.filter((d) => d.originKind === 'user_authored');
	const proposed = visions.filter((d) => d.originKind !== 'user_authored');
	const synthesis = active.filter((d) => d.kind.endsWith('_dream'));
	// Revisjonshistorikk for retningen: eldre brukerforfattede visjoner, nyest først.
	const visionHistory = historical.filter(
		(d) => d.kind.startsWith('vision_') && d.originKind === 'user_authored'
	);
	const synthesisHistory = historical.filter((d) => !visionHistory.includes(d));

	return {
		authored: authored.map(serialize),
		proposed: proposed.map(serialize),
		synthesis: synthesis.map(serialize),
		visionHistory: visionHistory.map(serialize),
		historical: synthesisHistory.map(serialize),
		values: valueMemories.map((m) => ({
			id: m.id,
			content: m.content,
			importance: m.importance,
			createdAt: m.createdAt.toISOString()
		}))
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
