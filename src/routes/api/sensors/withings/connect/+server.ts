import { redirect } from '@sveltejs/kit';
import { getWithingsAuthUrl } from '$lib/server/integrations/withings';
import type { RequestHandler } from './$types';

/**
 * Initiate Withings OAuth flow
 * GET /api/sensors/withings/connect
 */
export const GET: RequestHandler = async ({ url }) => {
	const origin = url.origin;
	const redirectUri = `${origin}/api/sensors/withings/callback`;
	
	// Generate state for CSRF protection
	const state = crypto.randomUUID();
	
	// Store state in session/cookie for validation in callback
	// For now, we'll validate in callback without state storage
	
	const authUrl = getWithingsAuthUrl(redirectUri, state);
	
	throw redirect(302, authUrl);
};
