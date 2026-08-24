/**
 * Å lese et `db.execute(sql\`…\`)`-resultat, uansett driver.
 *
 * Neon HTTP-driveren returnerer et resultat-OBJEKT
 * (`{ command, rowCount, rows, fields, rowAsArray }`); postgres-js returnerer en
 * bar ARRAY med `count` som egenskap. Koden som leser dem må tåle begge, og har
 * to ganger latt være.
 *
 * Ligger i egen modul framfor i `index.ts` fordi det er ren formlogikk som
 * fortjener tester — `index.ts` åpner en databasetilkobling ved import.
 */

/**
 * Radene fra et resultat.
 *
 * `db.execute()` typer resultatet løst, så koden castet historisk til
 * `as unknown as Array<...>` og kalte `.map()`/`.filter()`/`for…of` rett på
 * objektet. Det kastet «X is not a function / is not iterable» i prod, eller ga
 * stille `undefined`/`0` via `[0]?.x` og `.length`.
 */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
	if (Array.isArray(result)) return result as T[];
	const rows = (result as { rows?: unknown } | null)?.rows;
	return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * Antall rader et `UPDATE`/`DELETE`/`INSERT` traff.
 *
 * Samme todeling, og samme felle en gang til: Neon HTTP legger tallet på
 * `rowCount`, postgres-js på `count`. `spond-person-mapping-service.ts` leste
 * bare `rowCount` og rapporterte derfor «0 merket» mot en vanlig Postgres — et
 * tall som ser ut som et svar.
 */
export function affectedRows(result: unknown): number {
	if (result == null) return 0;
	const candidate = result as { rowCount?: unknown; count?: unknown };
	const value = typeof candidate.rowCount === 'number' ? candidate.rowCount : candidate.count;
	return typeof value === 'number' ? value : 0;
}
