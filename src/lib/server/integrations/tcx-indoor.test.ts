import { describe, it, expect } from 'vitest';
import { parseWorkoutFile } from './dropbox-sync';

/**
 * En mølleøkt fra Ekko: punkter uten `<Position>`, med kumulativ distanse, puls og
 * en høyde som stiger med møllas stigning. Formen er den `TCXBuilder` i Ekko skriver.
 */
function treadmillTcx(): string {
	const start = Date.parse('2026-09-26T16:00:00Z');
	const points = Array.from({ length: 11 }, (_, i) => {
		const time = new Date(start + i * 60_000).toISOString();
		// 10 km/t i ti minutter = 1 666,7 m; 2 % stigning gir 33 m opp.
		const distance = (10_000 / 60) * i;
		const altitude = 100 + distance * 0.02;
		return `        <Trackpoint>
          <Time>${time}</Time>
          <AltitudeMeters>${altitude.toFixed(1)}</AltitudeMeters>
          <DistanceMeters>${distance.toFixed(1)}</DistanceMeters>
          <HeartRateBpm><Value>${130 + i}</Value></HeartRateBpm>
        </Trackpoint>`;
	}).join('\n');
	return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Running">
      <Id>2026-09-26T16:00:00.000Z</Id>
      <Lap StartTime="2026-09-26T16:00:00.000Z">
        <TotalTimeSeconds>600</TotalTimeSeconds>
        <DistanceMeters>1666.7</DistanceMeters>
        <Track>
${points}
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;
}

describe('parseWorkoutFile – TCX uten posisjoner (mølle)', () => {
	const parsed = parseWorkoutFile('track.tcx', treadmillTcx());

	it('tolkes, og sporet er tomt', () => {
		expect(parsed).not.toBeNull();
		expect(parsed!.trackPoints).toEqual([]);
		expect(parsed!.sourceFormat).toBe('tcx');
	});

	it('varigheten leses fra punktene selv uten posisjon', () => {
		// Før: sluttiden ble hentet fra posisjonspunktene, så varigheten ble 0.
		expect(parsed!.duration).toBe(600);
	});

	it('distansen er den siste kumulative', () => {
		expect(parsed!.distance).toBeCloseTo(1666.7, 1);
	});

	it('pulsen overlever', () => {
		expect(parsed!.avgHeartRate).toBe(135);
		expect(parsed!.maxHeartRate).toBe(140);
		expect(parsed!.minHeartRate).toBe(130);
	});

	it('høydemeterne summeres fra høyden møllestigningen ga', () => {
		expect(parsed!.elevation).toBeCloseTo(33.3, 0);
	});

	it('pulskurven følger med som samples, med distansen fra fila', () => {
		expect(parsed!.samples).toHaveLength(11);
		expect(parsed!.samples![0]).toMatchObject({ dist: 0, hr: 130 });
		expect(parsed!.samples![10].dist).toBeCloseTo(1666.7, 1);
		expect(parsed!.samples![10].hr).toBe(140);
	});
});

describe('parseWorkoutFile – TCX med posisjoner', () => {
	it('sporet består fortsatt av punktene med posisjon', () => {
		const tcx = `<TrainingCenterDatabase><Activities><Activity Sport="Running"><Id>2026-09-26T16:00:00Z</Id><Lap><Track>
<Trackpoint><Time>2026-09-26T16:00:00Z</Time><Position><LatitudeDegrees>59.9</LatitudeDegrees><LongitudeDegrees>10.7</LongitudeDegrees></Position></Trackpoint>
<Trackpoint><Time>2026-09-26T16:01:00Z</Time><HeartRateBpm><Value>120</Value></HeartRateBpm></Trackpoint>
<Trackpoint><Time>2026-09-26T16:02:00Z</Time><Position><LatitudeDegrees>59.901</LatitudeDegrees><LongitudeDegrees>10.7</LongitudeDegrees></Position></Trackpoint>
</Track></Lap></Activity></Activities></TrainingCenterDatabase>`;
		const parsed = parseWorkoutFile('x.tcx', tcx)!;
		expect(parsed.trackPoints).toHaveLength(2);
		expect(parsed.duration).toBe(120);
		expect(parsed.avgHeartRate).toBe(120);
		expect(parsed.distance).toBeGreaterThan(100);
		// Med spor trengs ingen samples – sporet bærer kurven.
		expect(parsed.samples).toBeUndefined();
	});
});
