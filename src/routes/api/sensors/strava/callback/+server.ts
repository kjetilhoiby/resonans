import { isRedirect, redirect } from '@sveltejs/kit';
import { getStravaAccessToken } from '$lib/server/integrations/strava';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	const code = url.searchParams.get('code');
	const error = url.searchParams.get('error');
	const state = url.searchParams.get('state');

	if (error) {
		console.error('Strava OAuth error:', error);
		throw redirect(302, '/settings/sources?error=strava_auth_failed');
	}

	if (!code) {
		throw redirect(302, '/settings/sources?error=missing_code');
	}

	const savedState = cookies.get('strava_oauth_state');
	cookies.delete('strava_oauth_state', { path: '/' });
	if (state && savedState && state !== savedState) {
		throw redirect(302, '/settings/sources?error=strava_state_mismatch');
	}

	try {
		const tokenResponse = await getStravaAccessToken(code);
		const { access_token, refresh_token, expires_at, athlete } = tokenResponse;

		const credentials = btoa(JSON.stringify({
			access_token,
			refresh_token,
			expires_at
		}));

		const userId = locals.userId;

		const existingSensor = await db.query.sensors.findFirst({
			where: (sensors, { and, eq }) =>
				and(
					eq(sensors.userId, userId),
					eq(sensors.provider, 'strava')
				)
		});

		if (existingSensor) {
			await db.update(sensors)
				.set({
					credentials,
					config: {
						athleteId: athlete.id,
						athleteName: `${athlete.firstname} ${athlete.lastname}`,
						expiresAt: expires_at
					},
					isActive: true,
					updatedAt: new Date()
				})
				.where(eq(sensors.id, existingSensor.id));
		} else {
			await db.insert(sensors).values({
				userId,
				provider: 'strava',
				type: 'fitness_tracker',
				subtype: 'account',
				name: `Strava (${athlete.firstname})`,
				credentials,
				config: {
					athleteId: athlete.id,
					athleteName: `${athlete.firstname} ${athlete.lastname}`,
					expiresAt: expires_at
				},
				isActive: true
			});
		}

		throw redirect(302, '/settings/sources?connected=strava');
	} catch (err) {
		if (isRedirect(err)) throw err;
		console.error('Strava callback error:', err);
		throw redirect(302, '/settings/sources?error=strava_unknown');
	}
};
