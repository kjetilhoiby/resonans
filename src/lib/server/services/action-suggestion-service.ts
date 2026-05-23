import { db } from '$lib/db';
import { users, checklists } from '$lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import type { ActionCandidate } from '$lib/types/actions';
import {
	getEgenfrekvensCheckinStatus,
	toIsoDay,
	type EgenfrekvensSlotEntry
} from '$lib/server/egenfrekvens-checkin';
import { focusTimerProducer } from './action-producers/focus-timer';
import { sjekkInnProducer } from './action-producers/sjekk-inn';
import { planTomorrowProducer } from './action-producers/plan-tomorrow';
import { planWeekProducer } from './action-producers/plan-week';
import { planMonthProducer } from './action-producers/plan-month';
import { reflectionLightProducer } from './action-producers/reflection-light';

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

export interface PlanContext {
	activePlannedContexts: Set<string>;
	anyPlannedContexts: Set<string>;
}

export interface ProducerContext {
	userId: string;
	now: Date;
	tz: string;
	egenfrekvens: EgenfrekvensContext | null;
	plan: PlanContext;
}

export type ActionProducer = (
	ctx: ProducerContext
) => Promise<ActionCandidate[]> | ActionCandidate[];

const PRODUCERS: ActionProducer[] = [
	sjekkInnProducer,
	focusTimerProducer,
	reflectionLightProducer,
	planTomorrowProducer,
	planWeekProducer,
	planMonthProducer
];

async function loadPlanContext(userId: string): Promise<PlanContext> {
	const rows = await db.query.checklists.findMany({
		where: and(eq(checklists.userId, userId), isNotNull(checklists.context)),
		columns: { context: true, completedAt: true },
		with: { items: { columns: { id: true }, limit: 1 } }
	});

	const active = new Set<string>();
	const any = new Set<string>();
	for (const row of rows) {
		if (!row.context || row.items.length === 0) continue;
		any.add(row.context);
		if (row.completedAt === null) active.add(row.context);
	}
	return { activePlannedContexts: active, anyPlannedContexts: any };
}

async function buildContext(userId: string): Promise<ProducerContext> {
	const [user, status, plan] = await Promise.all([
		db.query.users.findFirst({ where: eq(users.id, userId) }),
		getEgenfrekvensCheckinStatus(userId, toIsoDay()),
		loadPlanContext(userId)
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
		},
		plan
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
