/**
 * Vekta som dommer over energibalansen.
 *
 * ## Hvorfor denne finnes
 *
 * Brukeren sa det som avgjorde saken: *«Hvis dette var i nærheten av å stemme
 * hadde jeg gått raskt ned i vekt, men det gjør jeg jo ikke.»*
 *
 * Et underskudd på 1 300 kcal om dagen er 1,2 kg i uka. Holder vekta seg, er
 * regnestykket feil — uansett hvor pent det er satt opp. Og feilen kan ligge på
 * begge sider: forbruket kan være for høyt, eller inntaket kan være underlogget.
 * Termodynamikken lyver ikke, men *begge* måletallene kan.
 *
 * Denne modulen bruker derfor observert vektendring til å regne ut hvor mye
 * balansen er feil per dag. Det er den ene kontrollen som ikke lener seg på at
 * loggen er komplett.
 *
 * ## Hva den ikke er
 *
 * Ikke en korreksjon. Vi justerer ingen tall automatisk — vektsvingninger på kort
 * horisont er mest vann og tarminnhold, og et par uker er minimum før trenden
 * betyr noe. Den sier bare hvor stort avviket er, slik at man vet om et
 * «underskudd» er ekte.
 *
 * ## Feilen denne modulen gjorde først
 *
 * Første utgave gatet på **vektspennet**, ikke på hvor mange dager som faktisk var
 * logget. Brukeren hadde 60 dager med vektmålinger og *én* logget dag, så porten
 * åpnet seg og hele periodens vektendring ble tilskrevet den ene dagen: «0,7 kg ned
 * tilsvarer 3 245 kcal per dag». Meningsløst, og vist med selvtillit.
 *
 * To ting måtte til. Dommen krever nå at de loggede dagene **dekker** vinduet de
 * sammenlignes med, og vektendringen måles som forskjell mellom *snitt* i starten og
 * slutten framfor mellom to enkeltmålinger. To målinger er nettopp det brukeren
 * advarte mot: vann, fordøyelse og tid på døgnet.
 */

import { KCAL_PER_KG_FAT } from './energy-balance';

/** Færre dager enn dette, og vektstøy dominerer helt. */
export const MIN_DAYS_FOR_VERDICT = 14;

/**
 * Hvor stor andel av vinduet som må ha logget inntak.
 *
 * Uten dette kravet kan én logget dag i et 60-dagers vindu «forklare» all
 * vektendring. Regnestykket gjelder bare de dagene det er gjort på.
 */
export const MIN_LOGGED_COVERAGE = 0.7;

/** Dager i hver ende som snittes, så enkeltmålinger ikke styrer dommen. */
export const TREND_WINDOW_DAYS = 7;

/** Avvik under dette er innenfor det målestøyen kan forklare. */
export const NOISE_FLOOR_KCAL_PER_DAY = 200;

export interface DailyBalance {
	date: string;
	/** Negativt = underskudd. Samme fortegn som `computeEnergyBalance`. */
	balanceKcal: number;
}

export interface WeightPoint {
	date: string;
	kg: number;
}

export interface RealityCheck {
	days: number;
	/** Dager i vektvinduet. */
	spanDays: number;
	/** Andel av vinduet som har logget inntak, 0–1. */
	loggedCoverage: number;
	/** Vektendringen balansen forutsier, i kg. Negativt = nedgang. */
	predictedKg: number;
	/** Vektendringen som faktisk skjedde. */
	observedKg: number;
	/**
	 * Hvor mye balansen bommer per dag. Positivt betyr at det reelle inntaket var
	 * HØYERE enn logget, eller forbruket lavere — altså at underskuddet var mindre
	 * enn regnestykket sa.
	 */
	impliedDailyErrorKcal: number;
	/** Nok dager til å si noe? */
	conclusive: boolean;
	/** Sant når avviket er større enn målestøyen kan forklare. */
	balanceIsOff: boolean;
}

/**
 * Null når det ikke er nok å regne på: under to vektmålinger, eller ingen dager
 * med balanse.
 *
 * Vi krever ikke at hver dag har en vektmåling — vekta måles ikke daglig av alle.
 * Første og siste måling i vinduet holder.
 */
export function checkAgainstWeight(input: {
	balances: DailyBalance[];
	weights: WeightPoint[];
}): RealityCheck | null {
	const balances = input.balances.filter((b) => Number.isFinite(b.balanceKcal));
	const weights = [...input.weights]
		.filter((w) => Number.isFinite(w.kg) && w.kg > 0)
		.sort((a, b) => a.date.localeCompare(b.date));

	if (balances.length === 0 || weights.length < 2) return null;

	const firstDate = weights[0].date;
	const lastDate = weights[weights.length - 1].date;
	const spanDays = daysBetween(firstDate, lastDate);
	if (spanDays <= 0) return null;

	// Bare balanser innenfor vektvinduet — en logget dag utenfor sier ingenting om
	// vektendringen vi måler.
	const inWindow = balances.filter((b) => b.date >= firstDate && b.date <= lastDate);
	if (inWindow.length === 0) return null;

	// Snitt i hver ende, ikke enkeltmålinger: vekt svinger med vann, fordøyelse og
	// tid på døgnet, og to punkter kan gi et helt annet svar enn trenden.
	const startAvg = averageWithin(weights, firstDate, addDays(firstDate, TREND_WINDOW_DAYS));
	const endAvg = averageWithin(weights, addDays(lastDate, -TREND_WINDOW_DAYS), lastDate);
	if (startAvg === null || endAvg === null) return null;

	const totalBalance = inWindow.reduce((sum, b) => sum + b.balanceKcal, 0);
	const predictedKg = totalBalance / KCAL_PER_KG_FAT;
	const observedKg = endAvg - startAvg;

	// Avviket fordeles på dagene vi faktisk har balanse for, ikke på hele vinduet:
	// det er de dagene regnestykket er gjort.
	const errorKcal = (observedKg - predictedKg) * KCAL_PER_KG_FAT;
	const impliedDailyErrorKcal = Math.round(errorKcal / inWindow.length);

	// Dekningen er den avgjørende porten. Én logget dag kan ikke forklare 60 dagers
	// vektendring, uansett hvor lang vektserien er.
	const loggedCoverage = inWindow.length / (spanDays + 1);
	const conclusive = spanDays >= MIN_DAYS_FOR_VERDICT && loggedCoverage >= MIN_LOGGED_COVERAGE;

	return {
		days: inWindow.length,
		spanDays,
		loggedCoverage: Math.round(loggedCoverage * 100) / 100,
		predictedKg: Math.round(predictedKg * 100) / 100,
		observedKg: Math.round(observedKg * 100) / 100,
		impliedDailyErrorKcal,
		conclusive,
		balanceIsOff: conclusive && Math.abs(impliedDailyErrorKcal) > NOISE_FLOOR_KCAL_PER_DAY
	};
}

/** Snittvekt i et datointervall, eller null når intervallet er tomt. */
function averageWithin(weights: WeightPoint[], from: string, to: string): number | null {
	const inRange = weights.filter((w) => w.date >= from && w.date <= to);
	if (inRange.length === 0) return null;
	return inRange.reduce((sum, w) => sum + w.kg, 0) / inRange.length;
}

function addDays(date: string, days: number): string {
	const ms = Date.parse(`${date}T00:00:00Z`);
	if (!Number.isFinite(ms)) return date;
	return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
	return Math.round((b - a) / 86_400_000);
}
