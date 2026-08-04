/**
 * Feltlogikken for dupper: gyldig varighet, og hva som kan endres på hva.
 *
 * Ligger i domenelaget fordi tre lag trenger den — `POST`/`PATCH /api/soevn/nap`
 * validerer med den, og flaten bruker den til å bestemme hvilke knapper en rad skal ha.
 * Duplisert ville grensene sprikt, og et felt som godtas av flaten men avvises av
 * endepunktet er den verste varianten.
 */

/** Under fem minutter er det ikke søvn; over tre timer er det en natt. */
export const NAP_MIN_MINUTES = 5;
export const NAP_MAX_MINUTES = 180;

/** Maks lengde på en notat-streng. Lengre er en dagbok, ikke en merknad. */
export const NAP_NOTE_MAX_LENGTH = 280;

export interface NapCapabilities {
	/** Varighet, tidspunkt og notat kan rettes. Bare manuelle dupper. */
	canEdit: boolean;
	/** Raden kan slettes helt. Bare manuelle dupper. */
	canDelete: boolean;
	/**
	 * Raden kan omklassifiseres til «ikke en dupp».
	 *
	 * Dette er alternativet for de **oppdagede** duppene. En Withings-måling kan ikke
	 * slettes meningsfullt — den er en ekte måling av at du lå stille, og raden ville
	 * dessuten kunne komme tilbake. Men klassifiseringen er vår, og den kan rettes:
	 * `isNapSleepEvent` leser et eksplisitt `data.isNap`, og søvnsynken skriver med
	 * `conflictMode: 'ignore'`, så overstyringen blir stående.
	 */
	canReclassify: boolean;
}

/**
 * Hva man kan gjøre med en dupp.
 *
 * Manuelle dupper er våre egne rader og kan rettes fritt. Oppdagede dupper eies av
 * Withings: der er omklassifisering det ærlige alternativet til en slett-knapp som
 * ville løyet om hva den gjorde.
 */
export function napCapabilities(nap: { manual: boolean }): NapCapabilities {
	return {
		canEdit: nap.manual,
		canDelete: nap.manual,
		canReclassify: !nap.manual
	};
}

/** Feilmeldingen, eller null når verdien er god. Samme tekst i flate og endepunkt. */
export function validateNapDuration(value: unknown): string | null {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 'Varigheten må være et tall.';
	}
	if (value < NAP_MIN_MINUTES || value > NAP_MAX_MINUTES) {
		return `Varigheten må være mellom ${NAP_MIN_MINUTES} og ${NAP_MAX_MINUTES} minutter.`;
	}
	return null;
}

/**
 * Normaliserer et notat. Tom streng blir null, altså «fjern notatet».
 *
 * Å skille tom streng fra `undefined` er poenget: `undefined` betyr «ikke rørt», tom
 * streng betyr «slett det som stod der».
 */
export function normalizeNapNote(value: unknown): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null) return null;
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim().slice(0, NAP_NOTE_MAX_LENGTH);
	return trimmed === '' ? null : trimmed;
}

/**
 * En dupp kan ikke ha startet i framtiden.
 *
 * Grensen er romslig med vilje — klokka på telefonen kan ligge et minutt foran
 * serveren, og å avvise et tidspunkt som er tolv sekunder «i framtiden» ville vært
 * uforståelig for den som logger en dupp de nettopp våknet fra.
 */
export const NAP_FUTURE_TOLERANCE_MINUTES = 5;

export function validateNapStart(at: Date, now: Date = new Date()): string | null {
	if (!(at instanceof Date) || Number.isNaN(at.getTime())) {
		return 'Ugyldig tidspunkt.';
	}
	if (at.getTime() > now.getTime() + NAP_FUTURE_TOLERANCE_MINUTES * 60_000) {
		return 'Tidspunktet kan ikke være i framtiden.';
	}
	return null;
}
