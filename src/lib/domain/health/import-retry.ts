/**
 * Skal denne runden prøves på nytt?
 *
 * Arkivimporten går i ~51 runder fra nettleseren, og kjøringen 5. september
 * 2026 døde fordi telefonen låste skjermen: Safari drepte fetchen, feltet sa
 * «Load failed», og et `return` avsluttet HELE importen. Halvparten av arkivet
 * var skrevet, resten ikke, og et nytt trykk begynte forfra.
 *
 * Regelen er den samme som cron-dispatcherens skille mellom «nådde aldri
 * serveren» og «serveren svarte»: en **transportfeil** er verdt et nytt forsøk,
 * en **4xx** er ikke. Serveren har alt sagt hva den mener om denne kroppen, og
 * den mener det samme neste gang — mens et avbrutt kall ikke har fått svar i
 * det hele tatt.
 *
 * 5xx retries fordi den kan være forbigående (en redeploy midt i importen er
 * helt vanlig: hver push restarter containeren).
 *
 * **Et nytt forsøk er trygt fordi skrivingen er idempotent.** Batchen kan i
 * verste fall skrive rader som alt er skrevet, og de kommer tilbake som
 * «fantes fra før».
 */
export type BatchAttemptResult =
	/** Forespørselen nådde aldri fram, eller svaret kom aldri tilbake. */
	| { kind: 'transport' }
	/** Serveren svarte med en status. */
	| { kind: 'http'; status: number };

export function shouldRetryBatch(result: BatchAttemptResult): boolean {
	if (result.kind === 'transport') return true;
	// 429 er «for fort», altså nettopp en tilstand som går over av seg selv.
	if (result.status === 429) return true;
	return result.status >= 500;
}

/**
 * Ventetid før forsøk nummer `attempt` (1-indeksert: første nye forsøk er 2).
 *
 * Doblende, fra en base. Ingen jitter: dette er én klient som snakker med sin
 * egen server, ikke en flokk som kan synkronisere seg til et tordenskrall.
 */
export function retryDelayMs(attempt: number, baseMs: number): number {
	if (attempt <= 1) return 0;
	return baseMs * 2 ** (attempt - 2);
}
