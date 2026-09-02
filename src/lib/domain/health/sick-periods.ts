/**
 * sick-periods.ts — «jeg er syk» som en PERIODE, ikke et flagg.
 *
 * ## Hvorfor perioder og ikke et nå-flagg
 *
 * Rigga som fantes fram til september 2026 lagret `sickUntil` på en
 * `tilstand_flag`-hendelse, og `getActiveEgenfrekvensFlags` leste bare den
 * NYESTE. Det svarer presist på «er jeg syk nå», som er alt readiness trengte
 * (`deriveState` → `state: 'rest'`).
 *
 * Streaks stiller et annet spørsmål: **hvilke dager** var syke. Det kan ikke
 * leses ut av et nå-flagg, og rekonstruksjon fra eventloggen er tvetydig —
 * klarerte du flagget kl. 22 på en dag du lå i senga, var den dagen syk eller
 * ikke? Et svar som avhenger av klokkeslettet du trykket på en knapp, er ikke
 * data. Derfor er en sykeperiode en RAD med `startDate`/`endDate` som kan rettes
 * og slettes — samme form som dupp-loggen (`updateNap`/`deleteNap`) og
 * livviddeloggen, og av samme grunn: en registrering man kan angre.
 *
 * Konsekvensen er at man kan melde seg syk **i etterkant** («jeg var syk
 * mandag til onsdag»), og streaken repareres retroaktivt — på samme måte som en
 * økt som kommer inn fra Withings i etterkant reparerer rekka. Streaks lagres
 * aldri som en teller, så det følger gratis.
 *
 * ## En åpen periode er ikke det samme som en glemt bryter
 *
 * `endDate: null` betyr «syk inntil videre», og det er den ærlige defaulten:
 * ingen vet på dag én hvor lenge det varer, og den gamle rigga tvang deg til å
 * gjette (`defaultUntil(5)`). Men en åpen periode som aldri lukkes ville
 * unnskyldt alt for alltid, og da måler vi ikke lenger noe. Etter
 * `MAX_OPEN_SICK_DAYS` slutter den derfor å unnskylde, og `staleOpen` sier fra
 * så flaten kan be om et sluttpunkt. Vi lukker den ikke selv: brukeren kan ha
 * vært syk i tre uker, og et automatisk sluttpunkt ville vært en påstand.
 *
 * ## Hva en syk dag betyr
 *
 * **Unnskyldt — hverken holdt eller brutt.** Dagen er gjennomsiktig: rekka
 * lever videre, og telleren står stille. «6 dager på rad» er fortsatt 6 når du
 * blir frisk. Alternativet — å telle sykedagene som holdt — ville gitt «11
 * dager på rad» etter fem dager i senga, altså en streak som påstår noe du ikke
 * gjorde. En streak man ikke kan stole på er ikke verdt å holde.
 *
 * Modulen er DB-fri og regner på dagsnøkler ('YYYY-MM-DD'), så kallstedet eier
 * tidssonevalget (Oslo-lokal dag, som resten av vane-laget).
 */

import { dayKeyFromNumber, dayNumber } from '$lib/domain/streaks';

/**
 * Hvor lenge en ÅPEN periode unnskylder før den må få et sluttpunkt.
 *
 * Ikke en påstand om hvor lenge folk er syke — en vakt mot bryteren ingen
 * skrudde av. To uker er lenger enn en vanlig infeksjon og kort nok til at en
 * glemt periode oppdages før den har spist en måned med streaks.
 */
export const MAX_OPEN_SICK_DAYS = 14;

export interface SickPeriod {
	/** `sensor_events.id` for raden. */
	id: string;
	/** Første sykedag, 'YYYY-MM-DD'. */
	startDate: string;
	/** Siste sykedag inklusive, eller null for «inntil videre». */
	endDate: string | null;
	note: string | null;
}

export interface ResolvedSickPeriod extends SickPeriod {
	/** Siste dagen perioden faktisk unnskylder — aldri fram i tid. */
	effectiveEnd: string;
	/** Ingen sluttdato satt. */
	open: boolean;
	/** Åpen og eldre enn `MAX_OPEN_SICK_DAYS` — unnskylder ikke lenger. */
	staleOpen: boolean;
	/** Dekker perioden dagens dato? */
	activeToday: boolean;
	/** Antall dager perioden unnskylder, til og med `effectiveEnd`. */
	days: number;
}

/** Er nøkkelen en gyldig 'YYYY-MM-DD'? */
export function isDayKey(value: unknown): value is string {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Regn ut hva en periode faktisk dekker i dag.
 *
 * En periode kan være registrert med en sluttdato fram i tid («jeg regner med å
 * være dårlig ut uka»). Den skal ikke unnskylde dager som ikke har vært — en dag
 * som ikke har skjedd kan ikke være brutt, og den kan derfor ikke være
 * unnskyldt heller. Samme regel som `isFuture` i streak-kalenderen.
 */
export function resolveSickPeriod(period: SickPeriod, todayKey: string): ResolvedSickPeriod {
	const start = dayNumber(period.startDate);
	const today = dayNumber(todayKey);
	const open = period.endDate === null;

	// Åpen periode: unnskylder til og med i dag, men ikke lenger enn taket.
	const openCap = start + MAX_OPEN_SICK_DAYS - 1;
	const declaredEnd = open ? Math.min(today, openCap) : dayNumber(period.endDate as string);
	const effectiveEndNum = Math.min(declaredEnd, today);
	const staleOpen = open && today > openCap;

	return {
		...period,
		effectiveEnd: dayKeyFromNumber(Math.max(start, effectiveEndNum)),
		open,
		staleOpen,
		activeToday: start <= today && today <= declaredEnd,
		days: Math.max(0, effectiveEndNum - start + 1)
	};
}

/**
 * Perioden som dekker i dag, eller null.
 *
 * Overlappende perioder er ikke forbudt (du kan ha registrert to bolker som
 * møtes), så den seneste starten vinner — den er den brukeren sist mente noe med.
 */
export function activeSickPeriod(
	periods: readonly SickPeriod[],
	todayKey: string
): ResolvedSickPeriod | null {
	const active = periods
		.map((p) => resolveSickPeriod(p, todayKey))
		.filter((p) => p.activeToday && !p.staleOpen)
		.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
	return active[0] ?? null;
}

/**
 * Alle unnskyldte dagsnøkler i perioder som overlapper [fromKey, toKey].
 *
 * Returnerer et Set fordi kallstedene spør «var denne dagen syk?» én dag av
 * gangen, og overlappende perioder ellers ville gitt duplikater.
 */
export function sickDayKeys(
	periods: readonly SickPeriod[],
	fromKey: string,
	toKey: string,
	todayKey: string
): Set<string> {
	const from = dayNumber(fromKey);
	const to = dayNumber(toKey);
	const days = new Set<string>();

	for (const period of periods) {
		const resolved = resolveSickPeriod(period, todayKey);
		if (resolved.staleOpen) continue;
		const start = Math.max(from, dayNumber(resolved.startDate));
		const end = Math.min(to, dayNumber(resolved.effectiveEnd));
		for (let d = start; d <= end; d++) days.add(dayKeyFromNumber(d));
	}
	return days;
}

export interface SickPeriodInput {
	id?: string;
	startDate: string;
	endDate?: string | null;
	note?: string | null;
}

export type SickPeriodValidation =
	| { ok: true; value: { id?: string; startDate: string; endDate: string | null; note: string | null } }
	| { ok: false; error: string };

/**
 * Validering delt av endepunktet og flaten, så en verdi som godtas ett sted
 * ikke avvises et annet — samme arbeidsdeling som `body-profile-fields.ts`.
 *
 * `todayKey` trengs fordi en startdato fram i tid ikke er en registrering, den
 * er en plan: du vet ikke at du blir syk på torsdag.
 */
export function validateSickPeriod(input: SickPeriodInput, todayKey: string): SickPeriodValidation {
	if (!isDayKey(input.startDate)) {
		return { ok: false, error: 'Startdato må være på formen ÅÅÅÅ-MM-DD.' };
	}
	if (input.startDate > todayKey) {
		return { ok: false, error: 'Startdato kan ikke være fram i tid — du vet ikke at du blir syk.' };
	}

	const rawEnd = input.endDate;
	let endDate: string | null = null;
	if (rawEnd !== undefined && rawEnd !== null && rawEnd !== '') {
		if (!isDayKey(rawEnd)) {
			return { ok: false, error: 'Sluttdato må være på formen ÅÅÅÅ-MM-DD.' };
		}
		if (rawEnd < input.startDate) {
			return { ok: false, error: 'Sluttdato kan ikke være før startdato.' };
		}
		endDate = rawEnd;
	}

	const note = typeof input.note === 'string' ? input.note.trim() || null : null;
	return { ok: true, value: { id: input.id, startDate: input.startDate, endDate, note } };
}

/* ── Ord ─────────────────────────────────────────────────────────────────── */

function shortDate(dayKey: string): string {
	const [, m, d] = dayKey.split('-');
	const months = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
	return `${Number(d)}. ${months[Number(m) - 1]}`;
}

/**
 * «Syk siden 2. sep (4 dager)» / «Syk 2.–6. sep».
 *
 * Setningen bor her og ikke i `.svelte`-fila fordi helsechatten må si det samme
 * som skjermen — samme grunn som `classifyTsb` ble flyttet ut av
 * `LoadBalanceCard`.
 */
export function describeSickPeriod(period: ResolvedSickPeriod): string {
	const days = `${period.days} ${period.days === 1 ? 'dag' : 'dager'}`;
	if (period.open) {
		if (period.staleOpen) {
			return `Åpen sykeperiode fra ${shortDate(period.startDate)} — over ${MAX_OPEN_SICK_DAYS} dager uten sluttdato, så den unnskylder ikke lenger.`;
		}
		return `Syk siden ${shortDate(period.startDate)} (${days}, ingen sluttdato satt)`;
	}
	const end = period.endDate as string;
	if (period.startDate === end) return `Syk ${shortDate(period.startDate)}`;
	// Samme måned: «1.–3. sep», ikke «1. sep–3. sep».
	const sameMonth = period.startDate.slice(0, 7) === end.slice(0, 7);
	const from = sameMonth ? `${Number(period.startDate.slice(8))}.` : shortDate(period.startDate);
	return `Syk ${from}–${shortDate(end)} (${days})`;
}
