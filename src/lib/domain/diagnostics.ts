/**
 * Hva et ÅPENT driftsdiagnose-API får si.
 *
 * ## Hvorfor dette er et eget, testet lag
 *
 * `/api/diagnostikk` er uautentisert med vilje: en Claude-økt eller en
 * vakthund skal kunne svare på «hva skjedde kl. 12:48» uten en hemmelighet å
 * oppbevare. Prisen er at ALT som slipper ut herfra er offentlig for alltid,
 * så utvelgelsen fortjener tester framfor å ligge inline i et endepunkt — samme
 * begrunnelse som `public-paths.ts`.
 *
 * ## Regelen: hvitelist felt, aldri svartelist dem
 *
 * `toPublicCronRun` BYGGER et nytt objekt av fire navngitte felt. Den gjør
 * ikke `delete rad.error`, og den sprer ikke `...rad`. Forskjellen er hele
 * garantien: en spread lekker hvert felt noen legger til i `cron_executions`
 * senere, uten at noen ser det. Med en hviteliste må et nytt felt legges til
 * her, av noen som leser denne kommentaren.
 *
 * To felt er konkret farlige, og de er grunnen til at regelen er skrevet ned:
 *
 * - **`error`** er rå fritekst fra en exception. Den bærer stier, id-er og
 *   det som måtte stå i en melding fra et tredjeparts-API.
 * - **`resultSummary`** er verre, fordi den ser harmløs ut. SB1-synken legger
 *   `accountNames` der — altså brukerens kontonavn. Et «sammendrag» er ikke
 *   et aggregat; det er hva endepunktet returnerte.
 *
 * Det som ER trygt: `jobPath` (et internt rutenavn), `status` (lukket
 * vokabular), `durationMs` og tidspunktet. Til sammen svarer de på «hvilken
 * jobb brukte unormalt lang tid, og når» — som er hele spørsmålet.
 */

/** Statusene `withCronTracking` skriver. Lukket vokabular, trygt å vise. */
export type CronRunStatus = 'success' | 'partial' | 'error';

/** En rad slik den ligger i `cron_executions`. */
export interface CronExecutionRow {
	jobPath: string;
	status: string;
	durationMs: number | null;
	executedAt: Date;
	/** Rå feiltekst. Slipper ALDRI ut herfra. */
	error?: string | null;
	/** Endepunktets returverdi. Kan bære brukerdata. Slipper ALDRI ut herfra. */
	resultSummary?: Record<string, unknown> | null;
}

/** En rad slik omverdenen får se den. */
export interface PublicCronRun {
	path: string;
	status: string;
	durationMs: number | null;
	executedAt: string;
	/**
	 * At kjøringen feilet, uten å si hvordan. Den som trenger meldingen må
	 * gjennom `/api/admin/logs` eller `/api/health` med `CRON_SECRET`.
	 */
	failed: boolean;
}

/**
 * Vindusgrenser.
 *
 * Taket finnes fordi et uautentisert endepunkt uten grense er en gratis
 * tabelldump: `cron_executions` vokser med ~630 rader i døgnet, og hele
 * historikken i ett kall er både en lekkasje av bruksmønster og en spørring
 * noen kan gjenta.
 */
export const DEFAULT_WINDOW_MINUTES = 60;
export const MAX_WINDOW_MINUTES = 1440; // et døgn
export const MAX_ROWS = 500;

export interface DiagnosticsWindow {
	fromMs: number;
	toMs: number;
	minutes: number;
	/** `true` når det brukeren ba om ble kappet — sies i svaret, ikke skjult. */
	clamped: boolean;
}

/**
 * Slakk på den øvre grensa når kalleren IKKE oppgav `until`.
 *
 * Vinduet beregnes i Node (`Date.now()`), men radene stemples av Postgres
 * (`now()`). Uten slakk faller en rad skrevet et øyeblikk senere utenfor, og
 * «siste time» mangler den ferskeste målingen — som er den man oftest er ute
 * etter. Fanget av en flakete test på egen kode: 25 skrevne rader ble lest som
 * 24, og den som forsvant var den nyeste.
 *
 * Gjelder BARE den implisitte «nå». Et eksplisitt `until` er et historisk
 * spørsmål og må være reproduserbart, så det respekteres presis.
 */
export const NOW_SLACK_MS = 5_000;

/**
 * Vinduet å hente kjøringer for.
 *
 * `minutes` teller bakover fra `until` (default nå), slik at «hva skjedde
 * 12:48 i går» blir `?until=2026-09-03T13:00:00Z&minutes=30`. Et rent
 * `?minutes=` alene dekker det ferske tilfellet.
 *
 * Ugyldige verdier faller til defaulten framfor å gi 400: dette er et
 * diagnoseverktøy man skriver for hånd i en adresselinje, og en 400 på en
 * skrivefeil er en dårligere handel enn et fornuftig vindu.
 */
export function resolveDiagnosticsWindow(
	params: { minutes?: string | null; until?: string | null },
	now: Date = new Date()
): DiagnosticsWindow {
	const explicitUntil = parseIso(params.until);
	const anchorMs = explicitUntil ?? now.getTime();

	const requested = Number.parseInt(params.minutes ?? '', 10);
	const valid = Number.isFinite(requested) && requested > 0;
	const minutes = valid ? Math.min(requested, MAX_WINDOW_MINUTES) : DEFAULT_WINDOW_MINUTES;

	return {
		// Vindulengden måles fra ankeret, så «60 minutter» er 60 minutter
		// uansett om den øvre grensa har slakk.
		fromMs: anchorMs - minutes * 60_000,
		toMs: explicitUntil == null ? anchorMs + NOW_SLACK_MS : explicitUntil,
		minutes,
		clamped: valid && requested > MAX_WINDOW_MINUTES
	};
}

/** `null` for manglende eller utolkbar verdi — kalleren avgjør fallbacken. */
function parseIso(value: string | null | undefined): number | null {
	if (!value) return null;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Én rad, redusert til det offentlige.
 *
 * NB: bygget felt for felt. Se modulkommentaren for hvorfor det ikke er en
 * spread med sletting.
 */
export function toPublicCronRun(row: CronExecutionRow): PublicCronRun {
	return {
		path: row.jobPath,
		status: row.status,
		durationMs: row.durationMs,
		executedAt: row.executedAt.toISOString(),
		failed: row.status !== 'success'
	};
}

export interface CronRunSummary {
	total: number;
	byStatus: Record<string, number>;
	/** Tregeste kjøringer først — det er dem man leter etter i en CPU-topp. */
	slowest: PublicCronRun[];
	totalDurationMs: number;
}

/**
 * Sammendraget som gjør vinduet lesbart uten å scrolle gjennom radene.
 *
 * `slowest` er poenget: en boks som pegger CPU har som regel én jobb som
 * skiller seg ut, og den skal stå øverst framfor å måtte finnes.
 */
export function summarizeCronRuns(runs: PublicCronRun[], topN = 5): CronRunSummary {
	const byStatus: Record<string, number> = {};
	let totalDurationMs = 0;

	for (const run of runs) {
		byStatus[run.status] = (byStatus[run.status] ?? 0) + 1;
		totalDurationMs += run.durationMs ?? 0;
	}

	const slowest = [...runs]
		.filter((r) => r.durationMs != null)
		.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
		.slice(0, topN);

	return { total: runs.length, byStatus, slowest, totalDurationMs };
}

/**
 * Jobbkøen som TELLINGER per status.
 *
 * Aldri rader: `background_jobs` har både `payload`, `result` og `error`, og
 * en jobbtype alene («batch:sparebank1_backfill») er grensa for hva som er
 * greit å si høyt. Tellingen svarer på «står det noe fast», som er det
 * spørsmålet et åpent API skal kunne svare på.
 */
export function summarizeJobCounts(rows: { status: string; count: number }[]): {
	byStatus: Record<string, number>;
	total: number;
} {
	const byStatus: Record<string, number> = {};
	let total = 0;
	for (const row of rows) {
		byStatus[row.status] = (byStatus[row.status] ?? 0) + row.count;
		total += row.count;
	}
	return { byStatus, total };
}
