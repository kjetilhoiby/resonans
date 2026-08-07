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
import { sensorEvents, sensors, writingDocs } from '$lib/db/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { generateEmbedding } from '$lib/server/services/embedding-service';
import { osloDayKey } from '$lib/server/trip-geo';
import { checkNotStale } from '$lib/domain/writing/concurrency';
import {
	countWords,
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

/** `dataType` skriveøktene logges under. Streak-definisjoner kan peke hit. */
export const WRITING_EVENT_DATA_TYPE = 'writing';
export const WRITING_PROVIDER = 'manual';
export const WRITING_SENSOR_TYPE = 'writing_log';

/** Egen sensor per bruker, opprettet ved første skriving. Som ensureNutritionSensor. */
export async function ensureWritingSensor(userId: string): Promise<string> {
	const existing = await db.query.sensors.findFirst({
		columns: { id: true },
		where: and(
			eq(sensors.userId, userId),
			eq(sensors.provider, WRITING_PROVIDER),
			eq(sensors.type, WRITING_SENSOR_TYPE)
		)
	});
	if (existing) return existing.id;

	const [created] = await db
		.insert(sensors)
		.values({
			userId,
			provider: WRITING_PROVIDER,
			type: WRITING_SENSOR_TYPE,
			subtype: 'session',
			name: 'Skrivelogg',
			isActive: true
		})
		.returning({ id: sensors.id });

	return created.id;
}

/**
 * Logger at det ble skrevet.
 *
 * **Uten dette kan ingen skrivestreak være sann.** `writing_docs.updatedAt` er
 * mutabel og husker bare *siste* dag et dokument ble rørt: redigerer man samme
 * scene mandag, tirsdag og onsdag, står det bare onsdag igjen, og mandag og
 * tirsdag forsvinner ut av streaken. En streak trenger en hendelseslogg, ikke et
 * tidsstempel.
 *
 * `sensor_events` er den loggen — «unified event stream» — og fordi hendelsene
 * ligger der, virker eksisterende streak-maskineri uten en ny kildetype:
 * `{ kind: 'sensor_event', dataType: 'writing' }`.
 *
 * Best-effort: en feilet logging skal aldri velte lagringen av teksten.
 */
async function logWritingEvent(params: {
	userId: string;
	docId: string;
	projectId: string | null;
	words: number;
	wordsDelta: number;
}): Promise<void> {
	try {
		const sensorId = await ensureWritingSensor(params.userId);
		await db.insert(sensorEvents).values({
			userId: params.userId,
			sensorId,
			eventType: 'activity',
			dataType: WRITING_EVENT_DATA_TYPE,
			timestamp: new Date(),
			data: {
				docId: params.docId,
				projectId: params.projectId,
				words: params.words,
				wordsDelta: params.wordsDelta
			}
		});
	} catch (err) {
		console.warn('[writing] kunne ikke logge skrivehendelse:', err);
	}
}

/** Oslo-dagsnøkler for skrivehendelser, til streak-beregningen. */
export async function listWritingDayKeys(userId: string, since: Date): Promise<string[]> {
	const rows = await db
		.select({ at: sensorEvents.timestamp })
		.from(sensorEvents)
		.where(
			and(
				eq(sensorEvents.userId, userId),
				eq(sensorEvents.dataType, WRITING_EVENT_DATA_TYPE),
				gte(sensorEvents.timestamp, since)
			)
		);
	return rows.map((r) => osloDayKey(r.at));
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

	if (body) {
		await logWritingEvent({
			userId: input.userId,
			docId: row.id,
			projectId: row.projectId,
			words: countWords(body),
			wordsDelta: countWords(body)
		});
	}

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

	// Bare tekstendringer teller som skriving. Å flytte et dokument inn i et
	// prosjekt eller endre status er ikke en skrivekveld.
	if (row && textChanged && body !== existing.body) {
		await logWritingEvent({
			userId: input.userId,
			docId: row.id,
			projectId: row.projectId,
			words: countWords(body),
			wordsDelta: countWords(body) - countWords(existing.body)
		});
	}

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
