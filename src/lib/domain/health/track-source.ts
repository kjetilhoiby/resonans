/**
 * Hvilken rad i en klynge eier SPORET.
 *
 * ## Hvorfor dette finnes
 *
 * Klyngingen på to timer slår Withings-raden, GPX-fila og Ekko-opplastingen av
 * samme tur sammen til én økt, og felttallene (distanse, tid, tempo, høyde)
 * velges per felt etter kildeprioritet. **Sporet var ikke med i den ordningen.**
 * `/aktivitet/[id]` leste `data.trackPoints` fra den ENE raden URL-en peker på,
 * uten å se på søsknene i klynga — så en klokkeøkt uten GPS viste ingen kart
 * mens sporet lå på raden ved siden av. Og lenkene lander ikke forutsigbart:
 * evidence sorteres på `timestamp`, altså starttid, og hvilken kilde som
 * startet først for samme tur er ikke til å forutsi.
 *
 * Konsekvensen var større enn et manglende kart: `trackPoints` mates videre inn
 * i øktvurderingen, så kilometersplitter og terreng forsvant med det.
 *
 * ## Reglene, i rekkefølge
 *
 * 1. **Radens EGET spor vinner alltid**, og det er kalleren som avgjør — denne
 *    funksjonen kalles bare når raden mangler spor. Å bytte ut et spor som
 *    finnes ville gjort en per-kilde-visning til noe annet enn den utgir seg
 *    for.
 * 2. **`preferGps` slår prioritet.** Har brukeren utpekt en kilde som vinner
 *    for GPS, er det den samme utpekingen `pickNumericField` bruker til
 *    distanse og høyde. To lag som er uenige om hvem som eier GPS er nøyaktig
 *    den feilklassen dette repoet har betalt for flest ganger.
 * 3. **`sourceRejected` er en veto.** Brukeren har sagt at kilden er feil for
 *    denne økta; da skal ikke sporet hentes derfra likevel.
 * 4. Deretter **kildeprioritet**, så **flest punkter** (et tett spor er mer
 *    verdt enn et tynt), så **nærmest starttid** — og til slutt `eventId`, så
 *    valget er stabilt mellom to kall.
 */

export type TrackCandidate = {
	eventId: string;
	/** Kildens prioritet, fra `sourcePriority` i activity-layer. */
	priority: number;
	/** Antall punkter i sporet. Rader uten spor hører ikke i lista. */
	points: number;
	/** Millisekunder mellom kandidatens starttid og radens starttid. */
	startOffsetMs: number;
	/** Brukeren har utpekt denne kilden som GPS-vinner for økta. */
	preferGps?: boolean;
	/** Brukeren har avvist denne kilden for økta. */
	sourceRejected?: boolean;
};

/**
 * Et spor må ha nok punkter til å tegne noe. Ett eller to punkter er et
 * artefakt fra en sporing som aldri kom i gang, og et kart med to prikker
 * ser ut som en feil framfor en tur.
 */
export const MIN_USABLE_TRACK_POINTS = 3;

export function pickTrackSource(candidates: TrackCandidate[]): TrackCandidate | null {
	const usable = candidates.filter(
		(candidate) => !candidate.sourceRejected && candidate.points >= MIN_USABLE_TRACK_POINTS
	);
	if (usable.length === 0) return null;

	const pinned = usable.filter((candidate) => candidate.preferGps === true);
	const pool = pinned.length > 0 ? pinned : usable;

	return [...pool].sort(
		(a, b) =>
			b.priority - a.priority ||
			b.points - a.points ||
			Math.abs(a.startOffsetMs) - Math.abs(b.startOffsetMs) ||
			(a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
	)[0];
}
