import cron from 'node-cron';
import { env } from '$env/dynamic/private';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { getUserActiveGoalsAndTasks } from '$lib/server/goals';
import { sendGoogleChatMessage, buildDailyCheckInMessage } from '$lib/server/google-chat';
import { syncAllWithingsData } from '$lib/server/integrations/withings-sync';
import { aggregateAllPeriods } from '$lib/server/integrations/aggregation';
import { DEFAULT_USER_ID } from '$lib/server/users';

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

	// Withings synk hver time
	// '0 * * * *' = hvert hele time
	cron.schedule(
		'0 * * * *',
		async () => {
			console.log('🔄 Running hourly Withings sync at', new Date().toISOString());
			await syncWithingsData();
		},
		{
			timezone: 'Europe/Oslo'
		}
	);

	// Withings synk hvert 5. minutt (dagtid: 05:00-23:00)
	// '*/5 5-22 * * *' = hvert 5. minutt mellom 05:00 og 22:59
	cron.schedule(
		'*/5 5-22 * * *',
		async () => {
			console.log('🔄 Running 5-min Withings sync at', new Date().toISOString());
			await syncWithingsData();
		},
		{
			timezone: 'Europe/Oslo'
		}
	);

	// Nattlig aggregering kl 00:00 (reduserer datatrafikk dramatisk)
	// '0 0 * * *' = hver dag kl 00:00
	cron.schedule(
		'0 0 * * *',
		async () => {
			console.log('📊 Running nightly aggregation at', new Date().toISOString());
			try {
				const userId = DEFAULT_USER_ID;
				await aggregateAllPeriods(userId);
				console.log('✅ Nightly aggregation complete');
			} catch (error) {
				console.error('❌ Nightly aggregation failed:', error);
			}
		},
		{
			timezone: 'Europe/Oslo'
		}
	);

	// Test: Send check-in hver 5. minutt (kun for testing - fjern i produksjon)
	// cron.schedule('*/5 * * * *', async () => {
	// 	console.log('🧪 Test check-in at', new Date().toISOString());
	// 	await sendDailyCheckIns();
	// });

	isSchedulerRunning = true;
	console.log('✅ Scheduler started:');
	console.log('   - Daily check-in at 09:00 Europe/Oslo');
	console.log('   - Withings sync every 5 min (05:00-23:00)');
	console.log('   - Withings sync every hour (23:00-05:00)');
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

// Track if sync is currently running to prevent concurrent syncs
let syncInProgress = false;

async function syncWithingsData() {
	// Prevent concurrent syncs
	if (syncInProgress) {
		console.log('⏭️  Skipping Withings sync - already in progress');
		return;
	}

	try {
		syncInProgress = true;
		console.log('🔄 Starting Withings data sync...');
		
		const userId = DEFAULT_USER_ID;
		
		// Incremental sync (only new data since last sync)
		const results = await syncAllWithingsData(userId, false);
		
		const totalSynced = results.weight + results.activity + results.sleep + results.workouts;
		console.log(`✅ Withings sync complete: ${totalSynced} new events (aggregation runs nightly at 00:00)`);
	} catch (error) {
		console.error('❌ Withings sync job failed:', error);
		// Log the full error for debugging
		if (error instanceof Error) {
			console.error('   Error details:', error.message);
			console.error('   Stack:', error.stack);
		}
	} finally {
		syncInProgress = false;
	}
}
