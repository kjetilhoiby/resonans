import { describe, it, expect } from 'vitest';
import {
	parseWorkoutAnalysis,
	MAX_FEATURES,
	MAX_NAME_LENGTH
} from './workout-analysis';

const hill = {
	kind: 'hill',
	name: 'Dreperen',
	startName: 'Østensjøvannet',
	endName: 'Ulsrud',
	startOffsetSec: 842,
	durationSec: 131,
	distanceMeters: 480,
	elevationGainM: 42,
	avgHeartRate: 168,
	maxHeartRate: 179,
	history: { completions: 14, medianDurationSec: 143, medianAvgHeartRate: 174, bestDurationSec: 128 }
};

describe('parseWorkoutAnalysis', () => {
	it('tolker en fullstendig payload', () => {
		const { analysis, warnings } = parseWorkoutAnalysis({
			version: 1,
			features: [hill],
			laps: [{ index: 1, distanceMeters: 400, durationSec: 96, avgHeartRate: 162 }],
			hillReps: [
				{ index: 1, durationSec: 62, distanceMeters: 210, avgHeartRate: 171, peakHeartRate: 182, secondsInZone: [0, 0, 12, 38, 12] }
			]
		});

		expect(warnings).toEqual([]);
		expect(analysis?.features[0].name).toBe('Dreperen');
		expect(analysis?.features[0].history?.medianDurationSec).toBe(143);
		expect(analysis?.laps[0].durationSec).toBe(96);
		expect(analysis?.hillReps[0].secondsInZone).toEqual([0, 0, 12, 38, 12]);
	});

	it('tar imot en JSON-streng, siden multipart-felt er tekst', () => {
		const { analysis } = parseWorkoutAnalysis(JSON.stringify({ features: [hill] }));
		expect(analysis?.features).toHaveLength(1);
	});

	it('forkaster ugyldig JSON uten å kaste', () => {
		const { analysis, warnings } = parseWorkoutAnalysis('{ ikke json');
		expect(analysis).toBeNull();
		expect(warnings[0]).toContain('ugyldig JSON');
	});

	it('regner tempo selv i stedet for å stole på appens tall', () => {
		const { analysis } = parseWorkoutAnalysis({
			features: [{ ...hill, avgPaceSecPerKm: 999 }]
		});
		// 131 s over 480 m → 273 s/km, ikke de 999 appen påsto.
		expect(analysis?.features[0].avgPaceSecPerKm).toBe(273);
	});

	it('lar tempo være null når distansen er for kort til å bety noe', () => {
		const { analysis } = parseWorkoutAnalysis({
			features: [{ ...hill, distanceMeters: 5 }]
		});
		expect(analysis?.features[0].avgPaceSecPerKm).toBeNull();
	});

	it('forkaster en feature uten navn — den er ikke til å skille fra oppdaget terreng', () => {
		const { analysis, warnings } = parseWorkoutAnalysis({
			features: [{ ...hill, name: '   ' }]
		});
		expect(analysis).toBeNull();
		expect(warnings.join()).toContain('forkastet 1');
	});

	it('forkaster en ukjent feature-type', () => {
		const { analysis } = parseWorkoutAnalysis({ features: [{ ...hill, kind: 'tunnel' }] });
		expect(analysis).toBeNull();
	});

	it('beholder de gyldige elementene når ett er ødelagt', () => {
		const { analysis, warnings } = parseWorkoutAnalysis({
			features: [hill, { kind: 'hill' }, { ...hill, name: 'Bakke 2' }]
		});
		expect(analysis?.features.map((f) => f.name)).toEqual(['Dreperen', 'Bakke 2']);
		expect(warnings.join()).toContain('forkastet 1');
	});

	it('avviser puls utenfor fysiologisk område som sensorfeil', () => {
		const { analysis } = parseWorkoutAnalysis({
			features: [{ ...hill, avgHeartRate: 900, maxHeartRate: 0 }]
		});
		expect(analysis?.features[0].avgHeartRate).toBeNull();
		expect(analysis?.features[0].maxHeartRate).toBeNull();
	});

	it('avviser NaN og strenger der det skal være tall', () => {
		const { analysis } = parseWorkoutAnalysis({
			features: [{ ...hill, durationSec: 'fort', elevationGainM: Number.NaN }]
		});
		expect(analysis?.features[0].durationSec).toBeNull();
		expect(analysis?.features[0].elevationGainM).toBeNull();
	});

	it('forkaster en sonefordeling med hull framfor å lese hullet som null sekunder', () => {
		const { analysis } = parseWorkoutAnalysis({
			hillReps: [{ index: 1, durationSec: 62, secondsInZone: [0, 0, null, 38, 12] }]
		});
		expect(analysis?.hillReps[0].secondsInZone).toBeNull();
	});

	it('forkaster en sonefordeling med feil lengde', () => {
		const { analysis } = parseWorkoutAnalysis({
			hillReps: [{ index: 1, durationSec: 62, secondsInZone: [10, 20, 30] }]
		});
		expect(analysis?.hillReps[0].secondsInZone).toBeNull();
	});

	it('kapper for lange lister og sier fra', () => {
		const many = Array.from({ length: MAX_FEATURES + 5 }, (_, i) => ({ ...hill, name: `Bakke ${i}` }));
		const { analysis, warnings } = parseWorkoutAnalysis({ features: many });

		expect(analysis?.features).toHaveLength(MAX_FEATURES);
		expect(warnings.join()).toContain(`kappet til ${MAX_FEATURES}`);
	});

	it('kapper et navn som er for langt', () => {
		const { analysis } = parseWorkoutAnalysis({
			features: [{ ...hill, name: 'x'.repeat(MAX_NAME_LENGTH + 50) }]
		});
		expect(analysis?.features[0].name).toHaveLength(MAX_NAME_LENGTH);
	});

	it('gir null analyse når payloaden er tom, ikke et tomt skall', () => {
		expect(parseWorkoutAnalysis({ features: [], laps: [], hillReps: [] }).analysis).toBeNull();
		expect(parseWorkoutAnalysis(undefined).analysis).toBeNull();
		expect(parseWorkoutAnalysis(null).analysis).toBeNull();
	});

	it('nummererer runder når appen utelot index', () => {
		const { analysis } = parseWorkoutAnalysis({
			laps: [{ durationSec: 96 }, { durationSec: 101 }]
		});
		expect(analysis?.laps.map((l) => l.index)).toEqual([1, 2]);
	});

	it('krever completions for at historikk skal telle', () => {
		const { analysis } = parseWorkoutAnalysis({
			features: [{ ...hill, history: { medianDurationSec: 143 } }]
		});
		expect(analysis?.features[0].history).toBeNull();
	});

	it('defaulter til versjon 1 når feltet mangler', () => {
		const { analysis } = parseWorkoutAnalysis({ features: [hill] });
		expect(analysis?.version).toBe(1);
	});
});
