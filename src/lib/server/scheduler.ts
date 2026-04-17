import cron from 'node-cron';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { getUserActiveGoalsAndTasks } from '$lib/server/goals';
import { sendGoogleChatMessage, buildDailyCheckInMessage } from '$lib/server/google-chat';
import { runDayPlanningAndCloseNudges } from '$lib/server/day-planning-nudges';
import { runDomainSignalProducers } from '$lib/server/domain-signals';

/**
 * In-app cron scheduler using node-cron
 * Kjører direkte i applikasjonsserveren - ingen Vercel Cron plan nødvendig!
 */

let isSchedulerRunning = false;

export function startScheduler() {
	if (isSchedulerRunning) {
		console.log('⏰ Scheduler already running');
		return;
	}

	console.log('🚀 Starting in-app scheduler...');

	// Daglig check-in kl. 09:00 norsk tid
	// Cron format: sekund minutt time dag måned ukedag
	// '0 9 * * *' = hver dag kl 09:00
	cron.schedule(
		'0 9 * * *',
		async () => {
			console.log('⏰ Running daily check-in at', new Date().toISOString());
			await sendDailyCheckIns();
		},
		{
			timezone: 'Europe/Oslo' // Norsk tidssone
		}
	);

	// Kjører hver hele time og sender lokale nudges (planlegg dag, parsjekk morgen, avslutt dag).
	cron.schedule(
		'0 * * * *',
		async () => {
			console.log('⏰ Running local nudges (day planning/relationship/day close) at', new Date().toISOString());
			const appUrl = env.ORIGIN || 'https://resonans.vercel.app';
			try {
				await runDayPlanningAndCloseNudges(appUrl);
			} catch (err) {
				console.error('❌ runDayPlanningAndCloseNudges failed:', err);
			}
			try {
				await runDomainSignalProducers();
			} catch (err) {
				console.error('❌ runDomainSignalProducers failed:', err);
			}
		},
		{
			timezone: 'UTC'
		}
	);

	// Withings-synk og nattlig aggregering håndteres av GitHub Actions cron
	// via /api/cron/withings-sync og /api/cron/aggregate (se /api/cron/jobs).

	isSchedulerRunning = true;
	console.log('✅ Scheduler started:');
	console.log('   - Daily check-in at 09:00 Europe/Oslo');
	console.log('   - Local nudges + domain signals every hour (UTC scheduler, local-time aware nudges)');
}

async function sendDailyCheckIns() {
	try {
		// Get all users with Google Chat webhook configured
		const allUsers = await db.query.users.findMany();

		let successCount = 0;
		let skipCount = 0;
		let errorCount = 0;

		for (const user of allUsers) {
			// Skip if no webhook configured
			if (!user.googleChatWebhook) {
				skipCount++;
				continue;
			}

			// Check notification settings
			const settings = user.notificationSettings as any;
			if (settings?.dailyCheckIn?.enabled === false) {
				skipCount++;
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
								const taskProgress =
									task.progress?.reduce((taskSum, p) => taskSum + (p.value || 0), 0) || 0;
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
				const appUrl = env.ORIGIN || 'https://resonans.vercel.app'; // Fallback URL
				const message = buildDailyCheckInMessage({
					appUrl,
					userName: user.name,
					goalsSummary: goalsSummary.filter((g) => g.status === 'active'),
					tasksDueToday
				});

				const success = await sendGoogleChatMessage(user.googleChatWebhook, message);

				if (success) {
					console.log(`✅ Daily check-in sent to ${user.name} (${user.email})`);
					successCount++;
				} else {
					console.error(`❌ Failed to send check-in to ${user.name}`);
					errorCount++;
				}
			} catch (error) {
				console.error(`❌ Error sending check-in to user ${user.id}:`, error);
				errorCount++;
			}
		}

		console.log(
			`📊 Daily check-in complete: ${successCount} sent, ${skipCount} skipped, ${errorCount} errors`
		);
	} catch (error) {
		console.error('❌ Daily check-in job failed:', error);
	}
}

