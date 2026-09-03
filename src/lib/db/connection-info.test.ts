import { describe, it, expect } from 'vitest';
import { assertNoRemovedDriverOverride, describeConnection } from './connection-info';

describe('describeConnection', () => {
	it('viser vert, port og base — og ALDRI passordet', () => {
		const line = describeConnection('postgres://bruker:hemmelig@postgres:5432/resonans');
		expect(line).toBe('[db] tilkobling: postgres:5432/resonans');
		expect(line).not.toContain('hemmelig');
		expect(line).not.toContain('bruker');
	});

	it('antar 5432 når porten ikke er oppgitt', () => {
		expect(describeConnection('postgres://u:p@db.example.com/resonans')).toBe(
			'[db] tilkobling: db.example.com:5432/resonans'
		);
	});

	it('ekkoer ikke en ugyldig streng — den kan bære passordet', () => {
		const line = describeConnection('postgres//hemmelig-uten-kolon');
		expect(line).toContain('kunne ikke tolke');
		expect(line).not.toContain('hemmelig');
	});
});

describe('assertNoRemovedDriverOverride', () => {
	it('kaster på neon-http, med veien videre i meldingen', () => {
		expect(() => assertNoRemovedDriverOverride('neon-http')).toThrow(/DATABASE_URL/);
		expect(() => assertNoRemovedDriverOverride('  NEON-HTTP  ')).toThrow(/fjernet/);
	});

	it('lar postgres og en tom verdi stå — variabelen skal kunne bli stående', () => {
		expect(() => assertNoRemovedDriverOverride('postgres')).not.toThrow();
		expect(() => assertNoRemovedDriverOverride(undefined)).not.toThrow();
		expect(() => assertNoRemovedDriverOverride('')).not.toThrow();
		// Et ukjent navn er heller ikke en feil lenger: det finnes ikke noe
		// valg å ta feil av.
		expect(() => assertNoRemovedDriverOverride('noe-rart')).not.toThrow();
	});
});
