/**
 * Jobbrader i det åpne diagnose-API-et.
 *
 * ## Hvorfor rader her, men bare tellinger for et døgn siden
 *
 * Første utgave ga `background_jobs` som tellinger per status, med
 * begrunnelsen «en jobbtype er grensa for hva som er greit å si høyt». Den var
 * for stram, og den kostet: `running: 13` fortalte at tretten jobber sto fast
 * uten å si hvilke eller hvor lenge, altså nettopp det man trenger.
 *
 * Typenavnene er sjekket, og de er MASKINNAVN — `sparebank1_historical_sync`,
 * `checklist_autocheck`, `workout_projection_refresh`, `goal_intent_parse`.
 * Ingen av dem bærer brukerdata. Det samme gjelder tellere, tidsstempler og
 * `lockedBy` (`worker-<pid>-<base36>`).
 *
 * ## Det som fortsatt ikke slipper ut
 *
 * `payload`, `result`, `error` og `userId`. De tre første er vilkårlig JSON og
 * fritekst — en `sparebank1_historical_sync` har datoer og kontoreferanser i
 * payloaden. Hvitelisten gjelder som før: bygg objektet felt for felt, aldri
 * en spread med sletting.
 */

/** En rad slik den ligger i `background_jobs`. */
export interface BackgroundJobRow {
	type: string;
	status: string;
	attempts: number;
	maxAttempts: number;
	runAt: Date | null;
	startedAt: Date | null;
	lockedAt: Date | null;
	lockedBy: string | null;
	createdAt: Date | null;
	/** Slipper ALDRI ut. Deklarert for å gjøre utelatelsen synlig. */
	payload?: unknown;
	result?: unknown;
	error?: string | null;
	userId?: string | null;
}

export interface PublicJob {
	type: string;
	status: string;
	attempts: number;
	maxAttempts: number;
	runAt: string | null;
	startedAt: string | null;
	lockedBy: string | null;
	createdAt: string | null;
	/** Minutter siden jobben ble plukket opp. Null når den ikke er startet. */
	runningForMinutes: number | null;
	/** `true` når den har stått i `running` lenger enn en jobb rimeligvis tar. */
	stuck: boolean;
}

/**
 * Hvor lenge en `running`-jobb får stå før den regnes som fastlåst.
 *
 * En container redeployes ved hver push, og en worker som dør midt i en jobb
 * etterlater raden låst — det er den vanligste måten å havne her på. Terskelen
 * er romslig fordi en ekte backfill kan ta lang tid; poenget er å skille «kjører
 * nå» fra «ingen kommer til å fullføre denne».
 */
export const STUCK_AFTER_MINUTES = 30;

function iso(d: Date | null | undefined): string | null {
	return d ? d.toISOString() : null;
}

export function toPublicJob(row: BackgroundJobRow, now: Date = new Date()): PublicJob {
	const startedAt = row.startedAt ?? row.lockedAt ?? null;
	const runningForMinutes =
		row.status === 'running' && startedAt
			? Math.max(0, Math.round((now.getTime() - startedAt.getTime()) / 60_000))
			: null;

	return {
		type: row.type,
		status: row.status,
		attempts: row.attempts,
		maxAttempts: row.maxAttempts,
		runAt: iso(row.runAt),
		startedAt: iso(startedAt),
		lockedBy: row.lockedBy ?? null,
		createdAt: iso(row.createdAt),
		runningForMinutes,
		stuck: runningForMinutes != null && runningForMinutes >= STUCK_AFTER_MINUTES
	};
}

/**
 * Feiltekst, redusert til noe som kan stå offentlig.
 *
 * ## Hvorfor rå feiltekst IKKE kan åpnes
 *
 * Postgres bygger VERDIEN inn i meldingen ved brudd på en unik constraint:
 * `Key (email)=(navn@example.com) already exists`. Skjemaet har unike
 * constraints på `email` og på `(userId, domain, fingerprint)`, så en
 * kollisjon lekker en e-postadresse eller et transaksjonsfingeravtrykk ordrett.
 * Tredjeparts-API-er er like ille: en SB1-feil kan bære en URL med kontoreferanse.
 *
 * ## Hva denne gjør, og hva den ikke lover
 *
 * Den fjerner de KJENTE formene: parentesverdier etter `Key (...)=`, e-poster,
 * lange sifferrekker, URL-spørrestrenger og alt etter `DETAIL:`. Så kapper den.
 *
 * **Dette er ikke en garanti.** En redaktør er en denylist, og denylister
 * lekker — et norsk kontonavn i klartekst har ingen form å kjenne igjen. Derfor
 * er redigert feiltekst gatet bak `DIAGNOSTICS_OPEN_ERRORS`, og gaten står AV
 * som standard. Fingeravtrykket under er det trygge alternativet.
 */
export function redactErrorText(raw: string, maxLength = 200): string {
	let s = raw;

	// Postgres: `Key (kolonne)=(verdi)` — verdien er brukerdata.
	s = s.replace(/Key \(([^)]*)\)=\([^)]*\)/g, 'Key ($1)=(<redigert>)');
	// Alt etter DETAIL:/HINT: er ofte radinnhold.
	s = s.replace(/\b(DETAIL|HINT):[\s\S]*/g, '$1: <redigert>');
	// E-poster.
	s = s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<e-post>');
	// URL-spørrestrenger kan bære tokens og id-er.
	s = s.replace(/(https?:\/\/[^\s?]+)\?[^\s]*/g, '$1?<redigert>');
	// Sifferrekker på fire eller mer: kontonummer, id-er, beløp i øre.
	s = s.replace(/\d{4,}/g, '<tall>');

	const firstLine = s.split('\n')[0].trim();
	return firstLine.length > maxLength ? firstLine.slice(0, maxLength) + '…' : firstLine;
}

/**
 * Stabilt fingeravtrykk av en feiltekst, uten å røpe innholdet.
 *
 * Svarer på «er dette den samme feilen som sist?» — som er det man oftest
 * trenger — og er trygt uansett hva meldingen inneholder. Derfor er det ALLTID
 * med, også når redigert tekst er skrudd av.
 *
 * Ikke kryptografisk; den skal bare være stabil og kort. FNV-1a.
 */
export function errorFingerprint(raw: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < raw.length; i++) {
		h ^= raw.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h.toString(16).padStart(8, '0');
}

export interface PublicError {
	fingerprint: string;
	length: number;
	/** Bare når `DIAGNOSTICS_OPEN_ERRORS` er på. Se `redactErrorText`. */
	redacted?: string;
}

export function toPublicError(raw: string | null | undefined, includeText: boolean): PublicError | null {
	if (!raw) return null;
	const out: PublicError = { fingerprint: errorFingerprint(raw), length: raw.length };
	if (includeText) out.redacted = redactErrorText(raw);
	return out;
}
