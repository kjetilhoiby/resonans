import { describe, it, expect } from 'vitest';
import { buildRoomClimateSummaries, isRoomClimateEvent } from './room-climate';

function event(overrides: Partial<{ dataType: string | null; timestamp: string; data: Record<string, unknown> }> = {}) {
	return {
		dataType: 'room_climate',
		timestamp: '2026-09-05T10:00:00.000Z',
		data: { room: 'Stue', temperature_c: 20 },
		...overrides
	};
}

describe('isRoomClimateEvent', () => {
	it('kjenner igjen room_climate-dataType', () => {
		expect(isRoomClimateEvent({ dataType: 'room_climate' })).toBe(true);
	});

	it('avviser andre dataTypes', () => {
		expect(isRoomClimateEvent({ dataType: 'appliance_cycle' })).toBe(false);
		expect(isRoomClimateEvent({ dataType: null })).toBe(false);
	});
});

describe('buildRoomClimateSummaries', () => {
	it('grupperer per rom og gir siste avlesning', () => {
		const summaries = buildRoomClimateSummaries([
			event({ timestamp: '2026-09-05T08:00:00.000Z', data: { room: 'Stue', temperature_c: 19 } }),
			event({ timestamp: '2026-09-05T10:00:00.000Z', data: { room: 'Stue', temperature_c: 20.5 } }),
			event({ timestamp: '2026-09-05T09:00:00.000Z', data: { room: 'Kontor', temperature_c: 18 } })
		]);

		expect(summaries.map((s) => s.room)).toEqual(['Kontor', 'Stue']); // alfabetisk

		const stue = summaries.find((s) => s.room === 'Stue')!;
		expect(stue.latest.temperatureC).toBe(20.5); // nyeste, ikke først i input
		expect(stue.series.map((p) => p.temperatureC)).toEqual([19, 20.5]); // eldst → nyest
	});

	it('tar med fuktighet, måltemperatur og varmestatus når de finnes', () => {
		const summaries = buildRoomClimateSummaries([
			event({
				data: {
					room: 'Kontor',
					temperature_c: 21,
					humidity_pct: 42,
					target_temperature_c: 20,
					heating: false
				}
			})
		]);
		expect(summaries[0].latest).toEqual({
			timestamp: '2026-09-05T10:00:00.000Z',
			temperatureC: 21,
			humidityPct: 42,
			targetTemperatureC: 20,
			heating: false
		});
	});

	it('manglende felt gir null, ikke krasj', () => {
		const summaries = buildRoomClimateSummaries([event({ data: { room: 'Bad', temperature_c: 24 } })]);
		expect(summaries[0].latest.humidityPct).toBeNull();
		expect(summaries[0].latest.targetTemperatureC).toBeNull();
		expect(summaries[0].latest.heating).toBeNull();
	});

	it('ignorerer andre dataTypes fra samme sensor', () => {
		const summaries = buildRoomClimateSummaries([
			event({ dataType: 'appliance_cycle', data: { appliance: 'Vaskemaskin' } })
		]);
		expect(summaries).toEqual([]);
	});

	it('avlesning uten rom eller temperatur telles ikke', () => {
		const summaries = buildRoomClimateSummaries([
			event({ data: { temperature_c: 20 } }), // mangler room
			event({ data: { room: 'Stue' } }) // mangler temperature_c
		]);
		expect(summaries).toEqual([]);
	});

	it('kutter serien til de siste 60 punktene per rom', () => {
		const events = Array.from({ length: 80 }, (_, i) =>
			event({
				timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
				data: { room: 'Stue', temperature_c: 20 + i * 0.01 }
			})
		);
		const summaries = buildRoomClimateSummaries(events);
		expect(summaries[0].series.length).toBe(60);
		// De 60 siste — første punkt i serien er indeks 20 (80-60), siste er 79.
		expect(summaries[0].series[0].temperatureC).toBeCloseTo(20 + 20 * 0.01);
		expect(summaries[0].series[59].temperatureC).toBeCloseTo(20 + 79 * 0.01);
	});
});
