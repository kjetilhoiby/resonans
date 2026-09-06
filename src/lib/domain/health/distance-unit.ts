/**
 * Er en rå distanse meter eller kilometer?
 *
 * ## Hvorfor spørsmålet finnes
 *
 * `normalizeDistanceMeters` tolker enhver rå `data.distance` ≤ 80 som
 * KILOMETER, fordi noen kilder sender km i et felt som heter meter. For en
 * ekte økt er det riktig. For et fragment er det galt med faktor tusen: en
 * blipp på 52,9 meter blir 52,9 kilometer.
 *
 * **Tallet alene kan ikke avgjøre det.** 52,9 er en plausibel ultradistanse og
 * en plausibel GPS-blipp. Det var derfor heuristikken sto urørt i et halvt år.
 *
 * ## Varigheten avgjør det
 *
 * Farten gjør tolkningen entydig, og den er tilgjengelig i det samme
 * objektet. Målt i prod (2. april 2026, en rad to kilder var enige om):
 *
 * - distanse 52,9 · varighet 3 min → **1058 km/t** om det er kilometer
 * - distanse 52,9 · varighet 25 min → **127 km/t**
 *
 * Begge avvises av fysikken, ikke av en terskel noen har smakt seg fram til.
 * Og raden avslørte seg selv på flaten hele tiden: kortet viste «52,90 km» ved
 * siden av «62:23 /km», som er `198 s ÷ 0,0529 km`. Tempoet ble regnet av
 * METERNE mens distansen ble vist som kilometer — to felt på samme kort som
 * spriker med tusen. Ingen leste dem mot hverandre.
 *
 * Se `docs/changelog/2026-09-06-52-9-var-meter.md`.
 */

/**
 * Over dette er ingen egenframdrift plausibel, uansett idrett.
 *
 * 30 m/s er 108 km/t. Terskelen er med vilje langt over det noen faktisk
 * holder — en utforkjøring på sykkel ligger rundt 25 m/s — fordi vakten skal
 * avvise det UMULIGE, ikke dømme det uvanlige. En stram terskel her ville
 * begynt å omtolke ekte økter, og det er en verre feil enn den den retter.
 */
export const MAX_PLAUSIBLE_SPEED_MPS = 30;

/**
 * Distansen i meter, med enheten avgjort av farten når den kan avgjøres.
 *
 * `rawDistance` er verdien slik kilden skrev den, `durationSeconds` øktas
 * varighet. Returnerer `null` når det ikke finnes en brukbar distanse.
 *
 * **Uten varighet gjør vi som før.** Da finnes det ingen uavhengig måling å
 * avgjøre med, og en gjetning ville vært akkurat den feilen dette retter — bare
 * i motsatt retning. Det er en kjent rest: en rad uten varighet kan fortsatt
 * bli tusen ganger for lang.
 */
export function resolveDistanceMeters(
	rawDistance: unknown,
	durationSeconds: unknown
): number | null {
	if (typeof rawDistance !== 'number' || !Number.isFinite(rawDistance) || rawDistance <= 0) {
		return null;
	}

	// Over taket er verdien meter, og da er det ingenting å avgjøre.
	if (rawDistance > 80) return rawDistance;

	const asKilometres = rawDistance * 1000;

	const seconds =
		typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
			? durationSeconds
			: null;
	if (seconds === null) return asKilometres;

	// Krever km-tolkningen en umulig fart, var verdien meter hele tiden. Vi
	// finner ikke opp et tall: vi lar være å gange med tusen.
	return asKilometres / seconds > MAX_PLAUSIBLE_SPEED_MPS ? rawDistance : asKilometres;
}
