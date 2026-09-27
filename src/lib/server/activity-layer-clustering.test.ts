import { describe, it, expect } from 'vitest';
import { clusterWorkoutEvents, type WorkoutEvidenceEvent } from './activity-layer';

/**
 * Ettermiddagen 27. september 2026: mølletur 17.17 og utetur 17.55, begge fra
 * Ekko, pluss Withings' versjon av uteturen. Innen to timer, samme familie –
 * én klynge. Utskilling (`metadata.clusterGroup`) er utveien.
 */
const ekko = 'sensor-ekko';
const withings = 'sensor-withings';

function event(
	id: string,
	sensorId: string,
	iso: string,
	sportType: string,
	metadata: Record<string, unknown> = {}
): WorkoutEvidenceEvent {
	return {
		id,
		sensorId,
		timestamp: new Date(iso),
		createdAt: new Date(iso),
		data: { sportType },
		metadata,
		provider: sensorId === ekko ? 'ekko' : 'withings',
		sensorType: sensorId === ekko ? 'gps_device' : 'health_tracker',
		priority: sensorId === ekko ? 4 : 3,
		hasTrackPoints: false
	};
}

const molle = (meta: Record<string, unknown> = {}) =>
	event('molle', ekko, '2026-09-27T15:17:27.498Z', 'indoor_running', meta);
const ute = event('ute', ekko, '2026-09-27T15:55:30.047Z', 'running');
const withingsUte = event('withings-ute', withings, '2026-09-27T15:55:55Z', 'running');

describe('clusterWorkoutEvents', () => {
	it('slår to turer innen to timer sammen – regelen som den er', () => {
		const clusters = clusterWorkoutEvents([molle(), ute, withingsUte]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].events.map((e) => e.id)).toEqual(['molle', 'ute', 'withings-ute']);
	});

	it('en utskilt kilde blir sin egen økt, og resten klynger seg som før', () => {
		const clusters = clusterWorkoutEvents([molle({ clusterGroup: 'g1' }), ute, withingsUte]);
		expect(clusters).toHaveLength(2);
		const [a, b] = clusters;
		expect(a.events.map((e) => e.id)).toEqual(['molle']);
		expect(a.group).toBe('g1');
		expect(b.events.map((e) => e.id)).toEqual(['ute', 'withings-ute']);
		expect(b.group).toBeNull();
		expect(b.startTime.toISOString()).toBe('2026-09-27T15:55:30.047Z');
	});

	it('kilder i samme gruppe klynges sammen', () => {
		const clusters = clusterWorkoutEvents([
			molle({ clusterGroup: 'g1' }),
			event('molle-v2', ekko, '2026-09-27T15:17:27Z', 'indoor_running', { clusterGroup: 'g1' })
		]);
		expect(clusters).toHaveLength(1);
		expect(clusters[0].events).toHaveLength(2);
	});

	it('holder kilde-avviste rader utenfor', () => {
		const clusters = clusterWorkoutEvents([molle({ sourceRejected: true }), ute]);
		expect(clusters.flatMap((c) => c.events.map((e) => e.id))).toEqual(['ute']);
	});
});
