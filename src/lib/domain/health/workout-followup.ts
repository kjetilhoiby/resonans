/**
 * Hva som skal skje etter at en treningsøkt er skrevet — den rene delen.
 *
 * Se `docs/changelog/2026-08-10-en-vei-inn-for-nye-okter.md`.
 *
 * Fram til august 2026 hang all etterbehandling av en økt på Withings-synken og
 * Dropbox-importen: `/api/apps/upload` (Ekko) skrev raden og gjorde ellers
 * ingenting. Konsekvensen var at en tur du nettopp hadde løpt og lastet opp
 * direkte ikke ga push, ikke haket av noe, og ikke fantes i aggregatene før
 * nattjobben kl. 03 UTC — mens den *samme* turen ga alt sammen noen minutter
 * senere, den dagen klokka eller Dropbox-fila kom fram.
 *
 * Modulen her eier de to valgene som må være like uansett hvilken kilde som kom
 * først: HVILKE klynger som er nye nok til å varsle om, og HVILKEN av kildene i
 * klynga varselet skal peke på.
 */

/**
 * Én kilde som beskrev en økt. Speiler `UnifiedWorkoutActivity['evidence']`, men
 * bare feltene beslutningen faktisk bruker — modulen skal kunne testes uten å
 * bygge en hel aktivitetsklynge.
 */
export type WorkoutEvidenceRef = {
	eventId: string;
	/** ISO-tidsstempel for kildens egen registrering. */
	timestamp: string;
	/** Har kilden et GPS-spor? Avgjør hvilken rad aktivitetssida får vise. */
	hasTrackPoints: boolean;
};

export type WorkoutClusterRef = {
	/** Klyngens id = eldste evidence-event. Samme nøkkel som `canonical_workouts`. */
	activityId: string;
	/** ISO-starttid for klynga (eldste kilde). */
	startTime: string;
	evidence: WorkoutEvidenceRef[];
};

/**
 * Hvor gammel en økt kan være og fortsatt gi push.
 *
 * Vakta finnes for backfill, ikke for sen synk: en full Withings-synk eller en
 * Dropbox-rescan skriver hundrevis av økter på én gang, og et varsel per stykk
 * ville tømt varslingskanalen for tillit på ett minutt. Sju døgn er satt
 * romslig med vilje — en klokke som synker tre dager for sent, eller en GPX du
 * laster opp manuelt fra helga, er fortsatt noe du vil vite at kom fram.
 */
export const NOTIFY_MAX_AGE_DAYS = 7;

/**
 * Hvor langt tilbake vi aggregerer på nytt etter en skriving.
 *
 * Aggregeringen koster per dag/uke/måned i spennet, så en økt datert flere år
 * tilbake ville dratt en full historikk-rebuild inn i en opplastings-request.
 * Nattjobben (`/api/cron/aggregate`, `aggregateAllPeriods`) tar de tilfellene;
 * denne dekker «det jeg nettopp gjorde», som er hele poenget med å ikke vente.
 */
export const AGGREGATE_MAX_LOOKBACK_DAYS = 90;

/**
 * Hvor gamle økter som fortsatt utløser autohaking og målprogresjon.
 *
 * Dette er en vakt mot backfill, og den er nødvendig: en full Withings-synk
 * skriver økter fra 2017 og framover i én omgang. Uten grensa ville
 * etterbehandlingen løpt `autocheckChecklistItemsForDay` én gang per
 * kalenderdag i historikken — tusenvis av spørringer inne i en synk som har
 * 120 sekunder på seg.
 *
 * Sju døgn er ikke et kompromiss, det er der nytten faktisk slutter:
 * dagssjekklister lages per dag og ukesjekklista gjelder inneværende uke, så en
 * økt fra i fjor har ingen hake å sette. Nattjobben og de køede
 * fallback-jobbene dekker resten.
 */
export const FOLLOWUP_MAX_AGE_DAYS = 7;

/**
 * Oslo-datoene som skal etterbehandles, og hvor mange som falt utenfor.
 *
 * `skipped` returneres for å bli logget: en stille kapping ser ut som «alt ble
 * behandlet» neste gang noen lurer på hvorfor en hake mangler.
 */
export function selectFollowupDays(
	timestamps: Date[],
	now: Date,
	maxAgeDays = FOLLOWUP_MAX_AGE_DAYS
): { dates: string[]; skipped: number } {
	const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
	const fresh: Date[] = [];
	let skipped = 0;

	for (const timestamp of timestamps) {
		if (!Number.isFinite(timestamp.getTime())) {
			skipped += 1;
			continue;
		}
		if (now.getTime() - timestamp.getTime() > maxAgeMs) {
			skipped += 1;
			continue;
		}
		fresh.push(timestamp);
	}

	const dates = [
		...new Set(fresh.map((t) => t.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' })))
	].sort();

	return { dates, skipped };
}

export type NotifiableCluster = {
	cluster: WorkoutClusterRef;
	/**
	 * Hendelsen varselet lenker til. `/aktivitet/[id]` slår opp én
	 * `sensor_events`-rad, så lenka må peke på kilden med mest å vise — en
	 * Withings-rad uten spor gir et kart uten strek.
	 */
	linkEventId: string;
};

/**
 * Klynger som er berørt av nye hendelser, og som ingen har varslet om ennå.
 *
 * Tre porter, i tur og orden:
 *
 * 1. **Berørt** — klynga må inneholde minst én av hendelsene som nettopp ble
 *    skrevet. Ellers varsler en Ekko-opplasting om naboøkta fra i går.
 * 2. **Ikke varslet** — INGEN av kildene i klynga kan være varslet om før. Det
 *    er her dobbelt-pushen stoppes: samme løpetur skrives av opptil tre
 *    sensorer, og nummer to og tre havner i samme klynge som den første.
 *    Sjekken går på hele klynga, ikke på `activityId` alene, nettopp fordi
 *    `activityId` er den *eldste* kilden — en Withings-rad som lander etterpå
 *    med et tidligere tidsstempel flytter id-en, og en dedup på id ville da
 *    sluppet varsel nummer to gjennom.
 * 3. **Fersk nok** — se `NOTIFY_MAX_AGE_DAYS`.
 */
export function selectClustersToNotify(input: {
	clusters: WorkoutClusterRef[];
	/** `sensor_events.id` for radene som nettopp ble skrevet. */
	writtenEventIds: string[];
	/** `sensor_events.id` det allerede er sendt varsel for. */
	alreadyNotifiedEventIds: string[];
	now: Date;
	maxAgeDays?: number;
}): NotifiableCluster[] {
	const written = new Set(input.writtenEventIds);
	const notified = new Set(input.alreadyNotifiedEventIds);
	const maxAgeMs = (input.maxAgeDays ?? NOTIFY_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;

	return input.clusters
		.filter((cluster) => cluster.evidence.some((e) => written.has(e.eventId)))
		.filter((cluster) => !cluster.evidence.some((e) => notified.has(e.eventId)))
		.filter((cluster) => {
			const startedAt = new Date(cluster.startTime).getTime();
			if (!Number.isFinite(startedAt)) return false;
			const age = input.now.getTime() - startedAt;
			// Framtidige tidsstempler slippes gjennom: en klokke som ligger et par
			// minutter foran er ikke en backfill.
			return age <= maxAgeMs;
		})
		.map((cluster) => ({ cluster, linkEventId: pickLinkEvent(cluster) }));
}

/**
 * Kilden varselet skal peke på: GPS-sporet der det finnes, ellers klyngens
 * egen id. Blant flere spor vinner det eldste, så lenka er stabil om samme
 * klynge skulle vurderes på nytt.
 */
export function pickLinkEvent(cluster: WorkoutClusterRef): string {
	const withTrack = cluster.evidence
		.filter((e) => e.hasTrackPoints)
		.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
	return withTrack[0]?.eventId ?? cluster.activityId;
}

/**
 * Startdato for aggregeringen: eldste berørte økt, klippet til
 * `AGGREGATE_MAX_LOOKBACK_DAYS`.
 */
export function aggregationStartDate(
	workoutTimestamps: Date[],
	now: Date,
	maxLookbackDays = AGGREGATE_MAX_LOOKBACK_DAYS
): Date {
	const floor = new Date(now.getTime() - maxLookbackDays * 24 * 60 * 60 * 1000);
	const valid = workoutTimestamps.filter((t) => Number.isFinite(t.getTime()));
	if (valid.length === 0) return floor;
	const earliest = valid.reduce((a, b) => (a.getTime() <= b.getTime() ? a : b));
	// Ett sekund før økta, slik at perioden økta ligger i faktisk kommer med.
	const start = new Date(earliest.getTime() - 1000);
	return start.getTime() < floor.getTime() ? floor : start;
}
