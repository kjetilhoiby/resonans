// Romklima (temperatur/fuktighet) fra Ping — Aqara-sensorer (climate.py/homekit.py)
// eller Mill-panelovner (mill.py), alle skrevet som samme dataType «room_climate»
// på Ping sin appliance_monitor-sensor. Se resonans-lab/ping/notifier.py
// (climate_reading → room_climate) og climate.py/homekit.py/mill.py.
//
// Formålet er å svare på «holder rommet seg varmt nok» før man vurderer å ta
// ned panelovner — se resonans-lab/ping/climate.py sin fil-kommentar.

const ROOM_CLIMATE_DATA_TYPE = 'room_climate';

export interface RoomClimateReading {
	timestamp: string;
	temperatureC: number;
	humidityPct: number | null;
	targetTemperatureC: number | null;
	heating: boolean | null;
}

export interface RoomClimateSummary {
	room: string;
	latest: RoomClimateReading;
	/** Eldst → nyest, for en sparkline. */
	series: Array<{ timestamp: string; temperatureC: number }>;
}

interface RawSensorEvent {
	dataType: string | null;
	timestamp: string;
	data: Record<string, unknown>;
}

const MAX_SERIES_POINTS = 60;

export function isRoomClimateEvent(e: { dataType: string | null }): boolean {
	return e.dataType === ROOM_CLIMATE_DATA_TYPE;
}

function num(v: unknown): number | null {
	return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function parseRoomClimateEvent(e: RawSensorEvent): RoomClimateReading & { room: string } | null {
	const room = e.data?.room;
	const temperatureC = num(e.data?.temperature_c);
	if (typeof room !== 'string' || !room || temperatureC === null) return null;
	return {
		room,
		timestamp: e.timestamp,
		temperatureC,
		humidityPct: num(e.data?.humidity_pct),
		targetTemperatureC: num(e.data?.target_temperature_c),
		heating: typeof e.data?.heating === 'boolean' ? (e.data.heating as boolean) : null
	};
}

/**
 * Grupper room_climate-events per rom. Rekkefølgen på `events` spiller ingen
 * rolle — funksjonen sorterer selv kronologisk, både for «siste avlesning» og
 * for serien en sparkline skal tegnes fra (eldst → nyest).
 *
 * Rom uten en eneste gyldig avlesning (manglende `room`/`temperature_c`)
 * bidrar ingenting — samme disiplin som Ping sin `parse_climate_payload`:
 * en ufullstendig måling er ingen måling.
 */
export function buildRoomClimateSummaries(events: RawSensorEvent[]): RoomClimateSummary[] {
	const byRoom = new Map<string, Array<RoomClimateReading & { room: string }>>();
	for (const raw of events) {
		if (!isRoomClimateEvent(raw)) continue;
		const parsed = parseRoomClimateEvent(raw);
		if (!parsed) continue;
		if (!byRoom.has(parsed.room)) byRoom.set(parsed.room, []);
		byRoom.get(parsed.room)!.push(parsed);
	}

	const summaries: RoomClimateSummary[] = [];
	for (const [room, readings] of byRoom) {
		readings.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
		const latest = readings[readings.length - 1];
		const series = readings.slice(-MAX_SERIES_POINTS).map((r) => ({
			timestamp: r.timestamp,
			temperatureC: r.temperatureC
		}));
		summaries.push({
			room,
			latest: {
				timestamp: latest.timestamp,
				temperatureC: latest.temperatureC,
				humidityPct: latest.humidityPct,
				targetTemperatureC: latest.targetTemperatureC,
				heating: latest.heating
			},
			series
		});
	}

	// Alfabetisk — stabil rekkefølge mellom lastinger, uavhengig av hvilket
	// rom som tilfeldigvis rapporterte sist.
	summaries.sort((a, b) => a.room.localeCompare(b.room, 'nb'));
	return summaries;
}
