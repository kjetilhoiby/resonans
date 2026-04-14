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
	return `${inviterName} inviterer deg til et delt partnerrom i Resonans for parforhold, samliv og hverdag.`;
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
	const ogUrl = `${appOrigin}/partner-invite/${params.token}`;

	const canRespond = Boolean(
		invite &&
			invite.status === 'pending' &&
			currentUser?.email &&
			currentUser.email.toLowerCase() === invite.inviteeEmail.toLowerCase()
	);

	const autoAccept = url.searchParams.get('autoAccept') === '1';
	const signInNext = `${url.pathname}?autoAccept=1`;

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
		autoAccept,
		signInUrl: `/auth?next=${encodeURIComponent(signInNext)}`,
		meta: {
			title,
			description,
			imageUrl: `${appOrigin}/partner-invite/${params.token}/og-image?v=2`,
			url: ogUrl
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
			throw redirect(303, '/?onboarding=partner');
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
			throw redirect(303, '/');
		} catch (error) {
			if (error instanceof RelationshipError) {
				return fail(400, { error: error.message });
			}

			throw error;
		}
	}
} satisfies Actions;