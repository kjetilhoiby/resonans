/**
 * Hvordan en cron-kjørings RESULTAT skal klassifiseres.
 *
 * Skilt ut av `withCronTracking` fordi regelen er ren og fortjener tester — og
 * fordi den tok feil stille: wrapperen så bare etter en `error`-nøkkel på
 * toppnivå, mens «for hver bruker»-synkene fanger feilen per bruker, legger den
 * i `results[]` og teller den i `failed`. En kjøring der ALLE brukerne feilet
 * ble derfor bokført som `success`. SpareBank1 sto tre døgn uten at ett eneste
 * signal var rødt (2026-09-03), og `cron_executions` var ett av dem.
 *
 * De tre formene er etablerte i repoet, ikke oppfunnet her:
 *   - `{ error: … }`       — jobber som rapporterer delvis feil på toppnivå
 *   - `{ failed: n }`      — de åtte «for hver bruker»-synkene
 *   - `{ success: false }` — rescuetime-sync og economics-dedup, som alt setter
 *                            `success: failed === 0` og altså sa fra hele tiden
 *                            til en wrapper som ikke hørte etter
 *
 * Regelen er BEVISST et supersett av den gamle: alt som før ble `partial`, blir
 * det fortsatt. En monitorering skal kunne skjerpes uten at man samtidig må
 * bevise at ingenting slutter å varsle.
 */
export type CronResultStatus = 'success' | 'partial';

export function classifyCronResult(result: unknown): CronResultStatus {
	if (!result || typeof result !== 'object') return 'success';

	const record = result as Record<string, unknown>;

	if ('error' in record) return 'partial';
	if (typeof record.failed === 'number' && record.failed > 0) return 'partial';
	if (record.success === false) return 'partial';

	return 'success';
}
