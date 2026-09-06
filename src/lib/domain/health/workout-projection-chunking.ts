/**
 * Hvor langt ÉN side av aktivitetslaget faktisk dekker.
 *
 * ## Feilen denne modulen finnes for
 *
 * `WorkoutProjectionService.refreshForRange` sletter `canonical_workouts` og
 * `workout_daily_aggregates` før den skriver dem opp igjen. Aktivitetene hentes
 * side for side med en grense, så sletting og skriving MÅ dekke det samme
 * spennet — sletter den mer enn siden bygger opp igjen, blir differansen et hull
 * uten en feilmelding.
 *
 * ## Enheten er HENDELSER, ikke aktiviteter — og det var feilen
 *
 * Grensa i `buildUnifiedWorkoutActivitiesPage` gjelder rader i `sensor_events`.
 * Samme løpetur skrives av opptil tre kilder, så 2000 hendelser blir typisk
 * 700–900 klynger. Første utgave av denne modulen (6. september 2026) tok inn
 * `pageLength` — antall AKTIVITETER — og sammenlignet det mot `limit`:
 *
 *     if (page.pageLength < page.limit) → «kilden gikk tom», dekk hele vinduet
 *
 * Den betingelsen er sann nesten alltid, også når kilden har tusenvis av rader
 * igjen. Resultatet var at fiksen ikke virket i det hele tatt: refreshen slettet
 * fortsatt hele `startDate`–`endDate` og skrev bare tilbake de eldste 2000
 * hendelsenes aktiviteter. På et tolvårsvindu — som arkivimportens køede
 * `workout_projection_refresh`-jobber ber om — forsvant alt etter de eldste ~900
 * øktene, hver gang en slik jobb kjørte. Målt i prod: den akkumulerte
 * løpekurven falt fra 421 km til 173 km på fjorten minutter, uten at noen
 * trykket på noe.
 *
 * Derfor bærer feltnavnene nå enheten: `eventsRead` mot `eventLimit`. Et navn
 * som `pageLength` inviterer til nøyaktig den forvekslingen igjen.
 *
 * ## Rekkefølgen på aktivitetene er IKKE til å stole på
 *
 * `buildUnifiedWorkoutActivities` sorterer **synkende** (nyeste først), mens
 * hendelsene hentes stigende. Første utgave leste `unified[length - 1]` som «den
 * nyeste aktiviteten» og fikk den ELDSTE. Feilen var latent bare fordi
 * enhetsfeilen over gjorde at grenen aldri ble nådd. Modulen tar derfor imot
 * alle starttidspunktene og finner ytterpunktet selv.
 *
 * Se `docs/changelog/2026-09-06-sidetallet-var-i-feil-enhet.md`.
 */

export interface ProjectionPage {
	/** Antall RÅ `sensor_events`-rader siden leste. */
	eventsRead: number;
	/** Hendelsesgrensa siden ble hentet med. */
	eventLimit: number;
	/** Starttidspunktene til aktivitetene siden bygde. Rekkefølge er irrelevant. */
	activityStartTimes: Date[];
	/** Sluttpunktet for hele forespørselen. Et kutt kan aldri gå forbi dette. */
	requestedEndDate: Date;
}

export interface ProjectionChunkDecision {
	/**
	 * Siste tidspunkt denne siden dekker. Sletting OG skriving avgrenses til
	 * `cursor`–`chunkEndDate`, aldri videre.
	 */
	chunkEndDate: Date;
	/** Finnes det mer bak grensa? */
	hasMore: boolean;
}

/**
 * Avgjør sidens dekning.
 *
 * - **Siden ble ikke avkortet** (`eventsRead < eventLimit`): kilden gikk tom, så
 *   siden dekker hele resten av vinduet. Ingenting ligger bak.
 * - **Siden ble avkortet**: den dekker bare fram til FØR den nyeste aktiviteten
 *   den bygde. Grunnen er klyngingen: den nyeste aktiviteten ligger på
 *   avkortingsgrensa, og hendelsene som hører til den kan være kuttet bort. Ble
 *   den skrevet nå, ville neste side lest de gjenstående hendelsene som en NY
 *   klynge og telt samme tur to ganger. Neste markør er derfor den aktivitetens
 *   eget starttidspunkt, så hendelsene leses om igjen i sin helhet.
 * - **Ingen aktiviteter**: `null`. Det finnes ingenting å slette eller skrive,
 *   og en kaller som slettet «resten av vinduet» her ville fjernet rader den
 *   aldri hentet.
 */
export function decideProjectionChunk(page: ProjectionPage): ProjectionChunkDecision | null {
	if (page.activityStartTimes.length === 0) return null;

	if (page.eventsRead < page.eventLimit) {
		return { chunkEndDate: page.requestedEndDate, hasMore: false };
	}

	const times = page.activityStartTimes.map((date) => date.getTime());
	const newest = Math.max(...times);
	const oldest = Math.min(...times);

	// Nådde siden forbi vinduet, er vinduet dekket — det som ligger bak grensa
	// er utenfor det vi ble spurt om.
	if (newest >= page.requestedEndDate.getTime()) {
		return { chunkEndDate: page.requestedEndDate, hasMore: false };
	}

	// Alt på siden er ÉN klynge (eller ett tidspunkt). Da finnes det ikke noe
	// «før den nyeste» å kutte ved, og et kutt der ville ikke flyttet markøren:
	// løkka ville hentet samme side igjen i det uendelige. Vi skriver den og går
	// videre, og betaler prisen for at klyngen kan mangle bevis bak grensa.
	if (newest === oldest) {
		return { chunkEndDate: new Date(newest), hasMore: true };
	}

	// Kutt FØR den nyeste aktiviteten; neste markør blir dens eget tidspunkt.
	return { chunkEndDate: new Date(newest - 1), hasMore: true };
}

/**
 * Markøren for neste side.
 *
 * Ett millisekund etter kuttet: `refreshForRange` sletter og skriver inklusivt i
 * begge ender, så en markør PÅ kuttet ville behandlet samme tidspunkt to ganger.
 */
export function nextProjectionCursor(previousChunkEnd: Date): Date {
	return new Date(previousChunkEnd.getTime() + 1);
}
