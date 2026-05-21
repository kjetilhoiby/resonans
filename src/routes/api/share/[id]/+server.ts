import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { revokeShareToken, ShareTokensStorageNotReadyError } from '$lib/server/share-tokens';

// DELETE /api/share/[id] — revoke a share token (sets revoked_at)
export const DELETE: RequestHandler = async ({ locals, params }) => {
	const userId = locals.userId;
	try {
		const revoked = await revokeShareToken(userId, params.id);
		if (!revoked) {
			return json({ error: 'Fant ingen aktiv deling med den ID-en' }, { status: 404 });
		}
		return json({ ok: true });
	} catch (error) {
		if (error instanceof ShareTokensStorageNotReadyError) {
			return json({ error: error.message }, { status: 503 });
		}
		throw error;
	}
};
