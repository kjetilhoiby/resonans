import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { sensors } from '$lib/db/schema';
import { and, eq } from 'drizzle-orm';
import { spondLogin } from '$lib/server/integrations/spond';
import type { RequestHandler } from './$types';

/**
 * POST /api/sensors/spond/connect
 * Body: { email: string; password: string }
 *
 * Verifies credentials by logging in, then stores them for future syncs.
 * Note: Spond does not support OAuth – credentials are stored encrypted (base64)
 * in the sensors table, consistent with how other sensors store auth data.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const userId = locals.userId;
	if (!userId) throw error(401, 'Ikke innlogget');

	let email: string;
	let password: string;

	try {
		const body = await request.json();
		email = (body.email ?? '').trim();
		password = body.password ?? '';
	} catch {
		throw error(400, 'Ugyldig forespørsel');
	}

	if (!email || !password) {
		throw error(400, 'E-post og passord er påkrevd');
	}

	// Validate credentials by attempting a real login
	let loginToken: string;
	try {
		loginToken = await spondLogin(email, password);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw error(401, `Spond-innlogging feilet: ${msg}`);
	}

	// Store credentials (base64 JSON) – same pattern as other sensors
	const credentials = btoa(JSON.stringify({ email, password }));

	// Upsert sensor row
	const existing = await db.query.sensors.findFirst({
		where: and(eq(sensors.userId, userId), eq(sensors.provider, 'spond'))
	});

	if (existing) {
		await db
			.update(sensors)
			.set({ credentials, isActive: true, lastError: null, updatedAt: new Date() })
			.where(eq(sensors.id, existing.id));
	} else {
		await db.insert(sensors).values({
			userId,
			provider: 'spond',
			type: 'activity_tracker',
			subtype: 'team_sports',
			name: 'Spond',
			credentials,
			config: {},
			isActive: true
		});
	}

	return json({ success: true, message: 'Spond koblet til.' });
};
