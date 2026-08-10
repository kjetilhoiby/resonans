import { describe, it, expect } from 'vitest';
import {
	buildAssessmentContext,
	describeFeatures,
	describeSplits,
	MAX_LISTED_SPLITS,
	type AssessmentInput
} from './workout-assessment-context';
import type { KmSplit } from '$lib/utils/track-stats';

function split(kmIndex: number, paceSecondsPerKm: number, avgHr: number | null = null): KmSplit {
	return {
		kmIndex,
		isPartial: false,
		distanceKm: 1,
		durationSec: paceSecondsPerKm,
		paceSecondsPerKm,
		avgHr,
		elevationGainM: 0
	};
}

function baseInput(overrides: Partial<AssessmentInput> = {}): AssessmentInput {
	return {
		workout: {
			title: 'Løpetur',
			sportType: 'running',
			timestamp: '2026-08-10T15:20:00Z',
			distanceKm: 8.03,
			durationSeconds: 1500,
			paceSecondsPerKm: 187,
			elevationMeters: 234,
			avgHeartRate: 152,
			maxHeartRate: 171
		},
		splits: [],
		analysis: null,
		effort: { score: null, method: null },
		bestEfforts: null,
		weekStanding: null,
		nugget: null,
		goals: { short: [], long: [] },
		...overrides
	};
}

describe('enhet følger idretten', () => {
	it('viser sykling i km/t, ikke i min/km', () => {
		const context = buildAssessmentContext(
			baseInput({ workout: { ...baseInput().workout, title: 'Sykkeløkt', sportType: 'cycling' } })
		);
		expect(context).toContain('19,3 km/t');
		expect(context).not.toContain('/km');
		expect(context).toContain('snittfart');
	});

	it('viser løping i min/km', () => {
		const context = buildAssessmentContext(baseInput());
		expect(context).toContain('3:07 /km');
		expect(context).toContain('snittempo');
	});

	it('bruker riktig enhet også på kilometersplittene', () => {
		const lines = describeSplits('cycling', [split(1, 180)]);
		expect(lines[0]).toContain('km/t');
		expect(lines[0]).not.toContain('/km');
	});
});

describe('describeSplits', () => {
	it('lister hver kilometer med tid og puls', () => {
		const lines = describeSplits('running', [split(1, 272, 148), split(2, 265, 155)]);
		expect(lines[0]).toBe('km 1: 4:32 /km, puls 148');
		expect(lines[1]).toBe('km 2: 4:25 /km, puls 155');
	});

	it('hopper over den delvise siste kilometeren', () => {
		const partial: KmSplit = { ...split(3, 280), isPartial: true, distanceKm: 0.4 };
		expect(describeSplits('running', [split(1, 272), partial])).toHaveLength(1);
	});

	it('oppsummerer i stedet for å liste når det er for mange', () => {
		const many = Array.from({ length: MAX_LISTED_SPLITS + 5 }, (_, i) => split(i + 1, 270 + i));
		const lines = describeSplits('running', many);

		expect(lines).toHaveLength(4);
		expect(lines[0]).toContain(`${many.length} hele kilometer`);
		expect(lines[1]).toContain('raskeste');
		expect(lines[2]).toContain('tregeste');
		expect(lines[3]).toContain('spredning');
	});

	it('tåler et spor uten splitter', () => {
		expect(describeSplits('running', [])).toEqual([]);
	});
});

describe('describeFeatures', () => {
	const feature = {
		kind: 'hill' as const,
		name: 'Dreperen',
		startName: 'Østensjøvannet',
		endName: 'Ulsrud',
		startOffsetSec: 842,
		durationSec: 131,
		distanceMeters: 480,
		elevationGainM: 42,
		avgHeartRate: 168,
		maxHeartRate: 179,
		avgPaceSecPerKm: 273,
		history: { completions: 14, medianDurationSec: 143, medianAvgHeartRate: 174, bestDurationSec: 128 }
	};

	it('skriver differansen mot medianen ut i klartekst', () => {
		// Modellen skal slippe å regne selv — den regner av og til feil.
		const [line] = describeFeatures({ version: 1, features: [feature], laps: [], hillReps: [] });
		expect(line).toContain('Bakke «Dreperen (Østensjøvannet → Ulsrud)»');
		expect(line).toContain('0:12 raskere enn medianen din');
		expect(line).toContain('6 slag lavere puls enn vanlig');
		expect(line).toContain('14. gang');
	});

	it('sier tregere når det var tregere', () => {
		const [line] = describeFeatures({
			version: 1,
			features: [{ ...feature, durationSec: 160 }],
			laps: [],
			hillReps: []
		});
		expect(line).toContain('tregere enn medianen din');
	});

	it('melder ny bestetid når tida slår rekorden', () => {
		const [line] = describeFeatures({
			version: 1,
			features: [{ ...feature, durationSec: 120 }],
			laps: [],
			hillReps: []
		});
		expect(line).toContain('ny bestetid');
	});

	it('sier «på medianen din» framfor «0:00 raskere»', () => {
		const [line] = describeFeatures({
			version: 1,
			features: [{ ...feature, durationSec: 143 }],
			laps: [],
			hillReps: []
		});
		expect(line).toContain('på medianen din');
		expect(line).not.toContain('0:00');
	});

	it('klarer seg uten historikk', () => {
		const [line] = describeFeatures({
			version: 1,
			features: [{ ...feature, history: null }],
			laps: [],
			hillReps: []
		});
		expect(line).toContain('Dreperen');
		expect(line).not.toContain('gang');
	});

	it('bruker bare navnet når endene mangler', () => {
		const [line] = describeFeatures({
			version: 1,
			features: [{ ...feature, startName: null, endName: null }],
			laps: [],
			hillReps: []
		});
		expect(line).toContain('«Dreperen»');
	});

	it('gir ingenting når det ikke finnes analyse', () => {
		expect(describeFeatures(null)).toEqual([]);
	});
});

describe('buildAssessmentContext', () => {
	it('utelater seksjoner vi ikke har data for, framfor tomme rubrikker', () => {
		const context = buildAssessmentContext(baseInput());
		expect(context).not.toContain('Runder');
		expect(context).not.toContain('Bakker');
		expect(context).not.toContain('Navngitte strekninger');
		expect(context).not.toContain('ukjent');
	});

	it('tar med mål med progresjon, delt i kort og lang', () => {
		const context = buildAssessmentContext(
			baseInput({
				goals: {
					short: [
						{ title: 'Halvmaraton', horizon: 'kort', daysLeft: 22, progressText: null, completion: null, paused: false }
					],
					long: [
						{
							title: 'Løp 600 km i 2026',
							horizon: 'lang',
							daysLeft: null,
							progressText: '340 km av 600 km (260 km igjen)',
							completion: 0.57,
							paused: false
						}
					]
				}
			})
		);

		expect(context).toContain('Kortsiktige mål');
		expect(context).toContain('Halvmaraton — 22 dager igjen');
		expect(context).toContain('Lange og løpende mål');
		expect(context).toContain('340 km av 600 km');
	});

	it('merker pausede mål', () => {
		const context = buildAssessmentContext(
			baseInput({
				goals: {
					short: [],
					long: [{ title: 'Ned til 85 kg', horizon: 'lang', daysLeft: null, progressText: null, completion: null, paused: true }]
				}
			})
		);
		expect(context).toContain('PÅ PAUSE');
	});

	it('tar med ukas standing med flatenes egne ord', () => {
		const context = buildAssessmentContext(
			baseInput({ weekStanding: { planText: '426 av 232–278', loadText: '−14, Sliten' } })
		);
		expect(context).toContain('426 av 232–278');
		expect(context).toContain('−14, Sliten');
	});

	it('tar med effort og raskeste strekk', () => {
		const context = buildAssessmentContext(
			baseInput({ effort: { score: 87.5, method: 'trimp' }, bestEfforts: { '1k': 258, '5k': 1400 } })
		);
		expect(context).toContain('effort 87,5 (trimp)');
		expect(context).toContain('1k: 4:18');
		expect(context).toContain('5k: 23:20');
	});
});

describe('geografien kommer fra Ekko', () => {
	it('viser Ekkos runder med sammenligning mot din vanlige runde', () => {
		const context = buildAssessmentContext(
			baseInput({
				analysis: {
					version: 1,
					features: [],
					laps: [
						{
							index: 1,
							distanceMeters: 400,
							durationSec: 96,
							avgHeartRate: 162,
							history: { completions: 30, medianDurationSec: 101, medianAvgHeartRate: null, bestDurationSec: null }
						}
					],
					hillReps: []
				}
			})
		);

		expect(context).toContain('Runder');
		expect(context).toContain('0:05 raskere enn din vanlige runde her');
	});

	it('viser bakkedrag med dominerende sone', () => {
		const context = buildAssessmentContext(
			baseInput({
				analysis: {
					version: 1,
					features: [],
					laps: [],
					hillReps: [
						{ index: 1, durationSec: 62, distanceMeters: 210, avgHeartRate: 171, peakHeartRate: 182, secondsInZone: [0, 0, 12, 38, 12] }
					]
				}
			})
		);
		expect(context).toContain('drag 1, 1:02, 210 m, puls 171/182, mest i Z4');
	});

	it('har ingen bakker eller runder uten Ekko-analyse — det er den bevisste konsekvensen', () => {
		// En økt fra klokka, Dropbox eller Strava. Den skal fortsatt ha alt det
		// andre, men ingen geografi.
		const context = buildAssessmentContext(
			baseInput({ splits: [split(1, 272, 148)], analysis: null })
		);

		expect(context).not.toContain('Runder');
		expect(context).not.toContain('Bakke');
		expect(context).not.toContain('Strekning');
		expect(context).toContain('Kilometer');
		expect(context).toContain('km 1: 4:32 /km');
	});
});
