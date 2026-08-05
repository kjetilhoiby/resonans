import { describe, it, expect } from 'vitest';
import {
	toWeightMeasurements,
	summarizeCompositionChange,
	interpretCompositionChange,
	COMPOSITION_WINDOW_DAYS,
	type CompositionChangeSummary
} from './weight-measurements';
import { dailyWeights, type WeightDay } from './weight-series';

function row(iso: string, data: Record<string, unknown>) {
	return { timestamp: new Date(iso), data };
}

describe('toWeightMeasurements', () => {
	it('bøtter på Oslo-dato, ikke UTC', () => {
		// 23:30 UTC 4. august er 01:30 norsk tid 5. august (sommertid).
		const [measurement] = toWeightMeasurements([row('2026-08-04T23:30:00Z', { weight: 82 })]);
		expect(measurement.date).toBe('2026-08-05');
	});

	it('leser fettprosent fra legacy-feltet og regner kilo av vekta', () => {
		// Historiske rader har PROSENTEN i `fatMass`. 22 % av 82 kg er 18,0 kg —
		// lest som kilo ville tallet vært 22, og et fettmasse-mål ville bommet 4 kg.
		const [measurement] = toWeightMeasurements([
			row('2026-08-05T06:00:00Z', { weight: 82, fatMass: 22 })
		]);
		expect(measurement.fatRatio).toBe(22);
		expect(measurement.fatMassKg).toBe(18);
	});

	it('foretrekker den målte kiloverdien når begge finnes', () => {
		const [measurement] = toWeightMeasurements([
			row('2026-08-05T06:00:00Z', { weight: 82, fatMassKg: 18.4, fatRatio: 22 })
		]);
		expect(measurement.fatMassKg).toBe(18.4);
	});

	it('forkaster rader uten brukbar vekt', () => {
		expect(
			toWeightMeasurements([
				row('2026-08-05T06:00:00Z', { weight: 0 }),
				row('2026-08-05T06:00:00Z', {}),
				row('2026-08-05T06:00:00Z', { weight: 'tung' })
			])
		).toEqual([]);
	});

	it('utleder fettfri masse når vekta ikke rapporterte den', () => {
		const [measurement] = toWeightMeasurements([
			row('2026-08-05T06:00:00Z', { weight: 82, fatMassKg: 18 })
		]);
		expect(measurement.fatFreeMassKg).toBe(64);
	});
});

function day(date: string, weightKg: number, fatMassKg: number | null, muscleMassKg: number | null): WeightDay {
	return {
		date,
		weightKg,
		weighInCount: 1,
		fatMassKg,
		fatRatio: null,
		muscleMassKg,
		fatFreeMassKg: null
	};
}

describe('summarizeCompositionChange', () => {
	it('formulerer endringen i vekt, fett og muskel', () => {
		const result = summarizeCompositionChange([
			day('2026-05-01', 84, 20, 61),
			day('2026-08-01', 82, 18.5, 60.5)
		]);
		expect(result?.sentence).toBe('−2,0 kg — −1,5 kg fett, −0,5 kg muskel');
		expect(result?.fatShare).toBe(0.75);
	});

	it('rapporterer den faktiske avstanden, ikke det ønskede vinduet', () => {
		// Bare tre uker med fettmålinger. Setningen skal ikke påstå tre måneder.
		const result = summarizeCompositionChange([
			day('2026-07-15', 83, 19, 60),
			day('2026-08-05', 82, 18.4, 60)
		]);
		expect(result?.windowDays).toBe(21);
		expect(result!.windowDays).toBeLessThan(COMPOSITION_WINDOW_DAYS);
	});

	it('velger målingen nærmest vinduets kant', () => {
		const result = summarizeCompositionChange([
			day('2025-01-01', 90, 26, 62),
			day('2026-05-07', 84, 20, 61),
			day('2026-08-05', 82, 18.5, 60.5)
		]);
		expect(result?.fromDate).toBe('2026-05-07');
	});

	it('tier når bare én måling har fettmasse', () => {
		expect(
			summarizeCompositionChange([day('2026-05-01', 84, null, 61), day('2026-08-01', 82, 18.5, 60.5)])
		).toBeNull();
	});

	it('tier på en tom serie', () => {
		expect(summarizeCompositionChange([])).toBeNull();
	});

	it('virker på utdata fra dailyWeights', () => {
		const days = dailyWeights([
			{ date: '2026-05-01', weightKg: 84, fatMassKg: 20, muscleMassKg: 61 },
			{ date: '2026-08-01', weightKg: 82, fatMassKg: 18.5, muscleMassKg: 60.5 }
		]);
		expect(summarizeCompositionChange(days)?.sentence).toContain('fett');
	});
});

describe('interpretCompositionChange', () => {
	function change(overrides: Partial<CompositionChangeSummary>): CompositionChangeSummary {
		return {
			windowDays: 90,
			fromDate: '2026-05-08',
			toDate: '2026-08-06',
			sentence: '',
			fatShare: null,
			weightDeltaKg: 0,
			fatDeltaKg: null,
			muscleDeltaKg: null,
			...overrides
		};
	}

	it('regner andel bare når vekt og fett faller i takt', () => {
		const note = interpretCompositionChange(
			change({ weightDeltaKg: -2, fatDeltaKg: -1.7, muscleDeltaKg: -0.2, fatShare: 0.85 })
		);
		expect(note).toContain('85 % av nedgangen er fett');
	});

	it('skriver ikke «200 %» når fettet falt mer enn vekta', () => {
		/**
		 * Regresjonen, funnet mot en ekte database: vekta ned 0,2 kg, fettet ned 0,4,
		 * muskelen opp 0,1 → fatShare 2. Kortet skrev «200 % av endringen er fett».
		 * Det er ikke en feil i dataene — det er det beste utfallet man kan ha.
		 */
		const note = interpretCompositionChange(
			change({ weightDeltaKg: -0.2, fatDeltaKg: -0.4, muscleDeltaKg: 0.1, fatShare: 2 })
		);
		expect(note).not.toContain('%');
		expect(note).toContain('muskelmassen gikk opp');
	});

	it('sier fra når vekta faller uten at fettet gjør det', () => {
		const note = interpretCompositionChange(
			change({ weightDeltaKg: -1.2, fatDeltaKg: 0.1, muscleDeltaKg: -1.1, fatShare: null })
		);
		expect(note).toContain('muskel eller væske');
	});

	it('dømmer ikke en oppgang, men sier hva som økte', () => {
		expect(
			interpretCompositionChange(change({ weightDeltaKg: 1.4, fatDeltaKg: 1.2, muscleDeltaKg: 0.1 }))
		).toContain('fettmassen med den');
		expect(
			interpretCompositionChange(change({ weightDeltaKg: 1.4, fatDeltaKg: -0.2, muscleDeltaKg: 1.5 }))
		).toContain('men ikke fettmassen');
	});

	it('tier uten fettmåling og uten endring', () => {
		expect(interpretCompositionChange(null)).toBeNull();
		expect(interpretCompositionChange(change({ weightDeltaKg: -1, fatDeltaKg: null }))).toBeNull();
		expect(interpretCompositionChange(change({ weightDeltaKg: 0, fatDeltaKg: 0 }))).toBeNull();
	});
});
