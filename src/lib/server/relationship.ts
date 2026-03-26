import { db } from '$lib/db';
import { allowedEmails, marriageInvites, users } from '$lib/db/schema';
import { normalizeEmail } from '$lib/server/auth-allowlist';
import { and, desc, eq, or } from 'drizzle-orm';

export class RelationshipError extends Error {}

export async function invitePartner(inviterUserId: string, inviteeEmailInput: string) {
	const inviteeEmail = normalizeEmail(inviteeEmailInput);

	const inviter = await db.query.users.findFirst({
		where: eq(users.id, inviterUserId)
	});

	if (!inviter) {
		throw new RelationshipError('Fant ikke brukeren som sender invitasjonen.');
	}

	if (!inviter.email) {
		throw new RelationshipError('Du må ha en e-postadresse på kontoen før du kan invitere partneren din.');
	}

	if (inviter.partnerUserId) {
		throw new RelationshipError('Du er allerede koblet til en partner.');
	}

	if (inviteeEmail === normalizeEmail(inviter.email)) {
		throw new RelationshipError('Du kan ikke invitere deg selv.');
	}

	const inviteeUser = await db.query.users.findFirst({
		where: eq(users.email, inviteeEmail)
	});

	if (inviteeUser?.partnerUserId) {
		throw new RelationshipError('Denne brukeren er allerede koblet til en partner.');
	}

	await db
		.update(marriageInvites)
		.set({
			status: 'cancelled',
			respondedAt: new Date()
		})
		.where(and(eq(marriageInvites.inviterUserId, inviterUserId), eq(marriageInvites.status, 'pending')));

	const existingAllowedEmail = await db.query.allowedEmails.findFirst({
		where: eq(allowedEmails.email, inviteeEmail)
	});

	if (!existingAllowedEmail) {
		await db.insert(allowedEmails).values({
			email: inviteeEmail,
			note: `Partnerinvitasjon fra ${inviter.email}`,
			invitedByUserId: inviterUserId
		});
	}

	const [invite] = await db
		.insert(marriageInvites)
		.values({
			inviterUserId,
			inviteeEmail,
			token: crypto.randomUUID()
		})
		.returning();

	return invite;
}

export async function acceptMarriageInvite(inviteId: string, userId: string) {
	const invite = await db.query.marriageInvites.findFirst({
		where: eq(marriageInvites.id, inviteId)
	});

	if (!invite || invite.status !== 'pending') {
		throw new RelationshipError('Invitasjonen finnes ikke lenger eller er allerede behandlet.');
	}

	const [currentUser, inviter] = await Promise.all([
		db.query.users.findFirst({ where: eq(users.id, userId) }),
		db.query.users.findFirst({ where: eq(users.id, invite.inviterUserId) })
	]);

	if (!currentUser || !inviter) {
		throw new RelationshipError('Fant ikke begge brukerne for invitasjonen.');
	}

	if (!currentUser.email || normalizeEmail(currentUser.email) !== normalizeEmail(invite.inviteeEmail)) {
		throw new RelationshipError('Denne invitasjonen er sendt til en annen e-postadresse.');
	}

	if (currentUser.partnerUserId || inviter.partnerUserId) {
		throw new RelationshipError('En av brukerne er allerede koblet til en partner.');
	}

	const now = new Date();

	await db.transaction(async (tx) => {
		await tx
			.update(users)
			.set({
				partnerUserId: inviter.id,
				partnerConfirmedAt: now,
				updatedAt: now
			})
			.where(eq(users.id, currentUser.id));

		await tx
			.update(users)
			.set({
				partnerUserId: currentUser.id,
				partnerConfirmedAt: now,
				updatedAt: now
			})
			.where(eq(users.id, inviter.id));

		await tx
			.update(marriageInvites)
			.set({
				status: 'accepted',
				inviteeUserId: currentUser.id,
				respondedAt: now
			})
			.where(eq(marriageInvites.id, invite.id));

		await tx
			.update(marriageInvites)
			.set({
				status: 'cancelled',
				respondedAt: now
			})
			.where(and(eq(marriageInvites.inviterUserId, inviter.id), eq(marriageInvites.status, 'pending')));
	});
}

export async function declineMarriageInvite(inviteId: string, userId: string) {
	const invite = await db.query.marriageInvites.findFirst({
		where: eq(marriageInvites.id, inviteId)
	});

	const currentUser = await db.query.users.findFirst({
		where: eq(users.id, userId)
	});

	if (!invite || invite.status !== 'pending' || !currentUser?.email) {
		throw new RelationshipError('Invitasjonen kan ikke avslås.');
	}

	if (normalizeEmail(currentUser.email) !== normalizeEmail(invite.inviteeEmail)) {
		throw new RelationshipError('Denne invitasjonen tilhører en annen bruker.');
	}

	await db
		.update(marriageInvites)
		.set({
			status: 'declined',
			inviteeUserId: currentUser.id,
			respondedAt: new Date()
		})
		.where(eq(marriageInvites.id, inviteId));
}

export async function cancelMarriageInvite(inviteId: string, userId: string) {
	const invite = await db.query.marriageInvites.findFirst({
		where: eq(marriageInvites.id, inviteId)
	});

	if (!invite || invite.inviterUserId !== userId || invite.status !== 'pending') {
		throw new RelationshipError('Invitasjonen kan ikke trekkes tilbake.');
	}

	await db
		.update(marriageInvites)
		.set({
			status: 'cancelled',
			respondedAt: new Date()
		})
		.where(eq(marriageInvites.id, inviteId));
}

export async function getRelationshipOverview(userId: string) {
	const currentUser = await db.query.users.findFirst({
		where: eq(users.id, userId)
	});

	if (!currentUser) {
		return {
			partner: null,
			incomingInvite: null,
			outgoingInvite: null
		};
	}

	const [partner, incomingInvite, outgoingInvite] = await Promise.all([
		currentUser.partnerUserId
			? db.query.users.findFirst({ where: eq(users.id, currentUser.partnerUserId) })
			: Promise.resolve(null),
		currentUser.email
			? db.query.marriageInvites.findFirst({
				where: and(
					eq(marriageInvites.inviteeEmail, normalizeEmail(currentUser.email)),
					eq(marriageInvites.status, 'pending')
				),
				orderBy: [desc(marriageInvites.createdAt)]
			})
			: Promise.resolve(null),
		db.query.marriageInvites.findFirst({
			where: and(eq(marriageInvites.inviterUserId, userId), eq(marriageInvites.status, 'pending')),
			orderBy: [desc(marriageInvites.createdAt)]
		})
	]);

	const inviter = incomingInvite
		? await db.query.users.findFirst({ where: eq(users.id, incomingInvite.inviterUserId) })
		: null;

	return {
		partner,
		incomingInvite: incomingInvite
			? {
				...incomingInvite,
				inviterName: inviter?.name || inviter?.email || 'Ukjent bruker'
			}
			: null,
		outgoingInvite
	};
}
