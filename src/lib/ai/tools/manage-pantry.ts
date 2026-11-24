import { z } from 'zod';
import { db } from '$lib/db';
import { pantryItems } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const managePantryTool = {
	name: 'manage_pantry',
	description: `Legg til, endre, bekreft eller fjern varer i lageret (skap, kjøleskap, fryser).

action:
- 'add': ny vare (name + location). Mengde og enhet er valgfritt, men handlelista trekker bare fra mengder den kjenner.
- 'update': endre en vare (id). En ny mengde regnes som en bekreftelse av beholdningen.
- 'confirm': «det stemmer» — bekrefter beholdningen uten å endre tallet (id). Bruk når brukeren sier at noe fortsatt ligger der.
- 'use': brukt (id); consumeQuantity trekker fra mengden.
- 'remove': fjern varen (id).

Hver vare har en dato for når beholdningen sist ble bekreftet (confirmedAt i query_food). Handlelista stoler ikke på en beholdning som er eldre enn to uker — den legger varen på lista merket som usikker. Spør heller enn å gjette når brukeren lurer på om noe finnes hjemme.

Faste varer (isStaple=true) skal alltid finnes hjemme. targetQuantity er ønsket buffer («ett brød i fryseren» = name «Brød», location «freezer», isStaple true, targetQuantity 1): handlelista fyller opp til den. Uten targetQuantity legges en fast vare på lista først når den er tom.`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['add', 'update', 'confirm', 'remove', 'use']),
		id: z.string().uuid().optional(),
		name: z.string().optional(),
		location: z.enum(['pantry', 'fridge', 'freezer']).optional(),
		quantity: z.number().nullable().optional(),
		unit: z.string().nullable().optional().describe('g, kg, dl, l, stk … tom = antall'),
		expiresAt: z.string().nullable().optional().describe('YYYY-MM-DD'),
		notes: z.string().optional(),
		isStaple: z.boolean().optional().describe('Fast vare som alltid skal finnes hjemme'),
		targetQuantity: z.number().nullable().optional().describe('Ønsket buffer for en fast vare, i varens enhet. null fjerner bufferen.'),
		consumeQuantity: z.number().optional().describe('Mengde å trekke fra ved action=use')
	}),

	execute: async (args: {
		userId: string;
		action: 'add' | 'update' | 'confirm' | 'remove' | 'use';
		id?: string;
		name?: string;
		location?: 'pantry' | 'fridge' | 'freezer';
		quantity?: number | null;
		unit?: string | null;
		expiresAt?: string | null;
		notes?: string;
		isStaple?: boolean;
		targetQuantity?: number | null;
		consumeQuantity?: number;
	}) => {
		if (args.action === 'add') {
			if (!args.name || !args.location) {
				return { error: 'name og location er påkrevd for add' };
			}
			const [created] = await db
				.insert(pantryItems)
				.values({
					userId: args.userId,
					name: args.name,
					location: args.location,
					quantity: args.quantity != null ? String(args.quantity) : null,
					unit: args.unit ?? null,
					expiresAt: args.expiresAt ?? null,
					notes: args.notes,
					isStaple: args.isStaple ?? false,
					targetQuantity: args.targetQuantity != null ? String(args.targetQuantity) : null,
					confirmedAt: new Date()
				})
				.returning();
			return { pantryItem: created };
		}

		if (!args.id) return { error: `id er påkrevd for ${args.action}` };

		if (args.action === 'update' || args.action === 'confirm') {
			const updates: Record<string, unknown> = {};
			if (args.action === 'update') {
				if (args.name !== undefined) updates.name = args.name;
				if (args.location !== undefined) updates.location = args.location;
				if (args.quantity !== undefined) updates.quantity = args.quantity != null ? String(args.quantity) : null;
				if (args.unit !== undefined) updates.unit = args.unit;
				if (args.expiresAt !== undefined) updates.expiresAt = args.expiresAt;
				if (args.notes !== undefined) updates.notes = args.notes;
				if (args.isStaple !== undefined) updates.isStaple = args.isStaple;
				if (args.targetQuantity !== undefined) {
					updates.targetQuantity = args.targetQuantity != null ? String(args.targetQuantity) : null;
				}
			}
			// En ny mengde er en bekreftelse; «confirm» er bare det.
			if (args.action === 'confirm' || args.quantity !== undefined) updates.confirmedAt = new Date();
			if (Object.keys(updates).length === 0) return { error: 'Ingen endringer oppgitt' };

			const [updated] = await db
				.update(pantryItems)
				.set(updates)
				.where(and(eq(pantryItems.id, args.id), eq(pantryItems.userId, args.userId)))
				.returning();
			return updated ? { pantryItem: updated } : { error: 'Fant ikke varen i lageret' };
		}

		if (args.action === 'remove') {
			const deleted = await db
				.delete(pantryItems)
				.where(and(eq(pantryItems.id, args.id), eq(pantryItems.userId, args.userId)))
				.returning({ id: pantryItems.id });
			return { deleted: deleted.length > 0 };
		}

		if (args.action === 'use') {
			const [existing] = await db
				.select()
				.from(pantryItems)
				.where(and(eq(pantryItems.id, args.id), eq(pantryItems.userId, args.userId)));
			if (!existing) return { error: 'Fant ikke varen i lageret' };

			const updates: Record<string, unknown> = { lastUsedAt: new Date() };
			if (args.consumeQuantity != null && existing.quantity != null) {
				const next = Number(existing.quantity) - args.consumeQuantity;
				updates.quantity = next > 0 ? String(next) : '0';
				// Den som trekker fra en kjent mengde, vet hva som er igjen.
				updates.confirmedAt = new Date();
			}

			const [updated] = await db
				.update(pantryItems)
				.set(updates)
				.where(and(eq(pantryItems.id, args.id), eq(pantryItems.userId, args.userId)))
				.returning();
			return { pantryItem: updated };
		}

		return { error: `Ukjent action: ${args.action}` };
	}
};
