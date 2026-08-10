/**
 * Oversettelsen fra en lagret meldingsrad til en `ChatMessage`, ett sted.
 *
 * Alle flater henter tråden sin fra samme endepunkt (`/api/conversations/[id]/messages`)
 * eller fra en side-loader som leser samme tabell. Reglene under er de som må være like
 * overalt for at paginering og deduplisering skal virke.
 */
import type { ChatMessage } from './chat-state.svelte';

/** En meldingsrad slik endepunktene og side-loaderne serialiserer den. */
export interface ThreadRow {
	id?: string;
	role: string;
	content: string;
	timestamp?: string | null;
	starred?: boolean;
	imageUrl?: string | null;
	widgetProposal?: ChatMessage['widgetProposal'];
	widgetFlow?: ChatMessage['widgetFlow'];
	statusWidget?: ChatMessage['statusWidget'];
	photoAnnotation?: ChatMessage['photoAnnotation'];
	photoAnnotationImageUrl?: string | null;
	eventCard?: ChatMessage['eventCard'];
	researchCard?: ChatMessage['researchCard'];
}

/**
 * DB-id-en beholdes som `id` — ikke en fersk uuid.
 *
 * Dedupliseringen ved prepend hviler på at samme rad får samme id hver gang den hentes.
 * Med `crypto.randomUUID()` blir hver henting unik, og en melding kan dukke opp to ganger
 * i tråden uten at noe filter tar den.
 */
export function threadRowToMessage(row: ThreadRow): ChatMessage {
	return {
		id: row.id ?? crypto.randomUUID(),
		dbId: row.id ?? null,
		role: row.role as 'user' | 'assistant',
		text: row.content,
		starred: row.starred ?? false,
		createdAt: row.timestamp ?? null,
		imageUrl: row.imageUrl ?? null,
		widgetProposal: row.widgetProposal ?? null,
		widgetFlow: row.widgetFlow ?? null,
		statusWidget: row.statusWidget ?? null,
		photoAnnotation: row.photoAnnotation ?? null,
		photoAnnotationImageUrl: row.photoAnnotationImageUrl ?? null,
		eventCard: row.eventCard ?? null,
		researchCard: row.researchCard ?? null
	};
}

/** Radene som skal VISES. System-meldinger er kontekst for modellen, ikke samtale. */
export function displayRows(rows: ThreadRow[]): ThreadRow[] {
	return rows.filter((r) => r.role !== 'system');
}

/**
 * Markøren neste side skal hentes før: den eldste RÅ raden, altså før
 * system-filtreringen.
 *
 * Bruker man den eldste *viste* raden i stedet, blir system-meldinger som ligger foran
 * den hentet om igjen i hver runde — de fyller slots i sida og filtreres bort, og en side
 * som bare inneholder system-meldinger stopper pagineringen helt.
 */
export function oldestCursor(rows: ThreadRow[]): string | null {
	return rows[0]?.timestamp ?? null;
}

/** Prepend uten duplikater: rader vi alt har vist skal ikke inn en gang til. */
export function dedupePrepend(existing: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
	const seen = new Set(existing.map((m) => m.id));
	return incoming.filter((m) => !seen.has(m.id));
}
