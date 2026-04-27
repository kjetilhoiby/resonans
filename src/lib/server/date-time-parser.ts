/**
 * Date/time parser for natural language task descriptions
 * Examples:
 * - "Ring byggeleder onsdag kl. 10" → { text: "Ring byggeleder", startDate: "2026-04-29", hour: 10 }
 * - "Møte fredag" → { text: "Møte", startDate: "2026-05-01" }
 * - "Kl. 14 presentasjon" → { text: "presentasjon", hour: 14 }
 */

interface ParsedDateTime {
	text: string; // Text with date/time stripped
	startDate?: string; // ISO date (YYYY-MM-DD)
	hour?: number; // 0-23
	minute?: number; // 0-59
}

const NORWEGIAN_DAYS = {
	mandag: 1,
	tirsdag: 2,
	onsdag: 3,
	torsdag: 4,
	fredag: 5,
	lørdag: 6,
	søndag: 0
};

const NORMALIZED_DAYS = {
	man: 1,
	tir: 2,
	ons: 3,
	tor: 4,
	fre: 5,
	lør: 6,
	søn: 0
};

/**
 * Get next occurrence of a day of week (0=Sun, 1=Mon, ..., 6=Sat)
 */
function getNextDateForDayOfWeek(targetDay: number): string {
	const now = new Date();
	const today = now.getDay();
	let daysAhead = targetDay - today;
	
	// If target day is in the past this week, jump to next week
	if (daysAhead < 0) {
		daysAhead += 7;
	}
	
	const result = new Date(now);
	result.setDate(result.getDate() + daysAhead);
	
	return result.toISOString().split('T')[0];
}

/**
 * Parse time from strings like "kl. 10", "10:30", "14", etc.
 */
function parseTime(timeStr: string): { hour?: number; minute?: number } {
	const result: { hour?: number; minute?: number } = {};
	
	// Match "kl. XX" or "kl XX"
	const klMatch = timeStr.match(/kl\.?\s*(\d{1,2})(?:[:\s](\d{2}))?/i);
	if (klMatch) {
		const hour = parseInt(klMatch[1], 10);
		const minute = klMatch[2] ? parseInt(klMatch[2], 10) : undefined;
		
		if (hour >= 0 && hour <= 23) {
			result.hour = hour;
			if (minute !== undefined && minute >= 0 && minute <= 59) {
				result.minute = minute;
			}
		}
		return result;
	}
	
	// Match "HH:MM" or "H:MM"
	const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
	if (timeMatch) {
		const hour = parseInt(timeMatch[1], 10);
		const minute = parseInt(timeMatch[2], 10);
		
		if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
			result.hour = hour;
			result.minute = minute;
		}
		return result;
	}
	
	// Match just a number like "14" or "10"
	const numberMatch = timeStr.match(/\b(\d{1,2})\b/);
	if (numberMatch) {
		const hour = parseInt(numberMatch[1], 10);
		if (hour >= 0 && hour <= 23) {
			result.hour = hour;
		}
	}
	
	return result;
}

export function parseTaskDateTime(text: string): ParsedDateTime {
	const result: ParsedDateTime = { text };
	let cleanText = text.trim();
	
	// Try to match Norwegian day names
	let dateMatched = false;
	for (const [dayName, dayNum] of Object.entries(NORWEGIAN_DAYS)) {
		const regex = new RegExp(`\\b${dayName}\\b`, 'i');
		if (regex.test(cleanText)) {
			result.startDate = getNextDateForDayOfWeek(dayNum);
			cleanText = cleanText.replace(regex, '').trim();
			dateMatched = true;
			break;
		}
	}
	
	// Try abbreviated day names if full name wasn't found
	if (!dateMatched) {
		for (const [dayAbbr, dayNum] of Object.entries(NORMALIZED_DAYS)) {
			const regex = new RegExp(`\\b${dayAbbr}\\b`, 'i');
			if (regex.test(cleanText)) {
				result.startDate = getNextDateForDayOfWeek(dayNum);
				cleanText = cleanText.replace(regex, '').trim();
				break;
			}
		}
	}
	
	// Try to match time patterns (kl. 10, 14:30, etc.)
	const timeRegex = /(?:kl\.?\s*\d{1,2}(?:[:\s]\d{2})?|\d{1,2}:\d{2})/i;
	const timeMatch = cleanText.match(timeRegex);
	if (timeMatch) {
		const time = parseTime(timeMatch[0]);
		if (time.hour !== undefined) {
			result.hour = time.hour;
		}
		if (time.minute !== undefined) {
			result.minute = time.minute;
		}
		cleanText = cleanText.replace(timeMatch[0], '').trim();
	}
	
	// Clean up extra spaces
	result.text = cleanText.replace(/\s+/g, ' ').trim();
	
	return result;
}

/**
 * Parse multiple subtask texts and return with metadata
 */
export function parseSubtaskDates(subtasks: string[]): Array<{ text: string; startDate?: string; hour?: number; minute?: number }> {
	return subtasks.map(text => parseTaskDateTime(text));
}
