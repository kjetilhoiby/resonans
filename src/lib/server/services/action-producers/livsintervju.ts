import type { ActionProducer } from '../action-suggestion-service';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { reflections } from '$lib/db/schema';

/** Årlig rytme: nytt intervju når forrige er eldre enn ~11 måneder. */
const STALE_AFTER_DAYS = 335;

/**
 * «Livsintervjuet» — chip når retningen mangler helt (aldri gjennomført)
 * eller er moden for det årlige re-intervjuet.
 */
export const livsintervjuProducer: ActionProducer = async (ctx) => {
	const latest = await db.query.reflections.findFirst({
		where: and(eq(reflections.userId, ctx.userId), eq(reflections.kind, 'livsintervju')),
		orderBy: [desc(reflections.createdAt)],
		columns: { createdAt: true }
	});

	const ageDays = latest
		? (ctx.now.getTime() - latest.createdAt.getTime()) / 86_400_000
		: Infinity;
	if (ageDays < STALE_AFTER_DAYS) return [];

	return [
		{
			id: 'livsintervju',
			icon: '🧭',
			label: 'Livsintervjuet',
			value: latest ? 'Årlig oppdatering' : 'Sett retningen',
			priority: latest ? 55 : 65,
			source: 'system',
			intent: { kind: 'open-flow', flowId: 'livsintervju' }
		}
	];
};
