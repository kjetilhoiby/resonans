/**
 * Svarteliste for treningsøkter: «denne økta skjedde ikke, uansett hvem som
 * forteller om den».
 *
 * Ren matchelogikk. Lesing/skriving bor i
 * `$lib/server/workouts/workout-suppressions.ts`.
 *
 * ## Hvorfor et flagg på raden ikke holdt
 *
 * `metadata.dismissed` sier «skjul denne RADEN». Det er et annet utsagn enn
 * «denne ØKTA skjedde ikke», og forskjellen ble konkret på tre måter:
 *
 * 1. Synken overskrev `metadata` ved upsert — flagget bodde på et sted synken
 *    eier. Rettet, men det avslørte problemet.
 * 2. Brukeren slettet økta hos Withings, og den ble stående i Resonans: synken
 *    er additiv og fjerner aldri rader en kilde slutter å returnere. En
 *    sletting ved kilden propagerer ikke.
 * 3. En ny rad med revidert starttidspunkt får ny id og arver ingenting.
 *
 * Svartelista matcher derfor på TIDSPUNKT + SPORTSFAMILIE, ikke på en rad-id.
 */

export type WorkoutSuppression = {
	startTime: Date;
	sportFamily: string;
};

export type SuppressibleWorkout = {
	startTime: Date;
	sportFamily: string;
};

/**
 * Hvor langt fra det svartelistede starttidspunktet en økt fortsatt regnes som
 * «den samme».
 *
 * 30 minutter, og tallet er en avveining mellom to reelle feil:
 *
 * - **For smalt** fanger ikke en retroaktiv revisjon. Withings justerer
 *   øktgrenser i ettertid, og en annen kilde (klokke mot telefon) starter
 *   sporingen noen minutter unna. Bommer vinduet, er økta tilbake — som er
 *   nøyaktig det svartelista finnes for å hindre.
 * - **For bredt** skjuler en ekte økt brukeren gjorde. Klyngevinduet i
 *   aktivitetslaget er to timer, og det kunne vært fristende å speile det. Men
 *   klyngevinduet SLÅR SAMMEN økter (en tapt økt vises fortsatt, bare som del
 *   av en annen), mens svartelista FJERNER dem. Samme tall, mye høyere pris for
 *   å ta feil — så det skal ikke arves ukritisk.
 *
 * Konsekvensen er bevisst: to reelle økter i samme familie innenfor en halvtime
 * ville uansett blitt klynget sammen til én av aktivitetslaget, så vinduet
 * fjerner ikke noe som ellers ville stått alene.
 */
export const SUPPRESSION_TOLERANCE_MINUTES = 30;

const MINUTE_MS = 60 * 1000;

/**
 * Er økta svartelistet?
 *
 * Sportsfamilien må stemme. Uten den ville en svartelistet løpetur også skjult
 * en sykkeltur på samme klokkeslett — og familien er allerede nøkkelen
 * aktivitetslaget klynger på, så de to er enige om hva «samme type» betyr.
 */
export function isWorkoutSuppressed(
	workout: SuppressibleWorkout,
	suppressions: readonly WorkoutSuppression[],
	toleranceMinutes = SUPPRESSION_TOLERANCE_MINUTES
): boolean {
	const toleranceMs = toleranceMinutes * MINUTE_MS;
	const at = workout.startTime.getTime();
	if (!Number.isFinite(at)) return false;

	return suppressions.some((suppression) => {
		if (suppression.sportFamily !== workout.sportFamily) return false;
		const delta = Math.abs(at - suppression.startTime.getTime());
		return delta <= toleranceMs;
	});
}

/**
 * Tidsvinduet svartelistinger må hentes for når aktiviteter fra `since` skal
 * filtreres.
 *
 * Utvidet med toleransen i begge ender: en svartelisting like FØR `since` kan
 * fortsatt treffe den første økta i vinduet. Uten paddingen ville en økt i
 * kanten sluppet gjennom — og en svarteliste som virker nesten alltid er verre
 * enn ingen, fordi feilen er umulig å få øye på.
 */
export function suppressionLookupWindow(
	since: Date,
	toleranceMinutes = SUPPRESSION_TOLERANCE_MINUTES
): Date {
	return new Date(since.getTime() - toleranceMinutes * MINUTE_MS);
}
