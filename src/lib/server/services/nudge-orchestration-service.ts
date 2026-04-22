import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { getUserActiveGoalsAndTasks } from '$lib/server/goals';
import { buildDailyCheckInMessage } from '$lib/server/google-chat';
import { resolveRoutesForNotification, sendGoogleChatToRoutes } from '$lib/server/notification-channels';
import { runDayPlanningAndCloseNudges } from '$lib/server/day-planning-nudges';
import { eq } from 'drizzle-orm';

function toHmFromParts(parts: Intl.DateTimeFormatPart[]) {
	const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
	const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
	return `${hour}:${minute}`;
}

function localHm(timeZone: string, now: Date) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	});
	return toHmFromParts(formatter.formatToParts(now));
}

function hmToMinutes(hm: string) {
	const [hRaw, mRaw] = hm.split(':');
	const h = Number.parseInt(hRaw ?? '', 10);
	const m = Number.parseInt(mRaw ?? '', 10);
	if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) {
		return null;
	}
	return h * 60 + m;
}

function isWithinRecentMinutesWindow(nowHm: string, targetHm: string, windowMinutes: number) {
	const nowMin = hmToMinutes(nowHm);
	const targetMin = hmToMinutes(targetHm);
	if (nowMin === null || targetMin === null) return false;
	const delta = (nowMin - targetMin + 1440) % 1440;
	return delta >= 0 && delta < windowMinutes;
}

export type DailyCheckInNudgeResult = {
	nudgeType: 'daily_checkin';
	userId: string;
	userName: string | null;
	success: boolean;
	goalCount?: number;
	taskCount?: number;
	error?: string;
};

export class NudgeOrchestrationService {
	static async runScheduledNudges(appUrl: string, now: Date = new Date()) {
		return runDayPlanningAndCloseNudges(appUrl, now);
	}

	static async runDailyCheckInNudges(args: {
		appUrl: string;
		now?: Date;
		windowMinutes?: number;
		requireRecentTimeWindow?: boolean;
		userId?: string;
	}) {
		const now = args.now ?? new Date();
		const windowMinutes = args.windowMinutes ?? 5;
		const requireRecentTimeWindow = args.requireRecentTimeWindow ?? true;

		const allUsers = args.userId
			? await db.query.users.findMany({ where: eq(users.id, args.userId) })
			: await db.query.users.findMany();

		const results: DailyCheckInNudgeResult[] = [];

		for (const user of allUsers) {
			const routes = resolveRoutesForNotification(user, 'dailyCheckIn');
			if (routes.length === 0) {
				continue;
			}

			const settings = user.notificationSettings as {
				dailyCheckIn?: { enabled?: boolean; time?: string };
			};
			if (settings?.dailyCheckIn?.enabled === false) {
				continue;
			}

			if (requireRecentTimeWindow) {
				const timezone = user.timezone || 'Europe/Oslo';
				const targetHm = settings?.dailyCheckIn?.time || '09:00';
				const nowHm = localHm(timezone, now);
				if (!isWithinRecentMinutesWindow(nowHm, targetHm, windowMinutes)) {
					continue;
				}
			}

			try {
				const activeGoals = await getUserActiveGoalsAndTasks(user.id);

				const goalsSummary = activeGoals.map((goal) => {
					let totalProgress = 0;
					if (goal.tasks.length > 0) {
						totalProgress = Math.round(
							goal.tasks.reduce((sum, task) => {
								const taskProgress =
									task.progress?.reduce((taskSum: number, p: { value: number | null }) => taskSum + (p.value || 0), 0) || 0;
								const taskTarget = task.targetValue || 100;
								return sum + Math.min((taskProgress / taskTarget) * 100, 100);
							}, 0) / goal.tasks.length
						);
					}

					return {
						title: goal.title,
						progress: totalProgress,
						status: goal.status
					};
				});

				const tasksDueToday = activeGoals.flatMap((goal) =>
					goal.tasks
						.filter(
							(task) =>
								task.frequency === 'daily' ||
								task.frequency === 'weekly' ||
								(task.frequency === 'once' && task.status === 'active')
						)
						.map((task) => ({
							title: task.title,
							goalTitle: goal.title
						}))
				);

				const message = buildDailyCheckInMessage({
					appUrl: args.appUrl,
					userName: user.name,
					goalsSummary: goalsSummary.filter((g) => g.status === 'active'),
					tasksDueToday
				});

				const success = await sendGoogleChatToRoutes({ user, routes, message });

				results.push({
					nudgeType: 'daily_checkin',
					userId: user.id,
					userName: user.name,
					success,
					goalCount: goalsSummary.length,
					taskCount: tasksDueToday.length
				});
			} catch (error) {
				console.error(`Failed to send daily check-in nudge for user ${user.id}:`, error);
				results.push({
					nudgeType: 'daily_checkin',
					userId: user.id,
					userName: user.name,
					success: false,
					error: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		}

		return {
			success: true,
			timestamp: now.toISOString(),
			nudgeType: 'daily_checkin' as const,
			userCount: results.length,
			results
		};
	}
}
