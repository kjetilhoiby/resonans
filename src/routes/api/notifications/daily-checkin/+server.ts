import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { NudgeOrchestrationService } from '$lib/server/services/nudge-orchestration-service';

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

		// Sjekk om daily check-in er aktivert for denne brukeren
		const settings = user.notificationSettings as any;
		if (settings?.dailyCheckIn?.enabled === false) {
			return json(
				{ success: false, message: 'Daily check-in is disabled for this user' },
				{ status: 200 }
			);
		}

		const result = await NudgeOrchestrationService.runDailyCheckInNudges({
			appUrl: url.origin,
			requireRecentTimeWindow: false,
			userId: user.id
		});
		const success = result.results.some((item) => item.success);

		if (!success) {
			return json({ error: 'Failed to send message to Google Chat' }, { status: 500 });
		}

		const primary = result.results[0];

		return json({
			success: true,
			message: 'Daily check-in sent to Google Chat',
			goalCount: primary?.goalCount ?? 0,
			taskCount: primary?.taskCount ?? 0
		});
	} catch (error) {
		console.error('Error sending daily check-in:', error);
		return json(
			{ error: 'Internal server error', details: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

