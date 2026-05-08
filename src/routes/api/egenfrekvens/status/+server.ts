import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import { getEgenfrekvensCheckinStatus, toIsoDay } from '$lib/server/egenfrekvens-checkin';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const dayParam = url.searchParams.get('day');
	const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : toIsoDay();

	const [status, user] = await Promise.all([
		getEgenfrekvensCheckinStatus(locals.userId, day),
		db.query.users.findFirst({ where: eq(users.id, locals.userId) })
	]);

	const settings =
		(user?.notificationSettings as Record<string, any> | null | undefined)?.egenfrekvensCheckin ??
		null;

	return json({
		...status,
		settings: settings ? { enabled: settings.enabled !== false, time: settings.time ?? '09:00' } : null
	});
};
