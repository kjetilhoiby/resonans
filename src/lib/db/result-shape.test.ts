import { describe, it, expect } from 'vitest';
import { affectedRows, rowsOf } from './result-shape';

/** Formen Neon HTTP-driveren returnerer. */
function neonResult(rows: unknown[], rowCount = rows.length) {
	return { command: 'SELECT', rowCount, rows, fields: [], rowAsArray: false };
}

/** Formen postgres-js returnerer: en array MED `count` på seg. */
function postgresResult(rows: unknown[], count = rows.length) {
	const result = [...rows] as unknown[] & { count: number };
	result.count = count;
	return result;
}

describe('rowsOf', () => {
	it('leser radene fra Neon-formen', () => {
		expect(rowsOf(neonResult([{ id: 1 }, { id: 2 }]))).toEqual([{ id: 1 }, { id: 2 }]);
	});

	// Arrayen returneres som den er — `count` henger med, siden postgres-js
	// legger den på arrayen selv. Derfor spres den før sammenligningen.
	it('leser radene fra postgres-js-formen', () => {
		expect([...rowsOf(postgresResult([{ id: 1 }]))]).toEqual([{ id: 1 }]);
	});

	it('gir tom liste for null, undefined og noe uventet', () => {
		expect(rowsOf(null)).toEqual([]);
		expect(rowsOf(undefined)).toEqual([]);
		expect(rowsOf({ noRows: true })).toEqual([]);
		expect(rowsOf(42)).toEqual([]);
	});
});

describe('affectedRows', () => {
	it('leser rowCount fra Neon-formen', () => {
		expect(affectedRows(neonResult([], 3))).toBe(3);
	});

	// Fella: `.rowCount` på en array er `undefined`, så et UPDATE mot en vanlig
	// Postgres rapporterte 0 traff uansett hvor mange rader det endret.
	it('leser count fra postgres-js-formen', () => {
		expect(affectedRows(postgresResult([], 7))).toBe(7);
	});

	it('0 er et gyldig svar, ikke et manglende', () => {
		expect(affectedRows(neonResult([], 0))).toBe(0);
		expect(affectedRows(postgresResult([], 0))).toBe(0);
	});

	it('gir 0 for null og for noe uten telling', () => {
		expect(affectedRows(null)).toBe(0);
		expect(affectedRows(undefined)).toBe(0);
		expect(affectedRows([])).toBe(0);
		expect(affectedRows({ rowCount: '3' })).toBe(0);
	});
});
