import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { getUserActiveGoalsAndTasks } from '$lib/server/goals';
import { sendGoogleChatMessage, buildDailyCheckInMessage } from '$lib/server/google-chat';

/**
 * Vercel Cron endpoint for daglige check-ins
 * Kjøres automatisk hver dag kl. 09:00 (UTC - juster etter tidssone)
 * 
 * VIKTIG: Denne endepunktet er beskyttet av Vercel Cron secret
 */
export const GET: RequestHandler = async ({ request, url }) => {
	// Verify that this is a legitimate Vercel Cron request
	const authHeader = request.headers.get('authorization');
	if (env.VERCEL_ENV && authHeader !== `Bearer ${env.CRON_SECRET}`) {
		return json({ error: 'Unauthorized' }, { status: 401 });
	}

	try {
		// Get all users with Google Chat webhook configured and daily check-in enabled
		const allUsers = await db.query.users.findMany();
		
		const results = [];
		
		for (const user of allUsers) {
			// Skip if no webhook configured
			if (!user.googleChatWebhook) {
				continue;
			}

			// Check notification settings
			const settings = user.notificationSettings as any;
			if (settings?.dailyCheckIn?.enabled === false) {
				continue;
			}

			try {
				// Get user's active goals and tasks
				const activeGoals = await getUserActiveGoalsAndTasks(user.id);

				// Calculate progress for each goal
				const goalsSummary = activeGoals.map((goal) => {
					let totalProgress = 0;
					if (goal.tasks.length > 0) {
						totalProgress = Math.round(
							goal.tasks.reduce((sum, task) => {
								const taskProgress = task.progress?.reduce((taskSum, p) => taskSum + (p.value || 0), 0) || 0;
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

				// Find tasks due today (daily or weekly tasks)
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

				// Build and send message
				const message = buildDailyCheckInMessage({
					appUrl: url.origin,
					userName: user.name,
					goalsSummary: goalsSummary.filter((g) => g.status === 'active'),
					tasksDueToday
				});

				const success = await sendGoogleChatMessage(user.googleChatWebhook, message);

				results.push({
					userId: user.id,
					userName: user.name,
					success,
					goalCount: goalsSummary.length,
					taskCount: tasksDueToday.length
				});
			} catch (error) {
				console.error(`Failed to send check-in for user ${user.id}:`, error);
				results.push({
					userId: user.id,
					userName: user.name,
					success: false,
					error: error instanceof Error ? error.message : 'Unknown error'
				});
			}
		}

		return json({
			success: true,
			timestamp: new Date().toISOString(),
			userCount: results.length,
			results
		});
	} catch (error) {
		console.error('Cron job failed:', error);
		return json(
			{
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
