/**
 * Måltidsslots: frokost, lunsj, middag, kvelds, snacks.
 *
 * Samme sett som Lifesum, fordi det er det brukeren har i hodet fra før. Det
 * finnes to andre slot-vokabular i repoet — `mealPlans.mealType`
 * (breakfast/lunch/dinner/snack) på planleggingssiden i Mat, og egenfrekvens
 * sine periode-slots — men ingen av dem har «kvelds», som er et eget norsk
 * måltid og ikke en snack.
 *
 * Slotten *derives* fra Osloklokka ved logging, og kan overstyres. Derfor
 * `mealSlotSource`: retter du tidspunktet på et måltid der sloten er utledet,
 * skal den følge med. Har du valgt slot selv, skal den stå.
 */

export const MEAL_SLOT_IDS = ['frokost', 'lunsj', 'middag', 'kvelds', 'snacks'] as const;

export type MealSlotId = (typeof MEAL_SLOT_IDS)[number];

export interface MealSlotMeta {
	id: MealSlotId;
	label: string;
	emoji: string;
}

/** Rekkefølgen dagen vises i. Snacks sist: de hører ikke til et klokkeslett. */
export const MEAL_SLOTS: MealSlotMeta[] = [
	{ id: 'frokost', label: 'Frokost', emoji: '🌅' },
	{ id: 'lunsj', label: 'Lunsj', emoji: '🥪' },
	{ id: 'middag', label: 'Middag', emoji: '🍽️' },
	{ id: 'kvelds', label: 'Kvelds', emoji: '🌃' },
	{ id: 'snacks', label: 'Snacks', emoji: '🍫' }
];

const BY_ID = new Map(MEAL_SLOTS.map((slot) => [slot.id, slot]));

export function mealSlotMeta(id: MealSlotId): MealSlotMeta {
	// Kartet dekker hele unionen, så oppslaget kan ikke feile for en gyldig id.
	return BY_ID.get(id) ?? MEAL_SLOTS[0];
}

export function isMealSlotId(value: unknown): value is MealSlotId {
	return typeof value === 'string' && (MEAL_SLOT_IDS as readonly string[]).includes(value);
}

/**
 * Timegrensene, i Oslo-timer. Dekker hele døgnet uten hull.
 *
 * Kvelds strekker seg over midnatt: et måltid kl. 01 er nattmat, og Lifesum-
 * settet har ingen egen natt-slot. Å kalle det frokost ville vært verre.
 */
const FROKOST_FROM = 4;
const LUNSJ_FROM = 10.5;
const MIDDAG_FROM = 14.5;
const KVELDS_FROM = 19;

/** Klokketimen i Oslo som desimaltall, f.eks. 13,5 for 13:30. */
function osloDecimalHour(timestamp: string | Date): number | null {
	const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
	if (Number.isNaN(date.getTime())) return null;
	const parts = new Intl.DateTimeFormat('en-GB', {
		timeZone: 'Europe/Oslo',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false
	}).format(date);
	const [hour, minute] = parts.split(':').map(Number);
	if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
	// 24:00 forekommer i noen ICU-versjoner for midnatt.
	return (hour % 24) + minute / 60;
}

/**
 * Standard slot for et tidspunkt.
 *
 * Returnerer aldri `snacks`: en snack er en *type* måltid, ikke et klokkeslett,
 * så den kan bare velges. Null når tidspunktet er ugyldig — kallstedet skal da
 * la sloten stå tom framfor å gjette.
 */
export function mealSlotForTime(timestamp: string | Date): Exclude<MealSlotId, 'snacks'> | null {
	const hour = osloDecimalHour(timestamp);
	if (hour === null) return null;
	if (hour >= KVELDS_FROM || hour < FROKOST_FROM) return 'kvelds';
	if (hour >= MIDDAG_FROM) return 'middag';
	if (hour >= LUNSJ_FROM) return 'lunsj';
	return 'frokost';
}

/**
 * Ny slot etter at tidspunktet er endret.
 *
 * Bare når sloten var utledet. Har brukeren valgt «snacks» og deretter retter
 * klokka, skal det fortsatt være snacks — ellers overstyrer vi et bevisst valg.
 */
export function reslotAfterTimeChange(
	timestamp: string | Date,
	current: { slot: MealSlotId | null; source: 'derived' | 'user' | null }
): { slot: MealSlotId | null; source: 'derived' | 'user' | null } {
	if (current.source === 'user') return current;
	const derived = mealSlotForTime(timestamp);
	return derived ? { slot: derived, source: 'derived' } : current;
}
