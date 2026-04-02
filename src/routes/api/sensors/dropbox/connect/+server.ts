import { redirect } from '@sveltejs/kit';
import { getDropboxAuthUrl } from '$lib/server/integrations/dropbox';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const state = crypto.randomUUID();
	cookies.set('dropbox_oauth_state', state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 10
	});

	const redirectUri = `${url.origin}/api/sensors/dropbox/callback`;
	const authUrl = getDropboxAuthUrl(redirectUri, state);
	throw redirect(302, authUrl);
};
