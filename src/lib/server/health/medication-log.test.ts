import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const SOURCE = readFileSync(new URL('./medication-log.ts', import.meta.url), 'utf8');

describe('vakt: en dose stemples ALDRI med et døgn', () => {
	/*
	 * `sensor_events_sensor_datatype_timestamp_unique` er unik på
	 * (sensor_id, data_type, timestamp). Et dagsstempel innfører derfor «én rad
	 * per dag per datatype» — og på doser er det ikke et kanttilfelle, det er
	 * hele poenget som ryker: flere doser samme dag er nettopp signalet
	 * ved-behov-loggen finnes for.
	 *
	 * Feilen ville dessuten pekt feil vei. Fire doser mandag ville blitt lest som
	 * én, altså tallet gjort galt i den retningen som SKJULER bedringen, mens de
	 * tre avviste skrivingene så ut som en flate som ikke virker.
	 *
	 * Samme felle som felte symptomloggen og sykeperiodene i prod 5. september
	 * 2026. Testen leser kildefila, som taket i `import-triage.ts`.
	 */
	const doseWrite = SOURCE.slice(
		SOURCE.indexOf('dataType: MEDICATION_DOSE_DATA_TYPE'),
		SOURCE.indexOf('source: \'medication_log\'', SOURCE.indexOf('dataType: MEDICATION_DOSE_DATA_TYPE'))
	);

	it('finner dose-skrivingen i kildefila', () => {
		expect(doseWrite.length).toBeGreaterThan(0);
	});

	it('stempler med `now`, ikke med en dagsnøkkel', () => {
		expect(doseWrite).toContain('timestamp: now');
	});

	it('bygger ikke et tidsstempel av en dag', () => {
		// `${dayKey}T12:00:00Z` og venner — formen som felte de to andre loggene.
		expect(doseWrite).not.toMatch(/timestamp:\s*new Date\(`/);
		expect(doseWrite).not.toMatch(/T\d{2}:\d{2}:\d{2}Z`/);
	});

	it('lar dagen bo i `data`', () => {
		expect(doseWrite).toMatch(/data:\s*\{[^}]*\bday\b/);
	});
});
