import { and, eq, isNotNull, lte, ne } from 'drizzle-orm';
import { db } from '$lib/db';
import { projectContacts, themes, users } from '$lib/db/schema';
import { buildProjectFollowUpNudgeMessage, sendGoogleChatMessage } from '$lib/server/google-chat';
import { createNudgeEvent, markNudgeSent } from '$lib/server/nudge-events';
import { PushDeliveryService } from '$lib/server/services/push-delivery-service';
import {
	getGoogleChatWebhooksForRoutes,
	resolveRoutesForNotification,
	routeTargetsPwa
} from '$lib/server/notification-channels';

interface NotificationSettings {
	projectFollowUp?: { enabled?: boolean; time?: string };
}

/** Lokal ISO-dato + HH:MM for en tidssone. */
function localNow(timeZone: string, now: Date): { isoDate: string; hm: string } {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).formatToParts(now);
	const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return {
		isoDate: `${get('year')}-${get('month')}-${get('day')}`,
		hm: `${get('hour')}:${get('minute')}`
	};
}

export interface ProjectFollowUpNudgeResult {
	userId: string;
	sent: boolean;
	projectCount?: number;
	contactCount?: number;
	skippedReason?: string;
}

/**
 * Daglig purre-nudge: for hver bruker, finn prosjekt-kontakter med forfalt
 * oppfølgingsdato (<= i dag, lokalt) og status != 'ferdig', gruppér per prosjekt,
 * og varsle på brukerens valgte kanaler. Kjøres av den timebaserte nudge-cron-en;
 * fyrer kun når lokal tid = brukerens innstilte tidspunkt (default 09:00).
 */
export async function runProjectFollowUpNudges(
	appUrl: string,
	now: Date = new Date()
): Promise<{ timestamp: string; processedUsers: number; sent: number; results: ProjectFollowUpNudgeResult[] }> {
	const allUsers = await db.query.users.findMany();
	const results: ProjectFollowUpNudgeResult[] = [];

	for (const user of allUsers) {
		const routes = resolveRoutesForNotification(user, 'projectFollowUp');
		if (routes.length === 0) {
			results.push({ userId: user.id, sent: false, skippedReason: 'no-channel' });
			continue;
		}

		const settings = (user.notificationSettings ?? {}) as NotificationSettings;
		if (settings.projectFollowUp?.enabled === false) {
			results.push({ userId: user.id, sent: false, skippedReason: 'disabled' });
			continue;
		}

		const timezone = user.timezone || 'Europe/Oslo';
		const local = localNow(timezone, now);
		const targetHm = settings.projectFollowUp?.time || '09:00';
		if (local.hm !== targetHm) {
			results.push({ userId: user.id, sent: false, skippedReason: 'not-time' });
			continue;
		}

		// Forfalte, ikke-ferdige kontakter i brukerens hjem-prosjekter.
		const rows = await db
			.select({
				themeId: projectContacts.themeId,
				themeName: themes.name,
				name: projectContacts.name,
				role: projectContacts.role
			})
			.from(projectContacts)
			.innerJoin(themes, eq(projectContacts.themeId, themes.id))
			.where(
				and(
					eq(projectContacts.userId, user.id),
					isNotNull(projectContacts.followUpAt),
					lte(projectContacts.followUpAt, local.isoDate),
					ne(projectContacts.status, 'ferdig'),
					eq(themes.archived, false)
				)
			);

		if (rows.length === 0) {
			results.push({ userId: user.id, sent: false, skippedReason: 'nothing-due' });
			continue;
		}

		// Gruppér per prosjekt.
		const byTheme = new Map<string, { themeId: string; themeName: string; contacts: Array<{ name: string; role: string | null }> }>();
		for (const r of rows) {
			const g = byTheme.get(r.themeId) ?? { themeId: r.themeId, themeName: r.themeName, contacts: [] };
			g.contacts.push({ name: r.name, role: r.role });
			byTheme.set(r.themeId, g);
		}
		const projects = [...byTheme.values()];
		const contactCount = rows.length;

		const eventId = await createNudgeEvent({
			userId: user.id,
			nudgeType: 'project_followup',
			mode: 'interactive',
			context: { dayIso: local.isoDate, projectCount: projects.length, contactCount, trigger: 'schedule' }
		});

		let sent = false;

		if (routeTargetsPwa(routes)) {
			const delivery = await PushDeliveryService.deliverToUser({
				userId: user.id,
				payload: {
					title: '📇 Oppfølging',
					body: `${contactCount} kontakt${contactCount === 1 ? '' : 'er'} venter på purring.`,
					url: `${appUrl}/tema/${projects[0].themeId}?tab=kontakter`,
					tag: `nudge-followup-${local.isoDate}`
				},
				onGone: 'disable'
			});
			sent = delivery.sent > 0;
		}

		const webhooks = getGoogleChatWebhooksForRoutes(user, routes);
		if (webhooks.length > 0) {
			const message = buildProjectFollowUpNudgeMessage({
				appUrl,
				userName: user.name,
				projects,
				nudgeEventId: eventId ?? undefined
			});
			for (const webhook of webhooks) {
				const ok = await sendGoogleChatMessage(webhook, message);
				sent = sent || ok;
			}
		}

		if (sent && eventId) await markNudgeSent(eventId);

		results.push({ userId: user.id, sent, projectCount: projects.length, contactCount });
	}

	return {
		timestamp: now.toISOString(),
		processedUsers: results.length,
		sent: results.filter((r) => r.sent).length,
		results
	};
}
