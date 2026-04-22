import { fail } from '@sveltejs/kit';
import { ensureUser } from '$lib/server/users';
import {
	ApiSecretsStorageNotReadyError,
	createUserApiSecret,
	listUserApiSecrets,
	revokeUserApiSecret
} from '$lib/server/api-secrets';
import type { Actions, PageServerLoad } from './$types';

function parseExpiresAt(daysRaw: FormDataEntryValue | null): Date | null {
	if (typeof daysRaw !== 'string' || !daysRaw.trim()) {
		return null;
	}

	const days = Number(daysRaw);
	if (!Number.isFinite(days) || days <= 0) {
		return null;
	}

	const safeDays = Math.min(Math.floor(days), 3650);
	const expiresAt = new Date();
	expiresAt.setDate(expiresAt.getDate() + safeDays);
	return expiresAt;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	await ensureUser(locals.userId);
	try {
		return {
			origin: url.origin,
			tableReady: true,
			secrets: await listUserApiSecrets(locals.userId)
		};
	} catch (error) {
		if (error instanceof ApiSecretsStorageNotReadyError) {
			return {
				origin: url.origin,
				tableReady: false,
				secrets: [] as Awaited<ReturnType<typeof listUserApiSecrets>>
			};
		}
		throw error;
	}
};

export const actions = {
	createSecret: async ({ request, locals }) => {
		await ensureUser(locals.userId);
		const formData = await request.formData();
		const labelRaw = formData.get('label');
		const label = typeof labelRaw === 'string' ? labelRaw.trim() : '';
		const expiresAt = parseExpiresAt(formData.get('expiresInDays'));

		let created: Awaited<ReturnType<typeof createUserApiSecret>>;
		try {
			created = await createUserApiSecret({
				userId: locals.userId,
				label,
				expiresAt
			});
		} catch (error) {
			if (error instanceof ApiSecretsStorageNotReadyError) {
				return fail(503, {
					error: 'API-secrets er ikke klare enda. Kjør databasemigrasjon (npm run db:push eller db:migrate).'
				});
			}
			throw error;
		}

		return {
			success: true,
			message: 'Nytt API-secret opprettet.',
			createdSecret: created.plainSecret,
			createdMeta: created.secret
		};
	},
	revokeSecret: async ({ request, locals }) => {
		await ensureUser(locals.userId);
		const formData = await request.formData();
		const secretIdRaw = formData.get('secretId');
		const secretId = typeof secretIdRaw === 'string' ? secretIdRaw.trim() : '';

		if (!secretId) {
			return fail(400, { error: 'Mangler secret-id.' });
		}

		let revoked = false;
		try {
			revoked = await revokeUserApiSecret(locals.userId, secretId);
		} catch (error) {
			if (error instanceof ApiSecretsStorageNotReadyError) {
				return fail(503, {
					error: 'API-secrets er ikke klare enda. Kjør databasemigrasjon (npm run db:push eller db:migrate).'
				});
			}
			throw error;
		}
		if (!revoked) {
			return fail(404, { error: 'Fant ikke et aktivt secret med den ID-en.' });
		}

		return {
			success: true,
			message: 'Secret er nå deaktivert.'
		};
	}
} satisfies Actions;
