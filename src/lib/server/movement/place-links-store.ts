/**
 * Lagring av koblingene mellom Aksers og Ekkos steder. Regelen bor i
 * `$lib/domain/movement/place-links.ts`.
 *
 * `reconcilePlaceLinks` kjøres hver gang en av appene sender stedslista si.
 * Brukerens valg (`confirmed`/`rejected`) står; `auto` og `suggested` regnes ut på
 * nytt og erstatter det som lå der.
 */

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { appPlaceLinks, appPlaces } from '$lib/db/schema';
import {
	proposePlaceLinks,
	type ExistingLink,
	type LinkablePlace,
	type LinkStatus
} from '$lib/domain/movement/place-links';
import type { PlaceCategory } from '$lib/domain/movement/places';

async function readLinkable(userId: string, app: 'akser' | 'ekko'): Promise<LinkablePlace[]> {
	const rows = await db
		.select({
			externalId: appPlaces.externalId,
			name: appPlaces.name,
			category: appPlaces.category,
			named: appPlaces.named,
			archived: appPlaces.archived,
			latitude: appPlaces.latitude,
			longitude: appPlaces.longitude,
			radiusMeters: appPlaces.radiusMeters
		})
		.from(appPlaces)
		.where(and(eq(appPlaces.userId, userId), eq(appPlaces.app, app)));
	return rows.map((row) => ({ ...row, category: row.category as PlaceCategory }));
}

export async function reconcilePlaceLinks(userId: string): Promise<{ auto: number; suggested: number }> {
	const [akser, ekko] = await Promise.all([readLinkable(userId, 'akser'), readLinkable(userId, 'ekko')]);
	// Uten begge appene finnes ingenting å koble. Brukerens valg står uansett.
	if (akser.length === 0 || ekko.length === 0) {
		await db
			.delete(appPlaceLinks)
			.where(and(eq(appPlaceLinks.userId, userId), inArray(appPlaceLinks.status, ['auto', 'suggested'])));
		return { auto: 0, suggested: 0 };
	}

	return db.transaction(async (tx) => {
		const existing = await tx
			.select({
				akserId: appPlaceLinks.akserPlaceId,
				ekkoId: appPlaceLinks.ekkoPlaceId,
				status: appPlaceLinks.status
			})
			.from(appPlaceLinks)
			.where(eq(appPlaceLinks.userId, userId));
		const proposed = proposePlaceLinks(akser, ekko, existing as ExistingLink[]);

		await tx
			.delete(appPlaceLinks)
			.where(and(eq(appPlaceLinks.userId, userId), inArray(appPlaceLinks.status, ['auto', 'suggested'])));
		if (proposed.length > 0) {
			await tx
				.insert(appPlaceLinks)
				.values(
					proposed.map((link) => ({
						userId,
						akserPlaceId: link.akserId,
						ekkoPlaceId: link.ekkoId,
						status: link.status,
						distanceMeters: link.distanceMeters
					}))
				)
				.onConflictDoNothing();
		}
		return {
			auto: proposed.filter((l) => l.status === 'auto').length,
			suggested: proposed.filter((l) => l.status === 'suggested').length
		};
	});
}

export interface PlaceLinkView {
	id: string;
	status: LinkStatus;
	distanceMeters: number | null;
	akser: { name: string; named: boolean; category: string } | null;
	ekko: { name: string } | null;
}

/** Koblingene med navnene fra begge sider. Aldri koordinatene. */
export async function listPlaceLinks(userId: string): Promise<PlaceLinkView[]> {
	const [links, places] = await Promise.all([
		db.select().from(appPlaceLinks).where(eq(appPlaceLinks.userId, userId)),
		db
			.select({
				app: appPlaces.app,
				externalId: appPlaces.externalId,
				name: appPlaces.name,
				named: appPlaces.named,
				category: appPlaces.category
			})
			.from(appPlaces)
			.where(eq(appPlaces.userId, userId))
	]);
	const byKey = new Map(places.map((p) => [`${p.app}|${p.externalId}`, p]));
	return links.map((link) => {
		const akser = byKey.get(`akser|${link.akserPlaceId}`);
		const ekko = byKey.get(`ekko|${link.ekkoPlaceId}`);
		return {
			id: link.id,
			status: link.status as LinkStatus,
			distanceMeters: link.distanceMeters,
			akser: akser ? { name: akser.name, named: akser.named, category: akser.category } : null,
			ekko: ekko ? { name: ekko.name } : null
		};
	});
}

/** Brukerens valg. Null når koblingen ikke finnes eller ikke er brukerens. */
export async function setPlaceLinkStatus(
	userId: string,
	id: string,
	status: 'confirmed' | 'rejected'
): Promise<boolean> {
	const updated = await db
		.update(appPlaceLinks)
		.set({ status, updatedAt: new Date() })
		.where(and(eq(appPlaceLinks.id, id), eq(appPlaceLinks.userId, userId)))
		.returning({ id: appPlaceLinks.id });
	return updated.length > 0;
}

/** Ekko-navnene som er koblet til hvert Akser-sted (automatisk eller bekreftet). */
export async function readLinkedEkkoNames(userId: string): Promise<Map<string, string[]>> {
	const rows = await db
		.select({ akserId: appPlaceLinks.akserPlaceId, name: appPlaces.name })
		.from(appPlaceLinks)
		.innerJoin(
			appPlaces,
			and(
				eq(appPlaces.userId, appPlaceLinks.userId),
				eq(appPlaces.app, 'ekko'),
				eq(appPlaces.externalId, appPlaceLinks.ekkoPlaceId),
				eq(appPlaces.archived, false)
			)
		)
		.where(and(eq(appPlaceLinks.userId, userId), inArray(appPlaceLinks.status, ['auto', 'confirmed'])));
	const result = new Map<string, string[]>();
	for (const row of rows) result.set(row.akserId, [...(result.get(row.akserId) ?? []), row.name]);
	return result;
}
