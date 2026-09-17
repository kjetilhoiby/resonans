/**
 * Formen et arrangement har når det forlater serveren.
 *
 * Bor i domenelaget og ikke hos lagringen fordi FLATEN trenger den, og
 * `$lib/server/*` kan ikke importeres fra klientkode — heller ikke som en ren
 * type, siden SvelteKits importvakt ser på modulgrafen og ikke på om
 * kompilatoren fjerner importen etterpå.
 */

import type { EventPrepItem, EventTicketFile } from '$lib/db/schema';

/**
 * En billettfil med ferdig utledede visnings-URL-er.
 *
 * `url` er originalen (full oppløsning, urørt). `thumbUrl` og `fullUrl` bygges
 * på serveren av `ticket-upload.ts`, siden Cloudinary-URL-er krever konfigurert
 * SDK — flaten skal ikke sette sammen transformasjonsstrenger selv.
 */
export interface ViewableTicket extends EventTicketFile {
	thumbUrl: string;
	fullUrl: string;
}

export interface EventRecord {
	id: string;
	title: string;
	kind: string | null;
	/** Oslo-dato, `YYYY-MM-DD`. Aldri et tidsstempel — se `events` i schema.ts. */
	eventDate: string;
	endDate: string | null;
	/** `HH:MM` Oslo-veggklokke, eller null når tidspunktet er ukjent. */
	startTime: string | null;
	doorsTime: string | null;
	venue: string | null;
	address: string | null;
	entrance: string | null;
	seat: string | null;
	ticketCount: number | null;
	bookingReference: string | null;
	notes: string | null;
	/** Lenke til billetten hos utstederen. Alltid http(s) — se `normalizeUrl`. */
	ticketUrl: string | null;
	tickets: ViewableTicket[];
	prep: EventPrepItem[];
	extractionSource: string | null;
	themeId: string | null;
	status: string;
	createdAt: string;
}
