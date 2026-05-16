import { z } from 'zod';
import { db } from '$lib/db';
import { procedures, procedureSteps } from '$lib/db/schema';
import { eq, and } from 'drizzle-orm';

export const manageProcedureTool = {
	name: 'manage_procedure',
	description: `Opprett, oppdater eller slett en fremgangsmåte/oppskrift (prosedyre for hverdagsoppgaver).
IKKE for mat-oppskrifter (bruk manage_recipe for det).

En fremgangsmåte er en gjenbrukbar prosedyre som kan gjenbrukes neste gang brukeren har en lignende oppgave.
Eksempler: stryke skjorter, vaske vinduene, vinterlagre hagemøbler, kalibrere varmepumpe.

action=suggest_save: Foreslå å lagre samtalen som fremgangsmåte (ingen DB-skriving). Returner forhåndsvisning.
action=create: Opprett fremgangsmåte med trinn.
action=update: Oppdater eksisterende (krever id).
action=delete: Arkiver (krever id).`,

	parameters: z.object({
		userId: z.string(),
		action: z.enum(['create', 'update', 'delete', 'suggest_save']),
		id: z.string().uuid().optional(),
		title: z.string().optional(),
		summary: z.string().optional(),
		steps: z.array(z.string()).optional(),
		domain: z.string().optional(),
		themeId: z.string().uuid().optional(),
		conversationId: z.string().uuid().optional(),
		triggerKeywords: z.array(z.string()).optional(),
		emoji: z.string().optional(),
		shared: z.boolean().optional()
	}),

	execute: async (args: {
		userId: string;
		action: 'create' | 'update' | 'delete' | 'suggest_save';
		id?: string;
		title?: string;
		summary?: string;
		steps?: string[];
		domain?: string;
		themeId?: string;
		conversationId?: string;
		triggerKeywords?: string[];
		emoji?: string;
		shared?: boolean;
	}) => {
		if (args.action === 'suggest_save') {
			return {
				suggestion: true,
				title: args.title,
				emoji: args.emoji,
				summary: args.summary,
				steps: args.steps,
				domain: args.domain,
				message: 'Vil du lagre denne som en gjenbrukbar fremgangsmåte?'
			};
		}

		if (args.action === 'create') {
			if (!args.title) return { error: 'title required for create' };

			const [created] = await db.insert(procedures).values({
				userId: args.userId,
				title: args.title,
				summary: args.summary ?? null,
				domain: args.domain ?? null,
				themeId: args.themeId ?? null,
				conversationId: args.conversationId ?? null,
				triggerKeywords: args.triggerKeywords ?? [],
				emoji: args.emoji ?? null,
				shared: args.shared ?? false
			}).returning();

			if (args.steps && args.steps.length > 0) {
				await db.insert(procedureSteps).values(
					args.steps.map((text, i) => ({
						procedureId: created.id,
						text,
						sortOrder: i
					}))
				);
			}

			const result = await db.query.procedures.findFirst({
				where: eq(procedures.id, created.id),
				with: { steps: { orderBy: (s, { asc }) => [asc(s.sortOrder)] } }
			});

			return { procedure: result };
		}

		if (args.action === 'update') {
			if (!args.id) return { error: 'id required for update' };

			const existing = await db.query.procedures.findFirst({
				where: and(eq(procedures.id, args.id), eq(procedures.userId, args.userId))
			});
			if (!existing) return { error: 'procedure not found' };

			const updates: Record<string, unknown> = { updatedAt: new Date() };
			if (args.title !== undefined) updates.title = args.title;
			if (args.summary !== undefined) updates.summary = args.summary;
			if (args.domain !== undefined) updates.domain = args.domain;
			if (args.themeId !== undefined) updates.themeId = args.themeId;
			if (args.triggerKeywords !== undefined) updates.triggerKeywords = args.triggerKeywords;
			if (args.emoji !== undefined) updates.emoji = args.emoji;
			if (args.shared !== undefined) updates.shared = args.shared;

			if (args.steps !== undefined) {
				updates.version = existing.version + 1;
				await db.delete(procedureSteps).where(eq(procedureSteps.procedureId, args.id));
				if (args.steps.length > 0) {
					await db.insert(procedureSteps).values(
						args.steps.map((text, i) => ({
							procedureId: args.id!,
							text,
							sortOrder: i
						}))
					);
				}
			}

			await db.update(procedures).set(updates).where(eq(procedures.id, args.id));

			const result = await db.query.procedures.findFirst({
				where: eq(procedures.id, args.id),
				with: { steps: { orderBy: (s, { asc }) => [asc(s.sortOrder)] } }
			});

			return { procedure: result };
		}

		if (args.action === 'delete') {
			if (!args.id) return { error: 'id required for delete' };

			const deleted = await db.update(procedures)
				.set({ archivedAt: new Date(), updatedAt: new Date() })
				.where(and(eq(procedures.id, args.id), eq(procedures.userId, args.userId)))
				.returning({ id: procedures.id });

			return { deleted: deleted.length > 0 };
		}

		return { error: 'unknown action' };
	}
};
