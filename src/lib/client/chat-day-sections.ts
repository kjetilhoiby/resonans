/**
 * Dato-seksjonering for chat-flyten.
 *
 * Den kanoniske chattetråden («dagboken») skal ha et avsnitt for hver dag, synliggjort
 * med en dato-spacer i flyten. Denne modulen er ren og testbar: den avgjør *når* en
 * spacer skal settes inn og *hvilken etikett* den skal ha — selve rendringen skjer i
 * `ChatMessages.svelte`.
 *
 * Bakoverkompatibelt: meldinger uten `createdAt` gir ingen spacer, slik at
 * chat-kontekster som ikke bærer tidsstempler oppfører seg som før.
 */

export interface DayAware {
	createdAt?: string | Date | null;
}

/** Parser en dato-verdi robust. Returnerer null for tomt/ugyldig. */
export function toDate(value: string | Date | null | undefined): Date | null {
	if (value === null || value === undefined || value === '') return null;
	const d = value instanceof Date ? value : new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** Er to datoer på samme kalenderdag (lokal tid)? */
export function isSameDay(a: Date, b: Date): boolean {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}

function startOfDay(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Stabil dag-nøkkel «YYYY-MM-DD» (lokal tid). Brukes som anker-id på dato-spacere
 * (`dag-<key>`) slik at ukeplanen kan hoppe rett til en dag i den kanoniske tråden.
 */
export function dayKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * Norsk etikett for en dag-spacer: «I dag», «I går», ellers «Onsdag 25. juni»
 * (år tas med kun når det avviker fra `now`).
 */
export function formatDayLabel(date: Date, now: Date = new Date()): string {
	const diffDays = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
	if (diffDays === 0) return 'I dag';
	if (diffDays === 1) return 'I går';

	const sameYear = date.getFullYear() === now.getFullYear();
	const formatted = new Intl.DateTimeFormat('nb-NO', {
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		...(sameYear ? {} : { year: 'numeric' })
	}).format(date);

	return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/**
 * Skal det settes inn en dato-spacer FØR meldingen på `index`? Returnerer etiketten
 * som skal vises, eller null om ingen spacer trengs.
 *
 * Regler:
 * - Melding uten gyldig `createdAt` → ingen spacer.
 * - Første melding med tidsstempel → spacer (dag-overskrift øverst i tråden).
 * - Ny kalenderdag i forhold til forrige melding → spacer.
 * - Hvis forrige melding mangler tidsstempel (blandet flyt) → ingen spacer midt i
 *   strømmen, for å unngå tilfeldige skiller.
 */
export function daySpacerBefore(
	messages: DayAware[],
	index: number,
	now: Date = new Date()
): string | null {
	const current = toDate(messages[index]?.createdAt);
	if (!current) return null;

	if (index === 0) return formatDayLabel(current, now);

	const previous = toDate(messages[index - 1]?.createdAt);
	if (!previous) return null;
	if (isSameDay(previous, current)) return null;

	return formatDayLabel(current, now);
}
