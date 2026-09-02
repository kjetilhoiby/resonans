/**
 * sick-checkin.ts — «hvordan går det?» mens du er syk.
 *
 * ## Hvorfor denne nudgen finnes når de andre er slått av
 *
 * `fuel-nudge`, skrivenudgen og øktvarslene maser om å GJØRE noe. I en
 * sykeperiode er de feil, og det er derfor de er utenfor. Denne er den motsatte:
 * den spør hvordan du har det, og det er det eneste spørsmålet som blir MER
 * relevant av at du ligger nede.
 *
 * ## Den spør konkret, ikke åpent
 *
 * «Hvordan går det?» er et spørsmål man ikke svarer på. «Er halsen bedre? Har
 * hosten gitt seg?» er det, fordi det bare krever en bekreftelse. Symptomloggen
 * gjør forskjellen mulig: vi vet hva som var galt i går, så vi kan spørre om
 * nettopp det. En nudge uten symptomer å nevne blir åpen igjen, og da spør den
 * heller om det ene som alltid er konkret — om du er frisk.
 *
 * ## Kadensen faller av, og det er hele forskjellen på nyttig og støy
 *
 * Et spørsmål hver dag i tre uker er ikke omsorg, det er mas — og mas blir slått
 * av. Så: daglig de første dagene, deretter sjeldnere. En influensa får fire-fem
 * spørsmål; en skade som varer i to måneder får ikke seksti.
 *
 * ## Ingen medisinske råd
 *
 * Den spør og registrerer. Den sier ikke om du bør oppsøke lege, hvor lenge noe
 * «normalt» varer, eller hva symptomene betyr. Vi måler ingenting her — brukeren
 * har skrevet det selv — og en vurdering fra oss ville vært en gjetning forkledd
 * som et råd. Samme linje som «ingen påstander om blodsukker».
 */

import { dayNumber } from '$lib/domain/streaks';
import type { Symptom } from './symptoms';
import { rankOngoingSymptoms } from './symptoms';

/**
 * Vinduet nudgen kan sendes i (Oslo-timer).
 *
 * Morgen er bevisst utelatt: spørsmålet «er det bedre i dag» krever at dagen har
 * begynt. Og etter 21 er svaret preget av at man er trøtt.
 */
export const CHECKIN_EARLIEST_HOUR = 11;
export const CHECKIN_LATEST_HOUR = 21;

/**
 * Kadensen: dager inn i perioden → hvor mange dager mellom hvert spørsmål.
 *
 * Trappen er valgt slik at et vanlig forløp (5–7 dager) får spørsmål omtrent
 * hver dag, mens en langvarig skade faller ned til ukentlig. Tallene er ikke
 * målt — de er en avveining mellom «husk å følge opp» og «ikke mas» — men
 * FORMEN er poenget: den skal falle, ikke stå.
 */
export const CHECKIN_CADENCE: ReadonlyArray<{ afterDays: number; everyDays: number }> = [
	{ afterDays: 0, everyDays: 1 },
	{ afterDays: 7, everyDays: 2 },
	{ afterDays: 14, everyDays: 4 },
	{ afterDays: 28, everyDays: 7 }
];

export function cadenceForDay(daysIntoPeriod: number): number {
	let every = 1;
	for (const step of CHECKIN_CADENCE) {
		if (daysIntoPeriod >= step.afterDays) every = step.everyDays;
	}
	return every;
}

export interface SickCheckinInput {
	/** Startdagen på den aktive sykeperioden. Null = ikke syk. */
	periodStart: string | null;
	/** Symptomene som pågår nå. */
	symptoms: readonly Symptom[];
	/** Dagen forrige oppfølging ble sendt, eller null. */
	lastCheckinDay: string | null;
	/** Oslo-time nå, som desimaltall (13.5 = 13:30). */
	osloHour: number;
	todayKey: string;
}

export interface SickCheckinDecision {
	/** Dager inn i perioden, 1 på første dag. */
	dayOfPeriod: number;
	title: string;
	body: string;
	/**
	 * Symptomene spørsmålet handler om, i rekkefølge. Flaten viser
	 * bedre/uendret/verre per symptom, så svaret er ett trykk per rad.
	 */
	symptomIds: string[];
}

/** Hvor mange symptomer nudgen nevner. Flere, og den slutter å bli lest. */
export const MAX_CHECKIN_SYMPTOMS = 3;

/**
 * Skal vi spørre nå? Null nesten alltid, som alle nudge-beslutninger.
 */
export function decideSickCheckin(input: SickCheckinInput): SickCheckinDecision | null {
	if (!input.periodStart) return null;
	if (input.osloHour < CHECKIN_EARLIEST_HOUR || input.osloHour >= CHECKIN_LATEST_HOUR) return null;

	const today = dayNumber(input.todayKey);
	const start = dayNumber(input.periodStart);
	// Første sykedag teller som dag 1.
	const dayOfPeriod = today - start + 1;
	if (dayOfPeriod < 1) return null;

	/**
	 * Ikke på dag 1.
	 *
	 * Du registrerte deg som syk i dag; du vet hvordan det går. Et spørsmål samme
	 * dag leser som at appen ikke fikk det med seg.
	 */
	if (dayOfPeriod < 2) return null;

	if (input.lastCheckinDay) {
		const sinceLast = today - dayNumber(input.lastCheckinDay);
		if (sinceLast < cadenceForDay(dayOfPeriod)) return null;
	}

	const ranked = rankOngoingSymptoms(input.symptoms, input.todayKey).slice(
		0,
		MAX_CHECKIN_SYMPTOMS
	);

	const dayLabel = `dag ${dayOfPeriod}`;

	if (ranked.length === 0) {
		// Ingen symptomer å nevne: spør om det ene som alltid er konkret.
		return {
			dayOfPeriod,
			title: `Hvordan går det? (${dayLabel})`,
			body: 'Er du frisk igjen, eller står sykemeldingen? Streaks er pauset så lenge den står.',
			symptomIds: []
		};
	}

	const names = ranked.map((s) => s.label);
	const list =
		names.length === 1
			? names[0]
			: `${names.slice(0, -1).join(', ')} og ${names[names.length - 1]}`;

	return {
		dayOfPeriod,
		title: `Hvordan går det? (${dayLabel})`,
		// Navngir symptomene og ber om en retning. Ingen vurdering av dem.
		body: `Sist meldte du ${list}. Bedre, uendret eller verre?`,
		symptomIds: ranked.map((s) => s.id)
	};
}
