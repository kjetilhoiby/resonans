/**
 * Berikelse av vektrader som ble skrevet før vi ba om kroppssammensetning.
 *
 * ## Hvorfor dette finnes
 *
 * Withings har 236 fettprosentmålinger for denne kontoen. Basen hadde 10.
 * Årsaken er ikke at synken lar være å hente dem — den ber om hele
 * `WITHINGS_BODY_MEASTYPES` — men at radene ble opprettet i en tidligere utgave
 * som bare ba om vekt, og at `conflictMode: 'ignore'` **aldri oppdaterer en rad
 * som finnes fra før**. Hver synk siden har hentet fettprosenten og kastet den,
 * fordi tidsstempelet allerede var kjent.
 *
 * Konsekvensen var ikke bare en tom kolonne: muskeltap-vakta i
 * `weight-milestones.ts` (`MUSCLE_SHARE_WARN`) avlyser feiringen når mer enn
 * halvparten av en nedgang er muskel. Med sammensetning på 10 av 1 378 rader har
 * den aldri fyrt. En vakt som er bygget, testet og stum er verre enn ingen vakt,
 * fordi den ser ut som dekning.
 *
 * ## Hvorfor det ikke bare er en full sync
 *
 * `?full=true` sletter alle Withings-hendelser for å kunne reimportere dem. Men
 * `hr_recovery` ligger under samme sensor, og den er selvhelende bare 21 dager
 * tilbake — all eldre pulsfallmåling ville vært borte for godt. Berikelsen retter
 * det som mangler og rører ikke resten.
 *
 * ## Reglene
 *
 * **Aldri fjerne, aldri overskrive.** Et felt som har en brukbar verdi står. Vi
 * fyller bare hull. Det gjør jobben trygg å kjøre om igjen, og det gjør at en
 * manuell retting i basen ikke blir spist av neste kjøring.
 *
 * Legacy-feltet `fatMass` (som er en PROSENT tross navnet) blir stående når vi
 * legger til `fatRatio` og `fatMassKg`. `normalizeBodyComposition` foretrekker
 * `fatRatio`, så den gamle verdien er uskadelig — og å slette den ville brutt
 * regelen over uten å vinne noe.
 */

/** Øvre grense for en menneskelig fettprosent, samme som i `body-composition`. */
const MAX_PLAUSIBLE_FAT_RATIO = 75;

/**
 * Feltene en berikelse kan fylle inn.
 *
 * `weight` står bevisst ikke på lista. Den finnes allerede på hver rad — det er
 * derfor raden finnes — og en berikelse som kunne skrive vekt ville kunne endre
 * selve målingen. Berikelsen skal utvide en måling, ikke revidere den.
 */
export const ENRICHABLE_FIELDS = [
	'fatRatio',
	'fatMassKg',
	'fatFreeMass',
	'muscleMass',
	'boneMass',
	'hydration',
	'restingHeartRate'
] as const;

export type EnrichableField = (typeof ENRICHABLE_FIELDS)[number];

export interface StoredWeightRow {
	id: string;
	/** Tidsstempelet raden ligger på, i millisekunder. */
	timestampMs: number;
	data: Record<string, unknown> | null;
}

export interface IncomingMeasurement {
	timestampMs: number;
	data: Record<string, unknown>;
}

export interface EnrichmentUpdate {
	id: string;
	/** Hele det nye `data`-objektet, klart til å skrives. */
	data: Record<string, unknown>;
	added: EnrichableField[];
}

export interface EnrichmentPlan {
	updates: EnrichmentUpdate[];
	/** Rader som allerede hadde alt målingen kunne gi. */
	alreadyComplete: number;
	/** Withings-målinger uten en lagret rad på samme tidsstempel. */
	unmatched: number;
	/** Lagrede rader Withings ikke leverte noe for i dette vinduet. */
	unvisited: number;
	/** Hvor mange ganger hvert felt ble fylt inn. */
	fieldCounts: Record<string, number>;
}

/**
 * En verdi teller som «finnes» bare når den er et brukbart tall.
 *
 * `0` behandles som fravær med vilje: ingen av disse feltene kan være null kilo
 * eller null prosent på et levende menneske, og Withings har historisk skrevet 0
 * der sensoren ikke fikk kontakt. Ville vi respektert en nulling, ville hullet
 * aldri blitt fylt.
 */
function present(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/** Godtar en innkommende verdi bare når den er innenfor det feltet kan bety. */
function plausible(field: EnrichableField, value: unknown): value is number {
	if (!present(value)) return false;
	if (field === 'fatRatio') return value < MAX_PLAUSIBLE_FAT_RATIO;
	return true;
}

/**
 * Hva én rad skal bli, gitt målingen Withings har for samme tidspunkt.
 *
 * Returnerer `null` når raden ikke skal røres. Det skillet er poenget: en jobb
 * som skriver alle rader «for sikkerhets skyld» kan ikke kjøres to ganger uten å
 * lyve om hvor mye den gjorde.
 */
export function decideEnrichment(
	existing: Record<string, unknown> | null,
	incoming: Record<string, unknown>
): { data: Record<string, unknown>; added: EnrichableField[] } | null {
	const base = existing ?? {};
	const added: EnrichableField[] = [];
	const next: Record<string, unknown> = { ...base };

	for (const field of ENRICHABLE_FIELDS) {
		if (present(base[field])) continue;
		if (!plausible(field, incoming[field])) continue;
		next[field] = incoming[field];
		added.push(field);
	}

	return added.length > 0 ? { data: next, added } : null;
}

/**
 * Hele planen, uten å røre en database.
 *
 * Matchingen er på **eksakt** tidsstempel. Begge sider stammer fra samme
 * `measuregrp.date`, så en bom betyr at noe annet er galt — og da skal den telles
 * i `unmatched` og bli synlig, ikke skjules av en toleranse som gjetter.
 */
export function planEnrichment(
	rows: StoredWeightRow[],
	measurements: IncomingMeasurement[]
): EnrichmentPlan {
	const byTimestamp = new Map<number, StoredWeightRow>();
	for (const row of rows) byTimestamp.set(row.timestampMs, row);

	const updates: EnrichmentUpdate[] = [];
	const fieldCounts: Record<string, number> = {};
	const visited = new Set<string>();
	let alreadyComplete = 0;
	let unmatched = 0;

	for (const measurement of measurements) {
		const row = byTimestamp.get(measurement.timestampMs);
		if (!row) {
			unmatched++;
			continue;
		}
		visited.add(row.id);

		const decision = decideEnrichment(row.data, measurement.data);
		if (!decision) {
			alreadyComplete++;
			continue;
		}

		updates.push({ id: row.id, data: decision.data, added: decision.added });
		for (const field of decision.added) {
			fieldCounts[field] = (fieldCounts[field] ?? 0) + 1;
		}
	}

	return {
		updates,
		alreadyComplete,
		unmatched,
		unvisited: rows.length - visited.size,
		fieldCounts
	};
}
