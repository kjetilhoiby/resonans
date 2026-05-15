import { error, redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAppConfig } from '$lib/server/app-registry';

export const GET: RequestHandler = async ({ url }) => {
	const appId = url.searchParams.get('app');
	if (!appId) throw error(400, 'Missing ?app= parameter');

	const app = getAppConfig(appId);
	if (!app) throw error(404, `Unknown app: ${appId}`);

	const callbackUrl = `${url.origin}/api/apps/callback?app=${encodeURIComponent(appId)}`;
	throw redirect(303, `/auth?next=${encodeURIComponent(callbackUrl)}`);
};
