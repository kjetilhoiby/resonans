import { describe, it, expect } from 'vitest';
import {
	findParentFerieLink,
	isWithinWindow,
	mergeDiaryDay,
	mergeInheritedDiary,
	type DiaryThemeLike,
	type DiaryEntryFields
} from './trip-diary-inherit';

const ferie: DiaryThemeLike = {
	id: 'ferie-1',
	name: 'Sommerferie 2026',
	ferieProfile: {
		trips: [
			{ linkedThemeId: 'reise-1', startDate: '2026-06-28', endDate: '2026-07-03' },
			{ startDate: '2026-07-10', endDate: '2026-07-12' }
		]
	}
};

const reise: DiaryThemeLike = {
	id: 'reise-1',
	name: 'Resdalen (reise)',
	tripProfile: { startDate: '2026-06-28', endDate: '2026-07-03' }
};

function entry(date: string, fields: Partial<DiaryEntryFields> = {}): DiaryEntryFields {
	return { date, content: '', ...fields };
}

describe('findParentFerieLink', () => {
	it('finner ferie-temaet via linkedThemeId i reiseblokkene', () => {
		const link = findParentFerieLink([ferie, reise], 'reise-1');
		expect(link?.parent.id).toBe('ferie-1');
		expect(link?.window).toEqual({ startDate: '2026-06-28', endDate: '2026-07-03' });
	});

	it('returnerer null når ingen ferie peker på reisen', () => {
		expect(findParentFerieLink([ferie, reise], 'reise-ukjent')).toBeNull();
	});

	it('bruker reiseblokkas datoer når reisen mangler tripProfile-vindu', () => {
		const utenVindu: DiaryThemeLike = { id: 'reise-1', name: 'Resdalen (reise)' };
		const link = findParentFerieLink([ferie, utenVindu], 'reise-1');
		expect(link?.window).toEqual({ startDate: '2026-06-28', endDate: '2026-07-03' });
	});

	it('returnerer null når verken reise eller reiseblokk har vindu', () => {
		const ferieUtenDatoer: DiaryThemeLike = {
			id: 'ferie-1',
			name: 'Ferie',
			ferieProfile: { trips: [{ linkedThemeId: 'reise-1' }] }
		};
		const utenVindu: DiaryThemeLike = { id: 'reise-1', name: 'Reise' };
		expect(findParentFerieLink([ferieUtenDatoer, utenVindu], 'reise-1')).toBeNull();
	});

	it('kobler ikke et tema til seg selv', () => {
		const sirkulær: DiaryThemeLike = {
			id: 'tema-1',
			name: 'Rar',
			tripProfile: { startDate: '2026-01-01', endDate: '2026-01-02' },
			ferieProfile: { trips: [{ linkedThemeId: 'tema-1' }] }
		};
		expect(findParentFerieLink([sirkulær], 'tema-1')).toBeNull();
	});
});

describe('isWithinWindow', () => {
	it('er inklusiv i begge ender', () => {
		const w = { startDate: '2026-06-28', endDate: '2026-07-03' };
		expect(isWithinWindow('2026-06-28', w)).toBe(true);
		expect(isWithinWindow('2026-07-03', w)).toBe(true);
		expect(isWithinWindow('2026-06-27', w)).toBe(false);
		expect(isWithinWindow('2026-07-04', w)).toBe(false);
	});

	it('er falsk uten komplett vindu', () => {
		expect(isWithinWindow('2026-06-28', { startDate: '2026-06-28' })).toBe(false);
	});
});

describe('mergeDiaryDay', () => {
	it('viser ferie-tekst når reisen bare har Ekko-seedet sted', () => {
		const merged = mergeDiaryDay(
			entry('2026-06-29', { content: 'Bading i Resdalen' }),
			entry('2026-06-29', { place: 'Rindal', weather: { emoji: '☀️' } })
		);
		expect(merged).toEqual({
			date: '2026-06-29',
			content: 'Bading i Resdalen',
			place: 'Rindal',
			weather: { emoji: '☀️' },
			images: undefined,
			geo: undefined,
			inherited: true
		});
	});

	it('lar ferien vinne felt-for-felt ved konflikt', () => {
		const merged = mergeDiaryDay(
			entry('2026-06-29', { content: 'Ferie-tekst', place: 'Resdalen', images: ['a.jpg'] }),
			entry('2026-06-29', { content: 'Reise-tekst', place: 'Rindal', images: ['b.jpg'] })
		);
		expect(merged?.content).toBe('Ferie-tekst');
		expect(merged?.place).toBe('Resdalen');
		expect(merged?.images).toEqual(['a.jpg']);
	});

	it('beholder reisens eget notat når ferien mangler dagen', () => {
		const own = entry('2026-06-30', { content: 'Bare i reisedagboka' });
		expect(mergeDiaryDay(undefined, own)).toEqual(own);
		expect(mergeDiaryDay(undefined, own)?.inherited).toBeUndefined();
	});
});

describe('mergeInheritedDiary', () => {
	const window = { startDate: '2026-06-28', endDate: '2026-07-03' };

	it('arver ferie-notater innenfor vinduet og sorterer på dato', () => {
		const merged = mergeInheritedDiary(
			[entry('2026-06-30', { content: 'Egen dag' })],
			[
				entry('2026-06-29', { content: 'Ferie-dag' }),
				entry('2026-06-28', { content: 'Ankomst' })
			],
			window
		);
		expect(merged.map((e) => e.date)).toEqual(['2026-06-28', '2026-06-29', '2026-06-30']);
		expect(merged[0].inherited).toBe(true);
		expect(merged[2].inherited).toBeUndefined();
	});

	it('arver ikke ferie-notater utenfor reisevinduet', () => {
		const merged = mergeInheritedDiary(
			[],
			[entry('2026-07-05', { content: 'Etter reisa' }), entry('2026-07-01', { content: 'På reisa' })],
			window
		);
		expect(merged.map((e) => e.date)).toEqual(['2026-07-01']);
	});

	it('fletter samme dag felt-for-felt', () => {
		const merged = mergeInheritedDiary(
			[entry('2026-06-29', { place: 'Rindal' })],
			[entry('2026-06-29', { content: 'Bading' })],
			window
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].content).toBe('Bading');
		expect(merged[0].place).toBe('Rindal');
	});
});
