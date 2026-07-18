import { z } from 'zod';
import { db } from '$lib/db';
import { lunchboxComponents, lunchboxEntries, lunchboxProfiles, lunchboxReturns, persons } from '$lib/db/schema';
import { and, eq, ilike } from 'drizzle-orm';
import { getLunchboxOverview, osloToday } from '$lib/server/services/lunchbox-service';

// Slår opp et barn på navn (case-insensitivt, også kallenavn/alias-prefiks).
async function findChild(userId: string, name: string) {
	const children = await db
		.select()
		.from(persons)
		.where(and(eq(persons.userId, userId), eq(persons.kind, 'child'), eq(persons.archived, false)));
	const q = name.trim().toLowerCase();
	return (
		children.find((c) => c.name.toLowerCase() === q) ??
		children.find(
			(c) =>
				c.name.toLowerCase().startsWith(q) ||
				c.nickname?.toLowerCase() === q ||
				c.aliases.some((a) => a.toLowerCase() === q)
		) ??
		null
	);
}

export const manageLunchboxTool = {
	name: 'manage_lunchbox',
	description: `Matpakke-hjelperen: forslag, retur-logging og preferanser for barnas matpakker.

Actions:
- get_suggestions: dagens matpakke-forslag per barn (eller ett barn via childName)
- log_packed: marker at et barns matpakke er pakket (bruker dagens forslag hvis items utelates)
- log_return: logg at noe kom i retur («Ola hadde med 2 skiver hjem») — childName + itemName kreves
- set_preferences: oppdater liker/liker ikke/allergier/appetitt for et barn
- add_component: legg en ny komponent i biblioteket (pålegg/brod/frukt/gront/notter/annet)

Datoer er YYYY-MM-DD; default i dag (Oslo-tid).`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['get_suggestions', 'log_packed', 'log_return', 'set_preferences', 'add_component']),
		childName: z.string().optional(),
		date: z.string().optional().describe('YYYY-MM-DD, default i dag'),
		itemName: z.string().optional().describe('Vare for log_return, f.eks. "brødskive med hvitost"'),
		quantity: z.number().optional().describe('Antall i retur, f.eks. 2'),
		degree: z.enum(['alt', 'mesteparten', 'noe']).optional(),
		likes: z.array(z.string()).optional(),
		dislikes: z.array(z.string()).optional(),
		allergies: z.array(z.string()).optional(),
		appetite: z.enum(['liten', 'middels', 'stor']).optional(),
		componentName: z.string().optional(),
		componentKind: z.enum(['palegg', 'brod', 'frukt', 'gront', 'notter', 'annet']).optional()
	}),

	execute: async (args: {
		userId: string;
		action: 'get_suggestions' | 'log_packed' | 'log_return' | 'set_preferences' | 'add_component';
		childName?: string;
		date?: string;
		itemName?: string;
		quantity?: number;
		degree?: 'alt' | 'mesteparten' | 'noe';
		likes?: string[];
		dislikes?: string[];
		allergies?: string[];
		appetite?: 'liten' | 'middels' | 'stor';
		componentName?: string;
		componentKind?: 'palegg' | 'brod' | 'frukt' | 'gront' | 'notter' | 'annet';
	}) => {
		const date = args.date ?? osloToday();

		if (args.action === 'get_suggestions') {
			const overview = await getLunchboxOverview(args.userId, date);
			const children = args.childName
				? overview.children.filter((c) => c.name.toLowerCase().includes(args.childName!.toLowerCase()))
				: overview.children;
			return {
				date,
				children: children.map((c) => ({
					name: c.name,
					packed: !!c.entry?.packedAt,
					packedItems: c.entry?.items ?? null,
					suggestion: c.suggestion,
					returnsToday: c.returnsToday
				}))
			};
		}

		if (args.action === 'log_packed') {
			if (!args.childName) return { error: 'childName required' };
			const child = await findChild(args.userId, args.childName);
			if (!child) return { error: `Fant ikke barnet «${args.childName}»` };

			const overview = await getLunchboxOverview(args.userId, date);
			const childData = overview.children.find((c) => c.personId === child.id);
			const items = childData?.suggestion?.items?.map(({ componentId, name, kind }) => ({ componentId, name, kind })) ?? [];

			const existing = await db.query.lunchboxEntries.findFirst({
				where: and(
					eq(lunchboxEntries.userId, args.userId),
					eq(lunchboxEntries.personId, child.id),
					eq(lunchboxEntries.date, date)
				)
			});
			if (existing) {
				await db
					.update(lunchboxEntries)
					.set({ packedAt: new Date() })
					.where(eq(lunchboxEntries.id, existing.id));
				return { packed: true, child: child.name, items: existing.items };
			}
			await db.insert(lunchboxEntries).values({
				userId: args.userId,
				personId: child.id,
				date,
				items,
				source: 'suggested',
				packedAt: new Date()
			});
			return { packed: true, child: child.name, items };
		}

		if (args.action === 'log_return') {
			if (!args.childName || !args.itemName) return { error: 'childName and itemName required' };
			const child = await findChild(args.userId, args.childName);
			if (!child) return { error: `Fant ikke barnet «${args.childName}»` };

			const [component] = await db
				.select({ id: lunchboxComponents.id })
				.from(lunchboxComponents)
				.where(
					and(
						eq(lunchboxComponents.userId, args.userId),
						ilike(lunchboxComponents.name, `%${args.itemName.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
					)
				)
				.limit(1);

			const [created] = await db
				.insert(lunchboxReturns)
				.values({
					userId: args.userId,
					personId: child.id,
					date,
					componentId: component?.id ?? null,
					itemName: args.itemName.trim(),
					quantity: args.quantity ?? null,
					degree: args.degree ?? 'noe'
				})
				.returning();
			return { logged: true, child: child.name, return: created };
		}

		if (args.action === 'set_preferences') {
			if (!args.childName) return { error: 'childName required' };
			const child = await findChild(args.userId, args.childName);
			if (!child) return { error: `Fant ikke barnet «${args.childName}»` };

			const updates: Record<string, unknown> = { updatedAt: new Date() };
			if (args.likes) updates.likes = args.likes;
			if (args.dislikes) updates.dislikes = args.dislikes;
			if (args.allergies) updates.allergies = args.allergies;
			if (args.appetite) updates.appetite = args.appetite;

			const [updated] = await db
				.update(lunchboxProfiles)
				.set(updates)
				.where(and(eq(lunchboxProfiles.userId, args.userId), eq(lunchboxProfiles.personId, child.id)))
				.returning();
			if (updated) return { profile: updated };

			const [created] = await db
				.insert(lunchboxProfiles)
				.values({
					userId: args.userId,
					personId: child.id,
					likes: args.likes ?? [],
					dislikes: args.dislikes ?? [],
					allergies: args.allergies ?? [],
					appetite: args.appetite ?? 'middels'
				})
				.returning();
			return { profile: created };
		}

		if (args.action === 'add_component') {
			if (!args.componentName || !args.componentKind) {
				return { error: 'componentName and componentKind required' };
			}
			const [created] = await db
				.insert(lunchboxComponents)
				.values({ userId: args.userId, name: args.componentName.trim(), kind: args.componentKind })
				.returning();
			return { component: created };
		}
	}
};
