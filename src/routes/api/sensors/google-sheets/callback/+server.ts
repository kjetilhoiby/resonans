import { redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { getGoogleSheetsAccessToken } from '$lib/server/integrations/google-sheets';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error');

	if (error) {
		throw redirect(302, `/settings?error=google_sheets_auth_failed`);
	}

	if (!code) {
		throw redirect(302, `/settings?error=google_sheets_missing_code`);
	}

	const cookieState = cookies.get('google_sheets_oauth_state');
	cookies.delete('google_sheets_oauth_state', { path: '/' });

	if (!state || !cookieState || state !== cookieState) {
		throw redirect(302, `/settings?error=google_sheets_invalid_state`);
	}

	try {
		const redirectUri = `${url.origin}/api/sensors/google-sheets/callback`;
		const tokenResponse = await getGoogleSheetsAccessToken(code, redirectUri);

		const now = Math.floor(Date.now() / 1000);
		const expiresAt = now + (tokenResponse.expires_in ?? 3600);

		const credentials = btoa(
			JSON.stringify({
				access_token: tokenResponse.access_token,
				refresh_token: tokenResponse.refresh_token,
				expires_at: expiresAt,
				scope: tokenResponse.scope,
				token_type: tokenResponse.token_type
			})
		);

		const userId = locals.userId;
		const existingSensor = await db.query.sensors.findFirst({
			where: and(
				eq(sensors.userId, userId),
				eq(sensors.provider, 'google_sheets'),
				eq(sensors.type, 'spreadsheet')
			)
		});

		if (existingSensor) {
			await db
				.update(sensors)
				.set({
					credentials,
					config: { expiresAt, scope: tokenResponse.scope },
					isActive: true,
					lastError: null,
					updatedAt: new Date()
				})
				.where(eq(sensors.id, existingSensor.id));
		} else {
			await db.insert(sensors).values({
				userId,
				provider: 'google_sheets',
				type: 'spreadsheet',
				name: 'Google Regneark',
				credentials,
				config: { expiresAt, scope: tokenResponse.scope },
				isActive: true
			});
		}

		throw redirect(302, '/settings?success=google_sheets_connected');
	} catch (err) {
		if (err instanceof Response || (err as any)?.status) throw err;
		console.error('Google Sheets callback error:', err);
		throw redirect(302, '/settings?error=google_sheets_callback_failed');
	}
};
