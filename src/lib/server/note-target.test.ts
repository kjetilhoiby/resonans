import { describe, it, expect } from 'vitest';
import { resolveNoteTarget, appendDiaryNote, type NoteTargetTheme } from './note-target';

const reise = (id: string, name: string, startDate: string, endDate: string): NoteTargetTheme => ({
	id,
	name,
	tripProfile: { startDate, endDate }
});

const ferie = (
	id: string,
	name: string,
	startDate: string,
	endDate: string,
	trips: Array<{ linkedThemeId?: string; startDate?: string; endDate?: string }> = []
): NoteTargetTheme => ({
	id,
	name,
	ferieProfile: { startDate, endDate, trips }
});

describe('resolveNoteTarget', () => {
	it('gir null uten pågående reise eller ferie', () => {
		const themes = [
			reise('t1', 'Hyttetur', '2026-07-20', '2026-07-22'),
			ferie('f1', 'Sommerferie', '2026-08-01', '2026-08-14')
		];
		expect(resolveNoteTarget(themes, '2026-07-14')).toBeNull();
	});

	it('velger reisen når dens vindu dekker datoen', () => {
		const themes = [reise('t1', 'Hyttetur', '2026-07-13', '2026-07-15')];
		expect(resolveNoteTarget(themes, '2026-07-14')).toEqual({
			themeId: 't1',
			themeName: 'Hyttetur'
		});
	});

	it('velger ferie-forelderen når reisen arver dagbok fra en ferie', () => {
		const themes = [
			reise('t1', 'Kroatia-tur', '2026-07-13', '2026-07-15'),
			ferie('f1', 'Sommerferie', '2026-07-01', '2026-07-31', [
				{ linkedThemeId: 't1', startDate: '2026-07-13', endDate: '2026-07-15' }
			])
		];
		expect(resolveNoteTarget(themes, '2026-07-14')).toEqual({
			themeId: 'f1',
			themeName: 'Sommerferie'
		});
	});

	it('velger smaleste reisevindu ved overlapp', () => {
		const themes = [
			reise('bred', 'Roadtrip Europa', '2026-07-01', '2026-07-31'),
			reise('smal', 'Stopp i Praha', '2026-07-13', '2026-07-15')
		];
		expect(resolveNoteTarget(themes, '2026-07-14')?.themeId).toBe('smal');
	});

	it('faller tilbake på pågående ferie uten aktiv reise', () => {
		const themes = [
			reise('t1', 'Hyttetur', '2026-07-20', '2026-07-22'),
			ferie('f1', 'Sommerferie', '2026-07-01', '2026-07-31')
		];
		expect(resolveNoteTarget(themes, '2026-07-14')).toEqual({
			themeId: 'f1',
			themeName: 'Sommerferie'
		});
	});

	it('ignorerer temaer som ikke er ferie selv med aktivt vindu', () => {
		const themes: NoteTargetTheme[] = [
			{ id: 'x1', name: 'Økonomi', ferieProfile: { startDate: '2026-07-01', endDate: '2026-07-31' } }
		];
		expect(resolveNoteTarget(themes, '2026-07-14')).toBeNull();
	});
});

describe('appendDiaryNote', () => {
	it('bruker notatet direkte når dagen er tom', () => {
		expect(appendDiaryNote('', 'Så en elg ved veien.')).toBe('Så en elg ved veien.');
		expect(appendDiaryNote(null, ' Så en elg. ')).toBe('Så en elg.');
	});

	it('føyer notatet til som eget avsnitt uten å røre eksisterende tekst', () => {
		expect(appendDiaryNote('Kjørte til Åndalsnes.', 'Så en elg ved veien.')).toBe(
			'Kjørte til Åndalsnes.\n\nSå en elg ved veien.'
		);
	});
});
