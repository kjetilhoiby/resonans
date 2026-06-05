import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { resolveUserIdFromApiSecret } from '$lib/server/api-secrets';
import { createOAuthState } from '$lib/server/services/strava-sync-service';
import { getAuthorizeUrl, isStravaConfigured } from '$lib/server/integrations/strava';

const SETTINGS_PATH = '/settings/sources';

/**
 * Starter Strava-OAuth. To moduser:
 *
 *  - **Native (ekko):** åpnes i ASWebAuthenticationSession med `?app=ekko&secret=<api-secret>`.
 *    Kan ikke sette Authorization-header, så brukeren identifiseres via secret-query-paramet.
 *    Callback redirecter til `ekko://strava-connected?status=…`.
 *  - **Web:** lenke fra `settings/sources` uten secret. Brukeren identifiseres fra session.
 *    Callback redirecter tilbake til `/settings/sources`.
 *
 * Browser-flyt: svarer alltid med redirect. Modusen lagres i state-nonce (`appId`).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const secret = url.searchParams.get('secret');
	const isNative = Boolean(secret);
	const appId = isNative ? url.searchParams.get('app') ?? 'ekko' : 'web';
	const app = isNative ? getAppConfig(appId) : null;
	const scheme = app?.deepLinkScheme ?? 'ekko';

	const fail = (reason: string) =>
		isNative
			? redirect(302, `${scheme}://strava-connected?status=error&reason=${reason}`)
			: redirect(302, `${SETTINGS_PATH}?error=strava_${reason}`);

	if (!isStravaConfigured()) throw fail('config');

	let userId: string | null;
	if (isNative) {
		if (!app) throw fail('auth');
		userId = await resolveUserIdFromApiSecret(secret);
	} else {
		userId = typeof locals.auth === 'function' ? (await locals.auth())?.user?.id ?? null : null;
		// Web uten innlogging → send til login og tilbake hit.
		if (!userId) throw redirect(302, `/auth?next=${encodeURIComponent(url.pathname + url.search)}`);
	}
	if (!userId) throw fail('auth');

	const state = await createOAuthState(userId, appId);
	const redirectUri = `${url.origin}/api/apps/strava/callback`;

	throw redirect(302, getAuthorizeUrl({ redirectUri, state, scope: 'activity:write,read' }));
};
