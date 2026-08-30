import { describe, it, expect } from 'vitest';
import {
	HR_ZONE_LABELS,
	MIN_HR_RESERVE,
	heartRateReserveFraction,
	hrZoneBand,
	hrZoneBands,
	isUsableHrBaseline,
	spokenBand,
	zoneForHeartRate,
	zoneLowerBpm,
	type HrZoneNumber
} from './hr-zones';

/** Referansebrukeren i dokumentasjonen: maks 180, hvile 50, reserve 130. */
const baseline = { restHr: 50, maxHr: 180 };

describe('hrZoneBands', () => {
	it('gir fem sammenhengende bånd uten hull eller overlapp', () => {
		const bands = hrZoneBands(baseline)!;
		expect(bands).toHaveLength(5);
		for (let i = 1; i < bands.length; i += 1) {
			expect(bands[i].lowerBpm).toBe(bands[i - 1].upperBpm + 1);
		}
	});

	it('regner båndene fra HRR, ikke fra %makspuls', () => {
		// Dette er hele poenget med omleggingen: %makspuls ville gitt Z2 fra 108.
		const bands = hrZoneBands(baseline)!;
		expect(bands.map((b) => [b.zone, b.lowerBpm, b.upperBpm])).toEqual([
			[1, 50, 127],
			[2, 128, 140],
			[3, 141, 153],
			[4, 154, 166],
			[5, 167, 180]
		]);
	});

	it('starter Z1 på hvilepulsen og avslutter Z5 på makspulsen', () => {
		const bands = hrZoneBands(baseline)!;
		expect(bands[0].lowerBpm).toBe(baseline.restHr);
		expect(bands[4].upperBpm).toBe(baseline.maxHr);
	});

	it('gir null når pulsreserven er for liten til å tro på', () => {
		expect(hrZoneBands({ restHr: 60, maxHr: 60 + MIN_HR_RESERVE - 1 })).toBeNull();
	});

	it('bruker de norske etikettene som Ekko sier høyt', () => {
		const bands = hrZoneBands(baseline)!;
		expect(bands.map((b) => b.label)).toEqual([
			'Restitusjon',
			'Rolig',
			'Moderat',
			'Terskel',
			'Maksimal'
		]);
		expect(HR_ZONE_LABELS[2]).toBe('Rolig');
	});
});

describe('zoneForHeartRate', () => {
	it('klassifiserer puls 135 som rolig — ikke moderat', () => {
		// Regresjonsvakt for feilen som gjorde arbeidet nødvendig: %makspuls ga Z3
		// her, og en sonecoach på den modellen ville bedt brukeren roe ned fra en
		// genuint rolig tur.
		expect(zoneForHeartRate(135, baseline)).toBe(2);
	});

	it('legger hver båndgrense i sonen båndet sier', () => {
		const bands = hrZoneBands(baseline)!;
		for (const band of bands) {
			expect(zoneForHeartRate(band.lowerBpm, baseline)).toBe(band.zone);
			expect(zoneForHeartRate(band.upperBpm, baseline)).toBe(band.zone);
		}
	});

	it('er enig med båndene på hvert eneste slag fra hvile til maks', () => {
		// Coachen leser båndet høyt og klassifiserer pulsen; sier de to ulike ting
		// på ETT slag, er det brukeren som oppdager det.
		const bands = hrZoneBands(baseline)!;
		for (let bpm = baseline.restHr; bpm <= baseline.maxHr; bpm += 1) {
			const zone = zoneForHeartRate(bpm, baseline)!;
			const band = bands.find((b) => b.zone === zone)!;
			expect(bpm).toBeGreaterThanOrEqual(band.lowerBpm);
			expect(bpm).toBeLessThanOrEqual(band.upperBpm);
		}
	});

	it('holder puls over maks i Z5 framfor å falle ut av modellen', () => {
		expect(zoneForHeartRate(195, baseline)).toBe(5);
	});

	it('legger puls under hvilepulsen i Z1', () => {
		expect(zoneForHeartRate(42, baseline)).toBe(1);
	});

	it('gir null uten brukbar puls eller baseline', () => {
		expect(zoneForHeartRate(0, baseline)).toBeNull();
		expect(zoneForHeartRate(140, { restHr: 60, maxHr: 70 })).toBeNull();
	});

	it('flytter båndene når hvilepulsen endrer seg, ikke bare makspulsen', () => {
		// Hele poenget med HRR framfor %makspuls: samme maks, ulik hvile, ulik sone.
		//
		// Retningen er verdt å ha skrevet ned, for den er lett å gjette feil på: en
		// LAV hvilepuls gir en STØRRE reserve, så 140 slag ligger lenger opp i den.
		// Med hvile 40 er 140 sytten prosent inne i Z3; med hvile 70 er det Z2.
		// Ergo er det ikke slik at god form flytter alle sonene nedover — den flytter
		// gulvet, og båndene strekker seg.
		expect(zoneForHeartRate(140, { restHr: 40, maxHr: 180 })).toBe(3);
		expect(zoneForHeartRate(140, { restHr: 70, maxHr: 180 })).toBe(2);
	});
});

describe('zoneLowerBpm', () => {
	it('er samme tall som båndets nedre grense', () => {
		const bands = hrZoneBands(baseline)!;
		for (const band of bands) {
			expect(zoneLowerBpm(band.zone, baseline)).toBe(band.lowerBpm);
		}
	});
});

describe('heartRateReserveFraction', () => {
	it('gir andelen av reserven, klippet til 0–1', () => {
		expect(heartRateReserveFraction(115, baseline)).toBeCloseTo(0.5, 5);
		expect(heartRateReserveFraction(30, baseline)).toBe(0);
		expect(heartRateReserveFraction(220, baseline)).toBe(1);
	});
});

describe('isUsableHrBaseline', () => {
	it('godtar en reserve på nøyaktig terskelen', () => {
		expect(isUsableHrBaseline({ restHr: 60, maxHr: 60 + MIN_HR_RESERVE })).toBe(true);
	});

	it('avviser tall som ikke er tall', () => {
		expect(isUsableHrBaseline({ restHr: Number.NaN, maxHr: 180 })).toBe(false);
	});
});

describe('spokenBand', () => {
	it('sier tallparet uten enhet', () => {
		expect(spokenBand(hrZoneBand(2 as HrZoneNumber, baseline)!)).toBe('128 til 140');
	});
});
