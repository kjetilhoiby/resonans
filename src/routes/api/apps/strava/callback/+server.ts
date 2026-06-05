import { isRedirect, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { consumeOAuthState, saveConnectionFromToken } from '$lib/server/services/strava-sync-service';
import { exchangeCodeForToken } from '$lib/server/integrations/strava';

const SETTINGS_PATH = '/settings/sources';

/**
 * Strava redirecter hit etter OAuth. Browser-flyt: svarer med redirect tilbake
 * til riktig klient avhengig av modus (lagret i state-nonce):
 *   - web   → /settings/sources?connected=strava | ?error=strava_<reason>
 *   - native → <scheme>://strava-connected?status=…
 * Ingen tokens sendes noensinne til klienten.
 */
export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const oauthError = url.searchParams.get('error');

	// Slå opp brukeren + modus tidlig så vi vet hvor vi skal redirecte.
	const resolved = state ? await consumeOAuthState(state) : null;
	const appId = resolved?.appId ?? 'ekko';
	const isWeb = appId === 'web';
	const scheme = getAppConfig(appId)?.deepLinkScheme ?? 'ekko';

	const appRedirect = (status: 'ok' | 'error', reason?: string) => {
		if (isWeb) {
			return status === 'ok'
				? redirect(302, `${SETTINGS_PATH}?connected=strava`)
				: redirect(302, `${SETTINGS_PATH}?error=strava_${reason ?? 'unknown'}`);
		}
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
