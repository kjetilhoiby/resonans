import { localHm, localIsoDay, hmToMinutes } from './nudge-time';

export interface LocalDateParts {
	iso: string;
	year: number;
	month: number;
	day: number;
	dow: number;
	minutesOfDay: number;
}

export function localDateParts(tz: string, now: Date): LocalDateParts {
	const iso = localIsoDay(tz, now);
	const [yStr, mStr, dStr] = iso.split('-');
	const year = Number(yStr);
	const month = Number(mStr);
	const day = Number(dStr);
	const dow = new Date(Date.UTC(year, month - 1, day, 12, 0, 0)).getUTCDay();
	const minutesOfDay = hmToMinutes(localHm(tz, now)) ?? 0;
	return { iso, year, month, day, dow, minutesOfDay };
}

export function isoWeekKey(year: number, month: number, day: number): string {
	const d = new Date(Date.UTC(year, month - 1, day));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const isoYear = d.getUTCFullYear();
	const yearStart = new Date(Date.UTC(isoYear, 0, 1));
	const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
	return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

export function yearMonthKey(year: number, month: number): string {
	return `${year}-${String(month).padStart(2, '0')}`;
}

export function isoDateKey(year: number, month: number, day: number): string {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(year: number, month: number, day: number, deltaDays: number) {
	const d = new Date(Date.UTC(year, month - 1, day));
	d.setUTCDate(d.getUTCDate() + deltaDays);
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate()
	};
}

export function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function nextMonth(year: number, month: number) {
	return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}
