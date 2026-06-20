/**
 * Ren mapping fra Tesla `vehicle_data`-respons → sensor-event-objekter.
 * Ingen DB-avhengigheter — testbar isolert (se tesla-parser.test.ts).
 *
 * Tesla rapporterer i imperiske enheter (miles, mph) og Celsius. Vi normaliserer
 * til metrisk (km, km/t) ved parsing slik at resten av systemet slipper å vite om
 * Tesla-spesifikke enheter.
 */

const MILES_TO_KM = 1.609344;

function milesToKm(miles: unknown): number | undefined {
	return typeof miles === 'number' ? Math.round(miles * MILES_TO_KM * 10) / 10 : undefined;
}

function num(v: unknown): number | undefined {
	return typeof v === 'number' ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
	return typeof v === 'boolean' ? v : undefined;
}

export type TeslaEventDataType = 'charge_state' | 'vehicle_state' | 'drive_state';

export interface ParsedTeslaEvent {
	dataType: TeslaEventDataType;
	eventType: 'measurement' | 'state_change';
	timestamp: Date;
	data: Record<string, unknown>;
}

/**
 * Forenklet, enhets-normalisert øyeblikksbilde — brukes både av live-state-
 * endepunktet til Ekko og som mellomledd for å bygge sensor-events.
 */
export interface TeslaSnapshot {
	asleep: boolean;
	state?: string;
	vin?: string;
	displayName?: string;
	batteryPercent?: number;
	rangeKm?: number;
	charging?: boolean;
	chargingState?: string;
	chargeRateKw?: number;
	timeToFullChargeH?: number;
	location?: { lat: number; lon: number };
	heading?: number;
	speedKmh?: number;
	shiftState?: string | null;
	/** Aktivt navigasjonsmål (navn) — kun satt når bilen faktisk navigerer. */
	navigationDestination?: string;
	/** Minutter til ankomst for aktivt navigasjonsmål. */
	navigationEtaMinutes?: number;
	/**
	 * Målpunktets koordinater (lat/lon) — samme konvensjon som `location`. Lar
	 * Ekko kjøre egen ruting on-device (bilposisjon → mål) og tegne rutelinja
	 * uten å geokode navnet.
	 */
	navigationDestinationLocation?: { lat: number; lon: number };
	/**
	 * Gjenstående rute til mål som [lat, lon]-par (samme konvensjon som live-
	 * session `routeCoordinates`). Tesla Fleet API eksponerer normalt ikke hele
	 * polyline-en, så feltet befolkes foreløpig ikke her — cockpiten viser da mål
	 * + ETA uten rutelinje. Kan fylles av en egen ruting-motor senere.
	 */
	navigationRoute?: [number, number][];
	odometerKm?: number;
	locked?: boolean;
	insideTempC?: number;
	outsideTempC?: number;
	climateOn?: boolean;
	asOf: string; // ISO
}

/**
 * Bygg et normalisert øyeblikksbilde fra rå vehicle_data.
 */
export function buildSnapshot(raw: Record<string, any> | null, now: Date = new Date()): TeslaSnapshot {
	if (!raw) {
		return { asleep: true, asOf: now.toISOString() };
	}

	const charge = raw.charge_state ?? {};
	const drive = raw.drive_state ?? {};
	const vehicle = raw.vehicle_state ?? {};
	const climate = raw.climate_state ?? {};

	const lat = num(drive.latitude);
	const lon = num(drive.longitude);
	const speedMph = num(drive.speed); // mph eller null
	const chargingState = typeof charge.charging_state === 'string' ? charge.charging_state : undefined;

	// Aktiv navigasjon: send mål/ETA kun når bilen faktisk navigerer (mål satt).
	const navDestination =
		typeof drive.active_route_destination === 'string' && drive.active_route_destination.length > 0
			? drive.active_route_destination
			: undefined;
	const navEtaRaw = num(drive.active_route_minutes_to_arrival);
	const navEtaMinutes =
		navDestination !== undefined && navEtaRaw !== undefined ? Math.round(navEtaRaw) : undefined;
	const navDestLat = num(drive.active_route_latitude);
	const navDestLon = num(drive.active_route_longitude);
	const navDestLocation =
		navDestination !== undefined && navDestLat !== undefined && navDestLon !== undefined
			? { lat: navDestLat, lon: navDestLon }
			: undefined;

	return {
		asleep: false,
		state: typeof raw.state === 'string' ? raw.state : undefined,
		vin: typeof raw.vin === 'string' ? raw.vin : undefined,
		displayName: typeof raw.display_name === 'string' ? raw.display_name : undefined,
		batteryPercent: num(charge.battery_level),
		rangeKm: milesToKm(charge.battery_range),
		charging: chargingState ? chargingState === 'Charging' : undefined,
		chargingState,
		chargeRateKw: num(charge.charger_power),
		timeToFullChargeH: num(charge.time_to_full_charge),
		location: lat !== undefined && lon !== undefined ? { lat, lon } : undefined,
		heading: num(drive.heading),
		speedKmh: speedMph !== undefined ? Math.round(speedMph * MILES_TO_KM * 10) / 10 : undefined,
		shiftState: typeof drive.shift_state === 'string' ? drive.shift_state : null,
		navigationDestination: navDestination,
		navigationEtaMinutes: navEtaMinutes,
		navigationDestinationLocation: navDestLocation,
		odometerKm: milesToKm(vehicle.odometer),
		locked: bool(vehicle.locked),
		insideTempC: num(climate.inside_temp),
		outsideTempC: num(climate.outside_temp),
		climateOn: bool(climate.is_climate_on),
		asOf: now.toISOString()
	};
}

/**
 * Map rå vehicle_data til sensor-events. Tom liste hvis bilen sover / mangler
 * data. drive_state-eventet skrives bare når posisjon er tilgjengelig (krever
 * vehicle_location-scope + at bilen er våken).
 */
export function parseVehicleData(
	raw: Record<string, any> | null,
	now: Date = new Date()
): ParsedTeslaEvent[] {
	const snap = buildSnapshot(raw, now);
	if (snap.asleep) return [];

	const events: ParsedTeslaEvent[] = [];

	// charge_state — batteri og lading
	if (snap.batteryPercent !== undefined || snap.rangeKm !== undefined || snap.chargingState) {
		events.push({
			dataType: 'charge_state',
			eventType: 'measurement',
			timestamp: now,
			data: {
				batteryPercent: snap.batteryPercent,
				rangeKm: snap.rangeKm,
				charging: snap.charging,
				chargingState: snap.chargingState,
				chargeRateKw: snap.chargeRateKw,
				timeToFullChargeH: snap.timeToFullChargeH
			}
		});
	}

	// vehicle_state — km-stand, lås, klima
	if (
		snap.odometerKm !== undefined ||
		snap.locked !== undefined ||
		snap.insideTempC !== undefined
	) {
		events.push({
			dataType: 'vehicle_state',
			eventType: 'measurement',
			timestamp: now,
			data: {
				odometerKm: snap.odometerKm,
				locked: snap.locked,
				insideTempC: snap.insideTempC,
				outsideTempC: snap.outsideTempC,
				climateOn: snap.climateOn,
				state: snap.state
			}
		});
	}

	// drive_state — posisjon/fart (kun når GPS finnes)
	if (snap.location) {
		events.push({
			dataType: 'drive_state',
			eventType: 'measurement',
			timestamp: now,
			data: {
				lat: snap.location.lat,
				lon: snap.location.lon,
				heading: snap.heading,
				speedKmh: snap.speedKmh,
				shiftState: snap.shiftState
			}
		});
	}

	return events;
}
