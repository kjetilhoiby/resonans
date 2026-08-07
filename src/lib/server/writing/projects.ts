/**
 * Skriveprosjekter: oppretting, henting og materialet chat-prompten trenger.
 *
 * Prosjektet får sin egen samtale ved oppretting, som `books.conversationId` —
 * kompislesingen skal ikke blande seg inn i dagbok-tråden.
 */

import { db } from '$lib/db';
import { writingDocs, writingProjects } from '$lib/db/schema';
import { and, asc, desc, eq } from 'drizzle-orm';
import { createConversation } from '$lib/server/conversations';
import { countWords, resolveDocKind } from '$lib/domain/writing/doc-kinds';
import { applyOrder } from '$lib/domain/writing/manuscript';
import type { PromptDoc } from '$lib/domain/writing/coach-prompt';

export type WritingProject = typeof writingProjects.$inferSelect;

export async function listProjects(userId: string): Promise<WritingProject[]> {
	return db.query.writingProjects.findMany({
		where: eq(writingProjects.userId, userId),
		orderBy: [desc(writingProjects.updatedAt)]
	});
}

export async function getProject(userId: string, id: string): Promise<WritingProject | null> {
	const row = await db.query.writingProjects.findFirst({
		where: and(eq(writingProjects.id, id), eq(writingProjects.userId, userId))
	});
	return row ?? null;
}

export async function createProject(params: {
	userId: string;
	title: string;
	genre?: string | null;
	summary?: string | null;
	themeId?: string | null;
}): Promise<WritingProject> {
	const title = params.title.trim();

	// Egen samtale per prosjekt. Tittelen settes eksplisitt, slik at auto-titling
	// ikke overskriver den (se createConversation).
	const conversation = await createConversation(params.userId, 'web', `Skriving: ${title}`);

	const [row] = await db
		.insert(writingProjects)
		.values({
			userId: params.userId,
			title,
			genre: params.genre?.trim() || null,
			summary: params.summary?.trim() || null,
			themeId: params.themeId ?? null,
			conversationId: conversation?.id ?? null
		})
		.returning();

	return row;
}

export async function updateProject(
	userId: string,
	id: string,
	patch: { title?: string; genre?: string | null; summary?: string | null; status?: string }
): Promise<WritingProject | null> {
	const values: Partial<typeof writingProjects.$inferInsert> = { updatedAt: new Date() };
	if (typeof patch.title === 'string' && patch.title.trim()) values.title = patch.title.trim();
	if (patch.genre !== undefined) values.genre = patch.genre?.trim() || null;
	if (patch.summary !== undefined) values.summary = patch.summary?.trim() || null;
	if (typeof patch.status === 'string') values.status = patch.status;

	const [row] = await db
		.update(writingProjects)
		.set(values)
		.where(and(eq(writingProjects.id, id), eq(writingProjects.userId, userId)))
		.returning();
	return row ?? null;
}

/**
 * Sletter prosjektet. Dokumentene overlever med `project_id = NULL` (ON DELETE
 * SET NULL) og havner dermed tilbake i notatblokka — å slette et prosjekt skal
 * ikke slette månedene med skriving som ligger i det.
 */
export async function deleteProject(userId: string, id: string): Promise<boolean> {
	const rows = await db
		.delete(writingProjects)
		.where(and(eq(writingProjects.id, id), eq(writingProjects.userId, userId)))
		.returning({ id: writingProjects.id });
	return rows.length > 0;
}

/**
 * Skriver ny rekkefølge for manusets deler.
 *
 * Klienten sender hele den ønskede rekkefølgen som id-liste; `applyOrder` tetter
 * den og beholder deler klienten ikke nevnte, så en utdatert klient ikke kan
 * miste et kapittel ut av manuset. Bare ordnede typer (kapittel, scene) berøres
 * — materialet har ingen meningsfull rekkefølge.
 */
export async function reorderManuscript(
	userId: string,
	projectId: string,
	order: string[]
): Promise<Array<typeof writingDocs.$inferSelect>> {
	const { manuscript } = await getProjectContents(userId, projectId);
	if (manuscript.length === 0) return [];

	const reordered = applyOrder(
		manuscript.map((d) => ({ id: d.id, sortOrder: d.sortOrder })),
		order
	);

	// Bare radene som faktisk flyttet seg — en full omskriving ville rørt
	// updatedAt på hele manuset og fått alt til å se nylig endret ut.
	const current = new Map(manuscript.map((d) => [d.id, d.sortOrder]));
	const changed = reordered.filter((d) => current.get(d.id) !== d.sortOrder);

	for (const doc of changed) {
		await db
			.update(writingDocs)
			.set({ sortOrder: doc.sortOrder })
			.where(and(eq(writingDocs.id, doc.id), eq(writingDocs.userId, userId)));
	}

	return (await getProjectContents(userId, projectId)).manuscript;
}

export interface ProjectContents {
	/** Manusets ordnede deler (kapittel, scene) etter sortOrder. */
	manuscript: Array<typeof writingDocs.$inferSelect>;
	/** Materialet rundt (karakter, sted, notat, dikt, liste, transkripsjon). */
	material: Array<typeof writingDocs.$inferSelect>;
}

export async function getProjectContents(
	userId: string,
	projectId: string
): Promise<ProjectContents> {
	const docs = await db.query.writingDocs.findMany({
		where: and(eq(writingDocs.userId, userId), eq(writingDocs.projectId, projectId)),
		orderBy: [asc(writingDocs.sortOrder), asc(writingDocs.createdAt)]
	});

	return {
		manuscript: docs.filter((d) => resolveDocKind(d.kind).ordered),
		material: docs.filter((d) => !resolveDocKind(d.kind).ordered)
	};
}

/**
 * Materialet chat-prompten skal se. Karakterer og steder først — de er det en
 * redaktør og en sparringpartner faktisk trenger; frie notater tas med sist og
 * kuttes av prompt-byggeren om de er lange.
 */
export async function getPromptMaterial(
	userId: string,
	projectId: string
): Promise<{ material: PromptDoc[]; outline: Array<{ kind: string; title: string; words: number }> }> {
	const { manuscript, material } = await getProjectContents(userId, projectId);

	const priority = (kind: string) => (kind === 'karakter' ? 0 : kind === 'sted' ? 1 : 2);

	return {
		material: [...material]
			.sort((a, b) => priority(a.kind) - priority(b.kind))
			.map((d) => ({
				kind: resolveDocKind(d.kind).label.toLowerCase(),
				title: d.title,
				body: d.body
			})),
		outline: manuscript.map((d) => ({
			kind: resolveDocKind(d.kind).label.toLowerCase(),
			title: d.title || '(uten tittel)',
			words: countWords(d.body)
		}))
	};
}
