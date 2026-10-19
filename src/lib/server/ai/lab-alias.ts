/**
 * Svarene fra Stemmegaffels aliaser (`GET /api/v1/aliaser/{navn}`), holdt i
 * prosessen. Delt av tekstaliasene (`model-alias.ts`) og Live-modellen
 * (`integrations/gemini-live.ts`), så alle har samme minne og samme tidsgrenser.
 *
 * Laben står ALDRI i den kritiske stien: `STEMMEGAFFEL_URL` er bryteren, svaret
 * fornyes hvert kvarter i bakgrunnen, og bare første kall venter – høyst
 * `FETCH_TIMEOUT_MS`.
 */
import { env } from '$env/dynamic/private';

const REFRESH_MS = 15 * 60_000;
const FETCH_TIMEOUT_MS = 1500;

interface Entry {
	/** Siste brukbare svar fra laben, lest av aliasets egen parser. */
	payload: unknown;
	reason: string;
	fetchedAt: number;
	pending: Promise<void> | null;
	/** Modellen vi sist logget at aliaset ga, så et bytte sies én gang. */
	logged: string | null;
}

const cache = new Map<string, Entry>();

function baseUrl(): string | null {
	const url = env.STEMMEGAFFEL_URL?.trim();
	return url ? url.replace(/\/+$/, '') : null;
}

async function refresh<T>(alias: string, entry: Entry, base: string, parse: (raw: unknown) => T | null): Promise<void> {
	try {
		const res = await fetch(`${base}/api/v1/aliaser/${alias}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) {
			entry.reason = `laben svarte ${res.status}`;
		} else {
			const payload = parse(await res.json());
			// Et ubrukelig svar visker ikke ut et godt vi har fra før.
			if (payload) entry.payload = payload;
			entry.reason = payload ? '' : 'laben svarte i en form vi ikke kjenner';
		}
	} catch (err) {
		entry.reason = `laben svarte ikke (${err instanceof Error ? err.name : 'ukjent feil'})`;
	} finally {
		entry.fetchedAt = Date.now();
		entry.pending = null;
	}
}

function entryFor(alias: string): Entry {
	let entry = cache.get(alias);
	if (!entry) {
		entry = { payload: null, reason: '', fetchedAt: 0, pending: null, logged: null };
		cache.set(alias, entry);
	}
	return entry;
}

/**
 * Svaret laben har for et alias, lest av `parse`, med samme minne og samme
 * tidsgrenser for alle aliasene. `payload` er `null` med en grunn når laben ikke
 * er satt opp, ikke svarer eller svarer i en form vi ikke kjenner. Kaster aldri.
 */
export async function labAliasPayload<T>(alias: string, parse: (raw: unknown) => T | null): Promise<{ payload: T | null; reason: string }> {
	const base = baseUrl();
	if (!base) return { payload: null, reason: 'STEMMEGAFFEL_URL er ikke satt' };
	const entry = entryFor(alias);
	if (!entry.pending && Date.now() - entry.fetchedAt > REFRESH_MS) {
		entry.pending = refresh(alias, entry, base, parse);
	}
	// Bare første gang venter vi; senere fornyes svaret mens det gamle brukes.
	if (entry.fetchedAt === 0 && entry.pending) await entry.pending;
	return { payload: (entry.payload as T | null) ?? null, reason: entry.reason };
}

/** Logger det aliaset ga, én gang per endring. */
export function logAliasChoice(alias: string, label: string, line: string): void {
	const entry = entryFor(alias);
	if (entry.logged === label) return;
	entry.logged = label;
	console.log(line);
}

/** Bare for tester: tøm minnet mellom tilfeller. */
export function _resetLabAliasCache(): void {
	cache.clear();
}
