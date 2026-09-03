import { describe, it, expect } from 'vitest';
import { affectedRows, rowsOf } from './result-shape';

/**
 * Formen postgres-js faktisk returnerer, målt 3. september 2026: en bar array
 * MED `count` på seg, og `rowCount` udefinert.
 */
function postgresResult(rows: unknown[], count = rows.length) {
	const result = [...rows] as unknown[] & { count: number };
	result.count = count;
	return result;
}

describe('rowsOf', () => {
	// NB: sammenlign RADENE, ikke bæreren. `toEqual` på en array ser også på
	// egne enumerable properties, og postgres-js' `count` ligger som en slik
	// på resultatet — så `toEqual([...])` mot et rått resultat feiler med
	// «Compared values have no visual difference». Spread isolerer radene.
	it('slipper gjennom radene fra postgres-js-formen', () => {
		expect([...rowsOf(postgresResult([{ id: 1 }, { id: 2 }]))]).toEqual([{ id: 1 }, { id: 2 }]);
	});

	it('gir tom liste for et tomt resultat', () => {
		expect([...rowsOf(postgresResult([]))]).toHaveLength(0);
	});

	it('returnerer resultatet selv, ikke en kopi', () => {
		// Ingen kallsteder muterer radene, og en kopi per spørring ville vært
		// en unødvendig kostnad på lister som kan være store.
		const result = postgresResult([{ id: 1 }]);
		expect(rowsOf(result)).toBe(result);
	});

	it('gir tom liste framfor å kaste på null, undefined og rare verdier', () => {
		// En LESEsti skal degradere nådig — se doc-kommentaren.
		expect(rowsOf(null)).toEqual([]);
		expect(rowsOf(undefined)).toEqual([]);
		expect(rowsOf(42)).toEqual([]);
		expect(rowsOf('rader')).toEqual([]);
		// Objektformen fra den fjernede neon-stien er ikke lenger en form vi
		// leser: den gir tom liste, som alt annet uventet.
		expect(rowsOf({ rows: [{ id: 1 }] })).toEqual([]);
	});

	it('returverdien er alltid iterabel — det er hele poenget', () => {
		for (const input of [null, undefined, 42, {}, postgresResult([{ id: 1 }])]) {
			expect(() => {
				for (const _ of rowsOf(input)) void _;
			}).not.toThrow();
		}
	});
});

describe('affectedRows', () => {
	it('leser count fra postgres-js-formen', () => {
		// Der `.rowCount` på en array er undefined, altså en stille 0 for
		// naiv kode.
		const result = postgresResult([], 3);
		expect((result as { rowCount?: number }).rowCount).toBeUndefined();
		expect(affectedRows(result)).toBe(3);
	});

	it('leser rowCount når det finnes som tall', () => {
		expect(affectedRows({ rowCount: 7 })).toBe(7);
	});

	it('0 er et gyldig svar, ikke et manglende', () => {
		expect(affectedRows(postgresResult([], 0))).toBe(0);
	});

	it('gir 0 for null og for noe uten telling', () => {
		expect(affectedRows(null)).toBe(0);
		expect(affectedRows(undefined)).toBe(0);
		expect(affectedRows({})).toBe(0);
		expect(affectedRows({ count: 'tre' })).toBe(0);
	});
});
