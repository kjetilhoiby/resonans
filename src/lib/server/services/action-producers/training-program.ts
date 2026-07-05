import type { ActionProducer } from '../action-suggestion-service';
import type { ActionCandidate } from '$lib/types/actions';
import { db } from '$lib/db';
import { trainingPlans, trackSessions } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * Chips for treningsløpene (ny modell). Uten aktiv plan: foreslå oppsett på
 * /trening. Med aktiv plan: chip for dagens materialiserte økt hvis den ikke
 * er fullført. (Legacy-programmer er arkivert og produserer ingen chips.)
 */
export const trainingProgramProducer: ActionProducer = async (ctx) => {
	try {
		return await produceChips(ctx);
	} catch (err) {
		console.warn('[training-program-producer] feilet, ingen chip', err);
		return [];
	}
};

async function produceChips(ctx: Parameters<ActionProducer>[0]): Promise<ActionCandidate[]> {
	const activePlans = await db.query.trainingPlans.findMany({
		where: and(eq(trainingPlans.userId, ctx.userId), eq(trainingPlans.status, 'active')),
		columns: { id: true, name: true },
		orderBy: (t, { desc }) => [desc(t.createdAt)],
		limit: 1
	});

	if (activePlans.length === 0) {
		return [
			{
				id: 'training-program-create',
				icon: '🏃',
				label: 'Start treningsløp',
				priority: 25,
				source: 'system',
				intent: { kind: 'navigate', href: '/trening' }
			}
		];
	}

	const plan = activePlans[0];
	const todayIso = ctx.now.toISOString().slice(0, 10);

	// Chip kun for materialisert (Ekko-hentet) økt som ikke er fullført —
	// selve forslaget beregnes på /trening og i /api/apps-flyten.
	const rows = await db
		.select({
			id: trackSessions.id,
			kind: trackSessions.kind,
			payload: trackSessions.payload,
			status: trackSessions.status
		})
		.from(trackSessions)
		.where(
			and(
				eq(trackSessions.planId, plan.id),
				eq(trackSessions.userId, ctx.userId),
				eq(trackSessions.date, todayIso)
			)
		)
		.limit(1);

	if (rows.length === 0 || rows[0].status === 'completed') return [];

	const session = rows[0];
	const isTest = session.payload.isTest === true;
	return [
		{
			id: `training-program-today-${plan.id}`,
			icon: isTest ? '🎯' : session.kind === 'run' ? '🏃' : '💪',
			label: isTest ? `Test: ${session.payload.name}` : `I dag: ${session.payload.name}`,
			priority: 80,
			source: 'system',
			intent: { kind: 'navigate', href: '/trening' }
		}
	];
}
