// Mengdeenheter for oppskrifter, lager og handleliste.
//
// Fram til november 2026 ble mengder bare summert når enheten var BYTE-lik, og
// lageret ble lest som ja/nei: «kjøttdeig» på lager fjernet kjøttdeigen fra
// handlelista uansett om det lå 100 g eller 2 kg der. To retter med 400 g og
// 0,5 kg ble to tall som ikke kunne legges sammen. Se
// docs/changelog/2026-11-24-middagsplanen-som-fasit.md.
//
// Regelen er bevisst smal: vekt mot vekt, volum mot volum, antall mot antall.
// Vi regner aldri om mellom vekt og volum (en dl mel er ikke en dl melk), og en
// enhet vi ikke kjenner («boks», «pose») er bare lik seg selv.

export type BaseUnit = 'g' | 'ml' | 'stk' | string;

const UNIT_TABLE: Record<string, { base: BaseUnit; factor: number }> = {
	g: { base: 'g', factor: 1 },
	gr: { base: 'g', factor: 1 },
	gram: { base: 'g', factor: 1 },
	kg: { base: 'g', factor: 1000 },
	kilo: { base: 'g', factor: 1000 },
	ml: { base: 'ml', factor: 1 },
	cl: { base: 'ml', factor: 10 },
	dl: { base: 'ml', factor: 100 },
	l: { base: 'ml', factor: 1000 },
	liter: { base: 'ml', factor: 1000 },
	ss: { base: 'ml', factor: 15 },
	ts: { base: 'ml', factor: 5 },
	stk: { base: 'stk', factor: 1 },
	'stk.': { base: 'stk', factor: 1 },
	stykk: { base: 'stk', factor: 1 },
	stykker: { base: 'stk', factor: 1 }
};

/** Normalisert enhet: tom enhet er antall («2 løk»). Ukjente enheter står for seg selv. */
export function normalizeUnit(unit: string | null | undefined): { base: BaseUnit; factor: number } {
	const key = (unit ?? '').trim().toLowerCase();
	if (!key) return { base: 'stk', factor: 1 };
	return UNIT_TABLE[key] ?? { base: key, factor: 1 };
}

/** Mengde i grunnenhet (g, ml, stk eller den ukjente enheten selv). */
export function toBase(quantity: number, unit: string | null | undefined): { amount: number; base: BaseUnit } {
	const { base, factor } = normalizeUnit(unit);
	return { amount: quantity * factor, base };
}

/** Kan to enheter summeres eller trekkes fra hverandre? */
export function sameDimension(a: string | null | undefined, b: string | null | undefined): boolean {
	return normalizeUnit(a).base === normalizeUnit(b).base;
}

/**
 * Skriv en grunnmengde tilbake i en lesbar enhet: 1500 g blir 1,5 kg, 250 ml blir
 * 2,5 dl. Antall og ukjente enheter står som de er.
 */
export function fromBase(amount: number, base: BaseUnit): { quantity: number; unit: string | null } {
	if (base === 'g') {
		return amount >= 1000 ? { quantity: round(amount / 1000, 2), unit: 'kg' } : { quantity: round(amount, 0), unit: 'g' };
	}
	if (base === 'ml') {
		if (amount >= 1000) return { quantity: round(amount / 1000, 2), unit: 'l' };
		if (amount >= 100) return { quantity: round(amount / 100, 1), unit: 'dl' };
		return { quantity: round(amount, 0), unit: 'ml' };
	}
	if (base === 'stk') return { quantity: round(amount, 1), unit: null };
	return { quantity: round(amount, 2), unit: base };
}

function round(value: number, decimals: number): number {
	const f = 10 ** decimals;
	return Math.round(value * f) / f;
}

/**
 * Skaler en mengde fra oppskriftens porsjoner til familiens. Antall rundes opp til
 * halve (en halv løk finnes, 2,4 løk gjør ikke), alt annet til et lesbart tall.
 */
export function scaleQuantity(
	quantity: number | null | undefined,
	unit: string | null | undefined,
	fromServings: number,
	toServings: number
): number | null {
	if (quantity == null || !Number.isFinite(quantity)) return null;
	if (!(fromServings > 0) || !(toServings > 0)) return quantity;
	const scaled = (quantity * toServings) / fromServings;
	if (normalizeUnit(unit).base === 'stk') return Math.ceil(scaled * 2) / 2;
	return scaled >= 10 ? Math.round(scaled) : round(scaled, 1);
}
