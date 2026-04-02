import { isRedirect, redirect } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { getDropboxAccessToken } from '$lib/server/integrations/dropbox';
import { and, eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	const error = url.searchParams.get('error_description') ?? url.searchParams.get('error');

	if (error) {
		console.error('Dropbox OAuth error:', error);
		throw redirect(302, '/settings/sources?error=dropbox_auth_failed');
	}

	if (!code) {
		throw redirect(302, '/settings/sources?error=dropbox_missing_code');
	}

	const cookieState = cookies.get('dropbox_oauth_state');
	cookies.delete('dropbox_oauth_state', { path: '/' });

	if (!state || !cookieState || state !== cookieState) {
		throw redirect(302, '/settings/sources?error=dropbox_invalid_state');
	}

	try {
		const redirectUri = `${url.origin}/api/sensors/dropbox/callback`;
		const token = await getDropboxAccessToken(code, redirectUri);
		const now = Math.floor(Date.now() / 1000);
		const expiresAt = now + (token.expires_in ?? 14400);
		const credentials = btoa(JSON.stringify({
			access_token: token.access_token,
			refresh_token: token.refresh_token,
			expires_at: expiresAt,
			token_type: token.token_type,
			scope: token.scope,
			account_id: token.account_id
		}));

		const userId = locals.userId;
		const existing = await db.query.sensors.findFirst({
			where: and(
				eq(sensors.userId, userId),
				eq(sensors.provider, 'dropbox'),
				eq(sensors.type, 'workout_files')
			)
		});

		if (existing) {
			const config = (existing.config ?? {}) as Record<string, unknown>;
			await db.update(sensors)
				.set({
					credentials,
					config: {
						...config,
						expiresAt,
						dropboxFolderPath: typeof config.dropboxFolderPath === 'string' ? config.dropboxFolderPath : '',
						dropboxCursor: null
					},
					isActive: true,
					lastError: null,
					updatedAt: new Date()
				})
				.where(eq(sensors.id, existing.id));
		} else {
			await db.insert(sensors).values({
				userId,
				provider: 'dropbox',
				type: 'workout_files',
				subtype: 'gpx_tcx',
				name: 'Dropbox Løpsfiler',
				credentials,
				config: {
					expiresAt,
					dropboxFolderPath: '',
					dropboxCursor: null
				},
				isActive: true
			});
		}

		throw redirect(302, '/settings/sources?connected=dropbox');
	} catch (err) {
		if (isRedirect(err)) throw err;
		console.error('Dropbox callback error:', err);
		throw redirect(302, '/settings/sources?error=dropbox_unknown');
	}
};
