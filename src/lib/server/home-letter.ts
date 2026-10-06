/**
 * Brevet på hjemskjermen — datainnhentingen. PROTOTYPE, se
 * `docs/changelog/2026-10-06-brev-prototype.md`. Reglene bor i
 * `$lib/domain/home-letter.ts`.
 *
 * Hver kilde leses med den SAMME innhentingen som pushen bruker
 * (`gatherDigestInput`, `gatherWeightNuggetInput`, `openItemsFromDay`), så brevet
 * og varselet ikke kan si to ulike ting om samme morgen. Ingenting skrives:
 * ingen `nudge_events`, ingen milepæler.
 */

import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '$lib/db';
import { usageEvents } from '$lib/db/schema';
import { osloDayKey } from '$lib/domain/oslo-time';
import { digestNuggets, type DigestNugget } from '$lib/domain/digest-nugget-rules';
import { weightNuggets, type WeightNugget } from '$lib/domain/health/weight-nugget-rules';
import { buildHomeLetter, EVENT_PREP_HORIZON_DAYS, type HomeLetter, type LetterEvent } from '$lib/domain/home-letter';
import { gatherDigestInput } from '$lib/server/digest-nugget';
import { gatherWeightNuggetInput } from '$lib/server/health/weight-nugget';
import { openItemsFromDay } from '$lib/server/day-planning-nudges';
import { listEventsInRange } from '$lib/server/events/event-store';
import { readDeduplicatedWorkouts } from '$lib/server/workouts/deduplicated-workouts';

/** Besøk nyere enn dette regnes som den pågående økta, ikke «forrige gang». */
const CURRENT_SESSION_MS = 30 * 60 * 1000;

/**
 * Lenger borte enn dette, og «siden sist» blir ikke regnet. Det er ikke en nyhet
 * lenger, og hele treningshistorikken siden i vår skal ikke lastes for en setning.
 */
const MAX_SINCE_LAST_VISIT_MS = 30 * 24 * 60 * 60 * 1000;

function addDaysIso(dayIso: string, days: number): string {
	const date = new Date(`${dayIso}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function osloHour(now: Date): number {
	const hour = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', hourCycle: 'h23' }).format(now);
	return Number(hour);
}

async function readLastVisit(userId: string, now: Date): Promise<Date | null> {
	const [row] = await db
		.select({ createdAt: usageEvents.createdAt })
		.from(usageEvents)
		.where(
			and(
				eq(usageEvents.userId, userId),
				inArray(usageEvents.eventType, ['page_view', 'app_resume']),
				lt(usageEvents.createdAt, new Date(now.getTime() - CURRENT_SESSION_MS))
			)
		)
		.orderBy(desc(usageEvents.createdAt))
		.limit(1);
	return row?.createdAt ?? null;
}

export interface HomeLetterPayload {
	letter: HomeLetter;
	/** Alt reglene sa, før brevet valgte — vises i prototypen for sammenligning. */
	raw: {
		digest: DigestNugget[];
		weight: WeightNugget[];
		lastVisit: string | null;
	};
	/** Kilder som feilet. Et brev som tier fordi en kilde døde, skal si det. */
	failed: string[];
}

export async function loadHomeLetter(userId: string, now: Date = new Date()): Promise<HomeLetterPayload> {
	const today = osloDayKey(now);
	const yesterday = addDaysIso(today, -1);
	const failed: string[] = [];
	const soft = <T>(name: string, fallback: T) => (err: unknown) => {
		console.error(`[home-letter] ${name} feilet user=${userId}: ${err instanceof Error ? err.message : String(err)}`);
		failed.push(name);
		return fallback;
	};

	const [carryover, todayItems, weightInput, events, lastVisit] = await Promise.all([
		openItemsFromDay(userId, yesterday).catch(soft('overliggere', { titles: [] as string[], count: 0 })),
		openItemsFromDay(userId, today).catch(soft('dagsplan', { titles: [] as string[], count: 0 })),
		gatherWeightNuggetInput({ userId, now }).catch(soft('vekt', null)),
		listEventsInRange(userId, today, addDaysIso(today, EVENT_PREP_HORIZON_DAYS)).catch(soft('arrangementer', [])),
		readLastVisit(userId, now).catch(soft('siste besøk', null))
	]);

	const [digestInput, workouts] = await Promise.all([
		gatherDigestInput({ userId, carryover: carryover.titles, now }).catch(soft('dagsoversikt', null)),
		lastVisit && now.getTime() - lastVisit.getTime() <= MAX_SINCE_LAST_VISIT_MS
			? readDeduplicatedWorkouts(userId, lastVisit, now).catch(soft('økter', null))
			: Promise.resolve(null)
	]);

	const digest = digestInput ? digestNuggets(digestInput) : [];
	const weight = weightInput ? weightNuggets(weightInput) : [];

	const letterEvents: LetterEvent[] = events
		.filter((e) => e.status !== 'cancelled')
		.map((e) => ({ id: e.id, title: e.title, eventDate: e.eventDate, startTime: e.startTime, prep: e.prep }));

	const letter = buildHomeLetter({
		today,
		hour: osloHour(now),
		sick: digestInput?.sick ?? false,
		digest,
		weight,
		todayOpen: todayItems.titles,
		events: letterEvents,
		hoursSinceLastVisit: lastVisit ? (now.getTime() - lastVisit.getTime()) / 3_600_000 : null,
		sinceLastVisit: workouts
			? {
					workouts: workouts.length,
					distanceKm: workouts.reduce((sum, w) => sum + (w.distanceMeters ?? 0), 0) / 1000
				}
			: null
	});

	return {
		letter,
		raw: { digest, weight, lastVisit: lastVisit ? lastVisit.toISOString() : null },
		failed
	};
}
