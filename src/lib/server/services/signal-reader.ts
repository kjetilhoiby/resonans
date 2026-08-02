import { db, rowsOf } from '$lib/db';
import { sql } from 'drizzle-orm';

/**
 * Leseside for `domain_signals`. Produsentene bor i signal-service.ts.
 *
 * Én spørring for siste måling per signaltype. Alternativet — én findFirst per
 * kontrakt — ble ~20 sekvensielle rundturer hver gang et tema åpnet
 * signalpanelet.
 */

export interface LatestSignal {
	signalType: string;
	ownerDomain: string;
	valueNumber: number | null;
	valueText: string | null;
	valueBool: boolean | null;
	severity: string;
	confidence: string;
	observedAt: string;
	context: Record<string, unknown>;
}

export interface LatestSignalRow extends Record<string, unknown> {
	signal_type: string;
	owner_domain: string;
	value_number: string | number | null;
	value_text: string | null;
	value_bool: boolean | null;
	severity: string;
	confidence: string | number;
	observed_at: string | Date;
	context: Record<string, unknown> | null;
}

function toIso(value: string | Date): string {
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Én rå SQL-rad → LatestSignal. Eksportert og ren, slik at kolonne-mappingen kan
 * testes uten database (numeric kommer som streng, timestamp som Date eller
 * streng avhengig av driver).
 */
export function mapSignalRow(row: LatestSignalRow): LatestSignal {
	return {
		signalType: row.signal_type,
		ownerDomain: row.owner_domain,
		valueNumber: row.value_number === null ? null : Number(row.value_number),
		valueText: row.value_text,
		valueBool: row.value_bool,
		severity: row.severity,
		confidence: String(row.confidence),
		observedAt: toIso(row.observed_at),
		context: (row.context ?? {}) as Record<string, unknown>
	};
}

/**
 * Siste måling per signaltype for brukeren, som kart fra signalType.
 * `ownerDomain` filtrerer når bare ett domene er interessant (f.eks. 'health').
 */
export async function getLatestSignalsByType(
	userId: string,
	opts: { ownerDomain?: string } = {}
): Promise<Map<string, LatestSignal>> {
	const result = await db.execute(sql`
		SELECT DISTINCT ON (signal_type)
			signal_type, owner_domain, value_number, value_text, value_bool,
			severity, confidence, observed_at, context
		FROM domain_signals
		WHERE user_id = ${userId}
		${opts.ownerDomain ? sql`AND owner_domain = ${opts.ownerDomain}` : sql``}
		ORDER BY signal_type, observed_at DESC
	`);

	// NB: MÅ gå gjennom rowsOf. Neon HTTP-driveren returnerer et resultat-objekt,
	// ikke en array — `for…of` rett på resultatet kaster «is not iterable» i prod.
	// Se docstringen på rowsOf i $lib/db.
	const out = new Map<string, LatestSignal>();
	for (const row of rowsOf<LatestSignalRow>(result)) {
		out.set(row.signal_type, mapSignalRow(row));
	}
	return out;
}
