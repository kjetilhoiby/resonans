export interface WeatherToolArgs {
	latitude?: number;
	longitude?: number;
	locationName?: string;
	timezone?: string;
}

export interface WeatherStatusWidget {
	kind: 'weather';
	title: string;
	locationLabel: string;
	temperatureC: number;
	conditionCode: string;
	conditionLabel: string;
	windMps: number;
	precipitationNextHourMm: number;
	updatedAt: string;
	sourceUrl: string;
}

const DEFAULT_LOCATION = {
	name: 'Oslo',
	latitude: 59.9139,
	longitude: 10.7522,
	timezone: 'Europe/Oslo'
};

function clampCoordinate(value: unknown, min: number, max: number) {
	if (typeof value !== 'number' || Number.isNaN(value)) return null;
	if (value < min || value > max) return null;
	return value;
}

function fallbackFromTimezone(timezone?: string) {
	if (!timezone) return DEFAULT_LOCATION;
	if (timezone === 'Europe/Oslo') return DEFAULT_LOCATION;
	return DEFAULT_LOCATION;
}

const CONDITION_LABELS: Record<string, string> = {
	clearsky_day: 'Klar himmel',
	clearsky_night: 'Klar natt',
	fair_day: 'Lettskyet',
	fair_night: 'Lettskyet natt',
	partlycloudy_day: 'Delvis skyet',
	partlycloudy_night: 'Delvis skyet natt',
	cloudy: 'Skyet',
	rain: 'Regn',
	lightrain: 'Lett regn',
	heavyrain: 'Kraftig regn',
	sleet: 'Sludd',
	snow: 'Snø',
	fog: 'Tåke'
};

function toConditionLabel(code: string) {
	if (!code) return 'Ukjent';
	return CONDITION_LABELS[code] ?? code.replace(/_/g, ' ');
}

export const weatherForecastTool = {
	name: 'weather_forecast',
	description:
		'Hent værprognose fra MET.no Locationforecast API basert på koordinater. Bruk for spørsmål om vær nå, neste timer eller når svar bør berikes med lokalt vær.',

	execute: async (args: WeatherToolArgs) => {
		const fallback = fallbackFromTimezone(args.timezone);
		const latitude = clampCoordinate(args.latitude, -90, 90) ?? fallback.latitude;
		const longitude = clampCoordinate(args.longitude, -180, 180) ?? fallback.longitude;
		const locationLabel = typeof args.locationName === 'string' && args.locationName.trim().length > 0
			? args.locationName.trim().slice(0, 80)
			: fallback.name;

		const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${latitude.toFixed(4)}&lon=${longitude.toFixed(4)}`;
		const response = await fetch(url, {
			headers: {
				Accept: 'application/json',
				'User-Agent': 'resonans-app/1.0 (https://resonans.no)'
			}
		});

		if (!response.ok) {
			throw new Error(`MET weather request failed with status ${response.status}`);
		}

		const payload = (await response.json()) as {
			properties?: {
				timeseries?: Array<{
					time: string;
					data?: {
						instant?: { details?: { air_temperature?: number; wind_speed?: number } };
						next_1_hours?: {
							summary?: { symbol_code?: string };
							details?: { precipitation_amount?: number };
						};
					};
				}>;
			};
		};

		const firstPoint = payload.properties?.timeseries?.[0];
		if (!firstPoint?.data?.instant?.details) {
			throw new Error('MET weather payload mangler timeseries-data');
		}

		const temperatureC = Number(firstPoint.data.instant.details.air_temperature ?? 0);
		const windMps = Number(firstPoint.data.instant.details.wind_speed ?? 0);
		const conditionCode = firstPoint.data.next_1_hours?.summary?.symbol_code ?? 'unknown';
		const precipitationNextHourMm = Number(firstPoint.data.next_1_hours?.details?.precipitation_amount ?? 0);

		const widget: WeatherStatusWidget = {
			kind: 'weather',
			title: 'Vær nå',
			locationLabel,
			temperatureC,
			conditionCode,
			conditionLabel: toConditionLabel(conditionCode),
			windMps,
			precipitationNextHourMm,
			updatedAt: firstPoint.time,
			sourceUrl: 'https://api.met.no/weatherapi/locationforecast/2.0/documentation'
		};

		return {
			success: true,
			location: {
				name: locationLabel,
				latitude,
				longitude
			},
			current: {
				temperatureC,
				windMps,
				conditionCode,
				conditionLabel: toConditionLabel(conditionCode),
				precipitationNextHourMm
			},
			widget,
			source: {
				provider: 'MET Norway Locationforecast',
				url: widget.sourceUrl
			},
			message: `Værdata hentet for ${locationLabel}.`
		};
	}
};
