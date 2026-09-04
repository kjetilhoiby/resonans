/**
 * Fra én logglinje per melding til et svar på «hva skal vi cache».
 *
 * ## Hvorfor aggregering, og ikke bare logglinja
 *
 * `[chat-perf]` har logget én linje per melding siden 2. september 2026, og
 * den er riktig for å se på ÉN melding. Men spørsmålet som faktisk står — hvor
 * går tida i chat-pipelinen, og hva er verdt å cache — besvares av fordelingen
 * over mange meldinger. En enkelt linje kan være et uhell; medianen kan ikke.
 *
 * Målingen lagres derfor, ikke bare logges. Ringbufferen tømmes ved restart,
 * og restart er hyppig (hver push) — så den evige logglinja var i praksis et
 * vindu på noen timer, som krevde admin-secret å lese.
 *
 * ## PERSENTILER, aldri snitt
 *
 * Samme lærdom som `worst` i `host-metrics.ts`, og den er dyrekjøpt: Coolifys
 * minnegraf viste 78 % under en hendelse der OOM-killeren fyrte tre ganger,
 * fordi den glattet. Et snitt over chat-målinger ville skjult nøyaktig den
 * halen brukeren faktisk kjenner.
 *
 * Per fase gir MEDIANEN normalkostnaden — det er den en cache fjerner — og
 * MAKS det verste tilfellet. En fase med lav median og høy maks er et annet
 * problem enn en med høy median: den første er en utligger å forstå, den andre
 * er arbeid å fjerne.
 *
 * ## `wall` mot `sum` er parallelliseringens helse
 *
 * Fasene i parallellbatchen overlapper, så `sum` er samlet DB-arbeid mens
 * `wall` er tiden brukeren ventet. `wall` langt under `sum` betyr at
 * parallelliseringen gjør jobben sin. `wall` ≈ største enkeltfase betyr at
 * neste forbedring er å gjøre nettopp den fasen billigere — og DA er en cache
 * det riktige grepet.
 */

export interface PhaseSample {
	name: string;
	ms: number;
}

export interface ChatPerfSample {
	wallMs: number;
	phases: PhaseSample[];
}

/**
 * Fasene slik de kommer ut av jsonb, formet gjennom en hviteliste.
 *
 * Navnene er kode-literaler (`perf.timed('helsebriefing', …)`), så de bærer
 * ingen brukerdata — men kolonnen er en generell jsonb-beholder, og et lagret
 * felt noen legger til senere skal ikke følge med ut av seg selv. Samme regel
 * som `toPublicCronRun`: bygg objektet felt for felt.
 */
export function parsePhases(raw: unknown): PhaseSample[] {
	if (!Array.isArray(raw)) return [];
	const out: PhaseSample[] = [];
	for (const item of raw) {
		if (!item || typeof item !== 'object') continue;
		const { name, ms } = item as Record<string, unknown>;
		if (typeof name !== 'string' || typeof ms !== 'number' || !Number.isFinite(ms)) continue;
		out.push({ name, ms });
	}
	return out;
}

/**
 * Nærmeste-rang-persentil.
 *
 * Ikke interpolerende: med få målinger er en interpolert verdi et tall som
 * ikke ble målt, og det er verre enn et som ble. `p(1)` er derfor alltid en
 * ekte observasjon.
 */
export function percentile(sorted: number[], p: number): number | null {
	if (sorted.length === 0) return null;
	const rank = Math.ceil(p * sorted.length);
	return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

export interface PhaseStats {
	name: string;
	/** Hvor mange meldinger fasen ble målt i. */
	samples: number;
	medianMs: number;
	p95Ms: number;
	maxMs: number;
}

export interface ChatPerfStats {
	samples: number;
	wall: { medianMs: number; p95Ms: number; maxMs: number } | null;
	/** Samlet DB-arbeid per melding — median. */
	sumMedianMs: number | null;
	/**
	 * `wall / sum` ved medianen. Lavt tall = parallelliseringen virker.
	 * Nær 1 = fasene kjører i praksis etter hverandre.
	 */
	parallelismRatio: number | null;
	/** Tyngste fase først — den man skal se på står da alltid samme sted. */
	phases: PhaseStats[];
	/** Hva tallene betyr, med forbeholdene. */
	summary: string;
}

/**
 * Under dette er utvalget for lite til å si noe om en median.
 *
 * Samme begrunnelse som `MIN_OBSERVATIONS` i sultprediksjonen: en median av
 * tre målinger er en gjetning med selvtillit, og et cache-grep tatt på den
 * kan fjerne arbeid som ikke var problemet.
 */
export const MIN_SAMPLES_FOR_VERDICT = 20;

/** Over dette er en fase verdt å se på uansett hva resten gjør. */
export const SLOW_PHASE_MS = 300;

export function summarizeChatPerf(samples: ChatPerfSample[]): ChatPerfStats {
	if (samples.length === 0) {
		return {
			samples: 0,
			wall: null,
			sumMedianMs: null,
			parallelismRatio: null,
			phases: [],
			summary: 'Ingen målinger i vinduet.'
		};
	}

	const walls = samples.map((s) => s.wallMs).sort((a, b) => a - b);
	const sums = samples
		.map((s) => s.phases.reduce((acc, p) => acc + p.ms, 0))
		.sort((a, b) => a - b);

	const byName = new Map<string, number[]>();
	for (const s of samples) {
		for (const p of s.phases) {
			const arr = byName.get(p.name);
			if (arr) arr.push(p.ms);
			else byName.set(p.name, [p.ms]);
		}
	}

	const phases: PhaseStats[] = [...byName.entries()]
		.map(([name, msList]) => {
			const sorted = [...msList].sort((a, b) => a - b);
			return {
				name,
				samples: sorted.length,
				medianMs: percentile(sorted, 0.5)!,
				p95Ms: percentile(sorted, 0.95)!,
				maxMs: sorted[sorted.length - 1]
			};
		})
		.sort((a, b) => b.medianMs - a.medianMs);

	const wallMedian = percentile(walls, 0.5)!;
	const sumMedian = percentile(sums, 0.5)!;
	const ratio = sumMedian > 0 ? wallMedian / sumMedian : null;

	return {
		samples: samples.length,
		wall: { medianMs: wallMedian, p95Ms: percentile(walls, 0.95)!, maxMs: walls[walls.length - 1] },
		sumMedianMs: sumMedian,
		parallelismRatio: ratio == null ? null : Math.round(ratio * 100) / 100,
		phases,
		summary: describe(samples.length, wallMedian, sumMedian, ratio, phases)
	};
}

function describe(
	n: number,
	wallMedian: number,
	sumMedian: number,
	ratio: number | null,
	phases: PhaseStats[]
): string {
	if (n < MIN_SAMPLES_FOR_VERDICT) {
		// Tallene sies, dommen holdes tilbake — som `describeWeeklyIntensity`.
		return (
			`${n} målinger: median ${wallMedian} ms ventetid, ${sumMedian} ms samlet arbeid. ` +
			`For få til å si noe om mønsteret (trengs ${MIN_SAMPLES_FOR_VERDICT}).`
		);
	}

	const parts = [`${n} målinger: median ${wallMedian} ms ventetid, ${sumMedian} ms samlet arbeid`];

	if (ratio != null && ratio < 0.6) {
		parts.push(`parallelliseringen virker (wall er ${Math.round(ratio * 100)} % av sum)`);
	} else if (ratio != null) {
		parts.push(
			`fasene kjører nærmest etter hverandre (wall er ${Math.round(ratio * 100)} % av sum) — ` +
				'se på om de faktisk startes parallelt før du cacher noe'
		);
	}

	const worst = phases[0];
	if (worst && worst.medianMs >= SLOW_PHASE_MS) {
		parts.push(
			`tyngste fase er «${worst.name}» med median ${worst.medianMs} ms ` +
				`(p95 ${worst.p95Ms}, maks ${worst.maxMs}) — der ligger gevinsten`
		);
	} else if (worst) {
		parts.push(
			`tyngste fase er «${worst.name}» med median ${worst.medianMs} ms, altså under ` +
				`${SLOW_PHASE_MS} ms: ingen fase peker seg ut som cache-kandidat`
		);
	}

	return parts.join('; ') + '.';
}
