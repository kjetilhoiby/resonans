import { z } from 'zod';
import { db } from '$lib/db';
import { themes, checklistItems } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { ensureProjectChecklist, syncProjectItemDayMembership, mapTaskItem } from '$lib/server/project-tasks';
import { parseTaskText } from '$lib/domains/home/task-parse';

// AI-verktøy: lar prosjekt-chatten styre oppgavelista (checklist_items knyttet til et tema).
// Gjenbruker samme helpers og parsing som /api/tema/[id]/tasks-endepunktet.
export const manageProjectTasksTool = {
	name: 'manage_project_tasks',
	parameters: z.object({
		userId: z.string(),
		themeId: z.string(),
		action: z.enum(['create', 'update', 'check', 'delete']),
		itemId: z.string().optional(),
		text: z.string().optional(),
		parentId: z.string().nullable().optional(),
		shopping: z.boolean().optional(),
		store: z.string().optional(),
		dueDate: z.string().nullable().optional(),
		estimateMinutes: z.number().nullable().optional(),
		blockedBy: z.array(z.string()).optional(),
		blocksItemIds: z.array(z.string()).optional(),
		checked: z.boolean().optional()
	}),
	execute: async (args: {
		userId: string;
		themeId: string;
		action: 'create' | 'update' | 'check' | 'delete';
		itemId?: string;
		text?: string;
		parentId?: string | null;
		shopping?: boolean;
		store?: string;
		dueDate?: string | null;
		estimateMinutes?: number | null;
		blockedBy?: string[];
		blocksItemIds?: string[];
		checked?: boolean;
	}) => {
		const { userId, themeId } = args;
		if (!themeId) return { success: false, error: 'Mangler themeId' };

		const theme = await db.query.themes.findFirst({
			where: and(eq(themes.id, themeId), eq(themes.userId, userId))
		});
		if (!theme) return { success: false, error: 'Tema ikke funnet' };

		switch (args.action) {
			case 'create': {
				if (!args.text?.trim()) return { success: false, error: 'Mangler text' };
				const parsed = parseTaskText(args.text);
				// Eksplisitte shopping/store fra AI-en vinner; ellers fall tilbake på «kjøp:»-parsing.
				const shopping = args.shopping ?? parsed.shopping;
				const store = args.store ?? parsed.store;
				const shopMeta = shopping ? { shopping: true, ...(store ? { store } : {}) } : {};
				const parentId = args.parentId ?? null;
				const checklistId = await ensureProjectChecklist(userId, themeId, theme.name);

				const [{ maxOrder }] = await db
					.select({ maxOrder: sql<number>`coalesce(max(${checklistItems.sortOrder}), -1)` })
					.from(checklistItems)
					.where(
						parentId
							? and(eq(checklistItems.themeId, themeId), eq(checklistItems.parentId, parentId))
							: and(eq(checklistItems.themeId, themeId), sql`${checklistItems.parentId} is null`)
					);

				const [created] = await db
					.insert(checklistItems)
					.values({
						checklistId,
						userId,
						themeId,
						parentId,
						text: parsed.text || args.text,
						dueDate: args.dueDate || null,
						estimateMinutes: typeof args.estimateMinutes === 'number' ? args.estimateMinutes : null,
						sortOrder: (maxOrder ?? -1) + 1,
						metadata: { ...shopMeta, ...(args.blockedBy?.length ? { blockedBy: args.blockedBy } : {}) }
					})
					.returning();

				if (args.dueDate) {
					await syncProjectItemDayMembership(userId, created.id, themeId, theme.name, args.dueDate);
				}
				// «Denne før X» — sett created.id som blocker på hver X (X.blockedBy += created.id).
				if (args.blocksItemIds?.length) {
					for (const bid of args.blocksItemIds) {
						const blk = await db.query.checklistItems.findFirst({
							where: and(
								eq(checklistItems.id, bid),
								eq(checklistItems.themeId, themeId),
								eq(checklistItems.userId, userId)
							)
						});
						if (!blk) continue;
						const bmeta = { ...((blk.metadata ?? {}) as Record<string, unknown>) };
						const arr = Array.isArray(bmeta.blockedBy) ? (bmeta.blockedBy as string[]) : [];
						if (!arr.includes(created.id)) {
							bmeta.blockedBy = [...arr, created.id];
							await db.update(checklistItems).set({ metadata: bmeta }).where(eq(checklistItems.id, bid));
						}
					}
				}
				return { success: true, item: mapTaskItem(created) };
			}

			case 'update': {
				if (!args.itemId) return { success: false, error: 'Mangler itemId' };
				const existing = await db.query.checklistItems.findFirst({
					where: and(
						eq(checklistItems.id, args.itemId),
						eq(checklistItems.themeId, themeId),
						eq(checklistItems.userId, userId)
					)
				});
				if (!existing) return { success: false, error: 'Oppgave ikke funnet' };

				const update: Partial<typeof checklistItems.$inferInsert> = {};
				const meta = { ...((existing.metadata ?? {}) as Record<string, unknown>) };

				if (typeof args.text === 'string' && args.text.trim()) {
					const parsed = parseTaskText(args.text);
					update.text = parsed.text || args.text;
					if (parsed.shopping) {
						meta.shopping = true;
						if (parsed.store) meta.store = parsed.store;
					}
				}
				if (args.shopping !== undefined) meta.shopping = args.shopping;
				if (args.store !== undefined) meta.store = args.store;
				if (args.dueDate !== undefined) update.dueDate = args.dueDate || null;
				if (args.estimateMinutes !== undefined) {
					update.estimateMinutes = typeof args.estimateMinutes === 'number' ? args.estimateMinutes : null;
				}
				if (args.blockedBy !== undefined) meta.blockedBy = args.blockedBy;
				update.metadata = meta;

				const [updated] = await db
					.update(checklistItems)
					.set(update)
					.where(eq(checklistItems.id, args.itemId))
					.returning();

				if (args.dueDate !== undefined) {
					await syncProjectItemDayMembership(userId, args.itemId, themeId, theme.name, args.dueDate || null);
				}
				return { success: true, item: mapTaskItem(updated) };
			}

			case 'check': {
				if (!args.itemId) return { success: false, error: 'Mangler itemId' };
				const next = args.checked ?? true;
				const [updated] = await db
					.update(checklistItems)
					.set({ checked: next, checkedAt: next ? new Date() : null })
					.where(
						and(
							eq(checklistItems.id, args.itemId),
							eq(checklistItems.themeId, themeId),
							eq(checklistItems.userId, userId)
						)
					)
					.returning();
				if (!updated) return { success: false, error: 'Oppgave ikke funnet' };
				return { success: true, item: mapTaskItem(updated) };
			}

			case 'delete': {
				if (!args.itemId) return { success: false, error: 'Mangler itemId' };
				await db
					.delete(checklistItems)
					.where(
						and(
							eq(checklistItems.id, args.itemId),
							eq(checklistItems.themeId, themeId),
							eq(checklistItems.userId, userId)
						)
					);
				return { success: true };
			}

			default:
				return { success: false, error: 'Ukjent action' };
		}
	}
};
