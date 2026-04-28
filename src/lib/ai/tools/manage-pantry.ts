import { z } from 'zod';
import { db } from '$lib/db';
import { pantryItems } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const managePantryTool = {
	name: 'manage_pantry',
	description: `Add, update or remove items in the user's pantry/fridge/freezer.

Use this to keep a lightweight inventory. Each item has a name, location, and optional quantity, unit and expiry.
Use action='use' to mark an item as used (sets last_used_at and decrements quantity if provided).`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['add', 'update', 'remove', 'use']),
		id: z.string().uuid().optional(),
		name: z.string().optional(),
		location: z.enum(['pantry', 'fridge', 'freezer']).optional(),
		quantity: z.number().nullable().optional(),
		unit: z.string().nullable().optional(),
		expiresAt: z.string().nullable().optional().describe('YYYY-MM-DD'),
		notes: z.string().optional(),
		consumeQuantity: z.number().optional().describe('Amount to subtract on action=use')
	}),

	execute: async (args: {
		userId: string;
		action: 'add' | 'update' | 'remove' | 'use';
		id?: string;
		name?: string;
		location?: 'pantry' | 'fridge' | 'freezer';
		quantity?: number | null;
		unit?: string | null;
		expiresAt?: string | null;
		notes?: string;
		consumeQuantity?: number;
	}) => {
		if (args.action === 'add') {
			if (!args.name || !args.location) {
				return { error: 'name and location required for add' };
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
					notes: args.notes
				})
				.returning();
			return { pantryItem: created };
		}

		if (args.action === 'update') {
			if (!args.id) return { error: 'id required for update' };
			const updates: Record<string, unknown> = {};
			if (args.name !== undefined) updates.name = args.name;
			if (args.location !== undefined) updates.location = args.location;
			if (args.quantity !== undefined) updates.quantity = args.quantity != null ? String(args.quantity) : null;
			if (args.unit !== undefined) updates.unit = args.unit;
			if (args.expiresAt !== undefined) updates.expiresAt = args.expiresAt;
			if (args.notes !== undefined) updates.notes = args.notes;

			const [updated] = await db
				.update(pantryItems)
				.set(updates)
				.where(and(eq(pantryItems.id, args.id), eq(pantryItems.userId, args.userId)))
				.returning();
			return updated ? { pantryItem: updated } : { error: 'pantry item not found' };
		}

		if (args.action === 'remove') {
			if (!args.id) return { error: 'id required for remove' };
			const deleted = await db
				.delete(pantryItems)
				.where(and(eq(pantryItems.id, args.id), eq(pantryItems.userId, args.userId)))
				.returning({ id: pantryItems.id });
			return { deleted: deleted.length > 0 };
		}

		if (args.action === 'use') {
			if (!args.id) return { error: 'id required for use' };
			const [existing] = await db
				.select()
				.from(pantryItems)
				.where(and(eq(pantryItems.id, args.id), eq(pantryItems.userId, args.userId)));
			if (!existing) return { error: 'pantry item not found' };

			const updates: Record<string, unknown> = { lastUsedAt: new Date() };
			if (args.consumeQuantity != null && existing.quantity != null) {
				const next = Number(existing.quantity) - args.consumeQuantity;
				updates.quantity = next > 0 ? String(next) : '0';
			}

			const [updated] = await db
				.update(pantryItems)
				.set(updates)
				.where(eq(pantryItems.id, args.id))
				.returning();
			return { pantryItem: updated };
		}
	}
};
