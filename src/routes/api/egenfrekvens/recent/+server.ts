import { json } from '@sveltejs/kit';
import {
	getEgenfrekvensCheckinStatus,
	toIsoDay
} from '$lib/server/egenfrekvens-checkin';
import { loadEgenfrekvensDashboardData } from '$lib/server/egenfrekvens-dashboard';
import { db } from '$lib/db';
import { users } from '$lib/db/schema';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
	const daysParam = Number(url.searchParams.get('days'));
	const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 30 ? daysParam : 7;

	const [today, dashboard, user] = await Promise.all([
		getEgenfrekvensCheckinStatus(locals.userId, toIsoDay()),
		loadEgenfrekvensDashboardData(locals.userId, days),
		db.query.users.findFirst({ where: eq(users.id, locals.userId) })
	]);

	const settings =
		(user?.notificationSettings as Record<string, any> | null | undefined)?.egenfrekvensCheckin ??
		null;

	return json({
		today: {
			morning: today.morning,
			evening: today.evening
		},
		points: dashboard.points.map((p) => ({
			day: p.day,
			morning: p.morning
				? { level: p.morning.level, mode: p.morning.mode, balance: p.morning.balance }
				: null,
			evening: p.evening
				? { level: p.evening.level, mode: p.evening.mode, balance: p.evening.balance }
				: null
		})),
		settings: settings
			? {
					enabled: settings.enabled !== false,
					morningTime: settings.morningTime ?? settings.time ?? '06:30',
					eveningTime: settings.eveningTime ?? '21:00'
				}
			: null
	});
};
