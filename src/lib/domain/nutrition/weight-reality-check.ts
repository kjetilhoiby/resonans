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
 */

import { KCAL_PER_KG_FAT } from './energy-balance';

/** Færre dager enn dette, og vektstøy dominerer helt. */
export const MIN_DAYS_FOR_VERDICT = 14;

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

	const first = weights[0];
	const last = weights[weights.length - 1];
	const spanDays = daysBetween(first.date, last.date);
	if (spanDays <= 0) return null;

	// Bare balanser innenfor vektvinduet — en logget dag utenfor sier ingenting om
	// vektendringen vi måler.
	const inWindow = balances.filter((b) => b.date >= first.date && b.date <= last.date);
	if (inWindow.length === 0) return null;

	const totalBalance = inWindow.reduce((sum, b) => sum + b.balanceKcal, 0);
	const predictedKg = totalBalance / KCAL_PER_KG_FAT;
	const observedKg = last.kg - first.kg;

	// Avviket fordeles på dagene vi faktisk har balanse for, ikke på hele vinduet:
	// det er de dagene regnestykket er gjort.
	const errorKcal = (observedKg - predictedKg) * KCAL_PER_KG_FAT;
	const impliedDailyErrorKcal = Math.round(errorKcal / inWindow.length);

	return {
		days: inWindow.length,
		predictedKg: Math.round(predictedKg * 100) / 100,
		observedKg: Math.round(observedKg * 100) / 100,
		impliedDailyErrorKcal,
		conclusive: spanDays >= MIN_DAYS_FOR_VERDICT,
		balanceIsOff:
			spanDays >= MIN_DAYS_FOR_VERDICT &&
			Math.abs(impliedDailyErrorKcal) > NOISE_FLOOR_KCAL_PER_DAY
	};
}

function daysBetween(from: string, to: string): number {
	const a = Date.parse(`${from}T00:00:00Z`);
	const b = Date.parse(`${to}T00:00:00Z`);
	if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
	return Math.round((b - a) / 86_400_000);
}
