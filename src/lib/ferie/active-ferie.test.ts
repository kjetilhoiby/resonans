import { describe, it, expect } from 'vitest';
import {
	isFerieActiveOn,
	ferieOverlaps,
	activeFerieThemes,
	tripPhase,
	formatTripDates,
	buildFerieContextBlock,
	makeParticipantResolver,
	FERIE_FALLBACK_EMOJI
} from './active-ferie';

describe('isFerieActiveOn', () => {
	const vindu = { startDate: '2026-07-01', endDate: '2026-07-14' };

	it('er sann på første og siste dag (inklusiv)', () => {
		expect(isFerieActiveOn(vindu, '2026-07-01')).toBe(true);
		expect(isFerieActiveOn(vindu, '2026-07-14')).toBe(true);
	});

	it('er sann midt i vinduet', () => {
		expect(isFerieActiveOn(vindu, '2026-07-08')).toBe(true);
	});

	it('er usann før og etter vinduet', () => {
		expect(isFerieActiveOn(vindu, '2026-06-30')).toBe(false);
		expect(isFerieActiveOn(vindu, '2026-07-15')).toBe(false);
	});

	it('er usann når datoer mangler', () => {
		expect(isFerieActiveOn(null, '2026-07-08')).toBe(false);
		expect(isFerieActiveOn({ startDate: '2026-07-01' }, '2026-07-08')).toBe(false);
		expect(isFerieActiveOn({}, '2026-07-08')).toBe(false);
	});
});

describe('ferieOverlaps', () => {
	const vindu = { startDate: '2026-07-06', endDate: '2026-07-12' };

	it('overlapper når uka inneholder vinduet helt eller delvis', () => {
		expect(ferieOverlaps(vindu, '2026-07-06', '2026-07-12')).toBe(true); // samme uke
		expect(ferieOverlaps(vindu, '2026-07-01', '2026-07-07')).toBe(true); // delvis start
		expect(ferieOverlaps(vindu, '2026-07-12', '2026-07-18')).toBe(true); // delvis slutt
	});

	it('overlapper ikke uker før eller etter', () => {
		expect(ferieOverlaps(vindu, '2026-06-29', '2026-07-05')).toBe(false);
		expect(ferieOverlaps(vindu, '2026-07-13', '2026-07-19')).toBe(false);
	});

	it('er usann når datoer mangler', () => {
		expect(ferieOverlaps(null, '2026-07-06', '2026-07-12')).toBe(false);
	});
});

describe('activeFerieThemes', () => {
	const sommerferie = {
		id: 't1',
		name: 'Sommerferie',
		emoji: '☀️',
		ferieProfile: { startDate: '2026-07-01', endDate: '2026-07-14' }
	};
	const helse = {
		id: 't2',
		name: 'Helse',
		emoji: '💪',
		ferieProfile: { startDate: '2026-07-01', endDate: '2026-07-14' }
	};
	const planlagtFerie = {
		id: 't3',
		name: 'Høstferie',
		emoji: null,
		ferieProfile: { startDate: '2026-10-01', endDate: '2026-10-07' }
	};

	it('plukker bare ferie-temaer med overlappende vindu', () => {
		const aktive = activeFerieThemes([sommerferie, helse, planlagtFerie], '2026-07-08', '2026-07-08');
		expect(aktive.map((f) => f.id)).toEqual(['t1']);
	});

	it('utelukker ikke-ferie-temaer selv om vinduet overlapper', () => {
		// Helse har et ferieProfile-vindu, men er ikke et ferie-tema → skal ikke med.
		const aktive = activeFerieThemes([helse], '2026-07-08', '2026-07-08');
		expect(aktive).toHaveLength(0);
	});

	it('bruker fallback-emoji når temaet mangler emoji', () => {
		const aktive = activeFerieThemes([planlagtFerie], '2026-10-03', '2026-10-03');
		expect(aktive[0].emoji).toBe(FERIE_FALLBACK_EMOJI);
	});

	it('returnerer vinduet for dag-merking', () => {
		const aktive = activeFerieThemes([sommerferie], '2026-07-08', '2026-07-08');
		expect(aktive[0]).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-14' });
	});
});

describe('tripPhase', () => {
	const today = '2026-07-08';
	it('klassifiserer pågående, kommende og passerte reiser', () => {
		expect(tripPhase({ label: 'Hytta', startDate: '2026-07-07', endDate: '2026-07-09' }, today)).toBe('ongoing');
		expect(tripPhase({ label: 'Volda', startDate: '2026-07-10', endDate: '2026-07-14' }, today)).toBe('upcoming');
		expect(tripPhase({ label: 'Bestemor', startDate: '2026-07-01', endDate: '2026-07-03' }, today)).toBe('past');
		expect(tripPhase({ label: 'Udatert' }, today)).toBe('undated');
	});
	it('en-dags reise på dagens dato er pågående', () => {
		expect(tripPhase({ label: 'Tur', startDate: today, endDate: today }, today)).toBe('ongoing');
	});
});

describe('formatTripDates', () => {
	it('formaterer intervall og enkeltdag', () => {
		expect(formatTripDates({ label: 'x', startDate: '2026-07-05', endDate: '2026-07-07' })).toBe('5. juli–7. juli');
		expect(formatTripDates({ label: 'x', startDate: '2026-07-05', endDate: '2026-07-05' })).toBe('5. juli');
		expect(formatTripDates({ label: 'x', startDate: '2026-07-05' })).toBe('fra 5. juli');
	});
});

describe('buildFerieContextBlock', () => {
	const themes = [
		{
			name: 'Sommerferie',
			ferieProfile: {
				startDate: '2026-07-01',
				endDate: '2026-07-20',
				note: 'Volda med Marte og David.',
				trips: [
					{ label: 'Hytta', participants: ['Kjetil', 'Nils', 'Erle'], startDate: '2026-07-07', endDate: '2026-07-09' },
					{ label: 'Volda', place: 'Sunnmøre', participants: ['Anita', 'Erle', 'Iver', 'Nils'], startDate: '2026-07-10', endDate: '2026-07-14' },
					{ label: 'Passert', startDate: '2026-07-01', endDate: '2026-07-02' }
				]
			}
		},
		{ name: 'Helse', ferieProfile: { startDate: '2026-07-01', endDate: '2026-07-20' } }
	];

	it('tar med pågående og kommende reiser, men ikke passerte', () => {
		const block = buildFerieContextBlock(themes, '2026-07-08');
		expect(block).toContain('Pågående ferie: «Sommerferie»');
		expect(block).toContain('Volda med Marte og David.');
		expect(block).toContain('Reiser som pågår nå:');
		expect(block).toContain('Hytta – Kjetil, Nils, Erle');
		expect(block).toContain('Kommende reiser:');
		expect(block).toContain('Volda (Sunnmøre) – Anita, Erle, Iver, Nils');
		expect(block).not.toContain('Passert');
	});

	it('gir tom streng når ingen ferie er aktiv i dag', () => {
		expect(buildFerieContextBlock(themes, '2026-08-01')).toBe('');
	});

	it('ignorerer ikke-ferie-temaer selv med ferieProfile', () => {
		const block = buildFerieContextBlock([{ name: 'Helse', ferieProfile: { startDate: '2026-07-01', endDate: '2026-07-20', trips: [] } }], '2026-07-08');
		expect(block).toBe('');
	});

	it('kanoniserer kjente deltakere og flagger ukjente via resolver', () => {
		const resolve = makeParticipantResolver([
			{ name: 'Kjetil', nickname: null, aliases: [] },
			{ name: 'Nils', nickname: null, aliases: ['Nisse'] },
			{ name: 'Erle', nickname: null, aliases: [] }
		]);
		const themesWithGuest = [
			{
				name: 'Sommerferie',
				ferieProfile: {
					startDate: '2026-07-01',
					endDate: '2026-07-20',
					trips: [
						{ label: 'Hytta', participants: ['kjetil', 'Nisse', 'Marte'], startDate: '2026-07-07', endDate: '2026-07-09' }
					]
				}
			}
		];
		const block = buildFerieContextBlock(themesWithGuest, '2026-07-08', resolve);
		// «kjetil» → «Kjetil», alias «Nisse» → «Nils», «Marte» ukjent
		expect(block).toContain('Hytta – Kjetil, Nils, Marte (ukjent)');
	});
});

describe('makeParticipantResolver', () => {
	const resolve = makeParticipantResolver([
		{ name: 'Anita', nickname: 'Nita', aliases: ['Mamma'] }
	]);
	it('matcher på navn, nickname og alias (case-insensitivt)', () => {
		expect(resolve('anita')).toEqual({ name: 'Anita', known: true });
		expect(resolve('Nita')).toEqual({ name: 'Anita', known: true });
		expect(resolve('mamma')).toEqual({ name: 'Anita', known: true });
	});
	it('flagger ukjente navn', () => {
		expect(resolve('David')).toEqual({ name: 'David', known: false });
	});
});
