import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GUARDED_DATA_TYPES, readsRawDataType } from './sensor-event-access';

const SRC_DIR = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			sourceFiles(path, out);
			continue;
		}
		if (!/\.(ts|svelte)$/.test(path)) continue;
		if (path.endsWith('.test.ts')) continue;
		// Vaktens egen konfig nevner mønstrene den leter etter
		if (path.endsWith('sensor-event-access.ts')) continue;
		// Tabelldefinisjonen er DDL, ikke spørringer: de partielle unike indeksene på
		// sensor_events nevner `data_type = 'bank_balance'` og
		// `data_type NOT IN ('bank_balance', 'bank_transaction')`. Å kreve at schema.ts
		// står på lista over rå lesere ville gjort lista misvisende.
		if (path.endsWith('lib/db/schema.ts')) continue;
		out.push(path);
	}
	return out;
}

const FILES = sourceFiles(SRC_DIR).map((path) => ({
	relative: path.slice(SRC_DIR.length).replace(/\\/g, '/'),
	source: readFileSync(path, 'utf8')
}));

describe('readsRawDataType', () => {
	it('finner rå SQL', () => {
		expect(readsRawDataType(`WHERE data_type = 'workout'`, 'workout')).toBe(true);
		expect(readsRawDataType(`WHERE data_type='workout'`, 'workout')).toBe(true);
		expect(readsRawDataType(`WHERE data_type IN ('workout', 'strength_workout')`, 'workout')).toBe(true);
	});

	it('finner query-builderen', () => {
		expect(readsRawDataType(`eq(sensorEvents.dataType, 'workout')`, 'workout')).toBe(true);
		expect(readsRawDataType(`inArray(sensorEvents.dataType, ['workout', 'strength_workout'])`, 'workout')).toBe(true);
	});

	it('treffer ikke skriving', () => {
		// En sensor som skriver sin egen rad har ingen sammenslåing å gjøre
		expect(readsRawDataType(`{ dataType: 'workout', timestamp }`, 'workout')).toBe(false);
	});

	it('skiller mellom datatyper', () => {
		expect(readsRawDataType(`data_type = 'sleep'`, 'workout')).toBe(false);
		expect(readsRawDataType(`data_type = 'sleep_disturbance'`, 'sleep')).toBe(false);
		expect(readsRawDataType(`dataType, 'weight'`, 'weight')).toBe(true);
	});
});

describe.each(GUARDED_DATA_TYPES)('rå lesing av $dataType', (guarded) => {
	const readers = FILES.filter((file) => readsRawDataType(file.source, guarded.dataType)).map(
		(file) => file.relative
	);
	const allowed = new Set(guarded.knownRawReaders);

	it('ingen nye filer leser rått', () => {
		const unlisted = readers.filter((relative) => !allowed.has(relative)).sort();

		expect(
			unlisted,
			unlisted.length === 0
				? ''
				: [
					``,
					`Nye filer leser sensor_events med data_type = '${guarded.dataType}' direkte:`,
					...unlisted.map((f) => `  · src/${f}`),
					``,
					`Bruk i stedet: ${guarded.use}`,
					`Hvorfor: ${guarded.why}`,
					``,
					`Er rå lesing riktig her likevel (én rad på id, en skrivesti, eller`,
					`per-kilde-visning), legg fila i knownRawReaders i sensor-event-access.ts`,
					`med en kommentar som sier hvorfor.`,
					``
				].join('\n')
		).toEqual([]);
	});

	it('lista inneholder ingen filer som ikke lenger leser rått', () => {
		const found = new Set(readers);
		const stale = guarded.knownRawReaders.filter((relative) => !found.has(relative)).sort();

		// Skrallen skal krympe: er en fil ryddet opp eller slettet, ut av lista
		expect(
			stale,
			stale.length === 0
				? ''
				: [
					``,
					`Disse står i knownRawReaders for '${guarded.dataType}', men leser ikke rått lenger:`,
					...stale.map((f) => `  · src/${f}`),
					``,
					`Fjern dem fra lista i sensor-event-access.ts.`,
					``
				].join('\n')
		).toEqual([]);
	});
});
