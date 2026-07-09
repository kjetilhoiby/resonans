import { describe, it, expect } from 'vitest';
import { buildVacuumState } from './appliance-cycle';

// Hjelper: ISO-tidsstempel X sekunder siden.
const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();

describe('buildVacuumState', () => {
	it('returnerer null uten vacuum-events', () => {
		expect(buildVacuumState([])).toBeNull();
		expect(
			buildVacuumState([{ dataType: 'appliance_cycle', timestamp: ago(10), data: {} }])
		).toBeNull();
	});

	it('kjører når fersk progress er nyere enn siste status', () => {
		const s = buildVacuumState([
			{
				dataType: 'vacuum_progress',
				timestamp: ago(20),
				data: { state: 'segment_cleaning', battery: 90, clean_minutes: 5, clean_area_m2: 12, clean_percent: null }
			},
			{
				dataType: 'vacuum_status',
				timestamp: ago(120),
				data: { state: 'cleaning', in_cleaning: true, battery: 95 }
			}
		]);
		expect(s).not.toBeNull();
		expect(s!.isRunning).toBe(true);
		expect(s!.state).toBe('segment_cleaning');
		expect(s!.battery).toBe(90);
		expect(s!.cleanMinutes).toBe(5);
		expect(s!.cleanAreaM2).toBe(12);
	});

	it('er i ro når siste status (in_cleaning=false) er nyere enn gammel progress', () => {
		const s = buildVacuumState([
			{
				dataType: 'vacuum_status',
				timestamp: ago(60),
				data: { state: 'charging', in_cleaning: false, battery: 100 }
			},
			{
				dataType: 'vacuum_progress',
				timestamp: ago(600), // > PROGRESS_FRESH_MS (5 min) ⇒ ikke fersk
				data: { clean_minutes: 44, clean_area_m2: 29 }
			},
			{
				dataType: 'vacuum_clean',
				timestamp: ago(900),
				data: { area_m2: 30, duration_minutes: 45, clean_type: 'select_zone', map_name: null, complete: true }
			}
		]);
		expect(s!.isRunning).toBe(false);
		expect(s!.state).toBe('charging');
		expect(s!.battery).toBe(100);
		// Live-felt nulles ut når den ikke kjører:
		expect(s!.cleanMinutes).toBeNull();
		expect(s!.cleanAreaM2).toBeNull();
		// Siste runde bevares:
		expect(s!.lastClean).toEqual({
			at: expect.any(String),
			areaM2: 30,
			durationMinutes: 45,
			cleanType: 'select_zone',
			mapName: null,
			complete: true
		});
	});

	it('viser siste runde selv uten status/progress', () => {
		const s = buildVacuumState([
			{
				dataType: 'vacuum_clean',
				timestamp: ago(3600),
				data: { area_m2: 12.3, duration_minutes: 20, clean_type: 'all_zone', complete: false }
			}
		]);
		expect(s!.isRunning).toBe(false);
		expect(s!.state).toBeNull();
		expect(s!.battery).toBeNull();
		expect(s!.lastClean?.areaM2).toBe(12.3);
		expect(s!.lastClean?.complete).toBe(false);
	});
});
