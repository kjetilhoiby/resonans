/**
 * Escaper LIKE/ILIKE-jokertegn i brukerinput slik at søketermen matches bokstavelig.
 * Selve verdien parameter-bindes av Drizzle — dette handler kun om jokertegn-semantikk
 * (`%` og `_`), ikke SQL-injeksjon.
 */
export function escapeLike(term: string): string {
	return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
