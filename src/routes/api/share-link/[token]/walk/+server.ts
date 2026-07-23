import { json } from '@sveltejs/kit';
import { resolveShareToken, recordShareAccess } from '$lib/server/share-tokens';
import { loadWalkPlayback } from '$lib/server/walk-playback';
import type { RequestHandler } from './$types';

/**
 * Offentlig (token-basert) data-endepunkt for en delt gåtur-avspilling.
 * Krever et gyldig walkPlayback-share-token. Returnerer rutelinje, plasserte
 * bilder og nøkkeltall. Samme /api/share-link-mønster som /story og /position.
 */
export const GET: RequestHandler = async ({ params }) => {
	const share = await resolveShareToken(params.token);
	if (!share || share.resourceType !== 'walkPlayback') {
		return json({ error: 'not_found' }, { status: 404 });
	}

	const result = await loadWalkPlayback(share.ownerUserId, share.resourceId);
	if (!result) {
		return json({ error: 'not_found' }, { status: 404 });
	}

	await recordShareAccess(share.tokenId);
	return json(result);
};
