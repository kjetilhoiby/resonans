import { describe, it, expect } from 'vitest';
import { rowsOf } from './index';

/**
 * rowsOf er vakten mot en feilklasse som har truffet prod: `db.execute(sql`…`)`
 * returnerer et resultat-OBJEKT med neon HTTP-driveren, men en bar ARRAY med
 * postgres-js. Koden som glemmer den kaster «is not iterable» — eller, verre,
 * gir stille tomme lister.
 */
describe('rowsOf', () => {
	it('henter radene ut av neon HTTP-resultatobjektet', () => {
		// Formen neon-http faktisk returnerer.
		const neonResult = {
			command: 'SELECT',
			rowCount: 2,
			rows: [{ id: 'a' }, { id: 'b' }],
			fields: [],
			rowAsArray: false
		};
		expect(rowsOf<{ id: string }>(neonResult)).toEqual([{ id: 'a' }, { id: 'b' }]);
	});

	it('slipper gjennom en bar array fra postgres-js', () => {
		expect(rowsOf<{ id: string }>([{ id: 'a' }])).toEqual([{ id: 'a' }]);
	});

	it('gir tom liste for tomt resultat i begge former', () => {
		expect(rowsOf({ command: 'SELECT', rowCount: 0, rows: [] })).toEqual([]);
		expect(rowsOf([])).toEqual([]);
	});

	it('gir tom liste framfor å kaste på null, undefined og rare verdier', () => {
		// Et resultat uten `rows` skal ikke velte kallstedet.
		expect(rowsOf(null)).toEqual([]);
		expect(rowsOf(undefined)).toEqual([]);
		expect(rowsOf({})).toEqual([]);
		expect(rowsOf({ rows: null })).toEqual([]);
		expect(rowsOf({ rows: 'ikke en array' })).toEqual([]);
		expect(rowsOf(42)).toEqual([]);
	});

	it('returverdien er alltid iterabel — det er hele poenget', () => {
		for (const shape of [null, undefined, {}, { rows: [{ id: 'a' }] }, [{ id: 'b' }]]) {
			expect(() => {
				for (const _row of rowsOf(shape)) {
					/* skal aldri kaste */
				}
			}).not.toThrow();
		}
	});
});
