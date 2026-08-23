/**
 * Ren måneds-matematikk: uker som starter på mandag, dag-nøkler «YYYY-MM-DD»
 * (samme format som chat-ankrene) og norske etiketter.
 *
 * Lå under `client/` da MonthCalendar var eneste kaller. Flyttet til domenelaget
 * da streak-historikken tok den i bruk — et domenemodul som importerer fra
 * `client/` snur lagene, og modulen har alltid vært ren matematikk.
 */

/** Ukedagsinitialer, mandag først (nb-NO). */
export const WEEKDAY_INITIALS = ['M', 'T', 'O', 'T', 'F', 'L', 'S'];

function parseMonthKey(key: string): { y: number; m: number } | null {
	const match = /^(\d{4})-(\d{2})$/.exec(key);
	if (!match) return null;
	const y = Number(match[1]);
	const m = Number(match[2]);
	return m >= 1 && m <= 12 ? { y, m } : null;
}

/** Måned-nøkkel «YYYY-MM» for en dato (lokal tid). */
export function monthKey(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/** Norsk tittel for en måned-nøkkel, f.eks. «Juli 2026». */
export function monthTitle(key: string): string {
	const p = parseMonthKey(key);
	if (!p) return '';
	const label = new Intl.DateTimeFormat('nb-NO', { month: 'long', year: 'numeric' }).format(
		new Date(p.y, p.m - 1, 1)
	);
	return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Flytt en måned-nøkkel `delta` måneder frem/tilbake (håndterer årsskifter). */
export function addMonths(key: string, delta: number): string {
	const p = parseMonthKey(key);
	if (!p) return key;
	return monthKey(new Date(p.y, p.m - 1 + delta, 1));
}

/**
 * Ukene i en måned som rader à 7 celler (man–søn). Celler utenfor måneden er null;
 * ellers dag-nøkkel «YYYY-MM-DD».
 */
export function monthGrid(key: string): (string | null)[][] {
	const p = parseMonthKey(key);
	if (!p) return [];
	const first = new Date(p.y, p.m - 1, 1);
	const daysInMonth = new Date(p.y, p.m, 0).getDate();
	const lead = (first.getDay() + 6) % 7; // getDay: 0=søndag → mandag-basert offset

	const cells: (string | null)[] = Array(lead).fill(null);
	for (let day = 1; day <= daysInMonth; day++) {
		cells.push(`${key}-${String(day).padStart(2, '0')}`);
	}
	while (cells.length % 7 !== 0) cells.push(null);

	const weeks: (string | null)[][] = [];
	for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
	return weeks;
}
