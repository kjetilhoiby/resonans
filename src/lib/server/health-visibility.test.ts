import { describe, it, expect } from 'vitest';
import { canSeeFullHealth } from './health-visibility';

const SECRET = 'hemmelig-cron';

describe('canSeeFullHealth', () => {
	it('slipper gjennom riktig bearer', () => {
		expect(canSeeFullHealth(`Bearer ${SECRET}`, SECRET)).toBe(true);
	});

	it('avviser feil, manglende og nesten-riktig legitimasjon', () => {
		expect(canSeeFullHealth('Bearer feil', SECRET)).toBe(false);
		expect(canSeeFullHealth(null, SECRET)).toBe(false);
		expect(canSeeFullHealth(SECRET, SECRET)).toBe(false); // uten «Bearer »
		expect(canSeeFullHealth(`bearer ${SECRET}`, SECRET)).toBe(false);
		expect(canSeeFullHealth(`Bearer ${SECRET} `, SECRET)).toBe(false);
	});

	// Fail-closed. Den gamle gaten var `env.CRON_SECRET && …`, altså falsk uten
	// hemmelighet — men der sto `|| debug` ved siden av og reddet den gjennom.
	it('er fail-closed uten konfigurert hemmelighet', () => {
		expect(canSeeFullHealth('Bearer hva som helst', undefined)).toBe(false);
		expect(canSeeFullHealth('Bearer ', '')).toBe(false);
		expect(canSeeFullHealth(null, undefined)).toBe(false);
	});

	// Regresjonsvakt for selve feilen: funksjonen tar ikke imot noe fra
	// query-strengen i det hele tatt, så en parameter KAN ikke gi tilgang.
	// Endrer noen signaturen til å ta en `debug`-flagg, feiler denne intensjonen
	// synlig i en review.
	it('har ingen vei inn utenom legitimasjonen', () => {
		expect(canSeeFullHealth.length).toBe(2);
	});
});
