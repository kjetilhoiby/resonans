/**
 * Når når jeg målet — og når nådde jeg det?
 *
 * ## Hvorfor datoen er det interessante tallet
 *
 * Kortet svarte tidligere med «estimat ved dagens snitt: ~70,4 kg (14,6 kg
 * under mål)» på et mål om 85 kg innen juni 2028. Det er en ekstrapolasjon av
 * dagens tempo tjue måneder fram, og den er ubrukelig av to grunner: ingen
 * fortsetter å gå ned et halvt kilo i uka i to år, og *tallet svarer på feil
 * spørsmål*. Et mål formulert som «oppnå en tilstand innen en dato» har
 * tilstanden som gitt — det man lurer på er NÅR man er der.
 *
 * Snu regnestykket, og svaret blir både mer nyttig og mer ærlig: «på dagens
 * tempo er du på 85 kg rundt 12. mars 2027, halvannet år før fristen». Bommer
 * tempoet, bommer datoen — men en dato som ligger for langt fram avslører seg
 * selv, mens et vekttall på 70,4 ser presist ut.
 *
 * ## To målformer, to spørsmål
 *
 * - **`state`** — «ned til 85 kg innen juni 2028». Fristen er en ramme,
 *   tilstanden er poenget. Da er *datoen* estimatet.
 * - **`volume`** — «løp 80 km i august». Vinduet ER poenget: august slutter
 *   uansett, og det interessante er hvor mye det blir. Da er *summen ved
 *   fristen* estimatet — men datoen målet ble nådd er fortsatt verdt å si.
 *
 * Formen kan ikke utledes av tallene: begge har en startverdi, en målverdi og
 * to datoer. Kalleren vet hvilket spørsmål målet stiller, og sier det.
 *
 * ## Måloppnåelse leses av serien, ikke av dagens verdi
 *
 * «Nådd» er en dato, og den datoen ligger i historikken. Et mål som er nådd og
 * siden mistet (vekta opp igjen) har fortsatt en dag det ble nådd — vi leter
 * etter FØRSTE passering, ikke etter om dagens verdi ligger på riktig side.
 */

/** Dager siden epoken. Trygt på `YYYY-MM-DD` uansett tidssone. */
function dayNumber(date: string): number {
	return Math.round(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
}

function dateFromDayNumber(day: number): string {
	return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export type GoalShape = 'state' | 'volume';

export interface GoalProjectionInput {
	startDate: string;
	endDate: string;
	startValue: number;
	currentValue: number;
	targetValue: number;
	/** Dagens dato. Kalleren eier klokka. */
	today: string;
	/**
	 * Serien slik flaten tegner den — kumulativ for volum, absolutt for
	 * tilstand. Brukes bare til å finne dagen målet ble passert.
	 */
	series?: ReadonlyArray<{ date: string; value: number }>;
}

export type ProjectionBlocker =
	| 'wrong-direction'
	| 'no-progress'
	| 'too-early'
	| 'already-there';

export interface GoalProjection {
	/** Dagen målet ble passert første gang, hvis det har skjedd. */
	reachedOn: string | null;
	/**
	 * Dager mellom måloppnåelsen og fristen. Positivt er før fristen.
	 * Null når målet ikke er nådd.
	 */
	reachedDaysBeforeDeadline: number | null;
	/** Estimert dato for måloppnåelse, når tempoet peker dit. */
	projectedDate: string | null;
	/** Dager fra i dag til det estimatet. */
	projectedInDays: number | null;
	/** Positivt betyr før fristen. */
	projectedDaysBeforeDeadline: number | null;
	/** Hvorfor det ikke finnes et datoestimat. Null når `projectedDate` finnes. */
	blocker: ProjectionBlocker | null;
	/** Endring per dag, i målets enhet. Negativ for et nedadgående mål. */
	ratePerDay: number | null;
}

/**
 * Hvor langt fram et datoestimat får peke før det slutter å bety noe.
 *
 * Ti år er ikke et estimat, det er en divisjon. Grensen er raus med vilje —
 * et mål to år fram skal fortsatt få en dato — men den fanger tilfellet der
 * tempoet er nesten null og datoen spretter ut i neste århundre.
 */
export const MAX_PROJECTION_DAYS = 3650;

export function projectGoal(input: GoalProjectionInput): GoalProjection {
	const direction = Math.sign(input.targetValue - input.startValue) || 1;
	const todayDay = dayNumber(input.today);
	const startDay = dayNumber(input.startDate);
	const endDay = dayNumber(input.endDate);
	const daysElapsed = todayDay - startDay;

	// Første passering i serien. Leter framover, så en senere tilbakegang ikke
	// sletter datoen målet FAKTISK ble nådd.
	let reachedOn: string | null = null;
	for (const point of input.series ?? []) {
		if ((point.value - input.targetValue) * direction >= 0) {
			reachedOn = point.date;
			break;
		}
	}

	const reachedDaysBeforeDeadline =
		reachedOn === null ? null : endDay - dayNumber(reachedOn);

	const empty: GoalProjection = {
		reachedOn,
		reachedDaysBeforeDeadline,
		projectedDate: null,
		projectedInDays: null,
		projectedDaysBeforeDeadline: null,
		blocker: null,
		ratePerDay: null
	};

	// Alt i mål: da er det ikke noe å estimere, og `reachedOn` bærer svaret.
	if ((input.currentValue - input.targetValue) * direction >= 0) {
		return { ...empty, blocker: 'already-there' };
	}

	if (daysElapsed <= 0) return { ...empty, blocker: 'too-early' };

	const ratePerDay = (input.currentValue - input.startValue) / daysElapsed;
	const progressPerDay = ratePerDay * direction;

	// Står stille eller går motsatt vei: da finnes det ingen dato, og å regne
	// en ut ville gitt en negativ eller uendelig lang framskrivning.
	if (progressPerDay <= 0) {
		return {
			...empty,
			ratePerDay,
			blocker: ratePerDay === 0 ? 'no-progress' : 'wrong-direction'
		};
	}

	const remaining = (input.targetValue - input.currentValue) * direction;
	const daysNeeded = Math.ceil(remaining / progressPerDay);

	if (daysNeeded > MAX_PROJECTION_DAYS) {
		return { ...empty, ratePerDay, blocker: 'no-progress' };
	}

	const projectedDay = todayDay + daysNeeded;
	return {
		...empty,
		ratePerDay,
		projectedDate: dateFromDayNumber(projectedDay),
		projectedInDays: daysNeeded,
		projectedDaysBeforeDeadline: endDay - projectedDay
	};
}

const MONTHS = [
	'januar',
	'februar',
	'mars',
	'april',
	'mai',
	'juni',
	'juli',
	'august',
	'september',
	'oktober',
	'november',
	'desember'
];

/** «12. mars 2027», eller «12. mars» når året er inneværende. */
export function formatProjectionDate(iso: string, today: string): string {
	const [year, month, day] = iso.split('-').map(Number);
	const sameYear = iso.slice(0, 4) === today.slice(0, 4);
	return `${day}. ${MONTHS[month - 1]}${sameYear ? '' : ` ${year}`}`;
}

/** «halvannen måned», «tre uker», «12 dager» — et spenn, ikke et presist tall. */
export function describeSpanDays(days: number): string {
	const abs = Math.abs(days);
	if (abs < 14) return `${abs} ${abs === 1 ? 'dag' : 'dager'}`;
	if (abs < 60) {
		const weeks = Math.round(abs / 7);
		return `${weeks} uker`;
	}
	if (abs < 365) {
		const months = Math.round(abs / 30);
		return `${months} måneder`;
	}
	const years = Math.round((abs / 365) * 10) / 10;
	return `${String(years).replace('.', ',')} år`;
}

/**
 * Setningen flaten skriver.
 *
 * Bor her fordi den bærer forbeholdene: et estimat er «på dagens tempo», en
 * manglende dato skal SIES framfor å bli en tom linje, og «nådd» skal si når —
 * det er hele poenget med å måle et mål mot en frist.
 */
export function describeGoalProjection(
	projection: GoalProjection,
	opts: { today: string; shape: GoalShape }
): { label: string; tone: 'ahead' | 'behind' | 'neutral' } | null {
	if (projection.reachedOn) {
		const when = formatProjectionDate(projection.reachedOn, opts.today);
		const margin = projection.reachedDaysBeforeDeadline ?? 0;
		if (margin > 0) {
			return {
				label: `Nådd ${when} — ${describeSpanDays(margin)} før fristen.`,
				tone: 'ahead'
			};
		}
		if (margin < 0) {
			return {
				label: `Nådd ${when} — ${describeSpanDays(margin)} etter fristen.`,
				tone: 'behind'
			};
		}
		return { label: `Nådd ${when}, på fristen.`, tone: 'neutral' };
	}

	if (projection.projectedDate) {
		const when = formatProjectionDate(projection.projectedDate, opts.today);
		const margin = projection.projectedDaysBeforeDeadline ?? 0;
		const base = `På dagens tempo er du der rundt ${when}`;
		if (margin > 0) return { label: `${base} — ${describeSpanDays(margin)} før fristen.`, tone: 'ahead' };
		if (margin < 0) return { label: `${base} — ${describeSpanDays(margin)} etter fristen.`, tone: 'behind' };
		return { label: `${base}, akkurat på fristen.`, tone: 'neutral' };
	}

	// Ingen dato. Si hvorfor — en tom linje ser ut som en funksjon som ikke virker.
	switch (projection.blocker) {
		case 'wrong-direction':
			return { label: 'Utviklingen går motsatt vei, så det finnes ingen dato ennå.', tone: 'behind' };
		case 'no-progress':
			return { label: 'For lite bevegelse til å anslå en dato.', tone: 'neutral' };
		case 'too-early':
			return { label: 'For tidlig til å anslå en dato.', tone: 'neutral' };
		case 'already-there':
			// Nådd, men uten en serie å finne dagen i. Da mangler datoen, ikke
			// oppnåelsen — og det er verdt å si.
			return { label: 'Målet er nådd.', tone: 'ahead' };
		default:
			return null;
	}
}
