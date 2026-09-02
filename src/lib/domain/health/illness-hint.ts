/**
 * illness-hint.ts — «er du syk?», spurt av tallene framfor å vente på deg.
 *
 * ## Hvorfor et forslag og ikke en registrering
 *
 * Sovepuls og hudtemperatur er de to signalene vi har som beveger seg FØR
 * brukeren tar en beslutning. Men ingen av dem kan skille sykdom fra en hard
 * økt, en sen kveld eller et varmt soverom. Så vi spør — vi konkluderer ikke.
 * Samme arbeidsdeling som `suggestForgottenTracking`: en feil gjetning skal koste
 * et forslag brukeren avviser, ikke et tall brukeren må oppdage og rette.
 *
 * En automatisk registrering ville dessuten unnskyldt streak-dager på grunnlag
 * av en gjetning, og det er verre enn å ikke spørre: en unnskyldning brukeren
 * ikke ba om gjør telleren like utroverdig som en som teller feil.
 *
 * ## Terskelen er høyere enn flatens
 *
 * `NOTABLE_DEVIATION_BPM` (5) er «verdt å se på» på et kort du alt har åpnet.
 * Et forslag dytter seg på deg, så det må klare en høyere lut — ellers blir det
 * bakgrunnsstøy, og bakgrunnsstøy blir slått av. Derfor et eget tall, og derfor
 * kravet om to netter på rad: én natt er en sen kveld.
 *
 * ## `since` er halve verdien
 *
 * Forslaget peker på den FØRSTE natta avviket startet, ikke på i dag. Sier
 * brukeren ja, backdateres perioden dit — og siden streaks regnes fra hendelser,
 * repareres rekka bakover med det samme. Uten `since` måtte brukeren huske når
 * det begynte, og det er nettopp det man ikke gjør når man er syk.
 */

import { dayNumber } from '$lib/domain/streaks';

/**
 * Hvor mange slag over egen baseline sovepulsen må ligge før vi spør.
 *
 * Målt mot `NOTABLE_DEVIATION_BPM` (5), som er flatens «verdt å se på». Sju er
 * valgt fordi en hard treningsdag typisk gir 3–6 slag: over det er trening en
 * mindre sannsynlig forklaring, men den er fortsatt mulig — og derfor nevner
 * teksten den.
 */
export const HINT_HR_DEVIATION_BPM = 7;

/** Hvor mye hudtemperaturen må ligge over egen baseline. */
export const HINT_SKIN_DEVIATION_C = 0.5;

/** Netter på rad et signal må holde seg. Én natt er en sen kveld. */
export const HINT_MIN_NIGHTS = 2;

/**
 * Hvor lenge vi holder kjeft etter et avvist forslag.
 *
 * Et forslag som kommer tilbake i morgen er det samme forslaget. En uke er lang
 * nok til at et nytt spørsmål handler om noe nytt.
 */
export const HINT_QUIET_DAYS = 7;

export interface NightDeviation {
	/** Nattnøkkel — datoen man våkner. */
	date: string;
	/** Verdien minus brukerens egen baseline. Positivt = over. */
	deviation: number;
}

export interface IllnessHintInput {
	/** Sovepuls per natt som avvik fra egen baseline, eldste først. */
	restingHr: readonly NightDeviation[];
	/** Hudtemperatur per natt som avvik fra egen baseline, eldste først. */
	skinTemp: readonly NightDeviation[];
	/** Er en sykeperiode aktiv nå? Da spør vi ikke. */
	sickActive: boolean;
	/** Dagen et forslag sist ble avvist, eller null. */
	dismissedOn: string | null;
	todayKey: string;
}

export interface IllnessHint {
	/** Første dagen avviket holdt — perioden backdateres hit hvis brukeren sier ja. */
	since: string;
	/** Hvor mange netter avviket har holdt seg. */
	nights: number;
	/** Observasjonene, som setninger. Ingen tolkning. */
	observations: string[];
	/** Hele spørsmålet, klart til å vises. */
	text: string;
}

const fmt1 = (v: number) => v.toFixed(1).replace('.', ',');

/**
 * Halen av netter der avviket holdt terskelen, nyeste først i input-rekkefølge.
 *
 * Krever at SISTE natt er over: et avvik som gikk over for tre dager siden er
 * ikke et spørsmål om i dag.
 */
function trailingRun(
	nights: readonly NightDeviation[],
	threshold: number
): NightDeviation[] {
	const run: NightDeviation[] = [];
	for (let i = nights.length - 1; i >= 0; i--) {
		if (nights[i].deviation < threshold) break;
		run.unshift(nights[i]);
	}
	return run;
}

/**
 * Skal vi spørre om brukeren er syk?
 *
 * Null i det store flertallet av tilfellene, og det er meningen.
 */
export function suggestIllness(input: IllnessHintInput): IllnessHint | null {
	// Er perioden alt registrert, er spørsmålet besvart.
	if (input.sickActive) return null;

	if (input.dismissedOn) {
		const since = dayNumber(input.todayKey) - dayNumber(input.dismissedOn);
		if (since < HINT_QUIET_DAYS) return null;
	}

	const hrRun = trailingRun(input.restingHr, HINT_HR_DEVIATION_BPM);
	const tempRun = trailingRun(input.skinTemp, HINT_SKIN_DEVIATION_C);

	const hrQualifies = hrRun.length >= HINT_MIN_NIGHTS;
	const tempQualifies = tempRun.length >= HINT_MIN_NIGHTS;
	if (!hrQualifies && !tempQualifies) return null;

	const observations: string[] = [];
	const starts: string[] = [];

	if (hrQualifies) {
		const peak = Math.max(...hrRun.map((n) => n.deviation));
		observations.push(
			`sovepulsen ligger ${Math.round(peak)} slag over snittet ditt ${hrRun.length} netter på rad`
		);
		starts.push(hrRun[0].date);
	}
	if (tempQualifies) {
		const peak = Math.max(...tempRun.map((n) => n.deviation));
		observations.push(
			`hudtemperaturen ligger ${fmt1(peak)} °C over snittet ditt ${tempRun.length} netter på rad`
		);
		starts.push(tempRun[0].date);
	}

	// Tidligste start av signalene som slo ut: perioden dekker hele avviket.
	const since = starts.sort()[0];
	const nights = Math.max(hrQualifies ? hrRun.length : 0, tempQualifies ? tempRun.length : 0);

	/**
	 * Teksten navngir observasjonen og nevner den andre forklaringen.
	 *
	 * Hard trening løfter sovepulsen den også, og vi kan ikke skille de to. Å late
	 * som vi kan ville gjort et forslag brukeren avviser til en påstand hen må
	 * korrigere — og neste gang ville hen ikke trodd på det.
	 */
	const text = `${capitalize(observations.join(', og '))}. Er du syk, eller er det hard trening?`;

	return { since, nights, observations, text };
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
