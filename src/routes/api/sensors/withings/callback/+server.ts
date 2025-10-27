import { redirect } from '@sveltejs/kit';
import { getAccessToken } from '$lib/server/integrations/withings';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { DEFAULT_USER_ID } from '$lib/server/users';
import type { RequestHandler } from './$types';

/**
 * Handle Withings OAuth callback
 * GET /api/sensors/withings/callback?code=...&state=...
 */
export const GET: RequestHandler = async ({ url }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	if (error) {
		console.error('Withings OAuth error:', error);
		throw redirect(302, '/settings?error=withings_auth_failed');
	}

	if (!code) {
		throw redirect(302, '/settings?error=missing_code');
	}

	try {
		// Exchange code for tokens
		const origin = url.origin;
		const redirectUri = `${origin}/api/sensors/withings/callback`;
		const tokenResponse = await getAccessToken(code, redirectUri);

		if (tokenResponse.status !== 0 || !tokenResponse.body) {
			console.error('Withings token error:', tokenResponse);
			throw redirect(302, '/settings?error=token_exchange_failed');
		}

		const { access_token, refresh_token, expires_in, userid, scope } = tokenResponse.body;

		// Calculate expiry timestamp
		const expiresAt = Math.floor(Date.now() / 1000) + expires_in;

		// Encrypt credentials (simple base64 for now, should use proper encryption)
		const credentials = btoa(JSON.stringify({
			access_token,
			refresh_token,
			expires_at: expiresAt
		}));

		// Store or update sensor connection
		const userId = DEFAULT_USER_ID;

		// Check if sensor already exists
		const existingSensor = await db.query.sensors.findFirst({
			where: (sensors, { and, eq }) => 
				and(
					eq(sensors.userId, userId),
					eq(sensors.provider, 'withings'),
					eq(sensors.type, 'health_tracker')
				)
		});

		if (existingSensor) {
			// Update existing sensor
			await db.update(sensors)
				.set({
					credentials,
					config: {
						userId: userid,
						expiresAt,
						scope
					},
					isActive: true,
					lastSync: new Date(),
					updatedAt: new Date()
				})
				.where(eq(sensors.id, existingSensor.id));
		} else {
			// Create new sensor
			await db.insert(sensors).values({
				userId,
				provider: 'withings',
				type: 'health_tracker',
				subtype: 'account', // Can differentiate scale/watch later
				name: 'Withings Account',
				credentials,
				config: {
					userId: userid,
					expiresAt,
					scope
				},
				isActive: true,
				lastSync: new Date()
			});
		}

		// Redirect to settings with success message
		throw redirect(302, '/settings?success=withings_connected');
	} catch (err) {
		console.error('Withings callback error:', err);
		throw redirect(302, '/settings?error=unknown');
	}
};
