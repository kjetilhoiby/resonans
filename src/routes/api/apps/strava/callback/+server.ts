import { isRedirect, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { consumeOAuthState, saveConnectionFromToken } from '$lib/server/services/strava-sync-service';
import { exchangeCodeForToken } from '$lib/server/integrations/strava';

/**
 * Strava redirecter hit etter OAuth. Browser-flyt: svarer med redirect tilbake
 * til appen (`<scheme>://strava-connected?status=...`). Ingen tokens sendes
 * noensinne til appen.
 */
export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const oauthError = url.searchParams.get('error');

	// Slå opp brukeren tidlig så vi vet hvilken app-scheme vi skal redirecte til.
	const resolved = state ? await consumeOAuthState(state) : null;
	const appId = resolved?.appId ?? 'ekko';
	const scheme = getAppConfig(appId)?.deepLinkScheme ?? 'ekko';

	const appRedirect = (status: 'ok' | 'error', reason?: string) => {
		const suffix = reason ? `&reason=${reason}` : '';
		return redirect(302, `${scheme}://strava-connected?status=${status}${suffix}`);
	};

	if (oauthError) throw appRedirect('error', 'denied'); // f.eks. ?error=access_denied
	if (!resolved) throw appRedirect('error', 'state');
	if (!code) throw appRedirect('error', 'denied');

	try {
		const token = await exchangeCodeForToken(code);
		if (!token.access_token || !token.refresh_token) {
			throw appRedirect('error', 'token');
		}
		await saveConnectionFromToken(resolved.userId, token);
		throw appRedirect('ok');
	} catch (err) {
		if (isRedirect(err)) throw err;
		console.error('Strava callback feilet:', err);
		throw appRedirect('error', 'token');
	}
};
