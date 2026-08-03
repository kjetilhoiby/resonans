/**
 * Hvor langt på dagen inntaket ligger.
 *
 * ## Hvorfor dette er en egen ting
 *
 * Brukeren beskrev en konkret opplevelse: *«I dag falt jeg litt gjennom og var
 * veldig sulten i 15-17-tida.»*
 *
 * Loggen forklarer det presist. Frokost kl. 07:10 var 62 kcal (kefir og kaffe),
 * lunsj kl. 12:01 var 242. Altså **304 kcal før klokka 15**, på en dag som endte
 * over 3 000 i forbruk. Sultkrisa var ikke et mysterium, den var aritmetikk.
 *
 * Et dagstall alene kan ikke fange dette: 2 600 kcal fordelt som 300 før 15 og
 * 2 300 etter er en helt annen dag enn 2 600 jevnt fordelt, selv om summen er
 * identisk. Derfor måles inntaket mot hvor langt på dagen man er.
 *
 * ## Forventningskurven
 *
 * Ikke lineær. Folk spiser ikke mens de sover, og en jevn fordeling over 24 timer
 * ville sagt at man skulle vært på 25 % kl. 06. Kurven under er grov og bygget på
 * måltidsmønsteret loggen forutsetter — frokost, lunsj, middag, kvelds — og skal
 * leses som «omtrent her», ikke som en norm.
 */

/**
 * Andel av dagens energi man normalt har fått i seg ved gitt Oslo-time.
 *
 * Punktene er satt etter måltidsslotene i `meal-slots.ts`: frokost rundt 7,
 * lunsj rundt 11–12, middag 16–18, kvelds 20–21.
 */
const EXPECTED_SHARE_BY_HOUR: Array<[hour: number, share: number]> = [
	[6, 0],
	[9, 0.15],
	[12, 0.35],
	[15, 0.45],
	[18, 0.72],
	[21, 0.92],
	[24, 1]
];

/** Under dette regnes man ikke som «bak» — normal variasjon. */
export const BEHIND_THRESHOLD = 0.15;

export interface IntakePacing {
	osloHour: number;
	/** Andel av dagsmålet man har fått i seg. Null uten mål. */
	actualShare: number | null;
	/** Andel man normalt ville hatt på dette klokkeslettet. */
	expectedShare: number;
	/** Faktisk minus forventet. Negativt = bak skjema. Null uten mål. */
	deltaShare: number | null;
	/** Sant når man ligger merkbart bak — den vanligste årsaken til sultkrise. */
	behind: boolean;
	kcalSoFar: number;
	proteinSoFar: number;
	/** Kcal man normalt ville hatt nå. Null uten mål. */
	expectedKcalByNow: number | null;
}

/** Nåværende time på Osloklokka, som desimal (14:30 → 14,5). */
export function osloHourNow(now: Date = new Date()): number {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Oslo',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(now);
	const [hour, minute] = parts.split(':').map(Number);
	if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 12;
	return hour + minute / 60;
}

/** Forventet andel ved gitt time, lineært interpolert mellom punktene. */
export function expectedShareAtHour(osloHour: number): number {
	const hour = Math.max(0, Math.min(24, osloHour));
	if (hour <= EXPECTED_SHARE_BY_HOUR[0][0]) return 0;

	for (let i = 1; i < EXPECTED_SHARE_BY_HOUR.length; i++) {
		const [prevHour, prevShare] = EXPECTED_SHARE_BY_HOUR[i - 1];
		const [nextHour, nextShare] = EXPECTED_SHARE_BY_HOUR[i];
		if (hour <= nextHour) {
			const t = (hour - prevHour) / (nextHour - prevHour);
			return prevShare + t * (nextShare - prevShare);
		}
	}
	return 1;
}

export function describeIntakePacing(input: {
	kcalSoFar: number;
	proteinSoFar: number;
	targetKcal: number | null;
	targetProteinG: number | null;
	osloHour: number;
}): IntakePacing {
	const { kcalSoFar, proteinSoFar, targetKcal, osloHour } = input;
	const expectedShare = expectedShareAtHour(osloHour);

	const actualShare =
		typeof targetKcal === 'number' && targetKcal > 0 ? kcalSoFar / targetKcal : null;
	const deltaShare = actualShare === null ? null : actualShare - expectedShare;

	return {
		osloHour: Math.round(osloHour * 10) / 10,
		actualShare: actualShare === null ? null : Math.round(actualShare * 100) / 100,
		expectedShare: Math.round(expectedShare * 100) / 100,
		deltaShare: deltaShare === null ? null : Math.round(deltaShare * 100) / 100,
		behind: deltaShare !== null && deltaShare < -BEHIND_THRESHOLD,
		kcalSoFar: Math.round(kcalSoFar),
		proteinSoFar: Math.round(proteinSoFar),
		expectedKcalByNow:
			typeof targetKcal === 'number' && targetKcal > 0
				? Math.round(targetKcal * expectedShare)
				: null
	};
}
