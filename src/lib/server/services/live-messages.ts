/**
 * Ren validerings- og normaliseringslogikk for live-meldinger (retur-kanalen på
 * delt posisjon). Holdes DB-fri slik at den kan enhetstestes uten mocking.
 */

export const MAX_SENDER_LEN = 40;
export const MAX_TEXT_LEN = 280;

// Retning på en melding. Seer→løper leses opp av Ekko; løper→seer vises på dele-siden.
export const DIRECTION_VIEWER_TO_RUNNER = 'viewer_to_runner';
export const DIRECTION_RUNNER_TO_VIEWER = 'runner_to_viewer';
export type MessageDirection = typeof DIRECTION_VIEWER_TO_RUNNER | typeof DIRECTION_RUNNER_TO_VIEWER;

// Rate-limit: alle med dele-lenken kan skrive, så vi beskytter mot spam ved å
// begrense antall meldinger per økt innenfor et tidsvindu.
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_MAX_PER_WINDOW = 12;

export interface RawMessageInput {
	sender?: unknown;
	text?: unknown;
}

export interface NormalizedMessage {
	sender: string | null;
	text: string;
}

export type MessageValidation =
	| { ok: true; value: NormalizedMessage }
	| { ok: false; error: string };

/**
 * Normaliserer avsendernavn: trimmer, kapper til MAX_SENDER_LEN, tomt → null.
 */
export function normalizeSender(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	return trimmed.slice(0, MAX_SENDER_LEN);
}

/**
 * Validerer og normaliserer en innkommende melding. Kapper `text` defensivt slik
 * at lange meldinger ikke avvises, men kuttes (appen leser dem uansett opp).
 */
export function validateMessageInput(input: RawMessageInput): MessageValidation {
	if (typeof input.text !== 'string') {
		return { ok: false, error: 'text er påkrevd' };
	}
	const text = input.text.trim().slice(0, MAX_TEXT_LEN);
	if (!text) {
		return { ok: false, error: 'text kan ikke være tom' };
	}
	return {
		ok: true,
		value: {
			sender: normalizeSender(input.sender),
			text
		}
	};
}

/**
 * Parser `after`-markøren (seq som streng) til et tall. Ugyldig/utelatt → null
 * (= hent alt fra start). Negativt/NaN behandles som null.
 */
export function parseAfterMarker(raw: string | null | undefined): number | null {
	if (raw == null || raw === '') return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return null;
	return Math.floor(n);
}
