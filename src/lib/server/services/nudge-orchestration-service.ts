import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { getUserActiveGoalsAndTasks } from '$lib/server/goals';
import { buildDailyCheckInMessage } from '$lib/server/google-chat';
import { resolveRoutesForNotification, sendGoogleChatToRoutes } from '$lib/server/notification-channels';
import { runDayPlanningAndCloseNudges } from '$lib/server/day-planning-nudges';
import { runEgenfrekvensCheckInNudges, type EgenfrekvensCheckInNudgeResult } from '$lib/server/egenfrekvens-nudges';
import { runLivskompassWeekendNudges } from '$lib/server/livskompass-nudges';
import { runProgramReadinessNudges, type ProgramReadinessNudgeResult } from '$lib/server/programs/readiness-nudges';
import { localHm, isWithinRecentMinutesWindow } from '$lib/server/nudge-time';
import { eq } from 'drizzle-orm';

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

	static async runEgenfrekvensCheckInNudges(args: {
		appUrl: string;
		now?: Date;
		windowMinutes?: number;
		requireRecentTimeWindow?: boolean;
		userId?: string;
	}) {
		return runEgenfrekvensCheckInNudges(args);
	}

	static async runLivskompassWeekendNudges(args: {
		appUrl: string;
		now?: Date;
		windowMinutes?: number;
		requireRecentTimeWindow?: boolean;
		userId?: string;
	}) {
		return runLivskompassWeekendNudges(args);
	}

	static async runProgramReadinessNudges(args: {
		appUrl: string;
		now?: Date;
		windowMinutes?: number;
		requireRecentTimeWindow?: boolean;
		userId?: string;
	}) {
		return runProgramReadinessNudges(args);
	}
}

export type { EgenfrekvensCheckInNudgeResult, ProgramReadinessNudgeResult };
