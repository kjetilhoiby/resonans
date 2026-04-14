import { env } from '$env/dynamic/private';
import { redirect, fail } from '@sveltejs/kit';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import {
	acceptMarriageInvite,
	declineMarriageInvite,
	getMarriageInviteByToken,
	RelationshipError
} from '$lib/server/relationship';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

function getAppOrigin(url: URL) {
	return env.ORIGIN || url.origin;
}

function buildInviteDescription(inviterName: string) {
	return `${inviterName} vil koble dere sammen i Resonans for felles oversikt, refleksjon og hverdagsstøtte.`;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const invite = await getMarriageInviteByToken(params.token);
	const session = await locals.auth();
	const appOrigin = getAppOrigin(url);

	const currentUser = session?.user?.id
		? await db.query.users.findFirst({ where: eq(users.id, session.user.id) })
		: null;

	const title = invite
		? `${invite.inviterName} inviterte deg til Resonans`
		: 'Partnerinvitasjon | Resonans';
	const description = invite
		? buildInviteDescription(invite.inviterName)
		: 'Denne partnerinvitasjonen er ikke lenger tilgjengelig.';

	const canRespond = Boolean(
		invite &&
			invite.status === 'pending' &&
			currentUser?.email &&
			currentUser.email.toLowerCase() === invite.inviteeEmail.toLowerCase()
	);

	return {
		invite,
		currentUser: currentUser
			? {
				id: currentUser.id,
				email: currentUser.email,
				name: currentUser.name
			}
			: null,
		canRespond,
		signInUrl: `/auth?next=${encodeURIComponent(url.pathname)}`,
		meta: {
			title,
			description,
			imageUrl: `${appOrigin}/partner-invite/${params.token}/og-image`
		}
	};
};

export const actions = {
	accept: async ({ params, locals, url }) => {
		const session = await locals.auth();
		if (!session?.user?.id) {
			throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
		}

		const invite = await getMarriageInviteByToken(params.token);
		if (!invite) {
			return fail(404, { error: 'Invitasjonen finnes ikke lenger.' });
		}

		try {
			await acceptMarriageInvite(invite.id, session.user.id);
			throw redirect(303, '/settings');
		} catch (error) {
			if (error instanceof RelationshipError) {
				return fail(400, { error: error.message });
			}

			throw error;
		}
	},
	decline: async ({ params, locals, url }) => {
		const session = await locals.auth();
		if (!session?.user?.id) {
			throw redirect(303, `/auth?next=${encodeURIComponent(url.pathname)}`);
		}

		const invite = await getMarriageInviteByToken(params.token);
		if (!invite) {
			return fail(404, { error: 'Invitasjonen finnes ikke lenger.' });
		}

		try {
			await declineMarriageInvite(invite.id, session.user.id);
			throw redirect(303, '/settings');
		} catch (error) {
			if (error instanceof RelationshipError) {
				return fail(400, { error: error.message });
			}

			throw error;
		}
	}
} satisfies Actions;