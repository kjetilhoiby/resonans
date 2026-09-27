import { json, error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { createUserApiSecret } from '$lib/server/api-secrets';
import { sessionUserIdForAppCallback } from '$lib/server/request-user-sources';

/**
 * Siste ledd i app-innloggingen: `/api/apps/authorize` → `/auth` (Google) → hit,
 * som utsteder en `rsn_`-hemmelighet og sender den til appen i deep linken.
 *
 * Stien er offentlig (`public-paths.ts`), så `authorizationHandle` har IKKE
 * sjekket noe. Brukeren leses derfor BARE fra økta — aldri gjennom
 * `resolveRequestUserId`, som har fallbacker for lokal utvikling. Fram til
 * september 2026 gjorde den det, og `?userId=<uuid>` mintet en hemmelighet for
 * hvem som helst uten innlogging. Se `request-user-sources.ts`.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const appId = url.searchParams.get('app');
	if (!appId) throw error(400, 'Missing ?app= parameter');

	const app = getAppConfig(appId);
	if (!app) throw error(404, `Unknown app: ${appId}`);

	const session = typeof locals.auth === 'function' ? await locals.auth() : null;
	const userId = sessionUserIdForAppCallback(session);
	if (!userId) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	const { plainSecret } = await createUserApiSecret({
		userId,
		label: app.label
	});
	// Én linje per utstedt hemmelighet, så misbruk av stien kan ses i loggen.
	console.info(`[apps-callback] API-hemmelighet utstedt app=${app.id} user=${userId}`);

	throw redirect(303, `${app.deepLinkScheme}://auth?secret=${encodeURIComponent(plainSecret)}`);
};
