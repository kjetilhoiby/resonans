import { describe, it, expect } from 'vitest';
import {
	decideFuelNudge,
	EARLIEST_HOUR,
	LATEST_HOUR,
	pickSuggestions,
	SNACK_MAX_KCAL,
	TRAINING_KCAL_THRESHOLD
} from './fuel-nudge';
import type { IntakePacing } from './intake-pacing';
import type { RepeatableMeal } from './repeat-meals';
import type { HungerPrediction } from './hunger';

function pacing(over: Partial<IntakePacing> = {}): IntakePacing {
	return {
		osloHour: 15,
		actualShare: 0.12,
		expectedShare: 0.45,
		deltaShare: -0.33,
		behind: true,
		kcalSoFar: 304,
		proteinSoFar: 19,
		expectedKcalByNow: 1170,
		...over
	};
}

function meal(label: string, kcal: number, proteinG = 10): RepeatableMeal {
	return {
		label,
		occurrences: 3,
		macros: { kcal, proteinG, carbsG: 20, fatG: 8 },
		lastAt: '2026-08-02T10:00:00Z',
		usualSlot: null,
		imageUrl: null
	};
}

const SNACKS = [meal('Knekkebrød med egg', 242, 16), meal('Cottage cheese', 180, 22), meal('Banan', 105, 1)];

/** En klar sultmodell med terskel 1 400 kcal. */
function hunger(over: Partial<HungerPrediction> = {}): HungerPrediction {
	return {
		ready: true,
		notReadyReason: null,
		thresholdKcal: 1400,
		approaching: true,
		observations: 6,
		highObservations: 3,
		typicalHour: 15,
		...over
	};
}

describe('decideFuelNudge — forutsagt sult', () => {
	it('vinner over alle de andre variantene', () => {
		// Selv med en trent-men-underspist-dag skal den målte terskelen gå først:
		// den er målt på denne kroppen, og den kommer før sulten.
		const nudge = decideFuelNudge({
			osloHour: 15,
			pacing: pacing(),
			kcalBySlot: {},
			workouts: [{ sportType: 'running', kcal: 600, distanceKm: 8 }],
			repeatable: SNACKS,
			hunger: hunger(),
			gapNowKcal: 1290
		})!;
		expect(nudge.kind).toBe('predicted-hunger');
		expect(nudge.body).toContain('1290');
		expect(nudge.body).toContain('3 ganger');
		expect(nudge.body).toContain('15-tida');
		expect(nudge.suggestions.length).toBeGreaterThan(0);
	});

	it('sier ingenting om blodsukker — vi måler det ikke', () => {
		const nudge = decideFuelNudge({
			osloHour: 15,
			pacing: pacing(),
			kcalBySlot: {},
			workouts: [],
			repeatable: SNACKS,
			hunger: hunger(),
			gapNowKcal: 1290
		})!;
		expect(nudge.headline.toLowerCase()).not.toContain('blodsukker');
		expect(nudge.body.toLowerCase()).not.toContain('blodsukker');
	});

	it('faller tilbake til de vanlige variantene når modellen ikke er klar', () => {
		const nudge = decideFuelNudge({
			osloHour: 15,
			pacing: pacing(),
			kcalBySlot: {},
			workouts: [],
			repeatable: SNACKS,
			hunger: hunger({ ready: false, thresholdKcal: null, approaching: false }),
			gapNowKcal: 1290
		})!;
		expect(nudge.kind).toBe('behind-pacing');
	});

	it('fyrer ikke når gapet ikke nærmer seg terskelen', () => {
		const nudge = decideFuelNudge({
			osloHour: 15,
			pacing: pacing({ behind: false, deltaShare: 0 }),
			kcalBySlot: { lunsj: 600 },
			workouts: [],
			repeatable: SNACKS,
			hunger: hunger({ approaching: false }),
			gapNowKcal: 400
		});
		expect(nudge).toBeNull();
	});

	it('respekterer tidsvinduet også for sultvarselet', () => {
		const args = {
			pacing: pacing(),
			kcalBySlot: {},
			workouts: [],
			repeatable: SNACKS,
			hunger: hunger(),
			gapNowKcal: 1290
		};
		expect(decideFuelNudge({ ...args, osloHour: EARLIEST_HOUR - 1 })).toBeNull();
		expect(decideFuelNudge({ ...args, osloHour: LATEST_HOUR + 1 })).toBeNull();
	});

	it('tåler at gapet mangler', () => {
		const nudge = decideFuelNudge({
			osloHour: 15,
			pacing: pacing(),
			kcalBySlot: {},
			workouts: [],
			repeatable: SNACKS,
			hunger: hunger(),
			gapNowKcal: null
		})!;
		expect(nudge.kind).toBe('predicted-hunger');
		expect(nudge.body).not.toContain('null');
	});
});

describe('decideFuelNudge', () => {
	it('gir det sterkeste rådet når man har trent og spist lite', () => {
		// Brukerens tredje eksempel: løpt 8 km, spist to knekkebrød.
		const nudge = decideFuelNudge({
			osloHour: 15,
			pacing: pacing(),
			kcalBySlot: { lunsj: 242 },
			workouts: [{ sportType: 'running', kcal: 600, distanceKm: 8 }],
			repeatable: SNACKS
		})!;
		expect(nudge.kind).toBe('underfuelled-after-training');
		expect(nudge.headline).toContain('trent');
		expect(nudge.body).toContain('8,0 km');
		expect(nudge.body).toContain('304');
		expect(nudge.body).toContain('1170');
		expect(nudge.suggestions.length).toBeGreaterThan(0);
		expect(nudge.askHunger).toBe(false);
	});

	it('gir snack-forslag når man bare ligger bak', () => {
		// Brukerens første eksempel.
		const nudge = decideFuelNudge({
			osloHour: 14,
			pacing: pacing({ osloHour: 14 }),
			kcalBySlot: { frokost: 62, lunsj: 242 },
			workouts: [],
			repeatable: SNACKS
		})!;
		expect(nudge.kind).toBe('behind-pacing');
		expect(nudge.headline).toContain('snack');
		expect(nudge.suggestions).toHaveLength(3);
	});

	it('spør om sult når lunsjen mangler', () => {
		// Brukerens andre eksempel. Svakest signal, så vi spør framfor å råde.
		const nudge = decideFuelNudge({
			osloHour: 14,
			pacing: pacing({ behind: false, kcalSoFar: 900, deltaShare: -0.02 }),
			kcalBySlot: { frokost: 900 },
			workouts: [],
			repeatable: SNACKS
		})!;
		expect(nudge.kind).toBe('missing-meal');
		expect(nudge.body).toContain('1 til 5');
		expect(nudge.askHunger).toBe(true);
	});

	it('lar en normal dag være i fred', () => {
		expect(
			decideFuelNudge({
				osloHour: 15,
				pacing: pacing({ behind: false, kcalSoFar: 1200, deltaShare: 0.02 }),
				kcalBySlot: { frokost: 400, lunsj: 800 },
				workouts: [],
				repeatable: SNACKS
			})
		).toBeNull();
	});

	it('holder seg innenfor tidsvinduet', () => {
		const behind = { pacing: pacing(), kcalBySlot: {}, workouts: [], repeatable: SNACKS };
		expect(decideFuelNudge({ ...behind, osloHour: EARLIEST_HOUR - 0.5 })).toBeNull();
		expect(decideFuelNudge({ ...behind, osloHour: LATEST_HOUR + 0.5 })).toBeNull();
		expect(decideFuelNudge({ ...behind, osloHour: EARLIEST_HOUR })).not.toBeNull();
		expect(decideFuelNudge({ ...behind, osloHour: LATEST_HOUR })).not.toBeNull();
	});

	it('krever at økta faktisk kostet noe', () => {
		// En femminutters yoga endrer ikke rådet.
		const nudge = decideFuelNudge({
			osloHour: 15,
			pacing: pacing(),
			kcalBySlot: {},
			workouts: [{ sportType: 'yoga', kcal: TRAINING_KCAL_THRESHOLD - 1 }],
			repeatable: SNACKS
		})!;
		expect(nudge.kind).toBe('behind-pacing');
	});

	it('nevner ikke løpsdistanse når økta ikke var et løp', () => {
		const nudge = decideFuelNudge({
			osloHour: 15,
			pacing: pacing(),
			kcalBySlot: {},
			workouts: [
				{ sportType: 'e_bike', kcal: 200 },
				{ sportType: 'e_bike', kcal: 200 }
			],
			repeatable: SNACKS
		})!;
		expect(nudge.body).toContain('2 økter');
		expect(nudge.body).not.toContain('km');
	});

	it('venter til lunsjtida er passert', () => {
		const before = decideFuelNudge({
			osloHour: 12,
			pacing: pacing({ behind: false, kcalSoFar: 900, deltaShare: 0 }),
			kcalBySlot: { frokost: 900 },
			workouts: [],
			repeatable: SNACKS
		});
		expect(before).toBeNull();
	});
});

describe('pickSuggestions', () => {
	it('setter proteinrike først når protein mangler', () => {
		const picks = pickSuggestions(SNACKS, 60);
		expect(picks[0].label).toBe('Cottage cheese');
	});

	it('beholder hyppighetsrekkefølgen når protein er i rute', () => {
		const picks = pickSuggestions(SNACKS, null);
		expect(picks[0].label).toBe('Knekkebrød med egg');
	});

	it('luker bort det som ikke er en snack', () => {
		const picks = pickSuggestions(
			[meal('Middag', SNACK_MAX_KCAL + 1), meal('Tyggegummi', 5), ...SNACKS],
			null
		);
		expect(picks.map((m) => m.label)).not.toContain('Middag');
		expect(picks.map((m) => m.label)).not.toContain('Tyggegummi');
	});

	it('gir maks tre, og tåler tom historikk', () => {
		expect(pickSuggestions([...SNACKS, meal('Eple', 90)], null)).toHaveLength(3);
		expect(pickSuggestions([], null)).toEqual([]);
	});
});
