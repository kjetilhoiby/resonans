import { db } from '$lib/db';
import { users, checklists } from '$lib/db/schema';
import { eq, and, isNotNull } from 'drizzle-orm';
import type { ActionCandidate } from '$lib/types/actions';
import {
	getEgenfrekvensCheckinStatus,
	toIsoDay,
	type EgenfrekvensSlotEntry
} from '$lib/server/egenfrekvens-checkin';
import { localIsoDay } from '$lib/server/nudge-time';
import { countOpenChecklistItems } from '$lib/server/checklist-open-items';
import { loadActiveSnoozedChipIds } from '$lib/server/action-snoozes';
import { focusTimerProducer } from './action-producers/focus-timer';
import { planTomorrowProducer } from './action-producers/plan-tomorrow';
import { planWeekProducer } from './action-producers/plan-week';
import { planMonthProducer } from './action-producers/plan-month';
import { reflectionLightProducer } from './action-producers/reflection-light';
import { quickWinProducer } from './action-producers/quick-win';
import { inboxNoteProducer } from './action-producers/inbox-note';
import { sortInboxProducer } from './action-producers/sort-inbox';
import { trainingProgramProducer } from './action-producers/training-program';
import { screenTimeOnboardingProducer } from './action-producers/screen-time-onboarding';
import { birthdayInterviewProducer } from './action-producers/birthday-interview';
import { birthdayKavalkadeProducer } from './action-producers/birthday-kavalkade';

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
	openItemCount: number;
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

// Sjekk inn-chipen produseres ikke lenger server-side: slot-sjekkinnen (HomeScreen)
// viser en lokal chip når fullskjermen er dismisset men slottet ikke registrert.
const PRODUCERS: ActionProducer[] = [
	focusTimerProducer,
	reflectionLightProducer,
	quickWinProducer,
	inboxNoteProducer,
	sortInboxProducer,
	planTomorrowProducer,
	planWeekProducer,
	planMonthProducer,
	trainingProgramProducer,
	screenTimeOnboardingProducer,
	birthdayInterviewProducer,
	birthdayKavalkadeProducer
];

async function loadPlannedContexts(userId: string) {
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
	return { active, any };
}

async function buildContext(userId: string): Promise<ProducerContext> {
	const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
	const tz = user?.timezone ?? 'Europe/Oslo';
	const todayIso = localIsoDay(tz, new Date());

	const [status, planned, openItemCount] = await Promise.all([
		getEgenfrekvensCheckinStatus(userId, toIsoDay()),
		loadPlannedContexts(userId),
		countOpenChecklistItems(userId, todayIso)
	]);

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
		plan: {
			activePlannedContexts: planned.active,
			anyPlannedContexts: planned.any,
			openItemCount
		}
	};
}

// Holdes i samme rekkefølge som PRODUCERS (kun brukt til perf-logging)
const PRODUCER_NAMES = [
	'focus-timer', 'reflection-light', 'quick-win',
	'inbox-note', 'sort-inbox', 'plan-tomorrow', 'plan-week',
	'plan-month', 'training-program', 'screen-time-onboarding',
	'selvangivelse', 'kavalkade'
];

export async function produceActions(userId: string): Promise<ActionCandidate[]> {
	const t0 = performance.now();
	const ctx = await buildContext(userId);
	const ctxMs = performance.now() - t0;

	const [results, snoozed] = await Promise.all([
		Promise.all(
			PRODUCERS.map(async (p, i) => {
				const pt = performance.now();
				try {
					const items = await p(ctx);
					const ms = performance.now() - pt;
					if (ms > 50) console.log(`[perf][actions] producer=${PRODUCER_NAMES[i]} ms=${ms.toFixed(0)} items=${items.length}`);
					return items;
				} catch (err) {
					console.error('[action-suggestion-service] producer failed', err);
					return [] as ActionCandidate[];
				}
			})
		),
		loadActiveSnoozedChipIds(userId, ctx.now)
	]);
	console.log(`[perf][actions] user=${userId} context=${ctxMs.toFixed(0)}ms producers=${(performance.now() - t0 - ctxMs).toFixed(0)}ms`);
	return results
		.flat()
		.filter((c) => !snoozed.has(c.id))
		.sort((a, b) => b.priority - a.priority);
}
