/**
 * Skrivevei for dokumenter i notatblokk og skriveprosjekt.
 *
 * ÉN vei inn — API-ruta, chat-verktøy (fase 2) og transkripsjonsinngangen (fase 3)
 * skal alle gå gjennom `createDoc`/`updateDoc`. Samme begrunnelse som
 * `saveNutritionTargets`: legger man til et felt, skal det legges til ett sted.
 *
 * To ting skjer her som ingen kaller skal måtte huske på:
 *   1. Embedding regenereres når teksten endres — ellers står likheten mot den
 *      gamle teksten og søket lyver (samme felle som `updateReflection` fanget).
 *   2. Versjonssjekken kjøres før skriving, slik at samtidig redigering nektes
 *      framfor å skrive over.
 */

import { db, rowsOf } from '$lib/db';
import { writingDocs } from '$lib/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { generateEmbedding } from '$lib/server/services/embedding-service';
import { checkNotStale } from '$lib/domain/writing/concurrency';
import {
	DEFAULT_DOC_KIND,
	isWritingDocKind,
	isWritingDocStatus,
	type WritingDocKind,
	type WritingDocStatus
} from '$lib/domain/writing/doc-kinds';

export type WritingDoc = typeof writingDocs.$inferSelect;

export class StaleWriteError extends Error {
	readonly code = 'stale-write';
	constructor(message: string) {
		super(message);
		this.name = 'StaleWriteError';
	}
}

/** Teksten som embeddes: tittel + kropp, siden tittelen ofte bærer temaet. */
function embeddableText(title: string, body: string): string {
	return [title.trim(), body.trim()].filter(Boolean).join('\n\n');
}

export interface CreateDocInput {
	userId: string;
	title?: string | null;
	body?: string | null;
	kind?: string | null;
	status?: string | null;
	projectId?: string | null;
	sortOrder?: number;
}

export async function createDoc(input: CreateDocInput): Promise<WritingDoc> {
	const title = (input.title ?? '').trim();
	const body = (input.body ?? '').trim();
	const kind: WritingDocKind = isWritingDocKind(input.kind) ? input.kind : DEFAULT_DOC_KIND;
	const status: WritingDocStatus = isWritingDocStatus(input.status) ? input.status : 'utkast';

	// Embeddings er berikelse, aldri blokkerende — null lagres, og raden blir
	// stående søkbar via tekst-fallbacken til neste redigering.
	const embedding = await generateEmbedding(embeddableText(title, body));

	const [row] = await db
		.insert(writingDocs)
		.values({
			userId: input.userId,
			projectId: input.projectId ?? null,
			kind,
			title,
			body,
			status,
			sortOrder: input.sortOrder ?? 0,
			embedding
		})
		.returning();

	return row;
}

export interface UpdateDocInput {
	userId: string;
	id: string;
	/** Klientens `updatedAt` da dokumentet ble lastet. Påkrevd ved tekstendring. */
	expectedUpdatedAt?: string | null;
	title?: string | null;
	body?: string | null;
	kind?: string | null;
	status?: string | null;
	projectId?: string | null;
	sortOrder?: number;
}

/**
 * Oppdaterer et dokument. Kaster `StaleWriteError` når basen er nyere enn det
 * klienten så — kalleren skal vise meldingen, ikke svelge den.
 *
 * Returnerer null når dokumentet ikke finnes (eller tilhører en annen bruker).
 */
export async function updateDoc(input: UpdateDocInput): Promise<WritingDoc | null> {
	const existing = await db.query.writingDocs.findFirst({
		where: and(eq(writingDocs.id, input.id), eq(writingDocs.userId, input.userId))
	});
	if (!existing) return null;

	const titleChanged = input.title !== undefined && input.title !== null;
	const bodyChanged = input.body !== undefined && input.body !== null;
	const textChanged = titleChanged || bodyChanged;

	// Versjonssjekk bare når teksten endres. Å flytte et dokument inn i et prosjekt
	// eller endre status kan ikke ødelegge noens skriving, og skal ikke kunne
	// blokkeres av at en annen enhet skrev et tegn.
	if (textChanged) {
		const check = checkNotStale(existing.updatedAt, input.expectedUpdatedAt);
		if (!check.ok) throw new StaleWriteError(check.message);
	}

	const title = titleChanged ? input.title!.trim() : existing.title;
	const body = bodyChanged ? input.body!.trim() : existing.body;

	const patch: Partial<typeof writingDocs.$inferInsert> = {
		title,
		body,
		updatedAt: new Date()
	};

	if (input.kind !== undefined && isWritingDocKind(input.kind)) patch.kind = input.kind;
	if (input.status !== undefined && isWritingDocStatus(input.status)) patch.status = input.status;
	if (input.projectId !== undefined) patch.projectId = input.projectId;
	if (typeof input.sortOrder === 'number') patch.sortOrder = input.sortOrder;

	// Ny tekst → ny embedding, ellers står likheten mot den gamle teksten.
	if (textChanged) {
		patch.embedding = await generateEmbedding(embeddableText(title, body));
	}

	const [row] = await db
		.update(writingDocs)
		.set(patch)
		.where(and(eq(writingDocs.id, input.id), eq(writingDocs.userId, input.userId)))
		.returning();

	return row ?? null;
}

export async function deleteDoc(userId: string, id: string): Promise<boolean> {
	const rows = await db
		.delete(writingDocs)
		.where(and(eq(writingDocs.id, id), eq(writingDocs.userId, userId)))
		.returning({ id: writingDocs.id });
	return rows.length > 0;
}

export async function getDoc(userId: string, id: string): Promise<WritingDoc | null> {
	const row = await db.query.writingDocs.findFirst({
		where: and(eq(writingDocs.id, id), eq(writingDocs.userId, userId))
	});
	return row ?? null;
}

/**
 * Kopierer en fangst-rad (`reflections`) inn i notatblokka som dokument.
 *
 * Originalen blir stående — den er en logg-rad, og logger redigeres ikke. Samme
 * grep som `find-triage.ts` bruker når en oppskrift promoteres fra `finds` til
 * `meals`: kilden beholdes, kopien blir det redigerbare.
 */
export async function promoteReflectionToDoc(params: {
	userId: string;
	reflectionId: string;
	projectId?: string | null;
	kind?: string | null;
}): Promise<WritingDoc | null> {
	const rows = rowsOf<{ content: string; kind: string; period_key: string | null }>(
		await db.execute(sql`
			SELECT content, kind, period_key
			FROM reflections
			WHERE id = ${params.reflectionId} AND user_id = ${params.userId}
			LIMIT 1
		`)
	);
	const source = rows[0];
	if (!source) return null;

	const firstLine = source.content.split('\n').find((l) => l.trim())?.trim() ?? '';
	const title = firstLine.length > 60 ? `${firstLine.slice(0, 59)}…` : firstLine;

	return createDoc({
		userId: params.userId,
		title,
		body: source.content,
		kind: params.kind ?? 'notat',
		projectId: params.projectId ?? null
	});
}
