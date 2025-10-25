import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { ensureDefaultUser, DEFAULT_USER_ID } from '$lib/server/users';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	// Ensure user exists before loading
	await ensureDefaultUser();

	const user = await db.query.users.findFirst({
		where: eq(users.id, DEFAULT_USER_ID)
	});

	return {
		user: user || null
	};
};

export const actions = {
	updateSettings: async ({ request }) => {
		const userId = DEFAULT_USER_ID;
		
		// Ensure user exists
		await ensureDefaultUser();
		
		const data = await request.formData();

		const googleChatWebhook = data.get('googleChatWebhook') as string | null;
		const timezone = data.get('timezone') as string;

		// Parse notification settings
		const notificationSettings = {
			dailyCheckIn: {
				enabled: data.get('dailyCheckInEnabled') === 'on',
				time: data.get('dailyCheckInTime') as string
			},
			weeklyReview: {
				enabled: data.get('weeklyReviewEnabled') === 'on',
				day: data.get('weeklyReviewDay') as string,
				time: data.get('weeklyReviewTime') as string
			},
			milestones: {
				enabled: data.get('milestonesEnabled') === 'on'
			},
			reminders: {
				enabled: data.get('remindersEnabled') === 'on'
			},
			inactivityAlerts: {
				enabled: data.get('inactivityAlertsEnabled') === 'on',
				daysThreshold: parseInt(data.get('inactivityDaysThreshold') as string) || 3
			}
		};

		try {
			const result = await db
				.update(users)
				.set({
					googleChatWebhook: googleChatWebhook || null,
					timezone,
					notificationSettings,
					updatedAt: new Date()
				})
				.where(eq(users.id, userId))
				.returning();

			console.log('Settings updated:', result);

			return { success: true };
		} catch (error) {
			console.error('Failed to update settings:', error);
			return fail(500, { error: 'Kunne ikke lagre innstillinger' });
		}
	}
} satisfies Actions;
