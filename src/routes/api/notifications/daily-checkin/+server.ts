import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getUserActiveGoalsAndTasks } from '$lib/server/goals';
import { sendGoogleChatMessage, buildDailyCheckInMessage } from '$lib/server/google-chat';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';

/**
 * Send daglig check-in til Google Chat
 * 
 * Denne endepunktet kan kalles manuelt eller av en scheduled job (Vercel Cron)
 */
export const POST: RequestHandler = async ({ url, locals }) => {
	try {
		// Support for å spesifisere userId via query param
		const userId = url.searchParams.get('userId') || locals.userId;

		// Hent brukerens webhook og innstillinger
		const user = await db.query.users.findFirst({
			where: eq(users.id, userId)
		});

		if (!user) {
			return json({ error: 'User not found' }, { status: 404 });
		}

		if (!user.googleChatWebhook) {
			return json({ error: 'Google Chat webhook not configured for this user' }, { status: 400 });
		}

		// Sjekk om daily check-in er aktivert for denne brukeren
		const settings = user.notificationSettings as any;
		if (settings?.dailyCheckIn?.enabled === false) {
			return json(
				{ success: false, message: 'Daily check-in is disabled for this user' },
				{ status: 200 }
			);
		}

		// Hent brukerens mål og oppgaver
		const activeGoals = await getUserActiveGoalsAndTasks(userId);

		// Beregn progress for hvert mål
		const goalsSummary = activeGoals.map((goal) => {
			let totalProgress = 0;
			if (goal.tasks.length > 0) {
				// Enkel progress-beregning (kan forbedres)
				totalProgress = Math.round(
					goal.tasks.reduce((sum, task) => {
						// Simplified: hvis task har progress, anta 50% completion
						return sum + (task.progress && task.progress.length > 0 ? 50 : 0);
					}, 0) / goal.tasks.length
				);
			}

			return {
				title: goal.title,
				progress: totalProgress,
				status: goal.status
			};
		});

		// Finn tasks som er relevante for i dag
		// For nå: alle weekly/daily tasks
		const tasksDueToday = activeGoals.flatMap((goal) =>
			goal.tasks
				.filter((task) => task.frequency === 'daily' || task.frequency === 'weekly')
				.map((task) => ({
					title: task.title,
					goalTitle: goal.title
				}))
		);

		// Bygg og send melding til brukerens webhook
		const appUrl = url.origin;
		const message = buildDailyCheckInMessage({
			appUrl,
			avatarUrl: user.image,
			goalsSummary: goalsSummary.filter((g) => g.status === 'active'),
			tasksDueToday
		});

		const success = await sendGoogleChatMessage(user.googleChatWebhook, message);

		if (!success) {
			return json({ error: 'Failed to send message to Google Chat' }, { status: 500 });
		}

		return json({
			success: true,
			message: 'Daily check-in sent to Google Chat',
			goalCount: goalsSummary.length,
			taskCount: tasksDueToday.length
		});
	} catch (error) {
		console.error('Error sending daily check-in:', error);
		return json(
			{ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

