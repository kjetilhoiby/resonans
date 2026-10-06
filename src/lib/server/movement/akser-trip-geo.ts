/**
 * Etter en Akser-opplasting: berik reise-temaenes `tripProfile.geoByDay` med hvor
 * brukeren faktisk var. Regelen (`buildAkserDayGeo`) og presedensen (`applyDayGeo`)
 * bor i `$lib/server/trip-geo.ts`; her er bare databasen.
 *
 * Før Akser var en observert kjøretur fra Ekkos live-økt den eneste observerte
 * kilden — en ferie uten bilkjøring hadde bare deklarerte steder fra sjekklista.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appPlaces, themes } from '$lib/db/schema';
import type { NormalizedDay } from '$lib/domain/movement/timeline';
import { applyDayGeo, buildAkserDayGeo, pickTripForDate, type AkserPlaceGeo } from '$lib/server/trip-geo';
import { AKSER_APP_ID } from './akser-store';

/** Returnerer antall dager som ble skrevet inn i et reise-tema. */
export async function enrichTripsFromAkser(userId: string, days: readonly NormalizedDay[]): Promise<number> {
	if (days.length === 0) return 0;

	const themeRows = await db.query.themes.findMany({
		where: eq(themes.userId, userId),
		columns: { id: true, tripProfile: true }
	});
	const candidates = themeRows
		.filter((r) => r.tripProfile?.startDate && r.tripProfile?.endDate)
		.map((r) => ({ id: r.id, startDate: r.tripProfile!.startDate, endDate: r.tripProfile!.endDate }));
	if (candidates.length === 0) return 0;

	const byTheme = new Map<string, NormalizedDay[]>();
	for (const day of days) {
		const themeId = pickTripForDate(candidates, day.date);
		if (!themeId) continue;
		byTheme.set(themeId, [...(byTheme.get(themeId) ?? []), day]);
	}
	if (byTheme.size === 0) return 0;

	const placeRows = await db
		.select({
			id: appPlaces.externalId,
			name: appPlaces.name,
			named: appPlaces.named,
			latitude: appPlaces.latitude,
			longitude: appPlaces.longitude
		})
		.from(appPlaces)
		.where(and(eq(appPlaces.userId, userId), eq(appPlaces.app, AKSER_APP_ID)));
	const places = new Map<string, AkserPlaceGeo>(placeRows.map((p) => [p.id, p]));

	let written = 0;
	for (const [themeId, themeDays] of byTheme) {
		const profile = themeRows.find((r) => r.id === themeId)?.tripProfile ?? {};
		let geoByDay = profile.geoByDay;
		for (const day of themeDays) {
			const candidate = buildAkserDayGeo(day, places);
			if (!candidate) continue;
			geoByDay = applyDayGeo(geoByDay, day.date, candidate);
			written++;
		}
		await db
			.update(themes)
			.set({ tripProfile: { ...profile, geoByDay }, updatedAt: new Date() })
			.where(and(eq(themes.id, themeId), eq(themes.userId, userId)));
	}
	return written;
}
