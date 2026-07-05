/**
 * Lesing i ferien — ren beregningslogikk for FerieBooksSection.
 *
 * Fremdrift registreres som spredte slider-snapshots i book_progress_log.
 * Her omsettes snapshotene til mål-kort-serier for ferievinduet: baseline er
 * siste kjente verdi før ferien (0 når boka aldri er logget før — da regnes
 * den som påbegynt i ferien), lesestart/-slutt utledes fra første og siste
 * dag med økning i vinduet, og forventet ferdig-dato beregnes med lineær
 * regresjon over feriepunktene (samme tilnærming som bokas egen graf).
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
	/** Posisjon i x-domenet [feriestart, domainEnd], 0..1. */
	x: number;
	/** Andel av boka (mot total, ellers mot største observerte verdi), 0..1. */
	y: number;
	date: string; // ISO-dato
	value: number; // rå verdi (sider eller minutter)
}

/** Stiplet prediksjonslinje fra siste punkt mot totalen, normaliserte koordinater. */
export interface FeriePredSegment {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
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
	/** Boka nådde totalen i løpet av ferien. */
	finished: boolean;
	/** Dagen boka ble ferdig (siste økning) — null når !finished. */
	finishedDate: string | null;
	/** Forventet ferdig-dato fra ferie-tempoet — null når ferdig/ukjent. */
	etaDate: string | null;
	/** «34 sider/dag» / «1t 10m/dag» — null uten nok datapunkter. */
	paceLabel: string | null;
	/** Høyre ende av x-domenet: ferieslutt, eller ETA når den ligger like etter. */
	domainEnd: string;
	/** Ferieslutt-posisjonen i x-domenet (1 når domenet slutter ved ferieslutt). */
	ferieEndX: number;
	pred: FeriePredSegment | null;
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

/** «12. juli» — for ferdig/forventet ferdig-etiketter. */
export function formatDateLabel(iso: string): string {
	return formatDayLabel(iso);
}

/** «3t 20m» / «45m» — samme form som bokas egen fremdriftsgraf. */
export function formatMinutesLabel(mins: number): string {
	const h = Math.floor(mins / 60);
	const m = mins % 60;
	return h > 0 ? `${h}t ${m < 10 ? '0' : ''}${m}m` : `${m}m`;
}

function isoAddDays(iso: string, days: number): string {
	const d = new Date(Date.parse(iso + 'T00:00:00Z') + days * DAY_MS);
	return d.toISOString().slice(0, 10);
}

function linReg(pts: Array<{ x: number; y: number }>): { slope: number; intercept: number } | null {
	const n = pts.length;
	if (n < 2) return null;
	const sx = pts.reduce((s, p) => s + p.x, 0);
	const sy = pts.reduce((s, p) => s + p.y, 0);
	const sxy = pts.reduce((s, p) => s + p.x * p.y, 0);
	const sx2 = pts.reduce((s, p) => s + p.x * p.x, 0);
	const d = n * sx2 - sx * sx;
	if (d === 0) return null;
	const slope = (n * sxy - sx * sy) / d;
	return { slope, intercept: (sy - slope * sx) / n };
}

export function buildFerieReadingSeries(
	books: FerieBook[],
	startDate: string,
	endDate: string
): FerieReadingSeries[] {
	const startMs = Date.parse(startDate + 'T00:00:00Z');
	const endMs = Date.parse(endDate + 'T00:00:00Z');
	const windowMs = Math.max(endMs - startMs, DAY_MS);
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
		let baselineDay: string | null = null;
		const inWindow: Array<[string, number]> = [];
		for (const [day, v] of days) {
			if (day < startDate) {
				baseline = v;
				baselineDay = day;
			} else if (day <= endDate) {
				inWindow.push([day, v]);
			}
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

		const finished = total > 0 && lastValue >= total;

		// Tempo og forventet ferdig: regresjon over dagene med kjent verdi —
		// den ekte baseline-dagen (før ferien) teller med, den syntetiske
		// (antatt 0 ved feriestart) gjør ikke.
		const dayX = (day: string) => (Date.parse(day + 'T00:00:00Z') - startMs) / DAY_MS;
		const regPts = inWindow.map(([day, v]) => ({ x: dayX(day), y: v }));
		if (baselineDay) regPts.unshift({ x: dayX(baselineDay), y: baseline });
		const reg = linReg(regPts);

		let etaDate: string | null = null;
		let paceLabel: string | null = null;
		if (reg && reg.slope > 0) {
			paceLabel =
				metric === 'sider'
					? `${reg.slope < 10 ? reg.slope.toFixed(1) : Math.round(reg.slope)} sider/dag`
					: `${formatMinutesLabel(Math.max(Math.round(reg.slope), 1))}/dag`;
			if (!finished && total > 0) {
				const etaDays = (total - reg.intercept) / reg.slope;
				if (etaDays > 0 && etaDays < 3650) {
					etaDate = isoAddDays(startDate, Math.ceil(etaDays));
				}
			}
		}

		// x-domenet strekkes til ETA når den ligger like etter ferien (maks det
		// dobbelte av ferielengden), så prediksjonslinja kan nå 100 %-streken.
		let domainEndMs = endMs;
		const etaMs = etaDate ? Date.parse(etaDate + 'T00:00:00Z') : null;
		if (etaMs && etaMs > endMs && etaMs - endMs <= windowMs) domainEndMs = etaMs;
		const domainMs = Math.max(domainEndMs - startMs, DAY_MS);

		const maxObserved = Math.max(baseline, ...inWindow.map(([, v]) => v));
		const denom = total > 0 ? total : maxObserved;
		const xOfMs = (ms: number) => Math.min(Math.max((ms - startMs) / domainMs, 0), 1);
		const xOf = (day: string) => xOfMs(Date.parse(day + 'T00:00:00Z'));
		const yOf = (v: number) => (denom > 0 ? Math.min(v / denom, 1) : 0);

		const points: FerieReadingPoint[] = inWindow.map(([day, v]) => ({
			x: xOf(day), y: yOf(v), date: day, value: v
		}));
		// Kurven starter på feriens første dag med baseline-verdien, så «hvor langt
		// var jeg da ferien begynte» alltid er synlig.
		if (inWindow[0][0] !== startDate) {
			points.unshift({ x: 0, y: yOf(baseline), date: startDate, value: baseline });
		}

		// Prediksjonslinje fra siste punkt mot totalen. Når ETA ligger utenfor
		// domenet, klippes linja ved domeneslutt med regresjonsverdien der, så
		// stigningen ikke forvrenges.
		let pred: FeriePredSegment | null = null;
		if (reg && reg.slope > 0 && !finished && total > 0 && etaDate) {
			const last = points[points.length - 1];
			if (etaMs && etaMs <= domainEndMs) {
				pred = { x1: last.x, y1: last.y, x2: xOfMs(etaMs), y2: 1 };
			} else {
				const valueAtDomainEnd = reg.intercept + reg.slope * ((domainEndMs - startMs) / DAY_MS);
				pred = { x1: last.x, y1: last.y, x2: 1, y2: yOf(valueAtDomainEnd) };
			}
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
			finished,
			finishedDate: finished ? lastDay : null,
			etaDate,
			paceLabel,
			domainEnd: new Date(domainEndMs).toISOString().slice(0, 10),
			ferieEndX: xOfMs(endMs),
			pred,
			points
		});
	}

	// Mest lest først (relativt til bokas lengde, så sider og minutter kan
	// sammenlignes) — kortene vises i denne rekkefølgen.
	const ySpan = (s: FerieReadingSeries) =>
		s.points[s.points.length - 1].y - s.points[0].y;
	return out.sort((a, b) => ySpan(b) - ySpan(a));
}
