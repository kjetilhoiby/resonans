import { describe, it, expect } from 'vitest';
import {
	WORKOUT_LIST_LIMITS,
	clampQueryInt,
	metadataKeyForScope,
	parseDismissScope
} from './workout-dismiss';

describe('parseDismissScope', () => {
	it('tolker source', () => {
		expect(parseDismissScope('source')).toBe('source');
	});

	it('faller til activity for alt annet', () => {
		// En skrivefeil skal ikke gjøre skjuleknappen død, og den skal ikke
		// stille bli til «fjern én kilde» — da blir økta stående.
		for (const raw of ['activity', 'kilde', '', null, undefined, 'SOURCE']) {
			expect(parseDismissScope(raw)).toBe('activity');
		}
	});
});

describe('metadataKeyForScope', () => {
	it('activity → dismissed, source → sourceRejected', () => {
		expect(metadataKeyForScope('activity')).toBe('dismissed');
		expect(metadataKeyForScope('source')).toBe('sourceRejected');
	});

	it('nøklene er de brukerstyrte som overlever synken', async () => {
		const { USER_OWNED_METADATA_KEYS } = await import('$lib/domain/sensor-event-metadata');
		expect(USER_OWNED_METADATA_KEYS).toContain(metadataKeyForScope('activity'));
		expect(USER_OWNED_METADATA_KEYS).toContain(metadataKeyForScope('source'));
	});
});

describe('clampQueryInt', () => {
	const { defaultDays, maxDays } = WORKOUT_LIST_LIMITS;

	it('bruker defaulten når parameteren mangler eller er tull', () => {
		expect(clampQueryInt(null, defaultDays, 1, maxDays)).toBe(defaultDays);
		expect(clampQueryInt('abc', defaultDays, 1, maxDays)).toBe(defaultDays);
		expect(clampQueryInt('', defaultDays, 1, maxDays)).toBe(defaultDays);
	});

	it('klipper til gulv og tak framfor å avvise', () => {
		expect(clampQueryInt('0', defaultDays, 1, maxDays)).toBe(1);
		expect(clampQueryInt('-5', defaultDays, 1, maxDays)).toBe(1);
		expect(clampQueryInt('99999', defaultDays, 1, maxDays)).toBe(maxDays);
	});

	it('slipper gyldige verdier gjennom', () => {
		expect(clampQueryInt('7', defaultDays, 1, maxDays)).toBe(7);
		expect(clampQueryInt(String(maxDays), defaultDays, 1, maxDays)).toBe(maxDays);
	});
});
