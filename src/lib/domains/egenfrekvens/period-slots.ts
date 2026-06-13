/**
 * Periode-slots for egenfrekvens: «Hvordan gikk …»-sjekkin knyttet til tid på døgnet.
 *
 * Når appen åpnes innenfor et vindu og slottet hverken er registrert eller
 * dismisset for dagen, vises et fullskjerm-spørsmål (slider + setning).
 *
 * Skjemaet er ukedag-aware: hverdager har en arbeidsdag-rytme (med lunsj-hull
 * 12–14 og eget arbeidsdag/ettermiddag-spørsmål), mens helger og norske
 * helligdager har en roligere rytme med ett generelt «dag»-spørsmål og tider
 * som ligger senere på døgnet (man sover lenger, kvelden varer kortere).
 */

export type PeriodSlotId = 'natt' | 'morgen' | 'dag' | 'arbeidsdag' | 'ettermiddag' | 'kveld';

/** Slot-identitet og tekster — felles på tvers av hverdag/helg. */
export interface PeriodSlotMeta {
	id: PeriodSlotId;
	/** Bestemt form til bruk i løpende tekst: «natta», «morgenen» … */
	label: string;
	/** Kort form til kolonneoverskrifter o.l.: «Natt», «Morgen» … */
	shortLabel: string;
	emoji: string;
	question: string;
}

export interface PeriodSlot extends PeriodSlotMeta {
	/** Vindusstart i minutter etter midnatt, inklusiv */
	fromMinutes: number;
	/** Vindusslutt i minutter etter midnatt, eksklusiv */
	toMinutes: number;
}

const SLOT_META: Record<PeriodSlotId, PeriodSlotMeta> = {
	natt: { id: 'natt', label: 'natta', shortLabel: 'Natt', emoji: '🌙', question: 'Hvordan gikk natta?' },
	morgen: { id: 'morgen', label: 'morgenen', shortLabel: 'Morgen', emoji: '🌅', question: 'Hvordan gikk morgenen?' },
	dag: { id: 'dag', label: 'dagen', shortLabel: 'Dag', emoji: '🌤️', question: 'Hvordan gikk dagen?' },
	arbeidsdag: { id: 'arbeidsdag', label: 'arbeidsdagen', shortLabel: 'Arbeid', emoji: '💼', question: 'Hvordan gikk arbeidsdagen?' },
	ettermiddag: { id: 'ettermiddag', label: 'ettermiddagen', shortLabel: 'Etterm.', emoji: '🌇', question: 'Hvordan gikk ettermiddagen?' },
	kveld: { id: 'kveld', label: 'kvelden', shortLabel: 'Kveld', emoji: '🌃', question: 'Hvordan gikk kvelden?' }
};

const h = (hours: number, minutes = 0) => hours * 60 + minutes;
const slot = (id: PeriodSlotId, fromMinutes: number, toMinutes: number): PeriodSlot => ({
	...SLOT_META[id],
	fromMinutes,
	toMinutes
});

/**
 * Hverdagsrytme: natt → morgen → (lunsj-hull) → arbeidsdag → ettermiddag → kveld.
 * Hullene 00–05 og 12–14 har bevisst ingen slot.
 */
export const WORKDAY_SLOTS: PeriodSlot[] = [
	slot('natt', h(5), h(7, 30)),
	slot('morgen', h(7, 30), h(12)),
	slot('arbeidsdag', h(14), h(18)),
	slot('ettermiddag', h(18), h(20)),
	slot('kveld', h(20), h(24))
];

/**
 * Helg/helligdag-rytme: roligere, uten arbeidsdag-begrep. Man sover lenger
 * (natt til 7, morgen til 10), har én lang «dag» til 19, og en kveld som
 * runder av kl. 23. Hullene 00–05 og 23–24 har ingen slot.
 */
export const WEEKEND_SLOTS: PeriodSlot[] = [
	slot('natt', h(5), h(7)),
	slot('morgen', h(7), h(10)),
	slot('dag', h(10), h(19)),
	slot('kveld', h(19), h(23))
];

/**
 * Full katalog i kronologisk visningsrekkefølge — alle distinkte slots på tvers
 * av hverdag og helg. Brukes av dashboards som viser historikk (der både
 * arbeidsdager og fridager forekommer). Har bevisst ingen tidsvinduer; bruk
 * {@link WORKDAY_SLOTS}/{@link WEEKEND_SLOTS} for det.
 */
export const PERIOD_SLOTS: PeriodSlotMeta[] = [
	SLOT_META.natt,
	SLOT_META.morgen,
	SLOT_META.dag,
	SLOT_META.arbeidsdag,
	SLOT_META.ettermiddag,
	SLOT_META.kveld
];

const PERIOD_SLOT_IDS = new Set<string>(Object.keys(SLOT_META));

export function isPeriodSlotId(value: unknown): value is PeriodSlotId {
	return typeof value === 'string' && PERIOD_SLOT_IDS.has(value);
}

/** Lørdag eller søndag (lokal tid). Holidays avgjøres serverside og sendes inn eksplisitt. */
export function isWeekendDay(now: Date = new Date()): boolean {
	const dow = now.getDay();
	return dow === 0 || dow === 6;
}

/**
 * Slot som er aktivt for et lokalt klokkeslett, eller null i hullene.
 *
 * `nonWorkingDay` velger skjema: helg/helligdag → {@link WEEKEND_SLOTS}, ellers
 * {@link WORKDAY_SLOTS}. Utelates verdien, utledes den fra ukedag (helg) — det
 * dekker klienten synkront før serveren har bekreftet eventuelle helligdager.
 */
export function getActivePeriodSlot(now: Date = new Date(), nonWorkingDay?: boolean): PeriodSlot | null {
	const isNonWorking = nonWorkingDay ?? isWeekendDay(now);
	const schedule = isNonWorking ? WEEKEND_SLOTS : WORKDAY_SLOTS;
	const minutes = now.getHours() * 60 + now.getMinutes();
	return schedule.find((s) => minutes >= s.fromMinutes && minutes < s.toMinutes) ?? null;
}

/** Gruppering inn i eksisterende morning/evening-spor så sparklines og dagsbaseline fortsatt virker. */
export const PERIOD_SLOT_GROUP: Record<PeriodSlotId, 'morning' | 'evening'> = {
	natt: 'morning',
	morgen: 'morning',
	dag: 'evening',
	arbeidsdag: 'evening',
	ettermiddag: 'evening',
	kveld: 'evening'
};

/**
 * Visningsslot for en lagret slot-verdi: periode-slots vises som seg selv,
 * historiske morning/evening-sjekkins vises som morgen/kveld, alt annet (legacy
 * uten slot) hører ikke hjemme i slot-visninger.
 */
export function displayPeriodSlotFor(rawSlot: unknown): PeriodSlotId | null {
	if (isPeriodSlotId(rawSlot)) return rawSlot;
	if (rawSlot === 'morning') return 'morgen';
	if (rawSlot === 'evening') return 'kveld';
	return null;
}

// Naturlige svar på «Hvordan gikk …?» — må passe alle slots, natt som arbeidsdag.
export const PERIOD_SLOT_LEVEL_LABELS: Record<number, string> = {
	1: 'Tungt',
	2: 'Trått',
	3: 'Helt greit',
	4: 'Fint',
	5: 'Strålende'
};

/** Lokal ISO-dato (ikke UTC) — slottene følger brukerens klokke. */
export function localIsoDay(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** localStorage-nøkkel som markerer at slottet er registrert eller dismisset for dagen. */
export function periodSlotStorageKey(day: string, slot: PeriodSlotId): string {
	return `egenfrekvens-slot-${day}-${slot}`;
}
