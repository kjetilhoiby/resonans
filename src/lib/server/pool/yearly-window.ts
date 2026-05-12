// Hjelpere for årlige vinduer på pool-tasks.
// Format: 'MM-DD..MM-DD' f.eks. '05-13..05-17'.
// Støtter også vinduer som krysser nyttår, f.eks. '12-20..01-05'.

export type YearlyWindow = {
	startMonth: number; // 1-12
	startDay: number; // 1-31
	endMonth: number;
	endDay: number;
};

const NORWEGIAN_MONTHS = [
	'januar', 'februar', 'mars', 'april', 'mai', 'juni',
	'juli', 'august', 'september', 'oktober', 'november', 'desember'
];

const PATTERN_RE = /^(\d{2})-(\d{2})\.\.(\d{2})-(\d{2})$/;

export function parseYearlyWindow(pattern: string | null | undefined): YearlyWindow | null {
	if (!pattern) return null;
	const m = pattern.match(PATTERN_RE);
	if (!m) return null;
	const startMonth = Number(m[1]);
	const startDay = Number(m[2]);
	const endMonth = Number(m[3]);
	const endDay = Number(m[4]);
	if (startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) return null;
	if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) return null;
	return { startMonth, startDay, endMonth, endDay };
}

function ordinal(month: number, day: number): number {
	return month * 100 + day;
}

export function isActiveOn(pattern: string | null | undefined, date: Date): boolean {
	const w = parseYearlyWindow(pattern);
	if (!w) return false;
	const m = date.getUTCMonth() + 1;
	const d = date.getUTCDate();
	const cur = ordinal(m, d);
	const start = ordinal(w.startMonth, w.startDay);
	const end = ordinal(w.endMonth, w.endDay);
	if (start <= end) {
		return cur >= start && cur <= end;
	}
	// Vindu krysser nyttår
	return cur >= start || cur <= end;
}

export function nextOccurrence(pattern: string, from: Date): { start: Date; end: Date } | null {
	const w = parseYearlyWindow(pattern);
	if (!w) return null;
	const fromYear = from.getUTCFullYear();
	for (let yearDelta = 0; yearDelta < 2; yearDelta++) {
		const year = fromYear + yearDelta;
		const start = new Date(Date.UTC(year, w.startMonth - 1, w.startDay));
		const crossesYear = ordinal(w.startMonth, w.startDay) > ordinal(w.endMonth, w.endDay);
		const end = new Date(Date.UTC(crossesYear ? year + 1 : year, w.endMonth - 1, w.endDay));
		if (end >= from) return { start, end };
	}
	return null;
}

export function formatYearlyWindowNo(pattern: string | null | undefined): string {
	const w = parseYearlyWindow(pattern);
	if (!w) return '';
	if (w.startMonth === w.endMonth) {
		return `${w.startDay}.–${w.endDay}. ${NORWEGIAN_MONTHS[w.startMonth - 1]} hvert år`;
	}
	return `${w.startDay}. ${NORWEGIAN_MONTHS[w.startMonth - 1]} til ${w.endDay}. ${NORWEGIAN_MONTHS[w.endMonth - 1]} hvert år`;
}

// Overlap mellom en gitt datointervall (uke/måned) og pattern. Returnerer true hvis
// vinduet er aktivt minst én dag i intervallet.
export function overlapsRange(pattern: string | null | undefined, rangeStart: Date, rangeEnd: Date): boolean {
	const w = parseYearlyWindow(pattern);
	if (!w) return false;
	// Iterer over hver dag i intervallet (max ~31 dager for måneds-kall — billig).
	const cursor = new Date(rangeStart);
	while (cursor <= rangeEnd) {
		if (isActiveOn(pattern, cursor)) return true;
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}
	return false;
}
