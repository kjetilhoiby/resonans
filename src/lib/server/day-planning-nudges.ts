/**
 * Dagens fire nudger: planlegg dagen, avslutt dagen, morgensjekk i forholdet og
 * den daglige oversikten. Timebasert cron (`/api/cron/day-planning-nudges`),
 * gatet på brukerens egen Oslo-klokke.
 *
 * Se `docs/changelog/2026-09-05-krydder-paa-dagsoversikten.md`.
 *
 * ## Tre ting å vite før du endrer noe her
 *
 * 1. **Tidsgaten er et VINDU, ikke et minutt.** En eksakt sammenligning mot
 *    `hm` forutsetter at cron-tikket lander presist, og det gjorde det ikke før
 *    den interne dispatcheren tok over. Se `NUDGE_WINDOW_MINUTES`.
 * 2. **Vinduet krever dedup.** `alreadyNudgedToday` er den andre halvdelen; uten
 *    den kan et bredere vindu sende det samme varselet to ganger.
 * 3. **Standardtidene og stillevinduet MÅ være forenlige.** De er defaults satt
 *    to steder, og da de var uenige vant stillevinduet stille — to av fire
 *    grener kunne ikke fyre i det hele tatt. Invarianten står som en test i
 *    `$lib/domain/nudge-schedule.test.ts`.
 *
 * Tidsregningen og modusvalget bor rent i `$lib/domain/nudge-schedule.ts`;
 * teksten i dagsoversikten i `$lib/domain/digest-nugget-rules.ts`. Denne fila
 * henter og sender.
 */
import { and, desc, eq, gte, ilike, isNotNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklists, conversations, memories, messages, nudgeEvents, sensorEvents, users, webPushSubscriptions } from '$lib/db/schema';
import {
	buildDayCloseNudgeMessage,
	buildDayPlanningNudgeMessage,
	buildRelationshipCheckinMorningNudgeMessage,
	buildNudgeDigestMessage,
	sendGoogleChatMessage
} from '$lib/server/google-chat';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import { describeOpenItems } from '$lib/domain/digest-nugget-rules';
import { computeDigestPush } from '$lib/server/digest-nugget';
import { isWithinRecentMinutesWindow } from '$lib/server/nudge-time';
import {
	DEFAULT_CLOSE_TIME,
	DEFAULT_PLANNING_TIME,
	DEFAULT_RELATIONSHIP_MORNING_TIME,
	NUDGE_WINDOW_MINUTES,
	digestTimeFor,
	resolveNudgeMode,
	type NudgeProfile
} from '$lib/domain/nudge-schedule';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';

interface NotificationSettings {
	dayPlanning?: { enabled?: boolean; time?: string };
	dayClose?: { enabled?: boolean; time?: string };
	relationshipCheckinMorning?: { enabled?: boolean; time?: string };
	nudgeProfile?: NudgeProfile;
}

function isDue(nowHm: string, targetHm: string) {
	return isWithinRecentMinutesWindow(nowHm, targetHm, NUDGE_WINDOW_MINUTES);
}

/**
 * Har vi alt sendt denne nudgen i dag?
 *
 * Et vindu på en time kan i prinsippet dekke to tikk — en manuell `?due=1`, et
 * nytt forsøk etter en timeout — og et varsel sendt to ganger er verre enn ett
 * som kom ti minutter for sent. `nudge_events` bærer alt `dayIso` i konteksten,
 * så dedupen trenger ingen ny tabell. Samme mønster som `grocery_weekly`.
 */
async function alreadyNudgedToday(userId: string, nudgeType: string, dayIso: string) {
	const existing = await db.query.nudgeEvents.findFirst({
		where: and(
			eq(nudgeEvents.userId, userId),
			eq(nudgeEvents.nudgeType, nudgeType),
			sql`(${nudgeEvents.context}->>'dayIso') = ${dayIso}`
		),
		columns: { id: true }
	});
	return Boolean(existing);
}

function toIsoDateFromParts(parts: Intl.DateTimeFormatPart[]) {
	const year = parts.find((p) => p.type === 'year')?.value ?? '1970';
	const month = parts.find((p) => p.type === 'month')?.value ?? '01';
	const day = parts.find((p) => p.type === 'day')?.value ?? '01';
	return `${year}-${month}-${day}`;
}

function toHmFromParts(parts: Intl.DateTimeFormatPart[]) {
	const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
	return `${hour}:${minute}`;
}

function localNow(timeZone: string, now: Date) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	const parts = formatter.formatToParts(now);
	return {
		isoDate: toIsoDateFromParts(parts),
		hm: toHmFromParts(parts)
	};
}

function getIsoWeekDashedFromIsoDate(isoDate: string) {
	const [yearRaw, monthRaw, dayRaw] = isoDate.split('-');
	const year = Number.parseInt(yearRaw ?? '', 10);
	const month = Number.parseInt(monthRaw ?? '', 10);
	const day = Number.parseInt(dayRaw ?? '', 10);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return null;
	}

	const d = new Date(Date.UTC(year, month - 1, day));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const isoYear = d.getUTCFullYear();
	const yearStart = new Date(Date.UTC(isoYear, 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	const week = String(weekNo).padStart(2, '0');
	return `${isoYear}-W${week}`;
}

function addDaysIsoDate(isoDate: string, days: number) {
	const date = new Date(`${isoDate}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function contextForDay(isoDate: string) {
	const weekKey = getIsoWeekDashedFromIsoDate(isoDate);
	if (!weekKey) return null;
	return `week:${weekKey}:day:${isoDate}`;
}

function isEnabled(value: { enabled?: boolean } | undefined) {
	return value?.enabled !== false;
}

function withNudgeTracking(appUrl: string, path: string, nudgeTrack: string, nudgeEventId: string | null) {
	const url = new URL(path, appUrl);
	url.searchParams.set('nudgeTrack', nudgeTrack);
	if (nudgeEventId) url.searchParams.set('nudgeEventId', nudgeEventId);
	return url.toString();
}

async function sendNativeNudgeToUser(args: {
	userId: string;
	title: string;
	body: string;
	url: string;
	tag: string;
}) {
	const delivery = await PushDeliveryService.deliverToUser({
		userId: args.userId,
		payload: {
			title: args.title,
			body: args.body,
			url: args.url,
			tag: args.tag
		},
		onGone: 'disable'
	});

	return delivery.sent > 0;
}

async function getNudgeTriage(userId: string) {
	const since = new Date();
	since.setDate(since.getDate() - 7);

	const [clickRows, userMsgCountRows, prefRows] = await Promise.all([
		db.query.nudgeEvents.findMany({
			where: and(eq(nudgeEvents.userId, userId), isNotNull(nudgeEvents.openedAt), gte(nudgeEvents.openedAt, since)),
			columns: { id: true },
			limit: 20
		}),
		db
			.select({ count: sql<number>`count(*)::int` })
			.from(messages)
			.innerJoin(conversations, eq(messages.conversationId, conversations.id))
			.where(and(eq(conversations.userId, userId), eq(messages.role, 'user'), gte(messages.createdAt, since))),
		db.query.memories.findMany({
			where: and(
				eq(memories.userId, userId),
				eq(memories.category, 'preferences'),
				or(
					ilike(memories.content, '%ikke mas%'),
					ilike(memories.content, '%spam%'),
					ilike(memories.content, '%rolig%'),
					ilike(memories.content, '%stille%')
				)
			),
			orderBy: (m, { desc: orderDesc }) => [orderDesc(m.createdAt)],
			limit: 10
		})
	]);

	const clicks7d = clickRows.length;
	const userMessages7d = userMsgCountRows[0]?.count ?? 0;
	const hasLowNoisePreference = prefRows.length > 0;

	const forceDigest = hasLowNoisePreference || (clicks7d === 0 && userMessages7d < 3);

	return {
		clicks7d,
		userMessages7d,
		hasLowNoisePreference,
		forceDigest
	};
}

async function findChecklistByContext(userId: string, context: string) {
	return db.query.checklists.findFirst({
		where: and(eq(checklists.userId, userId), eq(checklists.context, context)),
		with: {
			items: {
				orderBy: (items, { asc }) => [asc(items.sortOrder), asc(items.createdAt)]
			}
		}
	});
}

/**
 * Punktene fra en dag som fortsatt står åpne — navnene, ikke bare antallet.
 *
 * Ett oppslag, to svar: `count` er tallet konteksten og chat-kortet bærer,
 * `titles` er det varselet faktisk sier. Fram til september 2026 fantes bare
 * tallet, og «Overliggere: 1» tvinger brukeren til å åpne appen for å finne ut
 * om det ene punktet var verdt å bli varslet om.
 */
async function openItemsFromDay(userId: string, dayIso: string) {
	const context = contextForDay(dayIso);
	if (!context) return { titles: [] as string[], count: 0 };
	const checklist = await findChecklistByContext(userId, context);
	const open = (checklist?.items ?? []).filter((item) => !item.checked);
	return { titles: open.map((item) => item.text), count: open.length };
}

async function hasRelationshipCheckinForDay(userId: string, dayIso: string) {
	const existing = await db
		.select({ id: sensorEvents.id })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, 'relationship_checkin'),
				sql`${sensorEvents.data}->>'day' = ${dayIso}`
			)
		)
		.limit(1);

	return existing.length > 0;
}

export async function runDayPlanningAndCloseNudges(appUrl: string, now: Date = new Date()) {
	const allUsers = await db.query.users.findMany();

	const results: Array<{
		userId: string;
		planningSent: boolean;
		closeSent: boolean;
		relationshipMorningSent: boolean;
		skippedReason?: string;
	}> = [];

	for (const user of allUsers) {
		const dayPlanningRoutes = resolveRoutesForNotification(user, 'dayPlanning');
		const dayCloseRoutes = resolveRoutesForNotification(user, 'dayClose');
		const digestRoutes = resolveRoutesForNotification(user, 'digestDay');
		const relationshipRoutes = resolveRoutesForNotification(user, 'relationshipCheckinMorning');
		const hasAnyRoute =
			dayPlanningRoutes.length > 0 ||
			dayCloseRoutes.length > 0 ||
			digestRoutes.length > 0 ||
			relationshipRoutes.length > 0;

		if (!hasAnyRoute) {
			results.push({
				userId: user.id,
				planningSent: false,
				closeSent: false,
				relationshipMorningSent: false,
				skippedReason: 'no-channel'
			});
			continue;
		}

		const settings = (user.notificationSettings ?? {}) as NotificationSettings;
		const timezone = user.timezone || 'Europe/Oslo';
		const local = localNow(timezone, now);
		const todayIso = local.isoDate;
		let triage: Awaited<ReturnType<typeof getNudgeTriage>>;
		try {
			triage = await getNudgeTriage(user.id);
		} catch (err) {
			console.error(`❌ getNudgeTriage failed for user ${user.id}:`, err);
			results.push({ userId: user.id, planningSent: false, closeSent: false, relationshipMorningSent: false, skippedReason: 'triage-error' });
			continue;
		}
		const profile = settings.nudgeProfile;
		const mode = resolveNudgeMode(profile, todayIso, local.hm, triage);
		const digestTime = digestTimeFor(profile, todayIso);

		const planningTime = settings.dayPlanning?.time || DEFAULT_PLANNING_TIME;
		const closeTime = settings.dayClose?.time || DEFAULT_CLOSE_TIME;
		const relationshipMorningTime =
			settings.relationshipCheckinMorning?.time || DEFAULT_RELATIONSHIP_MORNING_TIME;

		let planningSent = false;
		let closeSent = false;
		let relationshipMorningSent = false;

		if (
			mode === 'interactive' &&
			isEnabled(settings.dayPlanning) &&
			isDue(local.hm, planningTime) &&
			!(await alreadyNudgedToday(user.id, 'plan_day', todayIso))
		) {
			const todayContext = contextForDay(todayIso);
			if (todayContext) {
				const todayChecklist = await findChecklistByContext(user.id, todayContext);
				const todayCount = todayChecklist?.items.length ?? 0;

				// Only nudge planning if day is not already planned.
				if (todayCount === 0) {
					const carryover = await openItemsFromDay(user.id, addDaysIsoDate(todayIso, -1));
					const carryoverCount = carryover.count;

					const eventId = await createNudgeEvent({
						userId: user.id,
						nudgeType: 'plan_day',
						mode,
						context: { dayIso: todayIso, carryoverCount, trigger: 'schedule' }
					});
					const pushUrl = withNudgeTracking(appUrl, '/ukeplan', 'plan_day', eventId);
					if (routeTargetsPwa(dayPlanningRoutes)) {
						// Navnet på overliggeren, ikke tellingen — samme regel som i
						// dagsoversikten, og den samme setningsmotoren.
						const carried = describeOpenItems(carryover.titles, 'fra i går');
						planningSent = await sendNativeNudgeToUser({
							userId: user.id,
							title: 'Planlegg dagen',
							body: carried?.sentence ?? 'Lag en enkel plan for dagen din.',
							url: pushUrl,
							tag: `nudge-plan-${todayIso}`
						});
					}

					const dayPlanningWebhooks = getGoogleChatWebhooksForRoutes(user, dayPlanningRoutes);
					if (dayPlanningWebhooks.length > 0) {
						const message = buildDayPlanningNudgeMessage({
							appUrl,
							userName: user.name,
							dayIso: todayIso,
							carryoverCount,
							nudgeEventId: eventId ?? undefined
						});
						for (const webhook of dayPlanningWebhooks) {
							const ok = await sendGoogleChatMessage(webhook, message);
							planningSent = planningSent || ok;
						}
					}
					if (planningSent && eventId) await markNudgeSent(eventId);
				}
			}
		}

		if (
			mode === 'interactive' &&
			isEnabled(settings.dayClose) &&
			isDue(local.hm, closeTime) &&
			!(await alreadyNudgedToday(user.id, 'close_day', todayIso))
		) {
			const todayContext = contextForDay(todayIso);
			if (todayContext) {
				const todayChecklist = await findChecklistByContext(user.id, todayContext);
				const openTitles = (todayChecklist?.items ?? [])
					.filter((item) => !item.checked)
					.map((item) => item.text);
				const openItems = openTitles.length;
				if (openItems > 0) {
					const eventId = await createNudgeEvent({
						userId: user.id,
						nudgeType: 'close_day',
						mode,
						context: { dayIso: todayIso, openItems, trigger: 'schedule' }
					});
					const pushUrl = withNudgeTracking(appUrl, '/ukeplan', 'close_day', eventId);
					if (routeTargetsPwa(dayCloseRoutes)) {
						const open = describeOpenItems(openTitles, 'i dag');
						closeSent = await sendNativeNudgeToUser({
							userId: user.id,
							title: 'Avslutt dagen',
							body: open?.sentence ?? `Du har ${openItems} åpne punkt igjen i dag.`,
							url: pushUrl,
							tag: `nudge-close-${todayIso}`
						});
					}

					const dayCloseWebhooks = getGoogleChatWebhooksForRoutes(user, dayCloseRoutes);
					if (dayCloseWebhooks.length > 0) {
						const message = buildDayCloseNudgeMessage({
							appUrl,
							userName: user.name,
							dayIso: todayIso,
							openItems,
							nudgeEventId: eventId ?? undefined
						});
						for (const webhook of dayCloseWebhooks) {
							const ok = await sendGoogleChatMessage(webhook, message);
							closeSent = closeSent || ok;
						}
					}
					if (closeSent && eventId) await markNudgeSent(eventId);
				}
			}
		}

		if (
			mode === 'digest' &&
			isDue(local.hm, digestTime) &&
			!(await alreadyNudgedToday(user.id, 'digest_day', todayIso))
		) {
			const todayContext = contextForDay(todayIso);
			if (todayContext) {
				const todayChecklist = await findChecklistByContext(user.id, todayContext);
				const plannedItems = todayChecklist?.items.length ?? 0;
				const openItems = (todayChecklist?.items ?? []).filter((item) => !item.checked).length;
				const carryover = await openItemsFromDay(user.id, addDaysIsoDate(todayIso, -1));

				/**
				 * Krydderet avgjør om det sendes i det hele tatt.
				 *
				 * Den gamle gaten var `plannedItems === 0 || openItems > 0 ||
				 * carryoverCount > 0` — altså «send hvis dagen ikke er planlagt»,
				 * som er sant hver eneste morgen før man har planlagt noe. Et
				 * varsel med en grunn som alltid finnes blir bakgrunnsstøy, og
				 * bakgrunnsstøy blir slått av. Nå er stillhet et gyldig svar:
				 * `computeDigestPush` returnerer null når ingen regel har noe å si.
				 */
				const push = await computeDigestPush({
					userId: user.id,
					carryover: carryover.titles,
					now
				}).catch((err) => {
					console.error(`❌ computeDigestPush failed for user ${user.id}:`, err);
					return null;
				});

				if (push) {
					const reason = triage.hasLowNoisePreference
						? 'rolig-profil fra preferences'
						: triage.forceDigest
							? 'lav engasjement siste uke'
							: 'stillevindu / helgeprofil';
					const eventId = await createNudgeEvent({
						userId: user.id,
						nudgeType: 'digest_day',
						mode,
						context: {
							dayIso: todayIso,
							plannedItems,
							openItems,
							carryoverCount: carryover.count,
							reason,
							// Hvilken regel som vant. Uten den kan man ikke se i
							// ettertid hvorfor en morgen ble stille og en annen ikke.
							nugget: push.nugget.kind,
							secondary: push.secondary?.kind ?? null,
							trigger: 'schedule'
						}
					});
					const pushUrl = withNudgeTracking(appUrl, '/ukeplan', 'digest_day', eventId);
					if (routeTargetsPwa(digestRoutes)) {
						planningSent = await sendNativeNudgeToUser({
							userId: user.id,
							title: push.title,
							body: push.body,
							url: pushUrl,
							tag: `nudge-digest-${todayIso}`
						});
					}

					const digestWebhooks = getGoogleChatWebhooksForRoutes(user, digestRoutes);
					if (digestWebhooks.length > 0) {
						const message = buildNudgeDigestMessage({
							userName: user.name,
							dayIso: todayIso,
							plannedItems,
							openItems,
							carryoverCount: carryover.count,
							reason,
							highlight: { title: push.title, body: push.body }
						});
						for (const webhook of digestWebhooks) {
							const ok = await sendGoogleChatMessage(webhook, message);
							planningSent = planningSent || ok;
						}
					}
					if (planningSent && eventId) await markNudgeSent(eventId);
				}
			}
		}

		if (
			isEnabled(settings.relationshipCheckinMorning) &&
			isDue(local.hm, relationshipMorningTime) &&
			!(await alreadyNudgedToday(user.id, 'relationship_checkin_morning', todayIso))
		) {
			const hasPartner = Boolean(user.partnerUserId && user.partnerConfirmedAt);
			if (hasPartner) {
				const alreadySubmitted = await hasRelationshipCheckinForDay(user.id, todayIso);
				if (!alreadySubmitted) {
					const eventId = await createNudgeEvent({
						userId: user.id,
						nudgeType: 'relationship_checkin_morning',
						mode,
						context: { dayIso: todayIso, trigger: 'schedule' }
					});
					const pushUrl = withNudgeTracking(appUrl, '/ukeplan', 'relationship_checkin_morning', eventId);
					if (routeTargetsPwa(relationshipRoutes)) {
						relationshipMorningSent = await sendNativeNudgeToUser({
							userId: user.id,
							title: 'Morgensjekk i forholdet',
							body: 'Ta en kort innsjekk for dagen.',
							url: pushUrl,
							tag: `nudge-relationship-${todayIso}`
						});
					}

					const relationshipWebhooks = getGoogleChatWebhooksForRoutes(user, relationshipRoutes);
					if (relationshipWebhooks.length > 0) {
						const message = buildRelationshipCheckinMorningNudgeMessage({
							appUrl,
							userName: user.name,
							dayIso: todayIso,
							nudgeEventId: eventId ?? undefined
						});
						for (const webhook of relationshipWebhooks) {
							const ok = await sendGoogleChatMessage(webhook, message);
							relationshipMorningSent = relationshipMorningSent || ok;
						}
					}
					if (relationshipMorningSent && eventId) await markNudgeSent(eventId);
				}
			}
		}

		results.push({ userId: user.id, planningSent, closeSent, relationshipMorningSent });
	}

	return {
		timestamp: now.toISOString(),
		processedUsers: results.length,
		planningSent: results.filter((r) => r.planningSent).length,
		closeSent: results.filter((r) => r.closeSent).length,
		relationshipMorningSent: results.filter((r) => r.relationshipMorningSent).length,
		results
	};
}
