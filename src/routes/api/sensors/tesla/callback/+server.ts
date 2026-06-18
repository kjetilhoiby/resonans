import { isRedirect, redirect } from '@sveltejs/kit';
import { exchangeCodeForToken, getRegion, listVehicles, TESLA_SCOPES } from '$lib/server/integrations/tesla';
import { encryptSecret } from '$lib/server/crypto';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Tesla OAuth callback.
 * GET /api/sensors/tesla/callback?code=...&state=...
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	const expectedState = cookies.get('tesla_oauth_state');
	const verifier = cookies.get('tesla_oauth_verifier');
	cookies.delete('tesla_oauth_state', { path: '/' });
	cookies.delete('tesla_oauth_verifier', { path: '/' });

	if (error) {
		console.error('Tesla OAuth error:', error);
		throw redirect(302, '/settings/sources?error=tesla_auth_failed');
	}
	if (!code || !state) {
		throw redirect(302, '/settings/sources?error=tesla_missing_code');
	}
	if (!expectedState || state !== expectedState || !verifier) {
		throw redirect(302, '/settings/sources?error=tesla_state_mismatch');
	}

	try {
		const userId = locals.userId;
		const redirectUri = `${url.origin}/api/sensors/tesla/callback`;
		const token = await exchangeCodeForToken({ code, redirectUri, codeVerifier: verifier });

		// Finn region og bilens identitet.
		const { region, fleetApiBaseUrl } = await getRegion(token.access_token);
		const vehicles = await listVehicles(token.access_token, fleetApiBaseUrl);
		if (vehicles.length === 0) {
			throw redirect(302, '/settings/sources?error=tesla_no_vehicles');
		}
		// v1: velg første kjøretøy. Liste lagres slik at en kjøretøyvelger kan
		// bytte senere uten ny innlogging.
		const primary = vehicles[0];

		const credentials = encryptSecret(
			JSON.stringify({
				access_token: token.access_token,
				refresh_token: token.refresh_token,
				expires_at: Math.floor(Date.now() / 1000) + token.expires_in
			})
		);

		const config = {
			vin: primary.vin,
			vehicleId: primary.id,
			fleetApiBaseUrl,
			region,
			scope: token.scope ?? TESLA_SCOPES,
			expiresAt: Math.floor(Date.now() / 1000) + token.expires_in,
			vehicles: vehicles.map((v) => ({ id: v.id, vin: v.vin, displayName: v.display_name }))
		};

		const name = primary.display_name ? `Tesla ${primary.display_name}` : 'Tesla';

		const existing = await db.query.sensors.findFirst({
			where: and(eq(sensors.userId, userId), eq(sensors.provider, 'tesla'))
		});

		if (existing) {
			await db
				.update(sensors)
				.set({ credentials, config, name, isActive: true, lastError: null, updatedAt: new Date() })
				.where(eq(sensors.id, existing.id));
		} else {
			await db.insert(sensors).values({
				userId,
				provider: 'tesla',
				type: 'vehicle',
				subtype: 'car',
				name,
				credentials,
				config,
				isActive: true
			});
		}

		throw redirect(302, '/settings/sources?connected=tesla');
	} catch (err) {
		if (isRedirect(err)) throw err;
		console.error('Tesla callback error:', err);
		throw redirect(302, '/settings/sources?error=tesla_unknown');
	}
};
