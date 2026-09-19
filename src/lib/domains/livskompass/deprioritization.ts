/**
 * Bevisst nedprioritering — et VALG med en termin, ikke et avvik.
 *
 * ## Hvorfor dette må finnes
 *
 * Livskompasset registrerer et gap ukentlig: viktighet minus samsvar. Det kan
 * ikke skille to helt ulike ting, og begge tegnes som samme røde sektor:
 *
 * - **Drift.** Kultur og venner sklir uten at noen har bestemt det. Det koster,
 *   og kostnaden er nettopp at ingen la merke til den.
 * - **Valg.** Bidraget hjemme er nedprioritert med en begrunnelse, avtalt, og
 *   med en plan for å reparere det — fordi det tjener noe på lengre sikt.
 *
 * Brukerens egne ord: «den endimensjonale livshjuløvelsen blir for flat for å
 * fange opp dette». Det manglende datumet er en INTENSJON med varighet.
 *
 * ## Terminen er obligatorisk, og det er hele forskjellen fra en sykeperiode
 *
 * `sick-periods.ts` lar `endDate` være null, fordi «inntil videre» er den
 * ærlige defaulten: ingen vet på dag én hvor lenge en infeksjon varer, og å
 * tvinge fram en gjetning ville vært verre.
 *
 * Her er det motsatt. En nedprioritering UTEN sluttdato er ikke et valg — det
 * er drift med en forklaring foran. Du kan velge terminen, og det å velge den
 * er selve handlingen. Derfor er `endDate` påkrevd, og `MAX_TERM_DAYS` setter
 * et tak: over et år er det ikke en periode lenger, det er den du har blitt.
 *
 * ## Oppgjøret ved terminslutt er vakten
 *
 * Når terminen løper ut, slutter perioden å unnskylde, og flaten spør: reparere,
 * forlenge, eller innrømme at det var drift. Det tredje svaret er det viktigste
 * — uten det kan en forlengelse gjentas i det uendelige og kalles et valg.
 *
 * Samme form som `sick-checkin`, og samme regel som sykeperiodene: **et bortfall
 * gjelder framover, aldri bakover.** Ukene terminen dekket, dekket den.
 *
 * DB-fri og regner på dagsnøkler ('YYYY-MM-DD'), så kallstedet eier
 * tidssonevalget (Oslo-lokal dag, som resten av vane-laget).
 */

import { dimensionById } from './dimensions';

/**
 * Tak på hvor lang en termin kan være.
 *
 * Ikke en påstand om hva som er sunt — en vakt mot at «i denne perioden» blir
 * en permanent tilstand med et pent navn. Et år er lenger enn et prosjekt og
 * kort nok til at en glemt nedprioritering møter et oppgjør.
 */
export const MAX_TERM_DAYS = 365;

/**
 * Hvor lenge en aktiv termin kan løpe uten et livstegn før flaten ber om et.
 *
 * Terminen er forpliktelsen, så vi maser ikke underveis på en kort en. Men en
 * halvårig nedprioritering ingen har sett på siden den ble satt, er ikke til å
 * skille fra drift — og det er nettopp den forskjellen modulen finnes for.
 */
export const CHECKIN_INTERVAL_DAYS = 60;

/** Hvor mange dager før terminslutt flaten varsler at oppgjøret kommer. */
export const SETTLEMENT_WARNING_DAYS = 7;

/** Hva som skjedde da terminen løp ut. */
export type DeprioritizationOutcome = 'repaired' | 'drifted';

export interface Deprioritization {
	/** `sensor_events.id` for raden. */
	id: string;
	/** Dimensjons-id fra livskompasset. */
	dimensionId: string;
	/** Første dagen nedprioriteringen gjelder, 'YYYY-MM-DD'. */
	startDate: string;
	/** Siste dagen den gjelder, inklusive. Aldri null — se filhodet. */
	endDate: string;
	/** Hvorfor. Påkrevd: en nedprioritering uten begrunnelse er drift. */
	reason: string;
	/** Hva som skal til for å rette den opp igjen. Valgfri. */
	repair: string | null;
	/** Siste dagen brukeren bekreftet at den fortsatt gjelder. */
	confirmedOn: string | null;
	/** Dagen oppgjøret ble tatt, eller null. */
	settledOn: string | null;
	/** Utfallet av oppgjøret, eller null om det ikke er tatt. */
	outcome: DeprioritizationOutcome | null;
}

export interface ResolvedDeprioritization extends Deprioritization {
	/** Visningsnavnet på dimensjonen, eller id-en om den er ukjent. */
	label: string;
	/** Dekker terminen dagens dato, og er oppgjøret ikke tatt? */
	activeToday: boolean;
	/** Terminen er over og oppgjøret ikke tatt — den unnskylder ikke lenger. */
	needsSettlement: boolean;
	/** Aktiv, og det nærmer seg terminslutt. */
	settlementSoon: boolean;
	/** Aktiv, og det er lenge siden noen så på den. */
	needsCheckIn: boolean;
	/** Dager igjen av terminen. 0 = i dag er siste. Negativt = over. */
	daysLeft: number;
	/** Hvilken uke av terminen vi er i, 1-indeksert. */
	weekOfTerm: number;
	/** Terminens lengde i uker, rundet opp. */
	weeksInTerm: number;
	/** Oppgjøret er tatt. */
	settled: boolean;
}

/** Er nøkkelen en gyldig 'YYYY-MM-DD'? */
export function isDayKey(value: unknown): value is string {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function dayDiff(fromKey: string, toKey: string): number {
	const [fy, fm, fd] = fromKey.split('-').map(Number);
	const [ty, tm, td] = toKey.split('-').map(Number);
	return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Seneste livstegn: bekreftelsen om den finnes, ellers starten. */
function lastSignal(period: Deprioritization): string {
	return period.confirmedOn && period.confirmedOn > period.startDate
		? period.confirmedOn
		: period.startDate;
}

export function resolveDeprioritization(
	period: Deprioritization,
	todayKey: string
): ResolvedDeprioritization {
	const settled = Boolean(period.settledOn);
	const started = period.startDate <= todayKey;
	const withinTerm = started && todayKey <= period.endDate;

	const daysLeft = dayDiff(todayKey, period.endDate);
	const termDays = dayDiff(period.startDate, period.endDate) + 1;
	const elapsed = Math.max(0, dayDiff(period.startDate, todayKey));

	return {
		...period,
		label: dimensionById(period.dimensionId)?.label ?? period.dimensionId,
		settled,
		activeToday: !settled && withinTerm,
		// Over terminen og ikke gjort opp. Den unnskylder ingen NYE uker, men
		// ukene den dekket står — samme regel som `effectiveEnd` i sykeperiodene.
		needsSettlement: !settled && started && todayKey > period.endDate,
		settlementSoon: !settled && withinTerm && daysLeft <= SETTLEMENT_WARNING_DAYS,
		needsCheckIn: !settled && withinTerm && dayDiff(lastSignal(period), todayKey) > CHECKIN_INTERVAL_DAYS,
		daysLeft,
		weekOfTerm: Math.floor(elapsed / 7) + 1,
		weeksInTerm: Math.max(1, Math.ceil(termDays / 7))
	};
}

/** Den aktive nedprioriteringen for en dimensjon, om den finnes. */
export function activeForDimension(
	periods: ResolvedDeprioritization[],
	dimensionId: string
): ResolvedDeprioritization | null {
	return periods.find((p) => p.activeToday && p.dimensionId === dimensionId) ?? null;
}

/* ── Validering ──────────────────────────────────────────────────────────── */

export interface DeprioritizationInput {
	id?: string;
	dimensionId: string;
	startDate: string;
	endDate: string;
	reason: string;
	repair?: string | null;
	confirmedOn?: string | null;
	settledOn?: string | null;
	outcome?: string | null;
}

export type DeprioritizationValidation =
	| { ok: true; value: Omit<Deprioritization, 'id'> & { id?: string } }
	| { ok: false; error: string };

const MAX_TEXT_CHARS = 500;

/**
 * Delt av endepunktet og flaten, så en verdi som godtas ett sted ikke avvises
 * et annet — samme arbeidsdeling som `validateSickPeriod`.
 */
export function validateDeprioritization(
	input: DeprioritizationInput,
	todayKey: string
): DeprioritizationValidation {
	if (!dimensionById(input.dimensionId)) {
		return { ok: false, error: `«${input.dimensionId}» er ikke en dimensjon i livskompasset.` };
	}
	if (!isDayKey(input.startDate)) {
		return { ok: false, error: 'Startdato må være på formen ÅÅÅÅ-MM-DD.' };
	}
	/**
	 * En startdato fram i tid avvises — ikke fordi «fra oktober» er urimelig, men
	 * fordi en slik rad ville vært USYNLIG: den er hverken aktiv, uoppgjort eller
	 * avsluttet, så ingen av flatens lister viser den. En beslutning man ikke kan
	 * se er verre enn en man ikke kan planlegge.
	 */
	if (input.startDate > todayKey) {
		return {
			ok: false,
			error: 'Startdato kan ikke være fram i tid — en nedprioritering gjelder fra den dagen du bestemmer deg.'
		};
	}
	if (!isDayKey(input.endDate)) {
		// Ikke en formfeil å gjette seg forbi: terminen ER handlingen. Se filhodet.
		return {
			ok: false,
			error: 'En nedprioritering må ha en sluttdato. Uten en termin er det drift med en forklaring foran.'
		};
	}
	if (input.endDate < input.startDate) {
		return { ok: false, error: 'Sluttdato kan ikke være før startdato.' };
	}
	if (input.endDate <= todayKey) {
		return { ok: false, error: 'Sluttdatoen må ligge fram i tid — ellers er det ingenting å holde.' };
	}
	const termDays = dayDiff(input.startDate, input.endDate) + 1;
	if (termDays > MAX_TERM_DAYS) {
		return {
			ok: false,
			error: `Terminen er ${termDays} dager — maks ${MAX_TERM_DAYS}. Over et år er det ikke en periode lenger, og da er spørsmålet et annet: er dette noe du vil?`
		};
	}

	const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
	if (!reason) {
		return {
			ok: false,
			error: 'Skriv hvorfor. En nedprioritering uten begrunnelse kan ikke skilles fra drift senere.'
		};
	}
	for (const [label, value] of [['Begrunnelsen', reason], ['Reparasjonen', input.repair]] as const) {
		if (typeof value === 'string' && value.trim().length > MAX_TEXT_CHARS) {
			return { ok: false, error: `${label} er lengre enn ${MAX_TEXT_CHARS} tegn.` };
		}
	}

	const outcome =
		input.outcome === 'repaired' || input.outcome === 'drifted' ? input.outcome : null;
	const settledOn = isDayKey(input.settledOn) ? input.settledOn : null;
	if (settledOn && !outcome) {
		return { ok: false, error: 'Et oppgjør må ha et utfall.' };
	}

	return {
		ok: true,
		value: {
			id: input.id,
			dimensionId: input.dimensionId,
			startDate: input.startDate,
			endDate: input.endDate,
			reason,
			repair: typeof input.repair === 'string' ? input.repair.trim() || null : null,
			confirmedOn: isDayKey(input.confirmedOn) ? input.confirmedOn : null,
			settledOn,
			outcome
		}
	};
}

/* ── Ord ─────────────────────────────────────────────────────────────────── */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

function shortDate(dayKey: string): string {
	const [, m, d] = dayKey.split('-');
	return `${Number(d)}. ${MONTHS[Number(m) - 1]}`;
}

/**
 * Setningen flaten OG chatten bruker.
 *
 * «Uke 6 av 12, slik du bestemte» er hele poenget: den sier at gapet er
 * forventet. Uten den leses en nedprioritert dimensjon som et avvik, og det er
 * nøyaktig feilen denne modulen finnes for å rette.
 */
export function describeDeprioritization(period: ResolvedDeprioritization): string {
	if (period.settled) {
		const verb = period.outcome === 'repaired' ? 'hentet opp igjen' : 'endte som drift';
		return `${period.label}: nedprioritert ${shortDate(period.startDate)}–${shortDate(period.endDate)}, ${verb}.`;
	}
	if (period.needsSettlement) {
		const over = Math.abs(period.daysLeft);
		return `${period.label}: terminen gikk ut ${shortDate(period.endDate)} (${over} ${over === 1 ? 'dag' : 'dager'} siden) og unnskylder ikke lenger. Hente den opp igjen, forlenge, eller var det drift?`;
	}
	const uke = `Uke ${period.weekOfTerm} av ${period.weeksInTerm}, slik du bestemte`;
	const repair = period.repair ? ` Plan: ${period.repair}` : '';
	if (period.settlementSoon) {
		return `${period.label}: nedprioritert ut ${shortDate(period.endDate)}. ${uke} — oppgjøret kommer om ${period.daysLeft} ${period.daysLeft === 1 ? 'dag' : 'dager'}. Grunn: ${period.reason}.${repair}`;
	}
	return `${period.label}: nedprioritert ut ${shortDate(period.endDate)}. ${uke}. Grunn: ${period.reason}.${repair}`;
}

/**
 * Prioriteringsseksjonen i chat-konteksten.
 *
 * **Uten denne kan ingen chat vekte noe.** Retningsblokken har til nå rendret
 * visjonene og verdiene flatt, og modellen er samtidig instruert om å peke på
 * gap. Uten en rekkefølge plukker den det som er lettest å konfrontere — og en
 * nedprioritering brukeren har bestemt seg for, er den letteste av alle.
 */
export function buildPriorityBlock(periods: ResolvedDeprioritization[]): string {
	const active = periods.filter((p) => p.activeToday);
	const unsettled = periods.filter((p) => p.needsSettlement);
	if (active.length === 0 && unsettled.length === 0) return '';

	let out = '';
	if (active.length > 0) {
		out += '\nBEVISST NEDPRIORITERT NÅ (brukerens eget valg, med termin):\n';
		out += active.map((p) => `- ${describeDeprioritization(p)}`).join('\n') + '\n';
	}
	if (unsettled.length > 0) {
		out += '\nTERMIN UTLØPT — venter på et oppgjør:\n';
		out += unsettled.map((p) => `- ${describeDeprioritization(p)}`).join('\n') + '\n';
	}

	out +=
		'\nEt lavt samsvar på noe som står som bevisst nedprioritert er IKKE et avvik å konfrontere — ' +
		'det er planen som virker, og brukeren har alt tatt kostnaden inn. Konfronter i stedet det som sklir ' +
		'UTEN at noen har bestemt det. En utløpt termin er derimot verdt å ta opp én gang: spørsmålet er om ' +
		'det skal hentes opp igjen, forlenges, eller om det viste seg å være drift.\n';

	return out;
}

/* ── Møtet med ukesinnsjekken ────────────────────────────────────────────── */

/** Det ukesinnsjekken og coachingen trenger om et valgt gap, uten en typeimport. */
export interface ChosenGap {
	dimensionId: string;
	label: string;
	sentence: string;
}

/**
 * Del gapene i det som SKLIR og det som er VALGT.
 *
 * Dette er hele møtepunktet mellom de to modellene. `computeOutOfSync` kjenner
 * bare viktighet minus samsvar, og tegner derfor en bevisst nedprioritering som
 * samme røde sektor som en dimensjon ingen har sett på siden mars. Partisjonen
 * gjør forskjellen synlig — uten å skjule noe: et valgt gap er fortsatt et gap,
 * det er bare ikke et avvik.
 *
 * Merk at en UTLØPT termin havner blant de driftende igjen, og det er meningen:
 * i det oppgjøret ikke er tatt, er vi tilbake til å ikke vite hva det er.
 */
export function partitionOutOfSync<T extends { id: string }>(
	items: T[],
	periods: ResolvedDeprioritization[]
): { drifting: T[]; chosen: Array<T & { choice: ChosenGap }> } {
	const drifting: T[] = [];
	const chosen: Array<T & { choice: ChosenGap }> = [];
	for (const item of items) {
		const period = activeForDimension(periods, item.id);
		if (period) {
			chosen.push({
				...item,
				choice: {
					dimensionId: period.dimensionId,
					label: period.label,
					sentence: describeDeprioritization(period)
				}
			});
		} else {
			drifting.push(item);
		}
	}
	return { drifting, chosen };
}
