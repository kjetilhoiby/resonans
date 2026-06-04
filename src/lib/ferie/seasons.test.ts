import { describe, it, expect } from 'vitest';
import {
	easterSunday,
	ferieWindow,
	nextOccurrence,
	classifyDate,
	nextUnplannedFerie,
	occurrenceId,
	seasonFromThemeName,
	toISODate
} from './seasons';

const D = (iso: string) => new Date(iso + 'T12:00:00Z');

describe('seasonFromThemeName', () => {
	it('utleder sesong + vindu fra «Sommerferie 2026»', () => {
		const occ = seasonFromThemeName('Sommerferie 2026');
		expect(occ?.key).toBe('sommerferie');
		expect(occ?.year).toBe(2026);
		expect(toISODate(occ!.start)).toBe('2026-06-20');
		expect(toISODate(occ!.end)).toBe('2026-08-17');
	});

	it('håndterer andre sesonger (case-insensitivt)', () => {
		expect(seasonFromThemeName('høstferie 2025')?.key).toBe('hostferie');
		expect(seasonFromThemeName('Juleferie 2024')?.key).toBe('juleferie');
	});

	it('returnerer null for navn uten gjenkjennelig sesong/år', () => {
		expect(seasonFromThemeName('Familie')).toBeNull();
		expect(seasonFromThemeName('Ferie til Italia')).toBeNull();
		expect(seasonFromThemeName('Sommerferie')).toBeNull();
	});
});

describe('easterSunday', () => {
	it('beregner kjente påskedager', () => {
		expect(toISODate(easterSunday(2025))).toBe('2025-04-20');
		expect(toISODate(easterSunday(2026))).toBe('2026-04-05');
		expect(toISODate(easterSunday(2024))).toBe('2024-03-31');
	});
});

describe('ferieWindow', () => {
	it('utleder påskeferie fra påskedag (mandag i stille uke → 2. påskedag)', () => {
		const w = ferieWindow('paaskeferie', 2026); // påske 5. april
		expect(toISODate(w.start)).toBe('2026-03-30');
		expect(toISODate(w.end)).toBe('2026-04-06');
	});
	it('juleferie krysser årsskiftet', () => {
		const w = ferieWindow('juleferie', 2026);
		expect(toISODate(w.start)).toBe('2026-12-20');
		expect(toISODate(w.end)).toBe('2027-01-02');
	});
});

describe('nextOccurrence', () => {
	it('ruller til neste år når ferien har startet', () => {
		// 1. juli 2026 — sommerferien er i gang → neste sommerferie er 2027
		const occ = nextOccurrence('sommerferie', D('2026-07-01'));
		expect(occ.year).toBe(2027);
	});
	it('gir inneværende år når ferien er fram i tid', () => {
		const occ = nextOccurrence('sommerferie', D('2026-03-15'));
		expect(occ.year).toBe(2026);
	});
});

describe('classifyDate', () => {
	it('matcher en startdato til riktig sesong og år', () => {
		expect(classifyDate('2026-06-25')).toEqual({ key: 'sommerferie', year: 2026 });
		expect(classifyDate('2026-10-02')).toEqual({ key: 'hostferie', year: 2026 });
		expect(classifyDate('2026-12-23')).toEqual({ key: 'juleferie', year: 2026 });
		expect(classifyDate('2026-04-01')).toEqual({ key: 'paaskeferie', year: 2026 });
	});
	it('returnerer null for datoer utenfor enhver ferie', () => {
		expect(classifyDate('2026-09-15')).toBeNull();
	});
});

describe('nextUnplannedFerie', () => {
	it('viser nærmeste kommende ferie med åpent vindu', () => {
		// 10. februar: vinterferie (~17. feb) er nærmest og vinduet åpnet 5. jan
		const occ = nextUnplannedFerie(D('2026-02-10'), new Set());
		expect(occ?.key).toBe('vinterferie');
		expect(occ?.year).toBe(2026);
	});
	it('går videre til sommerferie når påsken er passert', () => {
		// 15. april: påske 2026 (~5. apr) er passert, sommer-vinduet åpnet 1. mars
		const occ = nextUnplannedFerie(D('2026-04-15'), new Set());
		expect(occ?.key).toBe('sommerferie');
		expect(occ?.year).toBe(2026);
	});
	it('skjuler ferie før planleggingsvinduet har åpnet', () => {
		// 2. januar: vinter åpner først 5. jan, alt annet senere → ingen knapp
		expect(nextUnplannedFerie(D('2026-01-02'), new Set())).toBeNull();
	});
	it('hopper over en ferie som allerede har en plan', () => {
		const planned = new Set([occurrenceId('sommerferie', 2026)]);
		// 15. april med sommer planlagt → ingen andre åpne uplanlagte ennå
		expect(nextUnplannedFerie(D('2026-04-15'), planned)).toBeNull();
	});
});
