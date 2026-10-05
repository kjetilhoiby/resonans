import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./usage-diagnostics.ts', import.meta.url));
const MIGRATION = fileURLToPath(
	new URL('../../../scripts/db-migrations/0015_usage_events.sql', import.meta.url)
);

// Spørringene kan ikke kjøres uten en database, så vakten leser kildefila.
// Feilen den vokter mot er stum: et feil tidsuttrykk gir et plausibelt svar,
// bare forskjøvet fire timer.
describe('Oslo-tid i bruksdiagnosen', () => {
	it('usage_events er TIMESTAMPTZ i migrasjonen som laget tabellen', () => {
		const sql = readFileSync(MIGRATION, 'utf8');
		expect(sql).toMatch(/created_at\s+TIMESTAMPTZ/i);
	});

	it('bruker et uttrykk som er riktig for både timestamptz og timestamp', () => {
		const source = readFileSync(SOURCE, 'utf8');
		expect(source).toContain("::timestamptz AT TIME ZONE 'Europe/Oslo'");
	});

	it('bruker ikke dobbel AT TIME ZONE, som forskyver en timestamptz', () => {
		const code = readFileSync(SOURCE, 'utf8')
			.split('\n')
			.filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
			.join('\n');
		expect(code).not.toMatch(/AT TIME ZONE 'UTC' AT TIME ZONE/);
	});
});
