import { describe, it, expect } from 'vitest';
import {
	HINT_HR_DEVIATION_BPM,
	HINT_MIN_NIGHTS,
	HINT_QUIET_DAYS,
	HINT_SKIN_DEVIATION_C,
	suggestIllness,
	type IllnessHintInput,
	type NightDeviation
} from './illness-hint';

const nights = (from: number, devs: number[]): NightDeviation[] =>
	devs.map((deviation, i) => ({
		date: `2026-09-${String(from + i).padStart(2, '0')}`,
		deviation
	}));

const base: IllnessHintInput = {
	restingHr: [],
	skinTemp: [],
	sickActive: false,
	dismissedOn: null,
	todayKey: '2026-09-05'
};

describe('suggestIllness — når den holder kjeft', () => {
	it('uten signaler', () => {
		expect(suggestIllness(base)).toBeNull();
	});

	it('når en sykeperiode alt er aktiv — spørsmålet er besvart', () => {
		const input = { ...base, sickActive: true, restingHr: nights(1, [9, 9, 9]) };
		expect(suggestIllness(input)).toBeNull();
	});

	it('én natt er en sen kveld, ikke sykdom', () => {
		expect(suggestIllness({ ...base, restingHr: nights(1, [2, 2, 12]) })).toBeNull();
	});

	it('under terskelen, uansett hvor mange netter', () => {
		const under = HINT_HR_DEVIATION_BPM - 1;
		expect(suggestIllness({ ...base, restingHr: nights(1, [under, under, under]) })).toBeNull();
	});

	it('et avvik som gikk over er ikke et spørsmål om i dag', () => {
		// Høyt de tre første nettene, normalt de to siste.
		expect(suggestIllness({ ...base, restingHr: nights(1, [10, 10, 10, 1, 1]) })).toBeNull();
	});

	it('etter et avvist forslag holder den kjeft i HINT_QUIET_DAYS', () => {
		const input = { ...base, restingHr: nights(3, [9, 9, 9]), dismissedOn: '2026-09-04' };
		expect(suggestIllness(input)).toBeNull();

		// Og sier fra igjen etterpå.
		const later = {
			...input,
			todayKey: `2026-09-${String(4 + HINT_QUIET_DAYS).padStart(2, '0')}`
		};
		expect(suggestIllness(later)).not.toBeNull();
	});
});

describe('suggestIllness — når den spør', () => {
	it('sovepuls over terskelen to netter på rad', () => {
		const hint = suggestIllness({ ...base, restingHr: nights(3, [2, 9, 11]) })!;
		expect(hint.nights).toBe(2);
		// Peker på FØRSTE natta avviket startet, ikke i dag.
		expect(hint.since).toBe('2026-09-04');
		expect(hint.text).toContain('11 slag over snittet');
	});

	it('nevner hard trening som den andre forklaringen', () => {
		// Vi kan ikke skille sykdom fra en hard uke, og skal ikke late som.
		const hint = suggestIllness({ ...base, restingHr: nights(3, [9, 9, 9]) })!;
		expect(hint.text).toContain('hard trening');
		expect(hint.text).not.toMatch(/du er syk|infeksjon|feber/i);
	});

	it('hudtemperatur alene er nok', () => {
		const dev = HINT_SKIN_DEVIATION_C + 0.3;
		const hint = suggestIllness({ ...base, skinTemp: nights(4, [dev, dev]) })!;
		expect(hint.text).toContain('°C over snittet');
		expect(hint.since).toBe('2026-09-04');
	});

	it('begge signalene nevnes, og since er den tidligste starten', () => {
		const hint = suggestIllness({
			...base,
			restingHr: nights(2, [9, 9, 9, 9]),
			skinTemp: nights(4, [0.9, 0.9])
		})!;
		expect(hint.observations).toHaveLength(2);
		expect(hint.since).toBe('2026-09-02');
	});

	it('krever nøyaktig HINT_MIN_NIGHTS netter, ikke flere', () => {
		const run = Array<number>(HINT_MIN_NIGHTS).fill(HINT_HR_DEVIATION_BPM);
		expect(suggestIllness({ ...base, restingHr: nights(4, run) })).not.toBeNull();
		expect(
			suggestIllness({ ...base, restingHr: nights(5, run.slice(0, HINT_MIN_NIGHTS - 1)) })
		).toBeNull();
	});
});
