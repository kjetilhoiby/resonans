import { describe, it, expect } from 'vitest';
import { describeDriverChoice, hostOf, resolveDbDriver } from './driver-choice';

const NEON = 'postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/resonans';
const COOLIFY = 'postgresql://resonans_runtime:p@postgres:5432/resonans';
const LOCAL = 'postgresql://u:p@localhost:5432/resonans';

describe('resolveDbDriver', () => {
	it('velger neon-http for en Neon-vert', () => {
		expect(resolveDbDriver(NEON, undefined)).toMatchObject({
			driver: 'neon-http',
			explicit: false
		});
	});

	// Dette er hele grunnen til at modulen finnes: den gamle regexen så etter
	// «localhost», og en Coolify-URL peker på et containernavn.
	it('velger postgres for en Coolify-vert', () => {
		expect(resolveDbDriver(COOLIFY, undefined)).toMatchObject({
			driver: 'postgres',
			explicit: false,
			host: 'postgres'
		});
	});

	it('velger postgres for localhost', () => {
		expect(resolveDbDriver(LOCAL, undefined).driver).toBe('postgres');
	});

	it('DB_DRIVER slår verten', () => {
		expect(resolveDbDriver(NEON, 'postgres')).toMatchObject({
			driver: 'postgres',
			explicit: true
		});
		expect(resolveDbDriver(COOLIFY, 'neon-http')).toMatchObject({
			driver: 'neon-http',
			explicit: true
		});
	});

	it('tom eller blank DB_DRIVER ignoreres', () => {
		expect(resolveDbDriver(NEON, '').explicit).toBe(false);
		expect(resolveDbDriver(NEON, '   ').explicit).toBe(false);
	});

	// Et ukjent navn skal ikke bli en stille default — det er nettopp den
	// feilklassen denne modulen finnes for å fjerne.
	it('kaster på ukjent DB_DRIVER', () => {
		expect(() => resolveDbDriver(NEON, 'neon')).toThrow(/ukjent/);
		expect(() => resolveDbDriver(NEON, 'Postgres ')).not.toThrow();
	});

	it('en utolkbar streng blir postgres, ikke neon', () => {
		expect(resolveDbDriver('ikke en url', undefined)).toMatchObject({
			driver: 'postgres',
			host: null
		});
	});

	it('en vert som bare INNEHOLDER neon.tech teller ikke', () => {
		expect(
			resolveDbDriver('postgresql://u:p@neon.tech.example.com:5432/db', undefined).driver
		).toBe('postgres');
	});
});

describe('hostOf', () => {
	it('leser verten', () => {
		expect(hostOf(COOLIFY)).toBe('postgres');
	});

	it('gir null for søppel', () => {
		expect(hostOf('')).toBeNull();
	});
});

describe('describeDriverChoice', () => {
	it('sier hvor valget kom fra', () => {
		expect(describeDriverChoice(resolveDbDriver(COOLIFY, undefined))).toBe(
			'[db] driver=postgres (utledet av vert postgres)'
		);
		expect(describeDriverChoice(resolveDbDriver(COOLIFY, 'neon-http'))).toBe(
			'[db] driver=neon-http (DB_DRIVER)'
		);
	});
});
