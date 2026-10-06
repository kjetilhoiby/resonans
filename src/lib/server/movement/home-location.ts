import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { appPlaces } from '$lib/db/schema';
import { pickHomePlace, roundForWeather } from '$lib/domain/movement/home-place';
import { AKSER_APP_ID } from './akser-store';

export interface HomeLocation {
	name: string;
	/** Avrundet til ~1 km. Den presise posisjonen forlater ikke basen. */
	latitude: number;
	longitude: number;
}

/** Hjemmet fra Akser, eller null når Akser ikke er koblet til eller ikke har noe hjem. */
export async function readHomeLocation(userId: string): Promise<HomeLocation | null> {
	const rows = await db
		.select({
			name: appPlaces.name,
			category: appPlaces.category,
			named: appPlaces.named,
			archived: appPlaces.archived,
			latitude: appPlaces.latitude,
			longitude: appPlaces.longitude,
			updatedAt: appPlaces.updatedAt
		})
		.from(appPlaces)
		.where(and(eq(appPlaces.userId, userId), eq(appPlaces.app, AKSER_APP_ID), eq(appPlaces.category, 'home')));
	const home = pickHomePlace(rows);
	if (!home) return null;
	return {
		name: home.named ? home.name : 'Hjemme',
		latitude: roundForWeather(home.latitude),
		longitude: roundForWeather(home.longitude)
	};
}
