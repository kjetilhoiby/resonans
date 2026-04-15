import { and, eq, isNull } from 'drizzle-orm';
import { db } from '$lib/db';
import { nudgeEvents } from '$lib/db/schema';

export async function createNudgeEvent(params: {
	userId: string;
	nudgeType: 'plan_day' | 'close_day' | 'digest_day' | 'relationship_checkin_morning';
	mode: 'interactive' | 'digest';
	channel?: string;
	context?: Record<string, unknown>;
}) {
	try {
		const [created] = await db
			.insert(nudgeEvents)
			.values({
				userId: params.userId,
				nudgeType: params.nudgeType,
				mode: params.mode,
				channel: params.channel ?? 'google_chat',
				context: params.context ?? {},
				updatedAt: new Date()
			})
			.returning({ id: nudgeEvents.id });
		return created?.id ?? null;
	} catch {
		return null;
	}
}

export async function markNudgeSent(eventId: string) {
	try {
		await db
			.update(nudgeEvents)
			.set({ sentAt: new Date(), updatedAt: new Date() })
			.where(eq(nudgeEvents.id, eventId));
	} catch {
		// Best effort metrics only
	}
}

export async function markNudgeOpened(eventId: string, userId: string) {
	try {
		await db
			.update(nudgeEvents)
			.set({ openedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(nudgeEvents.id, eventId), eq(nudgeEvents.userId, userId), isNull(nudgeEvents.openedAt)));
	} catch {
		// Best effort metrics only
	}
}

export async function markNudgeFlowStarted(eventId: string, userId: string) {
	try {
		await db
			.update(nudgeEvents)
			.set({ flowStartedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(nudgeEvents.id, eventId), eq(nudgeEvents.userId, userId), isNull(nudgeEvents.flowStartedAt)));
	} catch {
		// Best effort metrics only
	}
}

export async function markNudgeFlowCompleted(eventId: string, userId: string) {
	try {
		await db
			.update(nudgeEvents)
			.set({ flowCompletedAt: new Date(), updatedAt: new Date() })
			.where(and(eq(nudgeEvents.id, eventId), eq(nudgeEvents.userId, userId), isNull(nudgeEvents.flowCompletedAt)));
	} catch {
		// Best effort metrics only
	}
}
