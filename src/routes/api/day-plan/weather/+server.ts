import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

const DEFAULT_LAT = 59.9139;
const DEFAULT_LON = 10.7522;

// Target hours to show in the day header: morning, midday, afternoon, evening
const TARGET_HOURS = [8, 12, 15, 18];

const CONDITION_EMOJI: Record<string, string> = {
	clearsky_day: '☀️',
	clearsky_night: '🌙',
	fair_day: '🌤',
	fair_night: '🌤',
	partlycloudy_day: '⛅',
	partlycloudy_night: '⛅',
	cloudy: '☁️',
	rain: '🌧',
	lightrain: '🌦',
	heavyrain: '🌧',
	sleet: '🌨',
	snow: '❄️',
	fog: '🌫'
};

function conditionToEmoji(code: string): string {
	if (!code) return '🌤';
	return CONDITION_EMOJI[code] ?? '🌤';
}

export const GET: RequestHandler = async ({ locals, url }) => {
	if (!locals.userId) return json({ error: 'Unauthorized' }, { status: 401 });

	const latParam = url.searchParams.get('lat');
	const lonParam = url.searchParams.get('lon');
	const dayIso = url.searchParams.get('day'); // e.g. "2026-04-16"

	const lat = latParam ? parseFloat(latParam) : DEFAULT_LAT;
	const lon = lonParam ? parseFloat(lonParam) : DEFAULT_LON;

	try {
		const metUrl = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`;
		const response = await fetch(metUrl, {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'resonans-app/1.0 (https://resonans.no)'
			}
		});

		if (!response.ok) {
			return json({ error: 'Værhenting feilet' }, { status: 502 });
		}

		const payload = (await response.json()) as {
			properties?: {
				timeseries?: Array<{
					time: string;
					data?: {
						instant?: { details?: { air_temperature?: number } };
						next_1_hours?: {
							summary?: { symbol_code?: string };
						};
					};
				}>;
			};
		};

		const timeseries = payload.properties?.timeseries ?? [];

		// Find the closest timeseries point to each target hour for the given day
		const slots = TARGET_HOURS.map((hour) => {
			const targetIso = dayIso
				? `${dayIso}T${String(hour).padStart(2, '0')}:00:00Z`
				: null;

			let best = timeseries.find((p) => {
				if (!targetIso) return false;
				return p.time === targetIso;
			});

			// Fallback: find nearest point to target hour
			if (!best && dayIso) {
				const targetMs = new Date(`${dayIso}T${String(hour).padStart(2, '0')}:00:00Z`).getTime();
				let minDiff = Infinity;
				for (const point of timeseries) {
					if (!point.time.startsWith(dayIso)) continue;
					const diff = Math.abs(new Date(point.time).getTime() - targetMs);
					if (diff < minDiff) {
						minDiff = diff;
						best = point;
					}
				}
			}

			// If no day filter, use index-based (current + ~hour offsets)
			if (!best) {
				const idx = Math.min(hour, timeseries.length - 1);
				best = timeseries[idx];
			}

			const code = best?.data?.next_1_hours?.summary?.symbol_code ?? '';
			const tempC = best?.data?.instant?.details?.air_temperature ?? null;
			return { hour, emoji: conditionToEmoji(code), conditionCode: code, tempC };
		});

		// Current conditions from first point for the chip
		const firstToday = dayIso
			? timeseries.find((p) => p.time.startsWith(dayIso)) ?? timeseries[0]
			: timeseries[0];

		return json({
			slots,
			current: {
				temperatureC: firstToday?.data?.instant?.details?.air_temperature ?? null,
				conditionCode: firstToday?.data?.next_1_hours?.summary?.symbol_code ?? ''
			}
		});
	} catch {
		return json({ error: 'Værhenting feilet' }, { status: 502 });
	}
};
