/**
 * lunchbox-service.ts — matpakke-modulens datagrunnlag, delt av API-rutene og
 * food-dashboardet. Barna er persons med kind='child'; profiler auto-opprettes
 * ved første henting. Forslag beregnes med den rene suggestLunchbox-motoren
 * (preferanser + rotasjon + retur-læring).
 */

import { db } from '$lib/db';
import {
	persons,
	lunchboxProfiles,
	lunchboxComponents,
	lunchboxEntries,
	lunchboxReturns
} from '$lib/db/schema';
import { and, eq, gte, lte, inArray } from 'drizzle-orm';
import { suggestLunchbox, type LunchboxSuggestion } from '$lib/domains/food/lunchbox';
import { addDaysIso } from '$lib/server/iso-week';

export type LunchboxOverview = {
	date: string;
	children: Array<{
		personId: string;
		name: string;
		avatarEmoji: string | null;
		photoUrl: string | null;
		profile: {
			likes: string[];
			dislikes: string[];
			allergies: string[];
			appetite: string;
			notes: string | null;
		};
		entry: {
			id: string;
			items: Array<{ componentId?: string; name: string; kind: string }>;
			packedAt: string | null;
			source: string;
		} | null;
		suggestion: LunchboxSuggestion | null;
		returnsToday: Array<{ id: string; itemName: string; quantity: number | null; degree: string }>;
	}>;
	components: Array<{ id: string; name: string; kind: string; tags: string[]; active: boolean }>;
};

/** Full matpakke-oversikt for en dato (default i dag). */
export async function getLunchboxOverview(
	userId: string,
	date: string,
	opts: { seed?: number } = {}
): Promise<LunchboxOverview> {
	const children = await db
		.select()
		.from(persons)
		.where(and(eq(persons.userId, userId), eq(persons.kind, 'child'), eq(persons.archived, false)));

	const components = await db
		.select()
		.from(lunchboxComponents)
		.where(and(eq(lunchboxComponents.userId, userId), eq(lunchboxComponents.active, true)));

	const childIds = children.map((c) => c.id);
	if (childIds.length === 0) {
		return { date, children: [], components: [] };
	}

	// Auto-opprett tomme profiler for barn som mangler
	const profiles = await db
		.select()
		.from(lunchboxProfiles)
		.where(and(eq(lunchboxProfiles.userId, userId), inArray(lunchboxProfiles.personId, childIds)));
	const profileByPerson = new Map(profiles.map((p) => [p.personId, p]));

	for (const child of children) {
		if (!profileByPerson.has(child.id)) {
			const [created] = await db
				.insert(lunchboxProfiles)
				.values({ userId, personId: child.id })
				.onConflictDoNothing()
				.returning();
			if (created) profileByPerson.set(child.id, created);
		}
	}

	const [entries, recentEntries, recentReturns, todayReturns] = await Promise.all([
		db
			.select()
			.from(lunchboxEntries)
			.where(and(eq(lunchboxEntries.userId, userId), eq(lunchboxEntries.date, date))),
		db
			.select()
			.from(lunchboxEntries)
			.where(
				and(
					eq(lunchboxEntries.userId, userId),
					gte(lunchboxEntries.date, addDaysIso(date, -14)),
					lte(lunchboxEntries.date, date)
				)
			),
		db
			.select()
			.from(lunchboxReturns)
			.where(
				and(
					eq(lunchboxReturns.userId, userId),
					gte(lunchboxReturns.date, addDaysIso(date, -30)),
					lte(lunchboxReturns.date, date)
				)
			),
		db
			.select()
			.from(lunchboxReturns)
			.where(and(eq(lunchboxReturns.userId, userId), eq(lunchboxReturns.date, date)))
	]);

	const entryByPerson = new Map(entries.map((e) => [e.personId, e]));

	return {
		date,
		components: components.map((c) => ({
			id: c.id,
			name: c.name,
			kind: c.kind,
			tags: c.tags,
			active: c.active
		})),
		children: children.map((child) => {
			const profile = profileByPerson.get(child.id);
			const entry = entryByPerson.get(child.id) ?? null;
			const profileLike = {
				personId: child.id,
				likes: profile?.likes ?? [],
				dislikes: profile?.dislikes ?? [],
				allergies: profile?.allergies ?? [],
				appetite: profile?.appetite ?? 'middels'
			};

			const suggestion =
				entry || components.length === 0
					? null
					: suggestLunchbox({
							profile: profileLike,
							components,
							recentEntries: recentEntries.map((e) => ({
								personId: e.personId,
								date: e.date,
								items: e.items
							})),
							recentReturns: recentReturns.map((r) => ({
								personId: r.personId,
								date: r.date,
								componentId: r.componentId,
								itemName: r.itemName,
								degree: r.degree
							})),
							date,
							seed: opts.seed
						});

			return {
				personId: child.id,
				name: child.name,
				avatarEmoji: child.avatarEmoji,
				photoUrl: child.photoUrl,
				profile: {
					likes: profileLike.likes,
					dislikes: profileLike.dislikes,
					allergies: profileLike.allergies,
					appetite: profileLike.appetite,
					notes: profile?.notes ?? null
				},
				entry: entry
					? {
							id: entry.id,
							items: entry.items,
							packedAt: entry.packedAt?.toISOString() ?? null,
							source: entry.source
						}
					: null,
				suggestion,
				returnsToday: todayReturns
					.filter((r) => r.personId === child.id)
					.map((r) => ({ id: r.id, itemName: r.itemName, quantity: r.quantity, degree: r.degree }))
			};
		})
	};
}

/** Oslo-dato (YYYY-MM-DD) — matpakker følger norsk lokaltid, ikke UTC. */
export function osloToday(now = new Date()): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now);
}
