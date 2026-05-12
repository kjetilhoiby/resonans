import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '$lib/db';
import { tasks } from '$lib/db/schema';
import { parseYearlyWindow } from '$lib/server/pool/yearly-window';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseIso(v: string | undefined | null): string | null {
	if (!v) return null;
	const t = String(v).trim();
	if (!ISO_DATE_RE.test(t)) return null;
	return t;
}

const ItemSchema = z.object({
	title: z.string().min(1),
	description: z.string().optional(),
	projectId: z.string().optional(),
	estimatedMinutes: z.number().int().positive().optional(),
	effort: z.enum(['low', 'medium', 'high']).optional(),
	dueDate: z.string().optional(),
	availableFrom: z.string().optional(),
	availableTo: z.string().optional(),
	yearlyWindow: z.string().optional(),
	contextTags: z.array(z.string()).optional(),
	poolPriority: z.number().int().optional()
});

export const managePoolTasksTool = {
	name: 'manage_pool_tasks',
	description: `Forvalt brukerens "huskeliste" (pool-tasks — oppgaver uten fast uke/måned).
Operations:
- bulk_add: Lavest friksjon — opprett flere oppgaver fra en dump. Send KUN title for hver (pluss projectId/yearlyWindow hvis brukeren eksplisitt nevnte det). Ikke gjett estimat eller frist.
- clarify: Oppdater en eksisterende stub med estimat og/eller frist. Brukes i klargjørings-loopen.
- complete: Marker som ferdig (status='done', completedAt=nå).
- snooze: Skyv 'availableFrom' N dager fram.
- update: Generell oppdatering (sjelden brukt — clarify dekker det meste).

Returnerer { created: [{id, title, needsClarification}], skipped: [...] } for bulk_add slik at AI vet hvilke stubs som mangler info.`,
	parameters: z.object({
		userId: z.string(),
		operation: z.enum(['bulk_add', 'clarify', 'complete', 'snooze', 'update']),
		items: z.array(ItemSchema).optional(),
		taskId: z.string().optional(),
		estimatedMinutes: z.number().int().positive().optional(),
		effort: z.enum(['low', 'medium', 'high']).optional(),
		dueDate: z.string().optional(),
		yearlyWindow: z.string().optional(),
		projectId: z.string().optional(),
		contextTags: z.array(z.string()).optional(),
		snoozeDays: z.number().int().positive().optional()
	}),
	execute: async (args: {
		userId: string;
		operation: 'bulk_add' | 'clarify' | 'complete' | 'snooze' | 'update';
		items?: z.infer<typeof ItemSchema>[];
		taskId?: string;
		estimatedMinutes?: number;
		effort?: 'low' | 'medium' | 'high';
		dueDate?: string;
		yearlyWindow?: string;
		projectId?: string;
		contextTags?: string[];
		snoozeDays?: number;
	}) => {
		switch (args.operation) {
			case 'bulk_add': {
				const items = args.items ?? [];
				if (items.length === 0) return { error: 'items er påkrevd' };

				const created: Array<{ id: string; title: string; needsClarification: boolean }> = [];
				const skipped: Array<{ title: string; reason: string }> = [];

				for (const item of items) {
					const title = item.title.trim();
					if (!title) {
						skipped.push({ title: '', reason: 'tom tittel' });
						continue;
					}
					const yearlyWindow = item.yearlyWindow?.trim() || null;
					if (yearlyWindow && !parseYearlyWindow(yearlyWindow)) {
						skipped.push({ title, reason: `ugyldig yearlyWindow '${yearlyWindow}'` });
						continue;
					}
					const dueDate = parseIso(item.dueDate);
					const availableFrom = parseIso(item.availableFrom);
					const availableTo = parseIso(item.availableTo);
					if (dueDate && (availableFrom || availableTo)) {
						skipped.push({ title, reason: 'dueDate og available-vindu er gjensidig utelukkende' });
						continue;
					}

					const [row] = await db
						.insert(tasks)
						.values({
							userId: args.userId,
							title,
							description: item.description ?? null,
							projectId: item.projectId ?? null,
							isPool: true,
							dueDate: dueDate ?? null,
							availableFrom: availableFrom ?? null,
							availableTo: availableTo ?? null,
							yearlyWindow: yearlyWindow ?? null,
							estimatedMinutes: item.estimatedMinutes ?? null,
							effort: item.effort ?? null,
							contextTags: item.contextTags ?? null,
							poolPriority: item.poolPriority ?? 0,
							recurrenceYearly: yearlyWindow ? true : false
						})
						.returning({ id: tasks.id, title: tasks.title });
					const needsClarification = !item.estimatedMinutes && !dueDate && !yearlyWindow;
					created.push({ id: row.id, title: row.title, needsClarification });
				}
				return { created, skipped };
			}
			case 'clarify': {
				if (!args.taskId) return { error: 'taskId er påkrevd' };
				const updates: Record<string, unknown> = { updatedAt: new Date() };
				if (args.estimatedMinutes !== undefined) updates.estimatedMinutes = args.estimatedMinutes;
				if (args.effort) updates.effort = args.effort;
				const dueDate = parseIso(args.dueDate);
				if (dueDate) updates.dueDate = dueDate;
				if (args.yearlyWindow) {
					if (!parseYearlyWindow(args.yearlyWindow)) return { error: 'ugyldig yearlyWindow' };
					updates.yearlyWindow = args.yearlyWindow;
					updates.recurrenceYearly = true;
				}
				if (args.projectId !== undefined) updates.projectId = args.projectId || null;
				if (args.contextTags) updates.contextTags = args.contextTags;

				const [row] = await db
					.update(tasks)
					.set(updates)
					.where(and(eq(tasks.id, args.taskId), eq(tasks.userId, args.userId)))
					.returning({ id: tasks.id, title: tasks.title });
				if (!row) return { error: 'Fant ikke oppgaven' };
				return { clarified: row };
			}
			case 'complete': {
				if (!args.taskId) return { error: 'taskId er påkrevd' };
				const meta = sql`coalesce(${tasks.metadata}, '{}'::jsonb) || jsonb_build_object('completedAt', to_jsonb(now()))`;
				const [row] = await db
					.update(tasks)
					.set({ status: 'done', metadata: meta as any, updatedAt: new Date() })
					.where(and(eq(tasks.id, args.taskId), eq(tasks.userId, args.userId)))
					.returning({ id: tasks.id, title: tasks.title });
				if (!row) return { error: 'Fant ikke oppgaven' };
				return { completed: row };
			}
			case 'snooze': {
				if (!args.taskId) return { error: 'taskId er påkrevd' };
				const days = args.snoozeDays ?? 1;
				const target = new Date();
				target.setUTCDate(target.getUTCDate() + days);
				const iso = target.toISOString().slice(0, 10);
				const [row] = await db
					.update(tasks)
					.set({ availableFrom: iso, lastSurfacedAt: new Date(), updatedAt: new Date() })
					.where(and(eq(tasks.id, args.taskId), eq(tasks.userId, args.userId)))
					.returning({ id: tasks.id });
				if (!row) return { error: 'Fant ikke oppgaven' };
				return { snoozed: { id: row.id, availableFrom: iso, days } };
			}
			case 'update': {
				if (!args.taskId) return { error: 'taskId er påkrevd' };
				const updates: Record<string, unknown> = { updatedAt: new Date() };
				if (args.estimatedMinutes !== undefined) updates.estimatedMinutes = args.estimatedMinutes;
				if (args.effort) updates.effort = args.effort;
				const dueDate = parseIso(args.dueDate);
				if (dueDate) updates.dueDate = dueDate;
				if (args.projectId !== undefined) updates.projectId = args.projectId || null;
				if (args.contextTags) updates.contextTags = args.contextTags;
				const [row] = await db
					.update(tasks)
					.set(updates)
					.where(and(eq(tasks.id, args.taskId), eq(tasks.userId, args.userId)))
					.returning({ id: tasks.id });
				if (!row) return { error: 'Fant ikke oppgaven' };
				return { updated: row };
			}
		}
	}
};
