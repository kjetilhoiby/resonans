import { fail } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { ensureUser } from '$lib/server/users';
import {
	normalizeGoogleChatChannels,
	resolveRoutesForNotification,
	type NotificationRouteKey
} from '$lib/server/notification-channels';

type NotificationSettings = {
	notificationChannels?: {
		googleChat?: Array<{ id: string; name: string; webhook: string; enabled?: boolean }>;
		routing?: Partial<Record<NotificationRouteKey, string[]>>;
	};
	dailyCheckIn?: { enabled?: boolean; time?: string };
	dayPlanning?: { enabled?: boolean; time?: string };
	dayClose?: { enabled?: boolean; time?: string };
	nudgeProfile?: {
		weekdayMode?: 'interactive' | 'digest';
		weekendMode?: 'interactive' | 'digest';
		quietHours?: { enabled?: boolean; start?: string; end?: string };
		digestTimeWeekday?: string;
		digestTimeWeekend?: string;
	};
	weeklyReview?: { enabled?: boolean; day?: string; time?: string };
	milestones?: { enabled?: boolean };
	reminders?: { enabled?: boolean };
	inactivityAlerts?: { enabled?: boolean; daysThreshold?: number };
};

export const load: PageServerLoad = async ({ locals }) => {
	await ensureUser(locals.userId);
	const user = await db.query.users.findFirst({ where: eq(users.id, locals.userId) });
	const settings = (user?.notificationSettings ?? {}) as NotificationSettings;
	const channelUserView = {
		googleChatWebhook: user?.googleChatWebhook,
		notificationSettings: settings
	};
	const googleChatChannels = normalizeGoogleChatChannels(channelUserView);

	return {
		settings: {
			channels: {
				googleChat: googleChatChannels,
				routing: {
					dailyCheckIn: resolveRoutesForNotification(channelUserView, 'dailyCheckIn'),
					dayPlanning: resolveRoutesForNotification(channelUserView, 'dayPlanning'),
					dayClose: resolveRoutesForNotification(channelUserView, 'dayClose'),
					relationshipCheckinMorning: resolveRoutesForNotification(channelUserView, 'relationshipCheckinMorning'),
					digestDay: resolveRoutesForNotification(channelUserView, 'digestDay')
				}
			},
			dailyCheckIn: {
				enabled: settings.dailyCheckIn?.enabled !== false,
				time: settings.dailyCheckIn?.time || '09:00'
			},
			dayPlanning: {
				enabled: settings.dayPlanning?.enabled !== false,
				time: settings.dayPlanning?.time || '07:00'
			},
			dayClose: {
				enabled: settings.dayClose?.enabled !== false,
				time: settings.dayClose?.time || '21:00'
			},
			nudgeProfile: {
				weekdayMode: settings.nudgeProfile?.weekdayMode || 'interactive',
				weekendMode: settings.nudgeProfile?.weekendMode || 'digest',
				quietHours: {
					enabled: settings.nudgeProfile?.quietHours?.enabled !== false,
					start: settings.nudgeProfile?.quietHours?.start || '20:00',
					end: settings.nudgeProfile?.quietHours?.end || '08:00'
				},
				digestTimeWeekday: settings.nudgeProfile?.digestTimeWeekday || '09:00',
				digestTimeWeekend: settings.nudgeProfile?.digestTimeWeekend || '10:00'
			}
		}
	};
};

export const actions = {
	updateChannels: async ({ locals, request }) => {
		await ensureUser(locals.userId);
		const user = await db.query.users.findFirst({ where: eq(users.id, locals.userId) });
		if (!user) return fail(404, { error: 'Fant ikke bruker' });

		const data = await request.formData();
		const existing = (user.notificationSettings ?? {}) as NotificationSettings;

		const channelIds = data.getAll('googleChatChannelId').map((v) => String(v || '').trim());
		const channelNames = data.getAll('googleChatChannelName').map((v) => String(v || '').trim());
		const channelWebhooks = data.getAll('googleChatChannelWebhook').map((v) => String(v || '').trim());

		const googleChat = channelWebhooks
			.map((webhook, index) => {
				if (!webhook) return null;
				const rawName = channelNames[index] || `Kanal ${index + 1}`;
				const safeName = rawName.trim() || `Kanal ${index + 1}`;
				const fallbackId = safeName
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, '-')
					.replace(/^-+|-+$/g, '')
					.slice(0, 40) || `channel-${index + 1}`;
				const id = channelIds[index] || fallbackId;
				return { id, name: safeName, webhook, enabled: true };
			})
			.filter((value): value is { id: string; name: string; webhook: string; enabled: boolean } => Boolean(value));

		const routing: Partial<Record<NotificationRouteKey, string[]>> = {
			dailyCheckIn: data.getAll('route_dailyCheckIn').map((v) => String(v)),
			dayPlanning: data.getAll('route_dayPlanning').map((v) => String(v)),
			dayClose: data.getAll('route_dayClose').map((v) => String(v)),
			relationshipCheckinMorning: data.getAll('route_relationshipCheckinMorning').map((v) => String(v)),
			digestDay: data.getAll('route_digestDay').map((v) => String(v))
		};

		await db
			.update(users)
			.set({
				googleChatWebhook: googleChat[0]?.webhook ?? null,
				notificationSettings: {
					...existing,
					notificationChannels: {
						googleChat,
						routing
					}
				} as typeof users.$inferSelect.notificationSettings,
				updatedAt: new Date()
			})
			.where(eq(users.id, locals.userId));

		return { success: true, message: 'Kanaler lagret.' };
	},

	updateNudges: async ({ locals, request }) => {
		await ensureUser(locals.userId);
		const user = await db.query.users.findFirst({ where: eq(users.id, locals.userId) });
		if (!user) return fail(404, { error: 'Fant ikke bruker' });

		const data = await request.formData();
		const existing = (user.notificationSettings ?? {}) as NotificationSettings;
		const dailyCheckInTime = String(data.get('dailyCheckInTime') || '09:00').trim() || '09:00';
		const dayPlanningTime = String(data.get('dayPlanningTime') || '07:00').trim() || '07:00';
		const dayCloseTime = String(data.get('dayCloseTime') || '21:00').trim() || '21:00';
		const weekdayMode = String(data.get('nudgeWeekdayMode') || 'interactive') === 'digest' ? 'digest' : 'interactive';
		const weekendMode = String(data.get('nudgeWeekendMode') || 'digest') === 'interactive' ? 'interactive' : 'digest';
		const quietEnabled = data.get('nudgeQuietEnabled') === 'on';
		const quietStart = String(data.get('nudgeQuietStart') || '20:00').trim() || '20:00';
		const quietEnd = String(data.get('nudgeQuietEnd') || '08:00').trim() || '08:00';
		const digestTimeWeekday = String(data.get('digestTimeWeekday') || '09:00').trim() || '09:00';
		const digestTimeWeekend = String(data.get('digestTimeWeekend') || '10:00').trim() || '10:00';

		const nextSettings: NotificationSettings = {
			...existing,
			dailyCheckIn: {
				enabled: data.get('dailyCheckInEnabled') === 'on',
				time: dailyCheckInTime
			},
			dayPlanning: {
				enabled: data.get('dayPlanningEnabled') === 'on',
				time: dayPlanningTime
			},
			dayClose: {
				enabled: data.get('dayCloseEnabled') === 'on',
				time: dayCloseTime
			},
			nudgeProfile: {
				weekdayMode,
				weekendMode,
				quietHours: {
					enabled: quietEnabled,
					start: quietStart,
					end: quietEnd
				},
				digestTimeWeekday,
				digestTimeWeekend
			}
		};

		await db
			.update(users)
			.set({
				notificationSettings: nextSettings as typeof users.$inferSelect.notificationSettings,
				updatedAt: new Date()
			})
			.where(eq(users.id, locals.userId));

		return { success: true, message: 'Varslingsinnstillinger lagret.' };
	}
} satisfies Actions;
