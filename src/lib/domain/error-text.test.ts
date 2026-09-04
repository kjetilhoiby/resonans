import { describe, it, expect } from 'vitest';
import {
	MAX_CAUSE_DEPTH,
	MAX_ERROR_PART_LENGTH,
	MAX_STORED_ERROR_LENGTH,
	compactErrorMessage,
	describeErrorForStorage,
	truncateForStorage
} from './error-text';

/** Etterligner formen `DrizzleQueryError` bygger: SQL, så alle parameterne. */
function drizzleError(rows: number, cause?: Error): Error {
	const columns = ['user_id', 'start_time', 'sport_type', 'evidence', 'best_efforts'];
	const placeholders = Array.from({ length: rows }, (_, r) =>
		`(${columns.map((_c, i) => `$${r * columns.length + i + 1}`).join(', ')})`
	).join(', ');
	const params = Array.from({ length: rows * columns.length }, (_, i) =>
		`{"trackPoints":"…","i":${i}}`
	).join(',');
	const err = new Error(
		`Failed query: insert into "canonical_workouts" (${columns.map((c) => `"${c}"`).join(', ')}) values ${placeholders}\nparams: ${params}`
	);
	if (cause) err.cause = cause;
	return err;
}

describe('truncateForStorage', () => {
	it('lar korte tekster stå urørt', () => {
		expect(truncateForStorage('kort feil', 100)).toBe('kort feil');
	});

	it('kapper og merker at det skjedde', () => {
		const out = truncateForStorage('x'.repeat(500), 50);
		expect(out).toHaveLength(50);
		expect(out.endsWith('… [kappet]')).toBe(true);
	});

	it('merket er en del av lengden, så taket holdes', () => {
		expect(truncateForStorage('y'.repeat(5000), MAX_STORED_ERROR_LENGTH).length).toBe(
			MAX_STORED_ERROR_LENGTH
		);
	});
});

describe('compactErrorMessage', () => {
	it('fjerner drizzles params-blokk i sin helhet', () => {
		const out = compactErrorMessage('Failed query: select 1\nparams: a,b,c,d');
		expect(out).toBe('Failed query: select 1');
	});

	it('beholder tabellnavnet, altså formen på det som ble forsøkt', () => {
		const out = compactErrorMessage(drizzleError(200).message);
		expect(out).toContain('insert into "canonical_workouts"');
		expect(out.length).toBeLessThanOrEqual(MAX_ERROR_PART_LENGTH);
	});

	it('lar en vanlig melding stå', () => {
		expect(compactErrorMessage('workout_projection_refresh requires user_id')).toBe(
			'workout_projection_refresh requires user_id'
		);
	});

	it('kapper en lang melding uten params-blokk', () => {
		const out = compactErrorMessage('Uventet: ' + 'z'.repeat(10_000));
		expect(out.length).toBe(MAX_ERROR_PART_LENGTH);
		expect(out.startsWith('Uventet: ')).toBe(true);
	});
});

describe('describeErrorForStorage', () => {
	it('holder en 780 KB drizzle-feil innenfor taket', () => {
		const raw = drizzleError(2000);
		expect(raw.message.length).toBeGreaterThan(100_000);
		expect(describeErrorForStorage(raw).length).toBeLessThanOrEqual(MAX_STORED_ERROR_LENGTH);
	});

	it('tar med årsaken, som er der grunnen faktisk står', () => {
		const cause = new Error(
			'duplicate key value violates unique constraint "canonical_workouts_user_id_start_time_sport_family_unique"'
		);
		const out = describeErrorForStorage(drizzleError(2000, cause));

		// Uten cause-kjeden ville de første 2000 tegnene bare vært SQL.
		expect(out).toContain('insert into "canonical_workouts"');
		expect(out).toContain('duplicate key value violates unique constraint');
	});

	it('gir samme tekst for to kjøringer med ulike parametere', () => {
		const cause = () => new Error('duplicate key value violates unique constraint "u"');
		// Det er dette som gjør errorFingerprint brukbar: 28 rader ga 28 unike
		// fingeravtrykk fordi parameterne lå i meldingen.
		expect(describeErrorForStorage(drizzleError(2000, cause()))).toBe(
			describeErrorForStorage(drizzleError(1500, cause()))
		);
	});

	it('kapper hvert ledd, så årsaken overlever en enorm toppmelding', () => {
		const cause = new Error('den ekte grunnen');
		const err = new Error('Uventet: ' + 'q'.repeat(100_000));
		err.cause = cause;

		expect(describeErrorForStorage(err)).toContain('den ekte grunnen');
	});

	it('stopper etter MAX_CAUSE_DEPTH ledd', () => {
		let err = new Error('ledd-4');
		for (const label of ['ledd-3', 'ledd-2', 'ledd-1', 'ledd-0']) {
			const next = new Error(label);
			next.cause = err;
			err = next;
		}

		const out = describeErrorForStorage(err);
		expect(out).toContain('ledd-0');
		expect(out).toContain(`ledd-${MAX_CAUSE_DEPTH}`);
		expect(out).not.toContain('ledd-4');
	});

	it('bryter en syklus i cause-kjeden', () => {
		const a = new Error('a');
		const b = new Error('b');
		a.cause = b;
		b.cause = a;

		expect(describeErrorForStorage(a)).toBe('a\n← årsak: b');
	});

	it('gjentar ikke identiske ledd', () => {
		const inner = new Error('samme melding');
		const outer = new Error('samme melding');
		outer.cause = inner;

		expect(describeErrorForStorage(outer)).toBe('samme melding');
	});

	it('takler en kastet verdi som ikke er en Error', () => {
		expect(describeErrorForStorage('bare en streng')).toBe('bare en streng');
		expect(describeErrorForStorage(null)).toBe('null');
		expect(describeErrorForStorage(undefined)).toBe('undefined');
	});
});
