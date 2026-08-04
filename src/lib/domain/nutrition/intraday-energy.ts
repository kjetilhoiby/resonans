/**
 * Spist mot forbrent **så langt i dag**, som to kumulative kurver.
 *
 * ## Hvorfor dette er mer enn en ny graf
 *
 * Flaten viste 3. august «Spist 1 214 · Forbrent 2 742» kl. 17:03. De to tallene måler
 * ulike ting: inntaket er så langt, forbruket er et anslag for **hele døgnet**. Derfor
 * har differansen mellom dem aldri vært et underskudd man kunne handle på — den starter
 * på sitt maksimum ved midnatt og krymper utover dagen. `frameDay` løser det ved å bytte
 * etikett til «Igjen i dag».
 *
 * En kumulativ forbrukskurve løser den samme feilen på ordentlig: begge sidene blir «så
 * langt», og gapet mellom kurvene kl. 15 er da et *reelt* gap. Det er også det gapet man
 * kjenner som sult, og som gjør formen verdt å se — man ser **når** det åpnet seg.
 *
 * ## Forbrukskurven er modellert, ikke målt
 *
 * Vi kjenner døgnanslaget, ikke fordelingen utover dagen. Modellen er tre ledd:
 *
 * 1. **Hvilestoffskiftet** fordeles jevnt over døgnet. Det brenner mens du sover.
 * 2. **Kontorpåslaget** (`baselineKcal − basalKcal`) fordeles bare over våken tid. Dette
 *    er leddet som betyr noe: legger man det jevnt utover, har man «forbrent» en femtedel
 *    av dagens bevegelse kl. 05 mens man sov.
 * 3. **Øktene** legges inn der de faktisk skjedde, som et jevnt påslag over øktas
 *    minutter.
 *
 * `expenditureModelled: true` er alltid sant, og flaten skal si det. Withings' intraday
 * kunne gitt en målt kurve, men døgnanslaget vårt kan ikke — og et modellert tall som
 * presenteres som målt er verre enn et ærlig anslag.
 */

/** Våkenvinduet kontorpåslaget fordeles over. En antakelse, ikke en måling. */
export const WAKE_HOUR = 7;
export const SLEEP_HOUR = 23;

/** Oppløsningen på kurven. 15 minutter gir 96 punkter — nok til en jevn linje. */
export const STEP_MINUTES = 15;

export const MINUTES_PER_DAY = 24 * 60;

export interface IntradayMeal {
	/** Minutter etter midnatt Oslo. */
	minute: number;
	kcal: number;
}

export interface IntradayWorkout {
	/** Minutter etter midnatt Oslo når økta startet. */
	startMinute: number;
	durationMinutes: number;
	kcal: number;
}

export interface IntradayPoint {
	minute: number;
	/** Kumulativt inntak til og med dette minuttet. */
	intakeKcal: number;
	/** Kumulativt modellert forbruk til og med dette minuttet. */
	expenditureKcal: number;
}

export interface IntradayEnergy {
	/** Punkter fra 00:00 til og med `nowMinute`, i STEP_MINUTES-steg. */
	points: IntradayPoint[];
	/** Resten av døgnet, til den dempede projeksjonen. Tom etter midnatt. */
	projection: IntradayPoint[];
	nowMinute: number;
	intakeNow: number;
	expenditureNow: number;
	/** Forbrent minus spist, så langt. Positivt = underskudd så langt. */
	gapNow: number;
	/** Døgnanslaget, altså der projeksjonen ender. */
	expenditureFullDay: number;
	/** Høyeste verdi noen kurve når, inkludert projeksjonen. Til y-aksen. */
	maxKcal: number;
	/** Alltid sant. Se modulkommentaren — kurven er en modell. */
	expenditureModelled: boolean;
}

/**
 * Modellert kumulativt forbruk ved et gitt minutt.
 *
 * Eksportert fordi den er kjernen i modellen og verdt å teste for seg.
 */
export function expenditureAtMinute(
	minute: number,
	input: { basalKcal: number; baselineKcal: number; workouts: IntradayWorkout[] }
): number {
	const clamped = Math.max(0, Math.min(MINUTES_PER_DAY, minute));

	// 1. Hvile, jevnt over døgnet.
	const basal = (input.basalKcal / MINUTES_PER_DAY) * clamped;

	// 2. Kontorpåslaget, jevnt over våken tid.
	const uplift = Math.max(0, input.baselineKcal - input.basalKcal);
	const wakeStart = WAKE_HOUR * 60;
	const wakeEnd = SLEEP_HOUR * 60;
	const wakeMinutes = wakeEnd - wakeStart;
	const wakeElapsed = Math.max(0, Math.min(wakeMinutes, clamped - wakeStart));
	const upliftSoFar = wakeMinutes > 0 ? (uplift / wakeMinutes) * wakeElapsed : 0;

	// 3. Øktene, fordelt over sine egne minutter.
	let workoutSoFar = 0;
	for (const workout of input.workouts) {
		if (workout.kcal <= 0) continue;
		const duration = Math.max(1, workout.durationMinutes);
		const elapsed = Math.max(0, Math.min(duration, clamped - workout.startMinute));
		workoutSoFar += (workout.kcal / duration) * elapsed;
	}

	return basal + upliftSoFar + workoutSoFar;
}

/** Kumulativt inntak ved et gitt minutt. Trappefunksjon — måltider er hendelser. */
export function intakeAtMinute(minute: number, meals: IntradayMeal[]): number {
	let total = 0;
	for (const meal of meals) {
		if (meal.minute <= minute) total += meal.kcal;
	}
	return total;
}

/**
 * Kurvene for i dag.
 *
 * `basalKcal`/`baselineKcal` kommer fra vårt eget forbruksanslag. Uten dem finnes ingen
 * kurve å tegne, og funksjonen returnerer null framfor å gjette — samme regel som
 * `estimateDailyExpenditure`.
 */
export function buildIntradayEnergy(input: {
	nowMinute: number;
	basalKcal: number | null;
	baselineKcal: number | null;
	meals: IntradayMeal[];
	workouts: IntradayWorkout[];
}): IntradayEnergy | null {
	const { basalKcal, baselineKcal } = input;
	if (
		typeof basalKcal !== 'number' ||
		typeof baselineKcal !== 'number' ||
		!Number.isFinite(basalKcal) ||
		!Number.isFinite(baselineKcal) ||
		basalKcal <= 0
	) {
		return null;
	}

	const nowMinute = Math.max(0, Math.min(MINUTES_PER_DAY, Math.round(input.nowMinute)));
	const meals = input.meals.filter((meal) => Number.isFinite(meal.kcal) && meal.kcal > 0);
	const model = { basalKcal, baselineKcal, workouts: input.workouts };

	/**
	 * Måltidsminuttene er egne punkter i tillegg til rutenettet. Uten dem ville en
	 * trappefunksjon på 15-minutters rutenett flyttet et måltid opptil et kvarter, og
	 * middagen kunne sett ut som den kom etter en nudge som ble sendt før den.
	 */
	const minutes = new Set<number>([0, nowMinute]);
	for (let m = 0; m <= nowMinute; m += STEP_MINUTES) minutes.add(m);
	for (const meal of meals) {
		if (meal.minute <= nowMinute) minutes.add(meal.minute);
	}

	const points = [...minutes]
		.sort((a, b) => a - b)
		.map((minute) => ({
			minute,
			intakeKcal: Math.round(intakeAtMinute(minute, meals)),
			expenditureKcal: Math.round(expenditureAtMinute(minute, model))
		}));

	const projection: IntradayPoint[] = [];
	for (let m = nowMinute; m <= MINUTES_PER_DAY; m += STEP_MINUTES) {
		projection.push({
			minute: m,
			// Inntaket projiseres ikke: vi vet ikke hva som blir spist, og en flat linje
			// ut dagen ville påstått at man ikke spiser mer.
			intakeKcal: Math.round(intakeAtMinute(nowMinute, meals)),
			expenditureKcal: Math.round(expenditureAtMinute(m, model))
		});
	}
	if (projection.length > 0 && projection[projection.length - 1].minute !== MINUTES_PER_DAY) {
		projection.push({
			minute: MINUTES_PER_DAY,
			intakeKcal: Math.round(intakeAtMinute(nowMinute, meals)),
			expenditureKcal: Math.round(expenditureAtMinute(MINUTES_PER_DAY, model))
		});
	}

	const intakeNow = Math.round(intakeAtMinute(nowMinute, meals));
	const expenditureNow = Math.round(expenditureAtMinute(nowMinute, model));
	const expenditureFullDay = Math.round(expenditureAtMinute(MINUTES_PER_DAY, model));

	return {
		points,
		projection,
		nowMinute,
		intakeNow,
		expenditureNow,
		gapNow: expenditureNow - intakeNow,
		expenditureFullDay,
		maxKcal: Math.max(expenditureFullDay, intakeNow, 1),
		expenditureModelled: true
	};
}

/** Minutter etter midnatt i Oslo, til x-aksen. */
export function osloMinuteOfDay(at: Date = new Date()): number {
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Oslo',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(at);
	const [hour, minute] = parts.split(':').map(Number);
	if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
	return hour * 60 + minute;
}

/** «14:30» fra minutter etter midnatt. */
export function minuteLabel(minute: number): string {
	const h = Math.floor(minute / 60) % 24;
	const m = minute % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
