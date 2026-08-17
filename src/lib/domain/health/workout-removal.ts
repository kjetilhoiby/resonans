/**
 * Hva en øktsletting må rydde etter seg.
 *
 * Bakgrunnen er felttesten 17. august 2026: en elsykkeltur til jobb ble lagret som
 * løping, og «tidenes raskeste 5 km» havnet i Ekko, Resonans og Strava. Å slette
 * `sensor_events`-raden alene rydder ingenting — rekorden, effort-skåren og
 * formkurven leser fra `canonical_workouts` og `sensor_aggregates`, som står igjen.
 * `POST /api/admin/cleanup-walking` gjorde nettopp det, og er grunnen til at denne
 * modulen finnes framfor et nytt engangsskript.
 *
 * ## Hva som er avledet, og hvordan det ryddes
 *
 * | Lag | Ryddes |
 * |-----|--------|
 * | `sensor_events` (`workout`) | slettes — kilden |
 * | `canonical_workouts` | slettes — projeksjonen med `effortScore` og `bestEfforts` |
 * | `workout_notifications` | slettes, ellers blokkerer de varsel om en ekte økt senere |
 * | `sensor_aggregates` | REBEREGNES fra dagen og framover |
 * | rekorder, VO2max, EF, form | selvheler — de regnes fra canonical ved lesing |
 *
 * **Autohaking og målprogresjon rulles IKKE tilbake.** Regelen i repoet er at vi
 * aldri haker av automatisk (`docs/changelog/2026-08-08-ivrig-autohaking.md`): å
 * fjerne opptjent framgang er farligere enn å la en hake stå. Slettingen sier det
 * i stedet, så det er et valg og ikke en overraskelse.
 *
 * Ren modul — ingen DB, ingen nettverk.
 */

/** Én kandidat for sletting, som den ser ut før noe røres. */
export interface RemovalCandidate {
	eventId: string;
	startTime: Date;
	sportType: string | null;
	distanceMeters: number | null;
	durationSeconds: number | null;
	provider: string | null;
}

export interface RemovalPlan {
	candidates: RemovalCandidate[];
	/** Tidligste dag som må reaggregeres. `null` når ingenting skal slettes. */
	reaggregateFrom: Date | null;
	/** Ting slettingen bevisst ikke rører, som ord — vises til brukeren. */
	notCleaned: string[];
}

/**
 * Hva som ryddes, og hva som ikke gjør det.
 *
 * `reaggregateFrom` er starten på den TIDLIGSTE berørte dagen, ikke øktas eget
 * tidspunkt: aggregatene er dags-, uke-, måned- og årsrader, og en reaggregering
 * som starter midt i dagen ville etterlatt dagsraden som den var.
 */
export function planRemoval(candidates: RemovalCandidate[]): RemovalPlan {
	if (candidates.length === 0) {
		return { candidates: [], reaggregateFrom: null, notCleaned: [] };
	}

	const earliest = candidates.reduce(
		(min, c) => (c.startTime.getTime() < min.getTime() ? c.startTime : min),
		candidates[0].startTime
	);
	const dayStart = new Date(earliest);
	dayStart.setUTCHours(0, 0, 0, 0);

	return {
		candidates,
		reaggregateFrom: dayStart,
		notCleaned: [
			'Avhakede oppgaver og opptjent målprogresjon står — vi haker aldri av automatisk.',
			'Aktiviteten i Strava må slettes der; Resonans eier ikke den kopien.'
		]
	};
}

/**
 * Sant når økta ser ut som en feilmerket idrett: farten er høyere enn idretten
 * tilsier. Brukes til å FORESLÅ sletting, aldri til å utføre den.
 *
 * Terskelen er 6,0 m/s (21,6 km/t) for løping — godt over det denne brukeren
 * løper, og godt under elsykkelfart. En ekte løpetur på over 21 km/t i snitt
 * finnes praktisk talt ikke utenfor en bane.
 */
export const SUSPICIOUS_RUN_SPEED_MPS = 6.0;

export function looksMislabelled(candidate: RemovalCandidate): boolean {
	if (candidate.sportType !== 'running') return false;
	const { distanceMeters, durationSeconds } = candidate;
	if (!distanceMeters || !durationSeconds || durationSeconds <= 0) return false;
	return distanceMeters / durationSeconds > SUSPICIOUS_RUN_SPEED_MPS;
}
