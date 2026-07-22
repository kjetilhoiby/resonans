import { z } from 'zod';
import { db } from '$lib/db';
import { themes, projectContacts } from '$lib/db/schema';
import { and, eq, asc, sql } from 'drizzle-orm';
import { mapContact, isContactStatus, normalizeIsoDate } from '$lib/server/project-contacts';

// AI-verktøy: lar prosjekt-chatten styre kontaktlista til et kommunikasjons-/arrangement-
// prosjekt (project_contacts knyttet til et tema). Brukes til å samle kontaktinfo, sette
// oppfølgingsdato (purredato) og registrere status. Formulering av e-post/samtaler gjør
// assistenten som vanlig i chatten — dette verktøyet lagrer selve kontaktene.
export const manageProjectContactsTool = {
	name: 'manage_project_contacts',
	parameters: z.object({
		userId: z.string(),
		themeId: z.string(),
		action: z.enum(['create', 'update', 'delete', 'list']),
		contactId: z.string().optional(),
		name: z.string().optional(),
		role: z.string().nullable().optional(),
		phone: z.string().nullable().optional(),
		email: z.string().nullable().optional(),
		status: z.enum(['todo', 'venter', 'ferdig']).optional(),
		notes: z.string().nullable().optional(),
		followUpAt: z.string().nullable().optional()
	}),
	execute: async (args: {
		userId: string;
		themeId: string;
		action: 'create' | 'update' | 'delete' | 'list';
		contactId?: string;
		name?: string;
		role?: string | null;
		phone?: string | null;
		email?: string | null;
		status?: 'todo' | 'venter' | 'ferdig';
		notes?: string | null;
		followUpAt?: string | null;
	}) => {
		const { userId, themeId } = args;
		if (!themeId) return { success: false, error: 'Mangler themeId' };

		const theme = await db.query.themes.findFirst({
			where: and(eq(themes.id, themeId), eq(themes.userId, userId))
		});
		if (!theme) return { success: false, error: 'Tema ikke funnet' };

		switch (args.action) {
			case 'list': {
				const rows = await db
					.select()
					.from(projectContacts)
					.where(and(eq(projectContacts.themeId, themeId), eq(projectContacts.userId, userId)))
					.orderBy(asc(projectContacts.sortOrder), asc(projectContacts.createdAt));
				return { success: true, contacts: rows.map(mapContact) };
			}

			case 'create': {
				if (!args.name?.trim()) return { success: false, error: 'Mangler navn' };
				const [{ maxOrder }] = await db
					.select({ maxOrder: sql<number>`coalesce(max(${projectContacts.sortOrder}), -1)` })
					.from(projectContacts)
					.where(and(eq(projectContacts.themeId, themeId), eq(projectContacts.userId, userId)));

				const [created] = await db
					.insert(projectContacts)
					.values({
						userId,
						themeId,
						name: args.name.trim().slice(0, 120),
						role: args.role?.trim() ? args.role.trim().slice(0, 80) : null,
						phone: args.phone?.trim() ? args.phone.trim().slice(0, 40) : null,
						email: args.email?.trim() ? args.email.trim().slice(0, 160) : null,
						status: isContactStatus(args.status) ? args.status : 'todo',
						notes: args.notes?.trim() ? args.notes.trim() : null,
						followUpAt: normalizeIsoDate(args.followUpAt),
						sortOrder: (maxOrder ?? -1) + 1
					})
					.returning();
				return { success: true, contact: mapContact(created) };
			}

			case 'update': {
				if (!args.contactId) return { success: false, error: 'Mangler contactId' };
				const existing = await db.query.projectContacts.findFirst({
					where: and(
						eq(projectContacts.id, args.contactId),
						eq(projectContacts.themeId, themeId),
						eq(projectContacts.userId, userId)
					)
				});
				if (!existing) return { success: false, error: 'Kontakt ikke funnet' };

				const update: Partial<typeof projectContacts.$inferInsert> = { updatedAt: new Date() };
				if (args.name?.trim()) update.name = args.name.trim().slice(0, 120);
				if (args.role !== undefined) update.role = args.role?.trim() ? args.role.trim().slice(0, 80) : null;
				if (args.phone !== undefined) update.phone = args.phone?.trim() ? args.phone.trim().slice(0, 40) : null;
				if (args.email !== undefined) update.email = args.email?.trim() ? args.email.trim().slice(0, 160) : null;
				if (args.notes !== undefined) update.notes = args.notes?.trim() ? args.notes.trim() : null;
				if (args.followUpAt !== undefined) update.followUpAt = normalizeIsoDate(args.followUpAt);
				if (isContactStatus(args.status)) {
					update.status = args.status;
					if (args.status !== 'todo') update.lastContactedAt = new Date();
				}

				const [updated] = await db
					.update(projectContacts)
					.set(update)
					.where(eq(projectContacts.id, args.contactId))
					.returning();
				return { success: true, contact: mapContact(updated) };
			}

			case 'delete': {
				if (!args.contactId) return { success: false, error: 'Mangler contactId' };
				await db
					.delete(projectContacts)
					.where(
						and(
							eq(projectContacts.id, args.contactId),
							eq(projectContacts.themeId, themeId),
							eq(projectContacts.userId, userId)
						)
					);
				return { success: true };
			}

			default:
				return { success: false, error: 'Ukjent action' };
		}
	}
};
