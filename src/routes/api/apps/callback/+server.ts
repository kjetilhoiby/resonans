import { json, error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';
import { createUserApiSecret } from '$lib/server/api-secrets';
import { resolveRequestUserId } from '$lib/server/request-user';

export const GET: RequestHandler = async (event) => {
	const appId = event.url.searchParams.get('app');
	if (!appId) throw error(400, 'Missing ?app= parameter');

	const app = getAppConfig(appId);
	if (!app) throw error(404, `Unknown app: ${appId}`);

	const userId = await resolveRequestUserId(event);
	if (!userId) {
		return json({ error: 'Not authenticated' }, { status: 401 });
	}

	const { plainSecret } = await createUserApiSecret({
		userId,
		label: app.label
	});

	throw redirect(303, `${app.deepLinkScheme}://auth?secret=${encodeURIComponent(plainSecret)}`);
};
