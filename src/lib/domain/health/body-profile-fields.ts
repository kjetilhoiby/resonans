/**
 * Feltlogikken i kroppsprofilen: gyldige spenn, parsing og hva som mangler.
 *
 * Ligger i domenelaget fordi tre lag trenger den — `PUT /api/helse/profil`
 * validerer med den, `readBodyProfile` leser med den, og innstillingsflaten viser
 * hva som gjenstår før hvileforbrenningen kan regnes. Duplisert ville grensene
 * sprikt, og et felt som godtas av flaten men avvises av endepunktet er den verste
 * varianten.
 */

import type { Sex } from './energy-expenditure';

/** Samme grenser som `basalMetabolicRate` krever for å svare med et tall. */
export const HEIGHT_MIN_CM = 120;
export const HEIGHT_MAX_CM = 230;
export const AGE_MIN_YEARS = 10;
export const AGE_MAX_YEARS = 110;

/**
 * Spennet aktivitetsfaktoren kan settes i.
 *
 * Taket er lavt med vilje. Standardtabeller går til 1,9 for «svært aktiv», men de
 * faktorene skal dekke *all* aktivitet inkludert trening — og vi legger øktene på
 * toppen. En bruker som setter 1,9 fordi hen trener mye, teller treningen to ganger.
 */
export const DESK_FACTOR_MIN = 1.1;
export const DESK_FACTOR_MAX = 1.9;

export interface BodyProfileFields {
	heightCm: number | null;
	birthYear: number | null;
	sex: Sex | null;
}

/**
 * Året fra en `YYYY-MM-DD`-streng, eller null.
 *
 * Null på tull og på urimelige år, slik at en halvutfylt dato ikke blir et
 * alderstall. Året er nok: Mifflin-St Jeor flytter seg ~5 kcal på ett års alder, så
 * en bursdag senere i året er under støygulvet.
 */
export function birthYearFromDate(
	birthDate: string | null | undefined,
	now: Date = new Date()
): number | null {
	if (!birthDate) return null;
	const match = /^(\d{4})-\d{2}-\d{2}$/.exec(birthDate);
	if (!match) return null;
	return isPlausibleBirthYear(Number(match[1]), now) ? Number(match[1]) : null;
}

export function isPlausibleBirthYear(year: unknown, now: Date = new Date()): boolean {
	if (typeof year !== 'number' || !Number.isInteger(year)) return false;
	const thisYear = now.getUTCFullYear();
	return year >= thisYear - AGE_MAX_YEARS && year <= thisYear - AGE_MIN_YEARS;
}

/** Alder i hele år fra fødselsår. Null når året mangler. */
export function ageFromBirthYear(birthYear: number | null, now: Date = new Date()): number | null {
	if (birthYear === null) return null;
	return now.getUTCFullYear() - birthYear;
}

/**
 * Feltene som mangler før hvileforbrenningen kan regnes, på norsk og i den
 * rekkefølgen flaten spør om dem.
 *
 * Vekt er med som argument framfor som felt: den kommer fra Withings og kan ikke
 * skrives inn, så «mangler vekt» er en helt annen beskjed enn «mangler høyde».
 */
export function missingProfileFields(
	fields: BodyProfileFields,
	opts: { weightKg?: number | null } = {}
): string[] {
	const missing: string[] = [];
	if (fields.heightCm === null) missing.push('høyde');
	if (fields.sex === null) missing.push('kjønn');
	if (fields.birthYear === null) missing.push('fødselsår');
	if (opts.weightKg === null || opts.weightKg === undefined) missing.push('vekt');
	return missing;
}

/**
 * Validerer én høyde. Returnerer feilmeldingen, eller null når verdien er god.
 *
 * Meldingen er den samme teksten endepunktet svarer med, slik at brukeren ikke får
 * to ulike forklaringer på samme avvisning.
 */
export function validateHeightCm(value: unknown): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) return 'Høyde må være et tall.';
	if (value < HEIGHT_MIN_CM || value > HEIGHT_MAX_CM) {
		return `Høyde må være mellom ${HEIGHT_MIN_CM} og ${HEIGHT_MAX_CM} cm.`;
	}
	return null;
}

export function validateDeskJobFactor(value: unknown): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 'Aktivitetsfaktoren må være et tall.';
	}
	if (value < DESK_FACTOR_MIN || value > DESK_FACTOR_MAX) {
		return `Aktivitetsfaktoren må være mellom ${nb(DESK_FACTOR_MIN)} og ${nb(DESK_FACTOR_MAX)}.`;
	}
	return null;
}

function nb(value: number): string {
	return String(value).replace('.', ',');
}
