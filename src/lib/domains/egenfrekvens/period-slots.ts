/**
 * Periode-slots for egenfrekvens: «Hvordan gikk …»-sjekkin knyttet til tid på døgnet.
 *
 * Når appen åpnes innenfor et vindu og slottet hverken er registrert eller
 * dismisset for dagen, vises et fullskjerm-spørsmål (slider + setning).
 * Hullene 00–05 og 12–14 har bevisst ingen slot.
 */

export type PeriodSlotId = 'natt' | 'morgen' | 'arbeidsdag' | 'ettermiddag' | 'kveld';

export interface PeriodSlot {
	id: PeriodSlotId;
	/** Bestemt form til bruk i løpende tekst: «natta», «morgenen» … */
	label: string;
	/** Kort form til kolonneoverskrifter o.l.: «Natt», «Morgen» … */
	shortLabel: string;
	emoji: string;
	question: string;
	/** Vindusstart i minutter etter midnatt, inklusiv */
	fromMinutes: number;
	/** Vindusslutt i minutter etter midnatt, eksklusiv */
	toMinutes: number;
}

export const PERIOD_SLOTS: PeriodSlot[] = [
	{ id: 'natt', label: 'natta', shortLabel: 'Natt', emoji: '🌙', question: 'Hvordan gikk natta?', fromMinutes: 5 * 60, toMinutes: 7 * 60 + 30 },
	{ id: 'morgen', label: 'morgenen', shortLabel: 'Morgen', emoji: '🌅', question: 'Hvordan gikk morgenen?', fromMinutes: 7 * 60 + 30, toMinutes: 12 * 60 },
	{ id: 'arbeidsdag', label: 'arbeidsdagen', shortLabel: 'Arbeid', emoji: '💼', question: 'Hvordan gikk arbeidsdagen?', fromMinutes: 14 * 60, toMinutes: 18 * 60 },
	{ id: 'ettermiddag', label: 'ettermiddagen', shortLabel: 'Etterm.', emoji: '🌇', question: 'Hvordan gikk ettermiddagen?', fromMinutes: 18 * 60, toMinutes: 20 * 60 },
	{ id: 'kveld', label: 'kvelden', shortLabel: 'Kveld', emoji: '🌃', question: 'Hvordan gikk kvelden?', fromMinutes: 20 * 60, toMinutes: 24 * 60 }
];

const PERIOD_SLOT_IDS = new Set<string>(PERIOD_SLOTS.map((s) => s.id));

export function isPeriodSlotId(value: unknown): value is PeriodSlotId {
	return typeof value === 'string' && PERIOD_SLOT_IDS.has(value);
}

/** Slot som er aktivt for et lokalt klokkeslett, eller null i hullene (00–05, 12–14). */
export function getActivePeriodSlot(now: Date = new Date()): PeriodSlot | null {
	const minutes = now.getHours() * 60 + now.getMinutes();
	return PERIOD_SLOTS.find((s) => minutes >= s.fromMinutes && minutes < s.toMinutes) ?? null;
}

/** Gruppering inn i eksisterende morning/evening-spor så sparklines og dagsbaseline fortsatt virker. */
export const PERIOD_SLOT_GROUP: Record<PeriodSlotId, 'morning' | 'evening'> = {
	natt: 'morning',
	morgen: 'morning',
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
