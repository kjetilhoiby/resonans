/**
 * Validering av stemmeturer fra Ekkos Live-samtale — tråd-foreningen i fase 2
 * (`resonans-lab/ekko/GEMINI_LIVE_VOICE_BRIEF.md` §6).
 *
 * Live-samtalen skjer app↔Google direkte; serveren ser aldri lyden. Skal SSE-hjernen
 * huske hva som ble sagt, må appen POSTE de monterte turene hit etterpå. Turene blir
 * vanlige `messages`-rader i assistent-tråden og lastes inn i neste SSE-kall som all
 * annen historikk — de RE-SPILLES aldri (ingen generering trigges av innsending).
 *
 * Ren og testet: parsing/grensene her, DB-skrivingen i endepunktet.
 */

export interface VoiceTurn {
	role: 'user' | 'assistant';
	text: string;
}

export interface ParsedVoiceTurns {
	turns: VoiceTurn[];
}

export class VoiceTurnValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'VoiceTurnValidationError';
	}
}

/**
 * Tak per innsending. En flush per tur-slutt gir 1–2 turer; taket finnes for en klient i
 * løkke, ikke for normal bruk. Over taket avvises hele batchen — en stille trunkering
 * ville sett ut som at alt ble husket.
 */
export const MAX_TURNS_PER_BATCH = 50;

/** Tak per tur. Live-transkripter er talte setninger; 8k tegn er en feil, ikke en tale. */
export const MAX_TURN_TEXT_LENGTH = 8000;

/**
 * Kaster `VoiceTurnValidationError` med en presis grunn framfor å returnere null —
 * konsekvensen skal sies, ikke oppdages (samme prinsipp som `extractApiErrorMessage`).
 *
 * `at` og `source` i kontrakten aksepteres men brukes ikke til noe ennå: lagrings-
 * rekkefølgen er batch-rekkefølgen, og `createdAt` settes av basen. Ukjente felter
 * er dermed ikke en feil — kontrakten kan vokse uten å knekke gamle klienter.
 */
export function parseVoiceTurns(payload: unknown): ParsedVoiceTurns {
	if (!payload || typeof payload !== 'object') {
		throw new VoiceTurnValidationError('Kroppen må være et JSON-objekt med «turns».');
	}
	const rawTurns = (payload as Record<string, unknown>).turns;
	if (!Array.isArray(rawTurns)) {
		throw new VoiceTurnValidationError('«turns» må være en liste.');
	}
	if (rawTurns.length === 0) {
		throw new VoiceTurnValidationError('«turns» er tom — ingenting å lagre.');
	}
	if (rawTurns.length > MAX_TURNS_PER_BATCH) {
		throw new VoiceTurnValidationError(
			`«turns» har ${rawTurns.length} elementer; taket er ${MAX_TURNS_PER_BATCH} per innsending.`
		);
	}

	const turns = rawTurns.map((raw, index): VoiceTurn => {
		if (!raw || typeof raw !== 'object') {
			throw new VoiceTurnValidationError(`Tur ${index} er ikke et objekt.`);
		}
		const row = raw as Record<string, unknown>;
		const role = row.role;
		if (role !== 'user' && role !== 'assistant') {
			// `system` avvises med vilje: systemnotiser er klientens egne og skal aldri
			// bli en del av modellens hukommelse.
			throw new VoiceTurnValidationError(
				`Tur ${index} har ukjent rolle «${String(role)}» — bare «user» og «assistant» lagres.`
			);
		}
		const text = typeof row.text === 'string' ? row.text.trim() : '';
		if (!text) {
			throw new VoiceTurnValidationError(`Tur ${index} mangler tekst.`);
		}
		if (text.length > MAX_TURN_TEXT_LENGTH) {
			throw new VoiceTurnValidationError(
				`Tur ${index} er ${text.length} tegn; taket er ${MAX_TURN_TEXT_LENGTH}.`
			);
		}
		return { role, text };
	});

	return { turns };
}
