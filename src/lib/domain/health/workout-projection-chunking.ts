/**
 * Hvor langt et projeksjonspass faktisk DEKKER, gitt én side med aktiviteter.
 *
 * ## Feilen dette retter
 *
 * `refreshForRange` henter aktiviteter med `since: startDate, limit: N`, ordnet
 * STIGENDE på tid — så en side som fylles helt opp (`pageLength === limit`) betyr
 * «det finnes flere, vi vet bare ikke hvor mange». Fram til september 2026 ignorerte
 * `refreshForRange` det: den slettet `canonical_workouts`/`workout_daily_aggregates`
 * for HELE det forespurte vinduet (`startDate`–`endDate`), men skrev bare inn de
 * aktivitetene siden FAKTISK returnerte — de N eldste. Ba man om et vindu med flere
 * enn `N` aktiviteter i seg (et arkivimport-skrevet 2015-tidsstempel ber om
 * `2015 → nå`, og det er tolv år), ble de nyeste ukene i vinduet slettet og ALDRI
 * skrevet tilbake. Symptomet var stumt: ingen feil, ingen loggrad — bare et hull i
 * en graf måneder senere. Se `docs/changelog/2026-09-06-projeksjon-som-sletter-mer-enn-den-bygger.md`.
 *
 * ## Regelen
 *
 * En side som IKKE fylte grensa (`pageLength < limit`) er hele resten av vinduet —
 * kilden gikk tom før taket, så vi kan trygt dekke helt til `requestedEndDate`.
 *
 * En side som FYLTE grensa kan bare stå inne for det den selv dekket: opp til
 * den SISTE aktivitetens eget tidspunkt. Sletter og skriver vi bare DIT — ikke
 * til `requestedEndDate` — er det aldri noe område vi sletter uten å bygge opp
 * igjen. Kalleren må så be om en ny side fra rett etter dette punktet.
 *
 * Ligger den siste aktiviteten i en full side likevel på eller etter
 * `requestedEndDate` (vinduet var mindre enn det den fylte siden dekker), er vi
 * ferdig — resten av siden ligger utenfor det vi ble bedt om.
 */
export type ProjectionPage = {
	/** Antall aktiviteter siden faktisk ga tilbake. */
	pageLength: number;
	/** Grensa spørringen ble kjørt med (samme tall som `limit` i kallet). */
	limit: number;
	/** Starttidspunktet til den SISTE (nyeste) aktiviteten på siden, stigende sortert. `null` når siden er tom. */
	lastActivityStartTime: Date | null;
	/** Det opprinnelig forespurte sluttidspunktet for HELE refreshen. */
	requestedEndDate: Date;
};

export type ProjectionChunkDecision = {
	/** Slett og skriv trygt til og med dette tidspunktet — aldri lenger. */
	chunkEndDate: Date;
	/** Er det trolig flere aktiviteter igjen i vinduet etter `chunkEndDate`? */
	hasMore: boolean;
};

export function decideProjectionChunk(page: ProjectionPage): ProjectionChunkDecision | null {
	if (page.pageLength === 0) return null;

	if (page.pageLength < page.limit) {
		// Kilden gikk tom før taket — dette ER resten av vinduet.
		return { chunkEndDate: page.requestedEndDate, hasMore: false };
	}

	// Siden fylte grensa. Vi vet bare om det den faktisk inneholder.
	const last = page.lastActivityStartTime;
	if (last === null) {
		// Uforenlig tilstand (full side uten siste aktivitet) — behandle som tom
		// framfor å garantere noe vi ikke kan stå inne for.
		return null;
	}
	if (last.getTime() >= page.requestedEndDate.getTime()) {
		// Siden strekker seg forbi det vi ble bedt om — resten er utenfor vinduet.
		return { chunkEndDate: page.requestedEndDate, hasMore: false };
	}
	return { chunkEndDate: last, hasMore: true };
}

/** Startpunktet for NESTE side: rett etter forrige sides dekning. */
export function nextProjectionCursor(previousChunkEnd: Date): Date {
	return new Date(previousChunkEnd.getTime() + 1);
}
