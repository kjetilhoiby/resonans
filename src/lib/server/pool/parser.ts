// Norske språkparsere for pool-tasks: splitting av dump, dato-uttrykk og estimat.

import { parseYearlyWindow } from './yearly-window';

const INTRO_RE = /(?:^|\n)\s*(?:skulle\s+(?:ha\s+)?gjort|huskelist[ea]|todo|todoer|dump(?:e|en)?|ting\s+å\s+gjøre|gjøremål|notater?)[:\s]+/i;

const NORWEGIAN_MONTH_MAP: Record<string, number> = {
	januar: 1, jan: 1,
	februar: 2, feb: 2,
	mars: 3, mar: 3,
	april: 4, apr: 4,
	mai: 5,
	juni: 6, jun: 6,
	juli: 7, jul: 7,
	august: 8, aug: 8,
	september: 9, sep: 9, sept: 9,
	oktober: 10, okt: 10,
	november: 11, nov: 11,
	desember: 12, des: 12, dec: 12
};

function stripBullet(s: string): string {
	return s.replace(/^[\s\-•*\d.)\]]+/u, '').trim();
}

// Splitter en dump-melding i enkelt-titler. Lav-friksjon: gjetter ikke metadata.
export function parseMultiplePoolTasks(text: string): Array<{ title: string }> {
	if (!text || !text.trim()) return [];

	let working = text.trim();
	const introMatch = working.match(INTRO_RE);
	if (introMatch) {
		working = working.slice(introMatch.index! + introMatch[0].length);
	}

	let parts: string[] = [];
	if (/\n/.test(working)) {
		parts = working.split(/\n+/);
	} else if (/[,;]| og /i.test(working)) {
		parts = working.split(/\s*,\s*|\s*;\s*|\s+og\s+/i);
	} else {
		parts = [working];
	}

	const seen = new Set<string>();
	const result: Array<{ title: string }> = [];
	for (const raw of parts) {
		const title = stripBullet(raw).replace(/\.$/, '').trim();
		if (!title) continue;
		if (title.length < 2) continue;
		const key = title.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		result.push({ title });
	}
	return result;
}

export type PoolDateExpression = {
	dueDate?: string;
	availableFrom?: string;
	availableTo?: string;
	yearlyWindow?: string;
};

function pad2(n: number): string {
	return n < 10 ? `0${n}` : String(n);
}

function isoDate(year: number, month: number, day: number): string {
	return `${year}-${pad2(month)}-${pad2(day)}`;
}

function findMonth(token: string): number | null {
	const lower = token.toLowerCase().replace(/\.$/, '');
	return NORWEGIAN_MONTH_MAP[lower] ?? null;
}

// Tolker norske dato-uttrykk i en enkelt streng (typisk ett klargjøringssvar eller én tittel).
export function parseDateExpressions(text: string, today: Date = new Date()): PoolDateExpression {
	const out: PoolDateExpression = {};
	const lower = text.toLowerCase();
	const year = today.getUTCFullYear();

	// "13.-17. mai hvert år" → yearlyWindow
	const yearlyMatch = lower.match(/(\d{1,2})\s*\.?\s*[-–]\s*(\d{1,2})\s*\.?\s+([a-zæøå]+)\s+hvert\s+år/);
	if (yearlyMatch) {
		const startDay = Number(yearlyMatch[1]);
		const endDay = Number(yearlyMatch[2]);
		const month = findMonth(yearlyMatch[3]);
		if (month && startDay >= 1 && endDay >= 1 && startDay <= 31 && endDay <= 31) {
			const pattern = `${pad2(month)}-${pad2(startDay)}..${pad2(month)}-${pad2(endDay)}`;
			if (parseYearlyWindow(pattern)) out.yearlyWindow = pattern;
		}
	}

	// "i løpet av april" / "innen april" / "i april" → måneds-vindu
	const monthRangeMatch = lower.match(/\b(?:i\s+løpet\s+av|innen|i)\s+([a-zæøå]+)\b/);
	if (!out.yearlyWindow && monthRangeMatch) {
		const month = findMonth(monthRangeMatch[1]);
		if (month) {
			const start = new Date(Date.UTC(year, month - 1, 1));
			const end = new Date(Date.UTC(year, month, 0)); // siste dag
			const targetMonth = month >= today.getUTCMonth() + 1 ? month : month; // alltid inneværende år (best-effort)
			out.availableFrom = isoDate(year, targetMonth, 1);
			out.availableTo = isoDate(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate());
		}
	}

	// "til mai" / "før mai" / "innen mai" → dueDate (siste dag i måneden før, eller første i måneden — vi setter siste dag i forrige måned)
	const beforeMatch = lower.match(/\b(?:til|før|innen)\s+([a-zæøå]+)\b/);
	if (!out.dueDate && !out.availableFrom && beforeMatch) {
		const month = findMonth(beforeMatch[1]);
		if (month) {
			// "innen mai" = sluttdato 30. apr (eller 31. apr → forrige måneds siste dag)
			const target = new Date(Date.UTC(year, month - 1, 0)); // siste dag i forrige måned
			out.dueDate = isoDate(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate());
		}
	}

	// "neste fredag" / "fredag" — enkel weekday
	const weekdays: Record<string, number> = {
		søndag: 0, mandag: 1, tirsdag: 2, onsdag: 3, torsdag: 4, fredag: 5, lørdag: 6
	};
	const weekdayMatch = lower.match(/\b(?:neste\s+)?(søndag|mandag|tirsdag|onsdag|torsdag|fredag|lørdag)\b/);
	if (!out.dueDate && weekdayMatch) {
		const targetDow = weekdays[weekdayMatch[1]];
		const current = today.getUTCDay();
		let delta = (targetDow - current + 7) % 7;
		if (delta === 0) delta = 7;
		const target = new Date(today);
		target.setUTCDate(today.getUTCDate() + delta);
		out.dueDate = target.toISOString().slice(0, 10);
	}

	// "DD. måned" → konkret dato
	const dateMatch = lower.match(/\b(\d{1,2})\.\s+([a-zæøå]+)\b/);
	if (!out.dueDate && dateMatch) {
		const day = Number(dateMatch[1]);
		const month = findMonth(dateMatch[2]);
		if (month && day >= 1 && day <= 31) {
			out.dueDate = isoDate(year, month, day);
		}
	}

	// ISO direkte
	const isoMatch = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
	if (!out.dueDate && isoMatch) {
		out.dueDate = isoMatch[1];
	}

	return out;
}

// Tolker estimat-uttrykk i norsk dagligtale.
export function parseEstimate(text: string): number | null {
	const lower = text.toLowerCase();
	if (/ingen\s+ide|vet\s+ikke|usikker/.test(lower)) return null;
	if (/\bet\s+kvarter\b/.test(lower)) return 15;
	if (/\ben\s+halvtime\b|\bhalvtime\b/.test(lower)) return 30;
	if (/\ben\s+time\s+og\s+et\s+kvarter\b/.test(lower)) return 75;
	if (/\bhalvannen\s+time\b/.test(lower)) return 90;

	const hourMatch = lower.match(/(\d+(?:[.,]\d+)?)\s*t(?:ime[r]?)?\b/);
	if (hourMatch) {
		const v = parseFloat(hourMatch[1].replace(',', '.'));
		if (Number.isFinite(v)) return Math.round(v * 60);
	}

	const minMatch = lower.match(/(\d+)\s*min(?:utt(?:er)?)?\b/);
	if (minMatch) {
		const v = Number(minMatch[1]);
		if (Number.isFinite(v)) return v;
	}

	const wordHours: Record<string, number> = {
		en: 1, ett: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6
	};
	const wordHourMatch = lower.match(/\b(en|ett|to|tre|fire|fem|seks)\s+time(?:r)?\b/);
	if (wordHourMatch) {
		return wordHours[wordHourMatch[1]] * 60;
	}

	return null;
}
