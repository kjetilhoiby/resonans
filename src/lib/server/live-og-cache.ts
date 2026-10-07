import { renderLiveSessionOgPng, type LiveOgSession } from '$lib/server/live-og';

/**
 * Forhåndsbildet til delt posisjon, ferdig i minnet FØR noen spør etter det.
 *
 * Messenger (og de andre meldingsappene) henter og:image i det lenka sendes —
 * altså sekunder etter at Ekko har startet delingen — og gir opp hvis bildet
 * kommer for sent. Da lagres kortet UTEN bilde, og det blir stående. Å tegne
 * bildet tok 2,5–3,5 s i prod (målt 7. oktober 2026: vektorflisene hentes og
 * tegnes på nytt for hver henting), og den første delte lenka fikk ikke bilde.
 *
 * Derfor:
 * - **Bildet lages i bakgrunnen** når delingen starter og når første posisjon
 *   kommer (`prewarmLiveSessionOg`), så crawlerens henting er et oppslag.
 * - **Et bilde som er litt gammelt leveres med det samme** og fornyes i
 *   bakgrunnen (`ogCacheDecision`). Et forhåndsbilde er et øyeblikksbilde; et
 *   minutt gammel posisjon i det er riktig nok, et manglende bilde er det ikke.
 * - **Taket er lite og fast** (`MAX_ENTRIES`). Containeren har vært OOM-drept før;
 *   en cache uten grense er en lekkasje med god samvittighet.
 *
 * Per instans og flyktig, som loggbufferen. Under rullende oppdatering kan
 * crawleren treffe en instans uten bildet; da tegnes det som før.
 */

const MAX_ENTRIES = 40;
/** Yngre enn dette: levér uten videre. */
export const FRESH_MS = 60_000;
/** Eldre enn dette: tegn på nytt før svar — posisjonen kan være langt unna. */
export const MAX_STALE_MS = 15 * 60_000;

type Entry = { png: Uint8Array; renderedAt: number; withPosition: boolean };

const entries = new Map<string, Entry>();
const inflight = new Map<string, Promise<Uint8Array>>();

export type OgCacheDecision = 'fresh' | 'stale' | 'miss';

/**
 * `fresh`: levér. `stale`: levér, og forny i bakgrunnen. `miss`: tegn nå.
 * Et avsluttet forløp har et bilde som ikke endrer seg — det er alltid ferskt
 * hvis det ble tegnet etter at forløpet sluttet.
 */
export function ogCacheDecision(
	entry: { renderedAt: number } | undefined,
	now: number,
	endedAt: number | null
): OgCacheDecision {
	if (!entry) return 'miss';
	if (endedAt !== null) return entry.renderedAt >= endedAt ? 'fresh' : 'miss';
	const age = now - entry.renderedAt;
	if (age < FRESH_MS) return 'fresh';
	if (age < MAX_STALE_MS) return 'stale';
	return 'miss';
}

function render(key: string, session: LiveOgSession): Promise<Uint8Array> {
	const running = inflight.get(key);
	if (running) return running;
	const job = renderLiveSessionOgPng(session)
		.then((png) => {
			entries.delete(key);
			entries.set(key, { png, renderedAt: Date.now(), withPosition: session.lastLat !== null });
			while (entries.size > MAX_ENTRIES) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
			return png;
		})
		.finally(() => inflight.delete(key));
	inflight.set(key, job);
	return job;
}

/** Bildet for en live-sesjon; `key` er sesjonens id. */
export async function liveSessionOgPng(
	key: string,
	session: LiveOgSession & { endedAt: Date | null }
): Promise<Uint8Array> {
	const entry = entries.get(key);
	const decision = ogCacheDecision(entry, Date.now(), session.endedAt?.getTime() ?? null);
	if (entry && decision === 'fresh') return entry.png;
	if (entry && decision === 'stale') {
		void render(key, session).catch((err) => console.error('[live-og] fornying feilet', err));
		return entry.png;
	}
	return render(key, session);
}

/** Tegn i bakgrunnen, så crawlerens første henting er et oppslag. Kaster aldri. */
export function prewarmLiveSessionOg(key: string, session: LiveOgSession): void {
	void render(key, session).catch((err) => console.error('[live-og] forhåndstegning feilet', err));
}

/** Så lenge etter start holdes bildet ferskt fra posisjonspingene — det er da lenka deles. */
export const PREWARM_WINDOW_MS = 5 * 60_000;

/**
 * Kalles ved hver posisjonsping. Tegner bare i de første minuttene (da lenka
 * typisk deles og hentes) og bare når bildet ikke alt er ferskt — resten av
 * turen fornyes bildet først når noen faktisk spør.
 */
export function prewarmOnPing(key: string, session: LiveOgSession, startedAt: Date): void {
	const now = Date.now();
	if (now - startedAt.getTime() > PREWARM_WINDOW_MS) return;
	const entry = entries.get(key);
	// Bildet fra oppstarten har ingen prikk; første posisjon er grunn nok alene.
	const gainedPosition = entry !== undefined && !entry.withPosition && session.lastLat !== null;
	if (!gainedPosition && ogCacheDecision(entry, now, null) === 'fresh') return;
	prewarmLiveSessionOg(key, session);
}
