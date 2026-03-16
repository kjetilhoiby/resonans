import { redirect } from '@sveltejs/kit';
import { getSparebank1AuthUrl } from '$lib/server/integrations/sparebank1';
import type { RequestHandler } from './$types';

/**
 * Initiate SpareBank1 OAuth flow
 * GET /api/sensors/sparebank1/connect
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	const redirectUri = `${url.origin}/api/sensors/sparebank1/callback`;
	const state = crypto.randomUUID();

	cookies.set('sparebank1_oauth_state', state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 10
	});

	const authUrl = getSparebank1AuthUrl(redirectUri, state);
	throw redirect(302, authUrl);
};
