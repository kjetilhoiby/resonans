import type { WeatherPeriod } from '$lib/components/ui/WeatherStrip.svelte';

export interface DayWeatherEntry { symbol: string; tempMax: number }
export interface DayWeatherSummary { emoji: string; tempMax: number; periods: WeatherPeriod[] }

export function weatherSeverity(symbol: string): number {
	if (symbol.includes('thunder')) return 6;
	if (symbol.includes('snow')) return 5;
	if (symbol.includes('sleet')) return 4;
	if (symbol.includes('rain') || symbol.includes('shower')) return 3;
	if (symbol.startsWith('fog')) return 2;
	if (symbol.startsWith('cloudy') || symbol.startsWith('partlycloudy')) return 1;
	return 0;
}

export function metSymbolToEmoji(symbol: string): string {
	if (symbol.startsWith('clearsky')) return '☀️';
	if (symbol.startsWith('fair')) return '🌤️';
	if (symbol.startsWith('partlycloudy')) return '⛅';
	if (symbol.startsWith('cloudy')) return '☁️';
	if (symbol.startsWith('fog')) return '🌫️';
	if (symbol.includes('thunder')) return '⛈️';
	if (symbol.includes('snow') || symbol.includes('sleet')) return '❄️';
	if (symbol.includes('rain') || symbol.includes('shower')) return '🌧️';
	return '🌡️';
}

interface TimeseriesEntry {
	time: string;
	data: {
		instant: { details: { air_temperature: number } };
		next_1_hours?: { summary?: { symbol_code?: string }; details?: { precipitation_amount?: number } };
		next_6_hours?: { summary?: { symbol_code?: string }; details?: { air_temperature_max?: number } };
	};
}

export function parseDayPeriods(timeseries: TimeseriesEntry[], dateIso: string): WeatherPeriod[] {
	const PERIODS = [
		{ key: 'natt',        label: 'Natt',        hourStart: 0,  representative: 2  },
		{ key: 'morgen',      label: 'Morgen',      hourStart: 6,  representative: 8  },
		{ key: 'ettermiddag', label: 'Ettermiddag', hourStart: 12, representative: 14 },
		{ key: 'kveld',       label: 'Kveld',       hourStart: 18, representative: 20 },
	];
	const fmtHour = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Oslo', hour: 'numeric', hour12: false });
	const fmtDate = new Intl.DateTimeFormat('sv',    { timeZone: 'Europe/Oslo' });
	const byHour: Record<number, TimeseriesEntry> = {};
	for (const entry of timeseries) {
		if (fmtDate.format(new Date(entry.time)) !== dateIso) continue;
		const h = parseInt(fmtHour.format(new Date(entry.time)), 10) % 24;
		byHour[h] = entry;
	}
	const result: WeatherPeriod[] = [];
	for (const { key, label, hourStart, representative } of PERIODS) {
		const entries = Array.from({ length: 6 }, (_, i) => byHour[hourStart + i]).filter(Boolean);
		if (!entries.length) continue;
		const repr = entries.reduce((best, e) => {
			const hE = parseInt(fmtHour.format(new Date(e.time)), 10) % 24;
			const hB = parseInt(fmtHour.format(new Date(best.time)), 10) % 24;
			return Math.abs(hE - representative) < Math.abs(hB - representative) ? e : best;
		});
		const temp = Math.round(repr.data.instant.details.air_temperature);
		const symbol = repr.data.next_6_hours?.summary?.symbol_code
			?? repr.data.next_1_hours?.summary?.symbol_code
			?? 'cloudy';
		const precip = entries.reduce((s, e) => s + (e.data.next_1_hours?.details?.precipitation_amount ?? 0), 0);
		result.push({ key, label, emoji: metSymbolToEmoji(symbol), temp, precip: Math.round(precip * 10) / 10 });
	}
	return result;
}

export interface FetchWeatherArgs {
	weekDays: Array<{ isoDate: string }>;
	activeTrips: Array<{ startDate: string; endDate: string; destination: string | null }>;
}

export async function fetchTripWeather(args: FetchWeatherArgs): Promise<Record<string, DayWeatherEntry>> {
	const weekDates = new Set(args.weekDays.map((d) => d.isoDate));
	const result: Record<string, DayWeatherEntry> = {};

	for (const trip of args.activeTrips) {
		const hasDaysThisWeek = args.weekDays.some(
			(d) => d.isoDate >= trip.startDate && d.isoDate <= trip.endDate
		);
		if (!hasDaysThisWeek) continue;
		try {
			const geoRes = await fetch(
				`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trip.destination ?? '')}&format=json&limit=1`,
				{ headers: { 'Accept-Language': 'nb,en' } }
			);
			const geoData: Array<{ lat: string; lon: string }> = await geoRes.json();
			if (!geoData.length) continue;
			const lat = parseFloat(geoData[0].lat);
			const lng = parseFloat(geoData[0].lon);
			const wxRes = await fetch(
				`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`,
				{ headers: { 'User-Agent': 'resonans/1.0 https://github.com/kjetilhoiby/resonans' } }
			);
			if (!wxRes.ok) continue;
			const wxData = await wxRes.json();
			const timeseries: TimeseriesEntry[] = wxData.properties.timeseries;
			type DayAgg = { temps: number[]; symbol?: string; severity: number };
			const dayMap = new Map<string, DayAgg>();
			for (const entry of timeseries) {
				const date = entry.time.slice(0, 10);
				if (!weekDates.has(date)) continue;
				if (!dayMap.has(date)) dayMap.set(date, { temps: [], severity: -1 });
				const agg = dayMap.get(date)!;
				agg.temps.push(entry.data.instant.details.air_temperature);
				const sym =
					entry.data.next_6_hours?.summary?.symbol_code ??
					entry.data.next_1_hours?.summary?.symbol_code;
				if (sym) {
					const sev = weatherSeverity(sym);
					if (sev > agg.severity) { agg.symbol = sym; agg.severity = sev; }
				}
				if (entry.time.includes('T12:00:00Z') && !agg.symbol) agg.symbol = sym;
			}
			for (const [date, agg] of dayMap.entries()) {
				if (!agg.symbol) continue;
				const tempMax = agg.temps.length ? Math.round(Math.max(...agg.temps)) : 0;
				const existing = result[date];
				if (!existing ||
					weatherSeverity(agg.symbol) > weatherSeverity(existing.symbol) ||
					(weatherSeverity(agg.symbol) === weatherSeverity(existing.symbol) && tempMax > existing.tempMax)) {
					result[date] = { symbol: agg.symbol, tempMax };
				}
			}
		} catch { /* best-effort */ }
	}
	return result;
}

export async function fetchHomeWeather(weekDays: Array<{ isoDate: string }>): Promise<Record<string, DayWeatherSummary>> {
	try {
		const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
			navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
		);
		const { latitude: lat, longitude: lng } = pos.coords;
		const wxRes = await fetch(
			`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`,
			{ headers: { 'User-Agent': 'resonans/1.0 https://github.com/kjetilhoiby/resonans' } }
		);
		if (!wxRes.ok) return {};
		const wxData = await wxRes.json();
		const ts = wxData.properties.timeseries;
		const result: Record<string, DayWeatherSummary> = {};
		for (const day of weekDays) {
			const periods = parseDayPeriods(ts, day.isoDate);
			if (!periods.length) continue;
			const midday = periods.find(p => p.key === 'ettermiddag') ?? periods.find(p => p.key === 'morgen') ?? periods[0];
			const tempMax = Math.max(...periods.map(p => p.temp));
			result[day.isoDate] = { emoji: midday.emoji, tempMax, periods };
		}
		return result;
	} catch { return {}; }
}
