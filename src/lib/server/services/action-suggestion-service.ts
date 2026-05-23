import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { ActionCandidate } from '$lib/types/actions';
import {
	getEgenfrekvensCheckinStatus,
	toIsoDay,
	type EgenfrekvensSlotEntry
} from '$lib/server/egenfrekvens-checkin';
import { focusTimerProducer } from './action-producers/focus-timer';
import { sjekkInnProducer } from './action-producers/sjekk-inn';

export interface EgenfrekvensContext {
	today: {
		morning: EgenfrekvensSlotEntry | null;
		evening: EgenfrekvensSlotEntry | null;
	};
	settings: {
		enabled: boolean;
		morningTime: string;
		eveningTime: string;
	} | null;
}

export interface ProducerContext {
	userId: string;
	now: Date;
	tz: string;
	egenfrekvens: EgenfrekvensContext | null;
}

export type ActionProducer = (
	ctx: ProducerContext
) => Promise<ActionCandidate[]> | ActionCandidate[];

const PRODUCERS: ActionProducer[] = [sjekkInnProducer, focusTimerProducer];

async function buildContext(userId: string): Promise<ProducerContext> {
	const [user, status] = await Promise.all([
		db.query.users.findFirst({ where: eq(users.id, userId) }),
		getEgenfrekvensCheckinStatus(userId, toIsoDay())
	]);

	const tz = user?.timezone ?? 'Europe/Oslo';
	const rawSettings =
		(user?.notificationSettings as Record<string, any> | null | undefined)?.egenfrekvensCheckin ??
		null;
	const settings = rawSettings
		? {
				enabled: rawSettings.enabled !== false,
				morningTime: rawSettings.morningTime ?? rawSettings.time ?? '06:30',
				eveningTime: rawSettings.eveningTime ?? '21:00'
			}
		: null;

	return {
		userId,
		now: new Date(),
		tz,
		egenfrekvens: {
			today: { morning: status.morning, evening: status.evening },
			settings
		}
	};
}

export async function produceActions(userId: string): Promise<ActionCandidate[]> {
	const ctx = await buildContext(userId);
	const results = await Promise.all(
		PRODUCERS.map(async (p) => {
			try {
				return await p(ctx);
			} catch (err) {
				console.error('[action-suggestion-service] producer failed', err);
				return [] as ActionCandidate[];
			}
		})
	);
	return results.flat().sort((a, b) => b.priority - a.priority);
}
