import { describe, it, expect } from 'vitest';
import {
	CACHE_COLLAPSE_KB,
	describeHost,
	parseMeminfo,
	type HostSample
} from './host-metrics';

/** Ekte utdrag, formatet slik det faktisk ser ut. */
const MEMINFO = `MemTotal:        3819876 kB
MemFree:         1234567 kB
MemAvailable:    1900000 kB
Buffers:           12345 kB
Cached:          1400000 kB
SwapCached:            0 kB
Active:          2000000 kB
SwapTotal:       4194300 kB
SwapFree:        4194300 kB
Dirty:                 0 kB`;

function sample(overrides: Partial<HostSample> = {}): HostSample {
	return {
		memTotalKb: 3_819_876,
		memAvailableKb: 1_900_000,
		memFreeKb: 1_234_567,
		cachedKb: 1_400_000,
		swapTotalKb: 4_194_300,
		swapFreeKb: 4_194_300,
		load1: 0.4,
		load5: 0.3,
		load15: 0.2,
		...overrides
	};
}

describe('parseMeminfo', () => {
	it('leser feltene vi bruker', () => {
		expect(parseMeminfo(MEMINFO)).toEqual({
			memTotalKb: 3_819_876,
			memAvailableKb: 1_900_000,
			memFreeKb: 1_234_567,
			cachedKb: 1_400_000,
			swapTotalKb: 4_194_300,
			swapFreeKb: 4_194_300
		});
	});

	// SwapCached står i fila rett etter Cached og ville truffet en løs
	// prefiks-sjekk. Feilen ville vært stum: et plausibelt tall, feil størrelse.
	it('forveksler ikke Cached med SwapCached', () => {
		expect(parseMeminfo(MEMINFO)?.cachedKb).toBe(1_400_000);
	});

	it('godtar swap på 0 — det er en gyldig måling, og den vi ønsket oss', () => {
		const utenSwap = MEMINFO.replace(/SwapTotal:.*/, 'SwapTotal:             0 kB').replace(
			/SwapFree:.*/,
			'SwapFree:              0 kB'
		);
		const p = parseMeminfo(utenSwap);
		expect(p?.swapTotalKb).toBe(0);
		expect(p?.swapFreeKb).toBe(0);
	});

	// En delvis måling ser ut som ekte data i en graf. Bedre å si nei.
	it('gir null når et påkrevd felt mangler', () => {
		expect(parseMeminfo(MEMINFO.replace(/MemAvailable:.*/, ''))).toBeNull();
		expect(parseMeminfo('')).toBeNull();
		expect(parseMeminfo('noe helt annet')).toBeNull();
	});
});

describe('describeHost', () => {
	it('regner andelene', () => {
		const v = describeHost(sample());
		expect(v.availableShare).toBeCloseTo(0.497, 2);
		expect(v.swapUsedShare).toBe(0);
		expect(v.cacheCollapsed).toBe(false);
	});

	// Signaturen fra 4. september: page cache 1 388 kB.
	it('flagger kollapset page cache, og sier MEKANISMEN', () => {
		const v = describeHost(sample({ cachedKb: 1_388, memAvailableKb: 89_000 }));
		expect(v.cacheCollapsed).toBe(true);
		expect(v.summary).toContain('page cache');
		expect(v.summary).toContain('leser egen kode fra disk');
	});

	it('terskelen skiller travelt fra kollaps', () => {
		expect(describeHost(sample({ cachedKb: CACHE_COLLAPSE_KB })).cacheCollapsed).toBe(false);
		expect(describeHost(sample({ cachedKb: CACHE_COLLAPSE_KB - 1 })).cacheCollapsed).toBe(true);
	});

	it('sier fra når swap mangler helt', () => {
		const v = describeHost(sample({ swapTotalKb: 0, swapFreeKb: 0 }));
		expect(v.swapUsedShare).toBeNull();
		expect(v.summary).toContain('ingen swap');
	});

	it('sier fra når swap er i tung bruk', () => {
		const v = describeHost(sample({ swapFreeKb: 1_000_000 }));
		expect(v.summary).toMatch(/swap \d+ % brukt/);
	});

	it('deler ikke på null for en tom måling', () => {
		const v = describeHost(sample({ memTotalKb: 0, swapTotalKb: 0 }));
		expect(v.availableShare).toBe(0);
		expect(Number.isNaN(v.availableShare)).toBe(false);
	});
});
