import { redirect } from '@sveltejs/kit';
import { getAuthorizeUrl, generatePkcePair, isTeslaConfigured } from '$lib/server/integrations/tesla';
import type { RequestHandler } from './$types';

/**
 * Start Tesla Fleet API OAuth (Authorization Code + PKCE).
 * GET /api/sensors/tesla/connect
 *
 * Vi lagrer state + PKCE code_verifier i en kortlevd httpOnly-cookie som
 * valideres i callback.
 */
export const GET: RequestHandler = async ({ url, cookies }) => {
	if (!isTeslaConfigured()) {
		throw redirect(302, '/settings/sources?error=tesla_not_configured');
	}

	const redirectUri = `${url.origin}/api/sensors/tesla/callback`;
	const state = crypto.randomUUID();
	const { verifier, challenge } = generatePkcePair();

	const cookieOpts = {
		path: '/',
		httpOnly: true,
		secure: url.protocol === 'https:',
		sameSite: 'lax' as const,
		maxAge: 600 // 10 min
	};
	cookies.set('tesla_oauth_state', state, cookieOpts);
	cookies.set('tesla_oauth_verifier', verifier, cookieOpts);

	throw redirect(302, getAuthorizeUrl({ redirectUri, state, codeChallenge: challenge }));
};
