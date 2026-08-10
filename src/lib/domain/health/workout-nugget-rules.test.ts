import { describe, it, expect } from 'vitest';
import { pickNugget, streakNugget, yearMilestoneNugget, type NuggetWorkout } from './workout-nugget-rules';
import { workoutActivityKind } from './workout-activity-kind';

const DAY = 24 * 60 * 60 * 1000;

/** Økt `daysAgo` dager før referansen, kl. 12 lokal tid. */
function w(
	sportType: string,
	daysAgo: number,
	overrides: Partial<NuggetWorkout> = {}
): NuggetWorkout {
	const d = new Date(2026, 7, 10, 12, 0, 0);
	d.setTime(d.getTime() - daysAgo * DAY);
	return {
		timestamp: d,
		sportType,
		distanceMeters: 5000,
		durationSeconds: 1500,
		...overrides
	};
}

describe('streak per aktivitet', () => {
	it('blander ikke elsykkel og løping — det var feilen som utløste dette', () => {
		// Fire dager på rad, men fire ulike aktiviteter.
		const current = w('running', 0);
		const history = [w('e_bike', 1), w('walking', 2), w('e_bike', 3)];

		expect(streakNugget(current, [], workoutActivityKind('running'))).toBeNull();
		expect(pickNugget(current, history) ?? '').not.toContain('dager på rad');
	});

	it('teller sammenhengende dager med samme aktivitet', () => {
		const current = w('running', 0);
		const sameKind = [w('running', 1), w('running', 2), w('running', 3)];
		expect(streakNugget(current, sameKind, workoutActivityKind('running'))).toBe('Løpt 4 dager på rad!');
	});

	it('bruker verbet for aktiviteten', () => {
		expect(streakNugget(w('e_bike', 0), [w('e_bike', 1), w('e_bike', 2)], workoutActivityKind('e_bike')))
			.toBe('Syklet elsykkel 3 dager på rad!');
		expect(streakNugget(w('walking', 0), [w('walking', 1), w('walking', 2)], workoutActivityKind('walking')))
			.toBe('Gått 3 dager på rad!');
	});

	it('faller tilbake på substantivet for aktiviteter uten naturlig verb', () => {
		const kind = workoutActivityKind('yoga');
		expect(streakNugget(w('yoga', 0), [w('yoga', 1), w('yoga', 2)], kind))
			.toBe('3 dager med yogaøkt på rad!');
	});

	it('krever tre dager — to er ikke en serie', () => {
		expect(streakNugget(w('running', 0), [w('running', 1)], workoutActivityKind('running'))).toBeNull();
	});

	it('brytes av en dag uten den aktiviteten', () => {
		const sameKind = [w('running', 1), w('running', 3), w('running', 4)];
		expect(streakNugget(w('running', 0), sameKind, workoutActivityKind('running'))).toBeNull();
	});

	it('teller to økter samme dag som én dag', () => {
		const sameKind = [w('running', 0), w('running', 1), w('running', 2)];
		expect(streakNugget(w('running', 0), sameKind, workoutActivityKind('running'))).toBe('Løpt 3 dager på rad!');
	});
});

describe('årsmilepæl', () => {
	it('sier fra på runde tall', () => {
		const sameKind = Array.from({ length: 49 }, (_, i) => w('e_bike', i + 1));
		expect(yearMilestoneNugget(w('e_bike', 0), sameKind, workoutActivityKind('e_bike')))
			.toBe('Elsykkeltur nr. 50 i år!');
	});

	it('holder kjeft på et vilkårlig tall — krydder hver gang blir bakgrunnsstøy', () => {
		const sameKind = Array.from({ length: 36 }, (_, i) => w('e_bike', i + 1));
		expect(yearMilestoneNugget(w('e_bike', 0), sameKind, workoutActivityKind('e_bike'))).toBeNull();
	});

	it('teller bare inneværende år', () => {
		const iFjor = Array.from({ length: 40 }, () => w('running', 400));
		const iAr = Array.from({ length: 9 }, (_, i) => w('running', i + 1));
		expect(yearMilestoneNugget(w('running', 0), [...iFjor, ...iAr], workoutActivityKind('running')))
			.toBe('Løpetur nr. 10 i år!');
	});

	it('teller ikke økter som ligger etter denne', () => {
		const senere = [w('running', -5), w('running', -3)];
		const tidligere = Array.from({ length: 9 }, (_, i) => w('running', i + 1));
		expect(yearMilestoneNugget(w('running', 0), [...senere, ...tidligere], workoutActivityKind('running')))
			.toBe('Løpetur nr. 10 i år!');
	});
});

describe('pickNugget', () => {
	it('grupperer løpevarianter som samme aktivitet', () => {
		const current = w('running', 0);
		const history = [w('trail_running', 1), w('indoor_running', 2), w('running', 3)];
		expect(pickNugget(current, history)).toBe('Løpt 4 dager på rad!');
	});

	it('holder elsykkel utenfor vanlig sykkel', () => {
		const current = w('e_bike', 0);
		const history = [w('cycling', 1), w('cycling', 2), w('cycling', 3)];
		expect(pickNugget(current, history) ?? '').not.toContain('dager på rad');
	});

	it('lar en rekord slå en streak', () => {
		const current = w('running', 0, { distanceMeters: 21000, durationSeconds: 7000 });
		const history = [
			w('running', 1, { distanceMeters: 5000 }),
			w('running', 2, { distanceMeters: 6000 }),
			w('running', 3, { distanceMeters: 7000 })
		];
		expect(pickNugget(current, history)).toBe('Lengste løpetur noensinne!');
	});

	it('teller ukas økter per aktivitet', () => {
		// Mandag 10. august 2026. To løpeturer tidligere i uka, pluss denne.
		const current = w('running', 0);
		const history = [w('running', 0), w('running', 0), w('e_bike', 0)];
		expect(pickNugget(current, history)).toContain('løpetur denne uka');
	});

	it('faller tilbake på en observasjon om økta når historikken er tom', () => {
		const current = w('running', 0, { distanceMeters: 12000, durationSeconds: 3600 });
		expect(pickNugget(current, [])).toBe('Lang økt — godt jobba!');
	});

	it('gir null når det ikke er noe å si', () => {
		const current = w('running', 0, { distanceMeters: 5000, durationSeconds: 1800 });
		expect(pickNugget(current, [])).toBeNull();
	});

	it('gir ikke tempo-rekord for sykling — farten sier lite om formen der', () => {
		const current = w('cycling', 0, { distanceMeters: 20000, durationSeconds: 3000 });
		const history = [
			w('cycling', 10, { distanceMeters: 20000, durationSeconds: 4000 }),
			w('cycling', 20, { distanceMeters: 25000, durationSeconds: 5000 }),
			w('cycling', 30, { distanceMeters: 22000, durationSeconds: 4500 })
		];
		expect(pickNugget(current, history) ?? '').not.toContain('tempo');
	});
});

describe('workoutActivityKind', () => {
	it('skiller elsykkel fra sykkel', () => {
		expect(workoutActivityKind('e_bike').key).toBe('e_bike');
		expect(workoutActivityKind('cycling').key).toBe('cycling');
		expect(workoutActivityKind('eBiking').key).toBe('e_bike');
	});

	it('slår sammen løpevariantene', () => {
		for (const t of ['running', 'trail_running', 'indoor_running']) {
			expect(workoutActivityKind(t).key).toBe('running');
		}
	});

	it('gir ukjente typer sin egen gruppe med generiske ord', () => {
		const kind = workoutActivityKind('padel');
		expect(kind.key).toBe('padel');
		expect(kind.noun).toBe('treningsøkt');
	});

	it('tåler tom og manglende type', () => {
		expect(workoutActivityKind(null).key).toBe('workout');
		expect(workoutActivityKind('   ').key).toBe('workout');
	});
});
