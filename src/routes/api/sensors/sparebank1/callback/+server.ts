import { isRedirect, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { getSparebank1AccessToken } from '$lib/server/integrations/sparebank1';
import { ensureThemeForUser } from '$lib/server/themes';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

/**
 * Handle SpareBank1 OAuth callback
 * GET /api/sensors/sparebank1/callback?code=...&state=...
 */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	if (error) {
		console.error('SpareBank1 OAuth error:', error);
		throw redirect(302, '/settings?error=sparebank1_auth_failed');
	}

	if (!code) {
		throw redirect(302, '/settings?error=sparebank1_missing_code');
	}

	const cookieState = cookies.get('sparebank1_oauth_state');
	cookies.delete('sparebank1_oauth_state', { path: '/' });

	if (!state || !cookieState || state !== cookieState) {
		console.error('SpareBank1 state mismatch', { state, cookieState });
		throw redirect(302, '/settings?error=sparebank1_invalid_state');
	}

	try {
		const redirectUri = `${url.origin}/api/sensors/sparebank1/callback`;
		const tokenResponse = await getSparebank1AccessToken(code, redirectUri, state);

		if (!tokenResponse.access_token) {
			console.error('SpareBank1 token response invalid:', tokenResponse);
			throw redirect(302, '/settings?error=sparebank1_token_exchange_failed');
		}

		const now = Math.floor(Date.now() / 1000);
		const expiresAt = tokenResponse.expires_in ? now + tokenResponse.expires_in : undefined;

		const credentials = btoa(
			JSON.stringify({
				access_token: tokenResponse.access_token,
				refresh_token: tokenResponse.refresh_token,
				expires_at: expiresAt,
				token_type: tokenResponse.token_type,
				scope: tokenResponse.scope
			})
		);

		const userId = locals.userId;
		const existingSensor = await db.query.sensors.findFirst({
			where: and(
				eq(sensors.userId, userId),
				eq(sensors.provider, 'sparebank1'),
				eq(sensors.type, 'bank_api')
			)
		});

		if (existingSensor) {
			await db
				.update(sensors)
				.set({
					credentials,
					config: {
						expiresAt,
						scope: tokenResponse.scope,
						tokenType: tokenResponse.token_type
					},
					isActive: true,
					lastError: null,
					updatedAt: new Date()
				})
				.where(eq(sensors.id, existingSensor.id));
		} else {
			await db.insert(sensors).values({
				userId,
				provider: 'sparebank1',
				type: 'bank_api',
				subtype: 'readonly',
				name: 'SpareBank 1',
				credentials,
				config: {
					expiresAt,
					scope: tokenResponse.scope,
					tokenType: tokenResponse.token_type
				},
				isActive: true,
				lastSync: null
			});
		}

		const { theme: economicsTheme, created } = await ensureThemeForUser({
			userId,
			name: 'Økonomi',
			emoji: '💰',
			description: 'Kontoer, transaksjoner, forbruksmønster og pengestrøm.'
		});

		const handoffParam = created ? '&handoff=1' : '';
		throw redirect(302, `/tema/${economicsTheme.id}?tab=data&connected=sparebank1${handoffParam}`);
	} catch (err) {
		if (isRedirect(err)) throw err;
		console.error('SpareBank1 callback error:', err);
		throw redirect(302, '/settings?error=sparebank1_unknown');
	}
};
