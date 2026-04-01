import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { fail } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import {
	acceptMarriageInvite,
	cancelMarriageInvite,
	declineMarriageInvite,
	getRelationshipOverview,
	invitePartner,
	RelationshipError
} from '$lib/server/relationship';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	await ensureUser(locals.userId);

	const user = await db.query.users.findFirst({
		where: eq(users.id, locals.userId)
	});
	const relationship = await getRelationshipOverview(locals.userId);

	return {
		user: user || null,
		relationship
	};
};

export const actions = {
	updateSettings: async ({ request, locals }) => {
		const userId = locals.userId;

		await ensureUser(userId);
		const existingUser = await db.query.users.findFirst({ where: eq(users.id, userId) });
		
		const data = await request.formData();

		const hasGoogleChatWebhook = data.has('googleChatWebhook');
		const hasTimezone = data.has('timezone');
		const googleChatWebhook = hasGoogleChatWebhook
			? (data.get('googleChatWebhook') as string | null)
			: (existingUser?.googleChatWebhook ?? null);
		const timezone = hasTimezone
			? ((data.get('timezone') as string) || 'Europe/Oslo')
			: (existingUser?.timezone ?? 'Europe/Oslo');

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
	},
	invitePartner: async ({ request, locals }) => {
		const data = await request.formData();
		const inviteeEmail = String(data.get('inviteeEmail') || '').trim();

		if (!inviteeEmail) {
			return fail(400, { error: 'Du må skrive inn e-postadressen til partneren din.' });
		}

		try {
			await invitePartner(locals.userId, inviteeEmail);
			return {
				success: true,
				message: `Invitasjon sendt til ${inviteeEmail}. Når partneren din logger inn, kan invitasjonen godkjennes i innstillingene.`
			};
		} catch (error) {
			if (error instanceof RelationshipError) {
				return fail(400, { error: error.message });
			}

			console.error('Failed to invite partner:', error);
			return fail(500, { error: 'Kunne ikke sende partnerinvitasjonen.' });
		}
	},
	acceptMarriageInvite: async ({ request, locals }) => {
		const data = await request.formData();
		const inviteId = String(data.get('inviteId') || '');

		try {
			await acceptMarriageInvite(inviteId, locals.userId);
			return { success: true, message: 'Ekteskapet er bekreftet. Dere er nå koblet sammen i appen.' };
		} catch (error) {
			if (error instanceof RelationshipError) {
				return fail(400, { error: error.message });
			}

			console.error('Failed to accept marriage invite:', error);
			return fail(500, { error: 'Kunne ikke godkjenne invitasjonen.' });
		}
	},
	declineMarriageInvite: async ({ request, locals }) => {
		const data = await request.formData();
		const inviteId = String(data.get('inviteId') || '');

		try {
			await declineMarriageInvite(inviteId, locals.userId);
			return { success: true, message: 'Invitasjonen ble avslått.' };
		} catch (error) {
			if (error instanceof RelationshipError) {
				return fail(400, { error: error.message });
			}

			console.error('Failed to decline marriage invite:', error);
			return fail(500, { error: 'Kunne ikke avslå invitasjonen.' });
		}
	},
	cancelMarriageInvite: async ({ request, locals }) => {
		const data = await request.formData();
		const inviteId = String(data.get('inviteId') || '');

		try {
			await cancelMarriageInvite(inviteId, locals.userId);
			return { success: true, message: 'Partnerinvitasjonen ble trukket tilbake.' };
		} catch (error) {
			if (error instanceof RelationshipError) {
				return fail(400, { error: error.message });
			}

			console.error('Failed to cancel marriage invite:', error);
			return fail(500, { error: 'Kunne ikke trekke tilbake invitasjonen.' });
		}
	}
} satisfies Actions;
