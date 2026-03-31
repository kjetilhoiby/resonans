import { redirect } from '@sveltejs/kit';
import { getGoogleSheetsAuthUrl } from '$lib/server/integrations/google-sheets';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies }) => {
	const state = crypto.randomUUID();

	cookies.set('google_sheets_oauth_state', state, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		maxAge: 60 * 10
	});

	const redirectUri = `${url.origin}/api/sensors/google-sheets/callback`;
	throw redirect(302, getGoogleSheetsAuthUrl(redirectUri, state));
};
