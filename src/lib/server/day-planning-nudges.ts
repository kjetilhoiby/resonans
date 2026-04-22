import { and, desc, eq, gte, ilike, or, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { checklists, conversations, memories, messages, sensorEvents, users, webPushSubscriptions } from '$lib/db/schema';
import {
	buildDayCloseNudgeMessage,
	buildDayPlanningNudgeMessage,
	buildRelationshipCheckinMorningNudgeMessage,
	buildNudgeDigestMessage,
	sendGoogleChatMessage
} from '$lib/server/google-chat';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
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
	nudgeProfile?: {
		weekdayMode?: 'interactive' | 'digest';
		weekendMode?: 'interactive' | 'digest';
		quietHours?: { enabled?: boolean; start?: string; end?: string };
		digestTimeWeekday?: string;
		digestTimeWeekend?: string;
	};
}

type DayMode = 'interactive' | 'digest';

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

function isWeekend(isoDate: string) {
	const day = new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
	return day === 0 || day === 6;
}

function isTimeInWindow(hm: string, start: string, end: string) {
	if (start === end) return true;
	if (start < end) return hm >= start && hm < end;
	return hm >= start || hm < end;
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
		db.query.memories.findMany({
			where: and(eq(memories.userId, userId), ilike(memories.source, 'nudge:click:%'), gte(memories.createdAt, since)),
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

function resolveNudgeMode(settings: NotificationSettings, todayIso: string, hm: string, triage: { forceDigest: boolean }) {
	if (triage.forceDigest) return 'digest' as DayMode;

	const profile = settings.nudgeProfile;
	const weekdayMode = profile?.weekdayMode ?? 'interactive';
	const weekendMode = profile?.weekendMode ?? 'digest';
	const baseMode: DayMode = isWeekend(todayIso) ? weekendMode : weekdayMode;

	const quietEnabled = profile?.quietHours?.enabled !== false;
	const quietStart = profile?.quietHours?.start ?? '20:00';
	const quietEnd = profile?.quietHours?.end ?? '08:00';

	if (quietEnabled && isTimeInWindow(hm, quietStart, quietEnd)) {
		return 'digest';
	}

	return baseMode;
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
		const mode = resolveNudgeMode(settings, todayIso, local.hm, triage);
		const profile = settings.nudgeProfile;
		const digestTime = isWeekend(todayIso)
			? (profile?.digestTimeWeekend ?? '10:00')
			: (profile?.digestTimeWeekday ?? '09:00');

		const planningTime = settings.dayPlanning?.time || '07:00';
		const closeTime = settings.dayClose?.time || '21:00';
		const relationshipMorningTime = settings.relationshipCheckinMorning?.time || '08:30';

		let planningSent = false;
		let closeSent = false;
		let relationshipMorningSent = false;

		if (mode === 'interactive' && isEnabled(settings.dayPlanning) && local.hm === planningTime) {
			const todayContext = contextForDay(todayIso);
			if (todayContext) {
				const todayChecklist = await findChecklistByContext(user.id, todayContext);
				const todayCount = todayChecklist?.items.length ?? 0;

				// Only nudge planning if day is not already planned.
				if (todayCount === 0) {
					const prevIso = addDaysIsoDate(todayIso, -1);
					const prevContext = contextForDay(prevIso);
					let carryoverCount = 0;
					if (prevContext) {
						const prevChecklist = await findChecklistByContext(user.id, prevContext);
						carryoverCount = (prevChecklist?.items ?? []).filter((item) => !item.checked).length;
					}

					const eventId = await createNudgeEvent({
						userId: user.id,
						nudgeType: 'plan_day',
						mode,
						context: { dayIso: todayIso, carryoverCount, trigger: 'schedule' }
					});
					const pushUrl = withNudgeTracking(appUrl, '/ukeplan', 'plan_day', eventId);
					if (routeTargetsPwa(dayPlanningRoutes)) {
						planningSent = await sendNativeNudgeToUser({
							userId: user.id,
							title: 'Planlegg dagen',
							body: carryoverCount > 0
								? `Du har ${carryoverCount} åpne punkter fra i går.`
								: 'Lag en enkel plan for dagen din.',
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

		if (mode === 'interactive' && isEnabled(settings.dayClose) && local.hm === closeTime) {
			const todayContext = contextForDay(todayIso);
			if (todayContext) {
				const todayChecklist = await findChecklistByContext(user.id, todayContext);
				const openItems = (todayChecklist?.items ?? []).filter((item) => !item.checked).length;
				if (openItems > 0) {
					const eventId = await createNudgeEvent({
						userId: user.id,
						nudgeType: 'close_day',
						mode,
						context: { dayIso: todayIso, openItems, trigger: 'schedule' }
					});
					const pushUrl = withNudgeTracking(appUrl, '/ukeplan', 'close_day', eventId);
					if (routeTargetsPwa(dayCloseRoutes)) {
						closeSent = await sendNativeNudgeToUser({
							userId: user.id,
							title: 'Avslutt dagen',
							body: `Du har ${openItems} åpne punkt igjen i dag.`,
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

		if (mode === 'digest' && local.hm === digestTime) {
			const todayContext = contextForDay(todayIso);
			if (todayContext) {
				const todayChecklist = await findChecklistByContext(user.id, todayContext);
				const plannedItems = todayChecklist?.items.length ?? 0;
				const openItems = (todayChecklist?.items ?? []).filter((item) => !item.checked).length;

				const prevIso = addDaysIsoDate(todayIso, -1);
				const prevContext = contextForDay(prevIso);
				let carryoverCount = 0;
				if (prevContext) {
					const prevChecklist = await findChecklistByContext(user.id, prevContext);
					carryoverCount = (prevChecklist?.items ?? []).filter((item) => !item.checked).length;
				}

				if (plannedItems === 0 || openItems > 0 || carryoverCount > 0) {
					const reason = triage.hasLowNoisePreference
						? 'rolig-profil fra preferences'
						: triage.forceDigest
							? 'lav engasjement siste uke'
							: 'stillevindu / helgeprofil';
					const eventId = await createNudgeEvent({
						userId: user.id,
						nudgeType: 'digest_day',
						mode,
						context: { dayIso: todayIso, plannedItems, openItems, carryoverCount, reason, trigger: 'schedule' }
					});
					const pushUrl = withNudgeTracking(appUrl, '/ukeplan', 'digest_day', eventId);
					if (routeTargetsPwa(digestRoutes)) {
						planningSent = await sendNativeNudgeToUser({
							userId: user.id,
							title: 'Daglig oversikt',
							body: `Planlagt: ${plannedItems} · Åpne: ${openItems} · Overliggere: ${carryoverCount}`,
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
							carryoverCount,
							reason
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

		if (isEnabled(settings.relationshipCheckinMorning) && local.hm === relationshipMorningTime) {
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
