import { redirect } from '@sveltejs/kit';
import { getStravaAuthUrl } from '$lib/server/integrations/strava';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const redirectUri = `${url.origin}/api/sensors/strava/callback`;
	const state = crypto.randomUUID();

	cookies.set('strava_oauth_state', state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 10
	});

	const authUrl = getStravaAuthUrl(redirectUri, state);
	throw redirect(302, authUrl);
};
