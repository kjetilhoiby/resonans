/**
 * Time period utilities for aggregation
 * Based on your weekly.js logic
 */

export interface WeekPeriod {
	year: number;
	week: number;
	yearweek: string; // '2025W43'
	startDate: string; // '2025-10-20' (ISO date)
	endDate: string; // '2025-10-26'
	startTime: Date;
	endTime: Date;
	dates: string[]; // All 7 dates in the week
}

export interface MonthPeriod {
	year: number;
	month: number;
	yearmonth: string; // '2025M10'
	startDate: string;
	endDate: string;
	startTime: Date;
	endTime: Date;
}

export interface YearPeriod {
	year: number;
	startDate: string; // '2025-01-01'
	endDate: string; // '2025-12-31'
	startTime: Date;
	endTime: Date;
}

/**
 * Get date of ISO week (Monday-based)
 * From your weekly.js
 */
function getDateOfISOWeek(week: number, year: number): Date {
	const naive = new Date(year, 0, 1 + (week - 1) * 7);
	const dateOfWeek = naive.getDay();
	const ISOweekStart = new Date(naive);
	
	if (dateOfWeek <= 4) {
		ISOweekStart.setDate(naive.getDate() - naive.getDay() + 1);
	} else {
		ISOweekStart.setDate(naive.getDate() + 8 - naive.getDay());
	}
	
	return ISOweekStart;
}

/**
 * Generate all weeks from start year to now
 */
export function generateWeeks(startYear = 2017): WeekPeriod[] {
	const weeks: WeekPeriod[] = [];
	const currentYear = new Date().getFullYear();
	const now = Date.now();

	for (let year = startYear; year <= currentYear; year++) {
		for (let week = 1; week <= 53; week++) {
			const startTime = getDateOfISOWeek(week, year);
			const endTime = new Date(startTime.getTime() + 7 * 24 * 60 * 60 * 1000 - 1000);

			// Only include weeks that have started
			if (startTime.getTime() > now) break;

			// Generate all 7 dates in the week
			const dates: string[] = [];
			for (let i = 0; i < 7; i++) {
				const date = new Date(startTime.getTime() + i * 24 * 60 * 60 * 1000);
				dates.push(date.toISOString().split('T')[0]);
			}

			const yearweek = `${year}W${week.toString().padStart(2, '0')}`;

			weeks.push({
				year,
				week,
				yearweek,
				startDate: startTime.toISOString().split('T')[0],
				endDate: endTime.toISOString().split('T')[0],
				startTime,
				endTime,
				dates
			});
		}
	}

	return weeks.reverse(); // Most recent first
}

/**
 * Generate all months from start year to now
 */
export function generateMonths(startYear = 2017): MonthPeriod[] {
	const months: MonthPeriod[] = [];
	const now = new Date();
	const currentYear = now.getFullYear();
	const currentMonth = now.getMonth() + 1;

	for (let year = startYear; year <= currentYear; year++) {
		const maxMonth = year === currentYear ? currentMonth : 12;
		
		for (let month = 1; month <= maxMonth; month++) {
			const startTime = new Date(year, month - 1, 1);
			const endTime = new Date(year, month, 0, 23, 59, 59);

			const yearmonth = `${year}M${month.toString().padStart(2, '0')}`;

			months.push({
				year,
				month,
				yearmonth,
				startDate: startTime.toISOString().split('T')[0],
				endDate: endTime.toISOString().split('T')[0],
				startTime,
				endTime
			});
		}
	}

	return months.reverse(); // Most recent first
}

/**
 * Generate all years from start to now
 */
export function generateYears(startYear = 2017): YearPeriod[] {
	const years: YearPeriod[] = [];
	const currentYear = new Date().getFullYear();

	for (let year = startYear; year <= currentYear; year++) {
		const startTime = new Date(year, 0, 1);
		const endTime = new Date(year, 11, 31, 23, 59, 59);

		years.push({
			year,
			startDate: `${year}-01-01`,
			endDate: `${year}-12-31`,
			startTime,
			endTime
		});
	}

	return years.reverse(); // Most recent first
}

/**
 * Get current week period
 */
export function getCurrentWeek(): WeekPeriod {
	const weeks = generateWeeks();
	return weeks[0]; // Most recent is first
}

/**
 * Get current month period
 */
export function getCurrentMonth(): MonthPeriod {
	const months = generateMonths();
	return months[0];
}

/**
 * Get current year period
 */
export function getCurrentYear(): YearPeriod {
	const years = generateYears();
	return years[0];
}
