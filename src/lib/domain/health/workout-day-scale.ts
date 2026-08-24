/**
 * Fargen og størrelsen på en treningsdag: hvor langt, og hvor fort.
 *
 * ## To akser i ett merke
 *
 * En streak-kalender som bare viser «møtte opp» skjuler forskjellen mellom en
 * rolig treningstur på tre kilometer og en hard tolv. Dagen bærer to tall, og de
 * svarer på ulike spørsmål: distansen er hvor mye, tempoet er hvor hardt.
 *
 *   LYSHET = tempo      lyst er fort, mørkt er rolig
 *   KULØR  = distanse   gult er kort, rødt er langt
 *
 * Én dimensjon, én kanal. Feltet interpoleres bilineært mellom fire hjørner, så en
 * dag midt på skalaen havner midt i fargefeltet framfor i nærmeste hjørne.
 *
 * ## Hvorfor arealet ble fjernet
 *
 * Første utgave la distansen i BÅDE areal og kulør, som ekstra sikkerhet. Det så
 * riktig ut i teorien og feilet i praksis: to kanaler som beveger seg sammen gjør at
 * bare diagonalen er synlig — «små gule flekker og store rosa flekker» — og
 * tempo-aksen drukner, fordi en størrelsesforskjell skriker høyere enn en
 * lyshetsforskjell. Leseren ser da ÉN akse der det er to.
 *
 * Med fast størrelse er farge den eneste variasjonen, og da er lysheten umiddelbart
 * synlig. Redundans er ikke gratis: den koster den andre dimensjonen.
 *
 * ## Lysheten er BARE tempo
 *
 * Fristelsen er å gi de lange dagene litt mørkere farge også — det ser rikere ut.
 * Da er lysheten ikke lenger tempo alene, og en lang, rask dag leses som roligere
 * enn en kort, rask. Kroma og kulør varierer med distansen; lysheten aldri.
 *
 * ## Hva fargevalget koster, og hva som ble rettet
 *
 * Kulør-aksen er et bevisst valg fra brukeren: flaten skal være vakker og
 * informativ for den som ser farger godt. Prisen står i validatoren — de to mørke
 * hjørnene skiller seg med **ΔE 3,6 under deuteranopi**, altså er distanse-aksen
 * praktisk borte for en rødgrønn-blind leser. Det er akseptert her: dette er en
 * personlig flate, og verdiene finnes som tall ved trykk.
 *
 * Tre funn fra validatoren handlet ikke om fargesyn, og de er rettet i tallene
 * under:
 *
 * 1. Første utgave hadde de mørke hjørnene på 2,0–2,2:1 mot flaten — nesten
 *    usynlige blokker. Nå er alle fire hjørner over 3:1.
 * 2. Mørk gul er oliven og falt under kromagulvet (C 0,084, «leses som grå»).
 *    Kuløren er dreid mot 105° og kroma hevet, så den mørke enden fortsatt har
 *    farge.
 * 3. De to hjørnene med samme tempo lå på ΔE 12,6 for normalt fargesyn, under
 *    gulvet på 15. Med et bredere kulørspenn (105° → 22°) er de på **16,8**.
 *
 * Lys rød kan ikke bli mettet i sRGB — den blir korall. Det er en gamut-grense, ikke
 * et valg: lysheten eies av tempoet, så den kan ikke senkes for å gi rødt mer kroma.
 *
 * ## Skalaen er brukerens egen
 *
 * «Langt» og «fort» finnes ikke absolutt. Spennet regnes fra brukerens egne dager
 * (10.–90. persentil), så en som løper 3–6 km får hele skalaen brukt på 3–6 km.
 * Persentiler framfor min/maks: én glemt tracker med 2 t 20 min på 9 km ville
 * ellers presset alle andre dager sammen i den lyse enden.
 *
 * Gulv på spennet (`MIN_*_SPAN_*`) hindrer det motsatte: er alle turene like, skal
 * de SE like ut. Uten gulvet ville tretti sekunders forskjell i tempo blitt tegnet
 * som hele skalaen — samme lærdom som `MIN_AXIS_SPAN` i vektgrafen.
 */

import { inkForLightness, oklchToHex } from '../oklch';

/**
 * Feltets fire hjørner. Validert mot flaten #141414: normalsyn-gulv ΔE 16,8 (over
 * 15) og alle fire hjørner over 3:1 kontrast.
 *
 * Lysheten er tempoets akse alene — samme verdi for kort og lang tur.
 */
export const L_FAST = 0.87;
export const L_SLOW = 0.52;
/** Kulør: gul for kort, rød for lang. */
export const HUE_SHORT = 105;
export const HUE_LONG = 22;
/** Kroma per kulør, før tapering mot den mørke enden. */
export const CHROMA_SHORT = 0.18;
export const CHROMA_LONG = 0.19;
/**
 * Hvor mye kroma gir seg i den mørke enden.
 *
 * Uten taperingen ba vi om metning sRGB ikke har på mørke farger, og gamut-klippet
 * tok den likevel — men da uforutsigbart per kulør. Bedre å be om det som finnes.
 */
export const CHROMA_DARK_TAPER = 0.25;

/** Under dette er det ingen fordeling å normalisere mot. */
export const MIN_MEASURED_DAYS = 5;

/** Gulv på spennet, så små forskjeller ikke tegnes som hele skalaen. */
export const MIN_DISTANCE_SPAN_KM = 2;
export const MIN_PACE_SPAN_SEC = 30;

export interface WorkoutDayMetrics {
	date: string;
	/** Antall økter den dagen. */
	count: number;
	/** Sum distanse for dagen, eller null når ingen økt hadde distanse. */
	distanceKm: number | null;
	/** Dagens vektede tempo (total tid / total distanse), sek per km. */
	paceSecPerKm: number | null;
}

export interface DayScale {
	distance: { min: number; max: number };
	/** `min` er det RASKESTE tempoet (lavest sek/km) og tegnes lysest. */
	pace: { min: number; max: number };
	/** Dager med begge tallene. Under `MIN_MEASURED_DAYS` brukes ikke skalaen. */
	measuredDays: number;
	usable: boolean;
}

export interface DayVisual {
	fill: string;
	/** Skriftfarge som holder kontrast mot `fill`. */
	ink: string;
}

/**
 * Dag med hendelse, men uten tall å fargelegge etter.
 *
 * Nesten uten kroma, og med vilje: den skal ikke kunne forveksles med et hjørne i
 * feltet. En styrkeøkt inne i en løpestreak møtte opp — den var ikke rolig.
 */
export const NO_METRIC_VISUAL: DayVisual = {
	fill: oklchToHex(0.44, 0.015, 70),
	ink: inkForLightness(0.44)
};

function percentile(sorted: number[], p: number): number {
	if (sorted.length === 1) return sorted[0];
	const index = (sorted.length - 1) * p;
	const lo = Math.floor(index);
	const hi = Math.ceil(index);
	return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}

/** Utvider et spenn til gulvet, symmetrisk om midtpunktet. */
function widen(min: number, max: number, floor: number): { min: number; max: number } {
	const span = max - min;
	if (span >= floor) return { min, max };
	const mid = (min + max) / 2;
	return { min: mid - floor / 2, max: mid + floor / 2 };
}

export function buildDayScale(days: readonly WorkoutDayMetrics[]): DayScale {
	const measured = days.filter(
		(d): d is WorkoutDayMetrics & { distanceKm: number; paceSecPerKm: number } =>
			typeof d.distanceKm === 'number' &&
			d.distanceKm > 0 &&
			typeof d.paceSecPerKm === 'number' &&
			d.paceSecPerKm > 0
	);

	const empty: DayScale = {
		distance: { min: 0, max: 0 },
		pace: { min: 0, max: 0 },
		measuredDays: measured.length,
		usable: false
	};
	if (measured.length < MIN_MEASURED_DAYS) return empty;

	const distances = measured.map((d) => d.distanceKm).sort((a, b) => a - b);
	const paces = measured.map((d) => d.paceSecPerKm).sort((a, b) => a - b);

	return {
		distance: widen(
			percentile(distances, 0.1),
			percentile(distances, 0.9),
			MIN_DISTANCE_SPAN_KM
		),
		pace: widen(percentile(paces, 0.1), percentile(paces, 0.9), MIN_PACE_SPAN_SEC),
		measuredDays: measured.length,
		usable: true
	};
}

function normalize(value: number, range: { min: number; max: number }): number {
	const span = range.max - range.min;
	if (span <= 0) return 0.5;
	return Math.min(1, Math.max(0, (value - range.min) / span));
}

/**
 * Fargen i et punkt av feltet. `paceT` 0 = raskest, `distanceT` 0 = kortest.
 *
 * Delt med tegnforklaringen, så prøvene der ER feltet og ikke en håndplukket
 * etterligning av det.
 */
export function fieldColor(paceT: number, distanceT: number): { fill: string; ink: string } {
	const p = Math.min(1, Math.max(0, paceT));
	const d = Math.min(1, Math.max(0, distanceT));

	const L = L_FAST + (L_SLOW - L_FAST) * p;
	const hue = HUE_SHORT + (HUE_LONG - HUE_SHORT) * d;
	const chroma = (CHROMA_SHORT + (CHROMA_LONG - CHROMA_SHORT) * d) * (1 - CHROMA_DARK_TAPER * p);

	return { fill: oklchToHex(L, chroma, hue), ink: inkForLightness(L) };
}

/**
 * Hvordan dagen skal tegnes. Null når dagen ikke har hendelser i det hele tatt —
 * kalleren tegner da en tom celle.
 */
export function dayVisual(metrics: WorkoutDayMetrics, scale: DayScale): DayVisual | null {
	if (metrics.count <= 0) return null;
	if (!scale.usable || metrics.distanceKm === null || metrics.paceSecPerKm === null) {
		return NO_METRIC_VISUAL;
	}

	return fieldColor(
		normalize(metrics.paceSecPerKm, scale.pace),
		normalize(metrics.distanceKm, scale.distance)
	);
}

/**
 * Tegnforklaringen: feltets fire hjørner, i det samme rutenettet aksene har.
 *
 * Fire ruter framfor ni: hjørnene er det leseren skal kunne kjenne igjen («liten og
 * blek» mot «stor og mørk rød»), og alt mellom dem leses som en retning. Ni ruter
 * ville krevd oppslag i to akser samtidig i en rute på seksten piksler.
 *
 * Radene er tempo (rask først), kolonnene distanse (kort først) — samme rekkefølge
 * som etikettene i flaten.
 */
export function legendSamples(): DayVisual[][] {
	return [0, 1].map((paceT) => [0, 1].map((distanceT) => fieldColor(paceT, distanceT)));
}
