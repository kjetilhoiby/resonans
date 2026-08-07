/**
 * Optimistisk låsing for dokumentredigering.
 *
 * Bakgrunnen står i docs/changelog/2026-08-07-skriveprosjekt.md: mobil og desktop
 * skal være likeverdige skriveflater, og da er samtidig redigering reell selv for
 * én bruker — et dokument åpent på telefonen hele kvelden, endret på desktop i
 * mellomtiden, lagrer over ved neste tastetrykk.
 *
 * Siste-skriv-vinner er feil default her fordi taperen typisk er den lengste
 * teksten. Vi merger ikke — vi nekter, og sier hvorfor. Kollisjonen skal *vises*
 * i flaten, ikke svelges i en `catch {}` (CLAUDE.md om `extractApiErrorMessage`).
 */

/**
 * Slingringsmonn i millisekunder. Postgres lagrer `timestamp` med
 * mikrosekundpresisjon, mens JS `Date` har millisekunder. Begge sider av
 * sammenligningen går gjennom samme Date-konvertering, så de skal være like —
 * men 1 ms slingring koster ingenting og fjerner en hel klasse falske
 * kollisjoner ved eventuell avrunding.
 */
const TOLERANCE_MS = 1;

export type StaleCheck =
	| { ok: true }
	| { ok: false; reason: 'ugyldig-tidsstempel' | 'utdatert'; message: string };

function toMillis(value: Date | string | null | undefined): number | null {
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value.getTime();
	}
	if (typeof value === 'string' && value.trim()) {
		const ms = new Date(value).getTime();
		return Number.isNaN(ms) ? null : ms;
	}
	return null;
}

/**
 * Er skrivingen trygg? `current` er radens `updatedAt` i basen nå, `expected` er
 * det klienten hadde da den lastet dokumentet.
 *
 * Merk at et *nyere* `expected` enn `current` ikke er en feil — det skjer når to
 * skrivinger kommer så tett at klienten alt har fått svaret på den forrige. Bare
 * «basen er nyere enn det klienten så» er en kollisjon.
 */
export function checkNotStale(
	current: Date | string | null | undefined,
	expected: Date | string | null | undefined
): StaleCheck {
	const currentMs = toMillis(current);
	const expectedMs = toMillis(expected);

	if (currentMs === null || expectedMs === null) {
		return {
			ok: false,
			reason: 'ugyldig-tidsstempel',
			message: 'Mangler gyldig tidsstempel for versjonssjekk — last dokumentet på nytt og prøv igjen.'
		};
	}

	if (currentMs - expectedMs > TOLERANCE_MS) {
		return {
			ok: false,
			reason: 'utdatert',
			message: describeConflict(currentMs, expectedMs)
		};
	}

	return { ok: true };
}

/**
 * Menneskelig kollisjonsmelding. Sier hvor gammel versjonen din er, fordi det er
 * det som avgjør hva du gjør videre: to sekunder er en dobbeltlagring, to timer
 * er den andre enheten.
 */
function describeConflict(currentMs: number, expectedMs: number): string {
	const seconds = Math.round((currentMs - expectedMs) / 1000);
	let when: string;
	if (seconds < 60) when = `${seconds} sekund${seconds === 1 ? '' : 'er'}`;
	else if (seconds < 3600) {
		const m = Math.round(seconds / 60);
		when = `${m} minutt${m === 1 ? '' : 'er'}`;
	} else {
		const h = Math.round(seconds / 3600);
		when = `${h} time${h === 1 ? '' : 'r'}`;
	}
	return `Dokumentet ble endret et annet sted for ${when} siden. Din versjon er ikke lagret — kopier teksten din, last inn på nytt, og flett den inn.`;
}
