/**
 * Fasemåling for chat-pipelinen — én søkbar logglinje per melding.
 *
 * Finnes fordi kontekstbyggingen i `/api/chat` er mange uavhengige hentinger
 * (minne, person, mål, helsebriefing, …), og «hva koster en melding» var
 * ubesvarbart uten å gjette. Søk etter `[chat-perf]` i loggen.
 *
 * Lesenøkkel: fasene i parallellbatchen overlapper, så `sum` er samlet
 * DB-arbeid mens `wall` er tiden brukeren ventet. `wall` langt under `sum`
 * betyr at parallelliseringen gjør jobben sin; `wall` ≈ største enkeltfase
 * betyr at neste forbedring er å gjøre nettopp den fasen billigere.
 */

export type PhaseSample = { name: string; ms: number };

export type ChatPerf = {
	phases: PhaseSample[];
	timed<T>(name: string, fn: () => Promise<T>): Promise<T>;
	wallMs(): number;
};

export function createChatPerf(now: () => number = () => performance.now()): ChatPerf {
	const phases: PhaseSample[] = [];
	const startedAt = now();
	return {
		phases,
		async timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
			const t0 = now();
			try {
				return await fn();
			} finally {
				phases.push({ name, ms: Math.round(now() - t0) });
			}
		},
		wallMs() {
			return Math.round(now() - startedAt);
		}
	};
}

/** Én linje, tyngste fase først — den man skal se på står da alltid samme sted. */
export function formatChatPerfLine(input: { wallMs: number; phases: PhaseSample[] }): string {
	const sum = input.phases.reduce((acc, p) => acc + p.ms, 0);
	const parts = [...input.phases]
		.sort((a, b) => b.ms - a.ms)
		.map((p) => `${p.name}=${p.ms}ms`);
	return `[chat-perf] kontekst wall=${input.wallMs}ms sum=${sum}ms ${parts.join(' ')}`;
}
