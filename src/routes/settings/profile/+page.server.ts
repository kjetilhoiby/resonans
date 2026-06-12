import { db } from '$lib/db';
import { persons, users } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
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

export const load: PageServerLoad = async ({ locals, url }) => {
	await ensureUser(locals.userId);

	const user = await db.query.users.findFirst({
		where: eq(users.id, locals.userId)
	});
	// Fødselsdato bor på self-personen (kilden for kavalkaden og selvangivelse-fristen)
	const selfPerson = await db.query.persons.findFirst({
		where: and(
			eq(persons.userId, locals.userId),
			eq(persons.kind, 'self'),
			eq(persons.archived, false)
		),
		columns: { birthDate: true }
	});
	const relationship = await getRelationshipOverview(locals.userId);
	const partnerInviteShareUrl = relationship.outgoingInvite
		? `${url.origin}/partner-invite/${relationship.outgoingInvite.token}`
		: null;

	return {
		user: user || null,
		selfBirthDate: selfPerson?.birthDate ?? null,
		relationship,
		partnerInviteShareUrl
	};
};

export const actions = {
	invitePartner: async ({ request, locals }) => {
		const data = await request.formData();
		const inviteeEmail = String(data.get('inviteeEmail') || '').trim();

		if (!inviteeEmail) {
			return fail(400, { error: 'Du må skrive inn e-postadressen til partneren din.' });
		}

		try {
			const result = await invitePartner(locals.userId, inviteeEmail);
			return {
				success: true,
				message: result.emailSent
					? `Invitasjon sendt til ${inviteeEmail} på e-post. Når partneren din logger inn, kan invitasjonen godkjennes i innstillingene.`
					: `Invitasjon registrert for ${inviteeEmail}, men e-post kunne ikke sendes akkurat nå. Partneren kan fortsatt logge inn med denne e-posten og godkjenne invitasjonen i innstillingene.`
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
			throw redirect(303, '/?onboarding=partner');
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
