import { describe, it, expect } from 'vitest';
import { buildSnapshot, parseVehicleData } from './tesla-parser';

const NOW = new Date('2026-06-18T10:00:00.000Z');

function fullVehicleData() {
	return {
		state: 'online',
		vin: '5YJ3E1EA7KF000000',
		display_name: 'Blåbil',
		charge_state: {
			battery_level: 72,
			battery_range: 200, // miles
			charging_state: 'Charging',
			charger_power: 11,
			time_to_full_charge: 1.5
		},
		drive_state: {
			latitude: 59.9139,
			longitude: 10.7522,
			heading: 180,
			speed: 50, // mph
			shift_state: 'D'
		},
		vehicle_state: {
			odometer: 12000, // miles
			locked: true
		},
		climate_state: {
			inside_temp: 21.5,
			outside_temp: 14,
			is_climate_on: true
		}
	};
}

describe('buildSnapshot', () => {
	it('normaliserer enheter til metrisk', () => {
		const snap = buildSnapshot(fullVehicleData(), NOW);
		expect(snap.asleep).toBe(false);
		expect(snap.batteryPercent).toBe(72);
		expect(snap.rangeKm).toBe(321.9); // 200 mi * 1.609344, avrundet 1 desimal
		expect(snap.charging).toBe(true);
		expect(snap.chargingState).toBe('Charging');
		expect(snap.speedKmh).toBe(80.5); // 50 mph
		expect(snap.odometerKm).toBe(19312.1); // 12000 mi
		expect(snap.locked).toBe(true);
		expect(snap.insideTempC).toBe(21.5);
		expect(snap.location).toEqual({ lat: 59.9139, lon: 10.7522 });
		expect(snap.asOf).toBe(NOW.toISOString());
	});

	it('markerer asleep når data mangler', () => {
		const snap = buildSnapshot(null, NOW);
		expect(snap.asleep).toBe(true);
		expect(snap.batteryPercent).toBeUndefined();
	});

	it('utleder charging=false fra annen ladestatus', () => {
		const raw = fullVehicleData();
		raw.charge_state.charging_state = 'Disconnected';
		const snap = buildSnapshot(raw, NOW);
		expect(snap.charging).toBe(false);
		expect(snap.chargingState).toBe('Disconnected');
	});

	it('mapper aktiv navigasjon (mål + ETA + koordinater) når bilen navigerer', () => {
		const raw = fullVehicleData();
		(raw.drive_state as any).active_route_destination = 'Volda';
		(raw.drive_state as any).active_route_minutes_to_arrival = 41.6;
		(raw.drive_state as any).active_route_latitude = 62.146;
		(raw.drive_state as any).active_route_longitude = 6.071;
		const snap = buildSnapshot(raw, NOW);
		expect(snap.navigationDestination).toBe('Volda');
		expect(snap.navigationEtaMinutes).toBe(42); // avrundet til hele minutter
		expect(snap.navigationDestinationLocation).toEqual({ lat: 62.146, lon: 6.071 });
	});

	it('utelater navigasjonsfelt når bilen ikke navigerer', () => {
		const snap = buildSnapshot(fullVehicleData(), NOW);
		expect(snap.navigationDestination).toBeUndefined();
		expect(snap.navigationEtaMinutes).toBeUndefined();
		expect(snap.navigationDestinationLocation).toBeUndefined();
	});

	it('sender ikke ETA uten et navigasjonsmål', () => {
		const raw = fullVehicleData();
		(raw.drive_state as any).active_route_minutes_to_arrival = 17;
		const snap = buildSnapshot(raw, NOW);
		expect(snap.navigationDestination).toBeUndefined();
		expect(snap.navigationEtaMinutes).toBeUndefined();
	});

	it('befolker ikke navigationRoute (Tesla eksponerer ikke polyline)', () => {
		const raw = fullVehicleData();
		(raw.drive_state as any).active_route_destination = 'Volda';
		const snap = buildSnapshot(raw, NOW);
		expect(snap.navigationRoute).toBeUndefined();
	});
});

describe('parseVehicleData', () => {
	it('lager charge_state, vehicle_state og drive_state events', () => {
		const events = parseVehicleData(fullVehicleData(), NOW);
		const types = events.map((e) => e.dataType).sort();
		expect(types).toEqual(['charge_state', 'drive_state', 'vehicle_state']);
		for (const e of events) {
			expect(e.timestamp).toEqual(NOW);
			expect(e.eventType).toBe('measurement');
		}
	});

	it('hopper over drive_state når posisjon mangler (bil sover/ingen GPS-scope)', () => {
		const raw = fullVehicleData();
		delete (raw.drive_state as any).latitude;
		delete (raw.drive_state as any).longitude;
		const events = parseVehicleData(raw, NOW);
		expect(events.map((e) => e.dataType)).not.toContain('drive_state');
		expect(events.map((e) => e.dataType)).toContain('charge_state');
	});

	it('returnerer tom liste når bilen sover', () => {
		expect(parseVehicleData(null, NOW)).toEqual([]);
	});

	it('tåler delvise felt uten å kaste', () => {
		const events = parseVehicleData({ state: 'online', charge_state: { battery_level: 40 } }, NOW);
		const charge = events.find((e) => e.dataType === 'charge_state');
		expect(charge?.data.batteryPercent).toBe(40);
		expect(charge?.data.rangeKm).toBeUndefined();
	});
});
