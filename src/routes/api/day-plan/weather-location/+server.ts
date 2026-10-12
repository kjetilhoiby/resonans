/**
 * GET /api/day-plan/weather-location
 *
 * Hvor ukelista henter været fra, når planen ikke sier noe: `today` er der brukeren
 * er nå (fra Akser, når det deles) eller hjemmet, `otherDays` er hjemmet. Begge er
 * avrundet til ~1 km. Null der Akser ikke vet noe – da faller flaten tilbake på
 * nettleserens posisjon, som før. Regelen bor i `pickWeatherLocation`.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveWeatherLocation } from '$lib/server/movement/presence-store';
import { localIsoDay } from '$lib/server/nudge-time';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });
	const today = localIsoDay('Europe/Oslo', new Date());
	const tomorrow = localIsoDay('Europe/Oslo', new Date(Date.now() + 36 * 3600_000));
	const [todayPlace, otherDays] = await Promise.all([
		resolveWeatherLocation(locals.userId, today, today),
		resolveWeatherLocation(locals.userId, tomorrow, today)
	]);
	return json({ today: todayPlace, otherDays });
};
