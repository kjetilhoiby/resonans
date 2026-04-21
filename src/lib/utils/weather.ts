/**
 * MET.no Locationforecast utilities.
 * Shared between ukeplan and ChecklistSheet weather rendering.
 */

export interface WeatherPeriod {
	key: string;
	label: string;
	emoji: string;
	temp: number;    // °C (max for week-mode)
	precip: number;  // mm
	isPast?: boolean; // true for days that have already passed (week-mode)
}

// ── Day-period definitions ──────────────────────────────────────────────────

const PERIOD_DEFS = [
	{ key: 'natt',   label: 'Natt',  startH: 0,  endH: 6  },
	{ key: 'morgen', label: 'Morn.', startH: 6,  endH: 12 },
	{ key: 'middag', label: 'Midd.', startH: 12, endH: 18 },
	{ key: 'kveld',  label: 'Kveld', startH: 18, endH: 24 },
];

export function metSymbolToEmoji(symbol: string): string {
	if (symbol.startsWith('clearsky'))     return '☀️';
	if (symbol.startsWith('fair'))         return '🌤️';
	if (symbol.startsWith('partlycloudy')) return '⛅';
	if (symbol.startsWith('cloudy'))       return '☁️';
	if (symbol.startsWith('fog'))          return '🌫️';
	if (symbol.includes('thunder'))        return '⛈️';
	if (symbol.includes('snow') || symbol.includes('sleet')) return '❄️';
	if (symbol.includes('rain') || symbol.includes('shower')) return '🌧️';
	return '🌡️';
}

// ── Cache ───────────────────────────────────────────────────────────────────

const CACHE_MAX_AGE_MS = 30 * 60 * 1000; // 30 min

export interface CacheEntry { timeseries: any[]; fetchedAt: number; }

function cacheKey(lat: number, lon: number): string {
	return `wx_ts_${lat.toFixed(1)}_${lon.toFixed(1)}`;
}

export function readCacheEntry(lat: number, lon: number): CacheEntry | null {
	if (typeof localStorage === 'undefined') return null;
	try {
		const raw = localStorage.getItem(cacheKey(lat, lon));
		if (!raw) return null;
		return JSON.parse(raw) as CacheEntry;
	} catch { return null; }
}

export function isCacheStale(entry: CacheEntry): boolean {
	return Date.now() - entry.fetchedAt > CACHE_MAX_AGE_MS;
}

function writeCache(lat: number, lon: number, timeseries: any[]): void {
	if (typeof localStorage === 'undefined') return;
	try {
		const entry: CacheEntry = { timeseries, fetchedAt: Date.now() };
		localStorage.setItem(cacheKey(lat, lon), JSON.stringify(entry));
	} catch { /* quota exceeded */ }
}

// ── Fetching ────────────────────────────────────────────────────────────────

/** Fetches raw MET.no timeseries and writes to localStorage cache. */
export async function fetchRawTimeseries(lat: number, lon: number): Promise<any[] | null> {
	try {
		const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
		const res = await fetch(url, {
			headers: { 'User-Agent': 'resonans/1.0 https://github.com/kjetilhoiby/resonans' }
		});
		if (!res.ok) return null;
		const data = await res.json();
		const ts: any[] = data.properties.timeseries;
		writeCache(lat, lon, ts);
		return ts;
	} catch { return null; }
}

// ── Period builders ─────────────────────────────────────────────────────────

/** Builds 4 time-of-day WeatherPeriod entries for a single date. */
export function buildPeriods(date: string, timeseries: any[]): WeatherPeriod[] {
	const todayIso = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
	const nowHourOslo = Number(
		new Date().toLocaleTimeString('sv', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' }).slice(0, 2)
	);

	return PERIOD_DEFS.map(({ key, label, startH, endH }) => {
		// A period is "past" if its entire window has elapsed for today, or the date is before today
		const periodIsPast = date < todayIso || (date === todayIso && nowHourOslo >= endH);

		const midH = (startH + endH) / 2;
		const candidates = timeseries.filter((entry: any) => {
			const t = new Date(entry.time);
			const entryDate = t.toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });
			const h = t.getUTCHours();
			return entryDate === date && h >= startH && h < endH;
		});
		if (!candidates.length) return { key, label, emoji: '—', temp: 0, precip: 0, isPast: periodIsPast };
		const best = candidates.reduce((prev: any, cur: any) => {
			const th = new Date(cur.time).getUTCHours();
			const ph = new Date(prev.time).getUTCHours();
			return Math.abs(th - midH) < Math.abs(ph - midH) ? cur : prev;
		});
		const instant = best.data?.instant?.details;
		const next1h = best.data?.next_1_hours;
		const next6h = best.data?.next_6_hours;
		const sym: string = next1h?.summary?.symbol_code ?? next6h?.summary?.symbol_code ?? '';
		return {
			key, label,
			emoji: sym ? metSymbolToEmoji(sym) : '—',
			temp: Math.round(instant?.air_temperature ?? 0),
			precip: next1h?.details?.precipitation_amount ?? next6h?.details?.precipitation_amount ?? 0,
			isPast: periodIsPast,
		};
	});
}

/**
 * Builds 7 day-column WeatherPeriod entries for an ISO week key ("2026-W17").
 * Days before today are returned with isPast: true and no data.
 */
export function buildWeekPeriods(weekKey: string, timeseries: any[]): WeatherPeriod[] {
	const dates = isoWeekToDates(weekKey);
	const todayIso = new Date().toLocaleDateString('sv', { timeZone: 'Europe/Oslo' });

	return dates.map((date) => {
		const label = shortDayLabel(date);
		if (date < todayIso) {
			return { key: date, label, emoji: '', temp: 0, precip: 0, isPast: true };
		}
		const entries = timeseries.filter((e: any) => e.time.slice(0, 10) === date);
		if (!entries.length) return { key: date, label, emoji: '—', temp: 0, precip: 0 };

		// Prefer noon (12 UTC) for representative symbol
		const noonEntry = entries.find((e: any) => e.time.includes('T12:00:00'))
			?? entries.reduce((prev: any, cur: any) => {
				const th = new Date(cur.time).getUTCHours();
				const ph = new Date(prev.time).getUTCHours();
				return Math.abs(th - 12) < Math.abs(ph - 12) ? cur : prev;
			});
		const sym: string =
			noonEntry.data?.next_6_hours?.summary?.symbol_code ??
			noonEntry.data?.next_1_hours?.summary?.symbol_code ?? '';
		const tempMax = Math.round(Math.max(...entries.map((e: any) =>
			e.data?.instant?.details?.air_temperature ?? 0)));
		const precipSum = entries.reduce((sum: number, e: any) =>
			sum + (e.data?.next_1_hours?.details?.precipitation_amount ?? 0), 0);
		return {
			key: date, label,
			emoji: sym ? metSymbolToEmoji(sym) : '—',
			temp: tempMax,
			precip: precipSum,
		};
	});
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isoWeekToDates(weekKey: string): string[] {
	const [yearStr, wStr] = weekKey.split('-W');
	const year = parseInt(yearStr, 10);
	const week = parseInt(wStr, 10);
	const jan4 = new Date(Date.UTC(year, 0, 4));
	const jan4Day = jan4.getUTCDay() || 7;
	const week1Mon = new Date(jan4.getTime() - (jan4Day - 1) * 86400000);
	const weekMon = new Date(week1Mon.getTime() + (week - 1) * 7 * 86400000);
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(weekMon.getTime() + i * 86400000);
		return d.toISOString().slice(0, 10);
	});
}

function shortDayLabel(date: string): string {
	return new Intl.DateTimeFormat('nb-NO', { weekday: 'short' })
		.format(new Date(date + 'T12:00:00Z'))
		.replace('.', '');
}

// ── Compat ──────────────────────────────────────────────────────────────────

/** @deprecated Use readCacheEntry + fetchRawTimeseries + buildPeriods directly */
export async function fetchWeatherPeriods(
	date: string,
	lat: number,
	lon: number
): Promise<WeatherPeriod[] | null> {
	const ts = await fetchRawTimeseries(lat, lon);
	return ts ? buildPeriods(date, ts) : null;
}
