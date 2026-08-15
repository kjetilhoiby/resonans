import { describe, it, expect } from 'vitest';
import { USER_OWNED_METADATA_KEYS, mergeUserOwnedMetadata } from './sensor-event-metadata';

describe('mergeUserOwnedMetadata', () => {
	it('bevarer dismissed når synken skriver raden på nytt', () => {
		const merged = mergeUserOwnedMetadata(
			{ source: 'withings_sync_workout', dismissed: true },
			{ source: 'withings_sync_workout', dedupeKey: null }
		);
		expect(merged.dismissed).toBe(true);
	});

	it('lar synken revidere sine egne felt', () => {
		const merged = mergeUserOwnedMetadata(
			{ source: 'withings_sync_workout', totalTrackPoints: 12, dismissed: true },
			{ source: 'withings_sync_workout', totalTrackPoints: 340 }
		);
		expect(merged.totalTrackPoints).toBe(340);
		expect(merged.dismissed).toBe(true);
	});

	it('bevarer alle kilde-rollene brukeren kan sette', () => {
		const merged = mergeUserOwnedMetadata(
			{ sourceRejected: true, preferGps: true, preferHr: true },
			{ source: 'withings_sync_workout' }
		);
		expect(merged).toMatchObject({ sourceRejected: true, preferGps: true, preferHr: true });
	});

	it('introduserer ikke nøkler raden ikke hadde', () => {
		const merged = mergeUserOwnedMetadata({ source: 'ekko' }, { source: 'ekko' });
		for (const key of USER_OWNED_METADATA_KEYS) {
			expect(key in merged).toBe(false);
		}
	});

	it('behandler null på den eksisterende raden som fravær', () => {
		// `metadata.dismissed === null` og «ingen dismissed» må se like ut for
		// leserne, som alle sjekker på `=== true`.
		const merged = mergeUserOwnedMetadata({ dismissed: null }, { source: 'withings_sync_workout' });
		expect('dismissed' in merged).toBe(false);
	});

	it('tåler at raden eller den nye metadataen mangler helt', () => {
		expect(mergeUserOwnedMetadata(null, null)).toEqual({});
		expect(mergeUserOwnedMetadata({ dismissed: true }, null)).toEqual({ dismissed: true });
		expect(mergeUserOwnedMetadata(null, { source: 'ekko' })).toEqual({ source: 'ekko' });
	});

	it('gjenåpning vinner — en fjernet nøkkel kommer ikke tilbake', () => {
		// DELETE /dismiss sletter nøkkelen med `metadata - 'dismissed'`. Neste
		// synk skal ikke gjenopplive den fra sin egen payload.
		const merged = mergeUserOwnedMetadata({ source: 'withings_sync_workout' }, { source: 'withings_sync_workout' });
		expect(merged.dismissed).toBeUndefined();
	});
});
