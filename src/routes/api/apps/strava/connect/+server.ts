import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { resolveUserIdFromApiSecret } from '$lib/server/api-secrets';
import { createOAuthState } from '$lib/server/services/strava-sync-service';
import { getAuthorizeUrl, isStravaConfigured } from '$lib/server/integrations/strava';

/**
 * Starter Strava-OAuth. Åpnes av ekko i en ASWebAuthenticationSession
 * (callback-scheme `ekko`), så vi kan ikke sette Authorization-header —
 * brukeren identifiseres via `secret`-query-param (validert mot samme
 * token-tabell som Bearer). Browser-flyt: svarer alltid med redirect.
 */
export const GET: RequestHandler = async ({ url }) => {
	const appId = url.searchParams.get('app') ?? 'ekko';
	const app = getAppConfig(appId);
	const scheme = app?.deepLinkScheme ?? 'ekko';

	const fail = (reason: string) =>
		redirect(302, `${scheme}://strava-connected?status=error&reason=${reason}`);

	if (!app) throw fail('auth');
	if (!isStravaConfigured()) throw fail('config');

	const userId = await resolveUserIdFromApiSecret(url.searchParams.get('secret'));
	if (!userId) throw fail('auth');

	const state = await createOAuthState(userId, appId);
	const redirectUri = `${url.origin}/api/apps/strava/callback`;

	throw redirect(302, getAuthorizeUrl({ redirectUri, state, scope: 'activity:write,read' }));
};
