/**
 * Lesing i ferien — ren beregningslogikk for FerieBooksSection.
 *
 * Fremdrift registreres som spredte slider-snapshots i book_progress_log.
 * Her omsettes snapshotene til tegnbare serier for ferievinduet: baseline er
 * siste kjente verdi før ferien (0 når boka aldri er logget før — da regnes
 * den som påbegynt i ferien), og lesestart/-slutt utledes fra første og siste
 * dag med økning i vinduet.
 */

export interface FerieBookPoint {
	loggedAt: string; // ISO-timestamp
	currentPage: number | null;
	currentMinutes: number | null;
}

export interface FerieBook {
	id: string;
	themeId: string | null;
	title: string;
	author: string | null;
	coverUrl: string | null;
	format: string | null; // 'print' | 'audio' | 'both'
	totalPages: number | null;
	totalMinutes: number | null;
	/** Loggpunkter t.o.m. ferieslutt, stigende — inkl. evt. baseline-punkt før ferien. */
	points: FerieBookPoint[];
}

export interface FerieReadingPoint {
	/** Posisjon i ferievinduet, 0..1. */
	x: number;
	/** Andel av boka (mot total, ellers mot største observerte verdi), 0..1. */
	y: number;
	date: string; // ISO-dato
	value: number; // rå verdi (sider eller minutter)
}

export interface FerieReadingSeries {
	bookId: string;
	themeId: string | null;
	title: string;
	author: string | null;
	coverUrl: string | null;
	metric: 'sider' | 'minutter';
	/** Lest i ferien: «142 sider» / «3t 20m». */
	deltaLabel: string;
	/** «2.–9. juli» — første til siste dag med registrert økning. */
	periodLabel: string;
	/** Andel av boka ved feriestart/-slutt i prosent — null når total er ukjent. */
	fromPct: number | null;
	toPct: number | null;
	points: FerieReadingPoint[];
}

const MONTHS = [
	'januar', 'februar', 'mars', 'april', 'mai', 'juni',
	'juli', 'august', 'september', 'oktober', 'november', 'desember'
];

const DAY_MS = 86_400_000;

function formatDayLabel(iso: string): string {
	const [, m, d] = iso.split('-').map(Number);
	return `${d}. ${MONTHS[m - 1]}`;
}

/** «2.–9. juli», «28. juni – 3. juli», eller «2. juli» for én dag. */
export function formatPeriodLabel(fromIso: string, toIso: string): string {
	if (fromIso === toIso) return formatDayLabel(fromIso);
	const [, fm, fd] = fromIso.split('-').map(Number);
	const [, tm, td] = toIso.split('-').map(Number);
	if (fm === tm) return `${fd}.–${td}. ${MONTHS[fm - 1]}`;
	return `${formatDayLabel(fromIso)} – ${formatDayLabel(toIso)}`;
}

/** «3t 20m» / «45m» — samme form som bokas egen fremdriftsgraf. */
export function formatMinutesLabel(mins: number): string {
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return h > 0 ? `${h}t ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
}

export function buildFerieReadingSeries(
	books: FerieBook[],
	startDate: string,
	endDate: string
): FerieReadingSeries[] {
	const startMs = Date.parse(startDate + 'T00:00:00Z');
	const range = Math.max(Date.parse(endDate + 'T00:00:00Z') - startMs, DAY_MS);
	const out: FerieReadingSeries[] = [];

	for (const book of books) {
		const metric: 'sider' | 'minutter' = book.format === 'print' ? 'sider' : 'minutter';
		const total = (metric === 'sider' ? book.totalPages : book.totalMinutes) ?? 0;

		// Siste snapshot per dag (samme kollaps som bokas egen fremdriftsgraf).
		const byDay = new Map<string, number>();
		for (const p of book.points) {
			const v = metric === 'sider' ? p.currentPage : p.currentMinutes;
			if (v !== null && v !== undefined) byDay.set(p.loggedAt.slice(0, 10), v);
		}
		const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

		let baseline = 0;
		const inWindow: Array<[string, number]> = [];
		for (const [day, v] of days) {
			if (day < startDate) baseline = v;
			else if (day <= endDate) inWindow.push([day, v]);
		}
		if (inWindow.length === 0) continue;

		// Lesestart/-slutt: første og siste dag med økning fra forrige kjente verdi.
		let firstDay: string | null = null;
		let lastDay: string | null = null;
		let prev = baseline;
		for (const [day, v] of inWindow) {
			if (v > prev) {
				firstDay ??= day;
				lastDay = day;
			}
			prev = v;
		}
		const lastValue = inWindow[inWindow.length - 1][1];
		const delta = lastValue - baseline;
		if (!firstDay || !lastDay || delta <= 0) continue; // ingen registrert lesing i vinduet

		const maxObserved = Math.max(baseline, ...inWindow.map(([, v]) => v));
		const denom = total > 0 ? total : maxObserved;
		const xOf = (day: string) =>
			Math.min(Math.max((Date.parse(day + 'T00:00:00Z') - startMs) / range, 0), 1);
		const yOf = (v: number) => (denom > 0 ? Math.min(v / denom, 1) : 0);

		const points: FerieReadingPoint[] = inWindow.map(([day, v]) => ({
			x: xOf(day), y: yOf(v), date: day, value: v
		}));
		// Kurven starter på feriens første dag med baseline-verdien, så «hvor langt
		// var jeg da ferien begynte» alltid er synlig.
		if (inWindow[0][0] !== startDate) {
			points.unshift({ x: 0, y: yOf(baseline), date: startDate, value: baseline });
		}

		out.push({
			bookId: book.id,
			themeId: book.themeId,
			title: book.title,
			author: book.author,
			coverUrl: book.coverUrl,
			metric,
			deltaLabel:
				metric === 'sider'
					? `${delta} ${delta === 1 ? 'side' : 'sider'}`
					: formatMinutesLabel(delta),
			periodLabel: formatPeriodLabel(firstDay, lastDay),
			fromPct: total > 0 ? Math.round((baseline / total) * 100) : null,
			toPct: total > 0 ? Math.round((lastValue / total) * 100) : null,
			points
		});
	}

	// Mest lest først (relativt til bokas lengde, så sider og minutter kan
	// sammenlignes) — fargene i diagrammet tildeles i denne rekkefølgen.
	const ySpan = (s: FerieReadingSeries) =>
		s.points[s.points.length - 1].y - s.points[0].y;
	return out.sort((a, b) => ySpan(b) - ySpan(a));
}
