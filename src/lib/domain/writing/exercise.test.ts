import { describe, it, expect } from 'vitest';
import {
	decideWritingNudge,
	describeStreak,
	EARLIEST_HOUR,
	FREE_EXERCISES,
	LATEST_HOUR,
	MAX_PROJECT_RUN,
	writingStreakDays,
	type NudgeProject,
	type WritingNudgeInput
} from './exercise';

const project: NudgeProject = {
	id: 'p1',
	title: 'Vinterlys',
	characters: ['Ida'],
	places: ['Kaia'],
	openParts: ['Middagen'],
	emptyParts: ['Hjemkomst']
};

const input = (overrides: Partial<WritingNudgeInput> = {}): WritingNudgeInput => ({
	osloHour: 20,
	wroteToday: false,
	activeProject: project,
	recentKinds: [],
	streakDays: 0,
	seed: 0,
	...overrides
});

describe('gating', () => {
	it('holder kjeft utenfor kveldsvinduet', () => {
		expect(decideWritingNudge(input({ osloHour: EARLIEST_HOUR - 1 }))).toBeNull();
		expect(decideWritingNudge(input({ osloHour: LATEST_HOUR + 1 }))).toBeNull();
	});

	it('fyrer i vinduet', () => {
		expect(decideWritingNudge(input({ osloHour: EARLIEST_HOUR }))).not.toBeNull();
		expect(decideWritingNudge(input({ osloHour: LATEST_HOUR }))).not.toBeNull();
	});

	it('sier ingenting når dagens skriving alt er gjort', () => {
		expect(decideWritingNudge(input({ wroteToday: true }))).toBeNull();
	});
});

describe('prosjektbundet øvelse', () => {
	it('velges når prosjektet har materiale', () => {
		const nudge = decideWritingNudge(input());
		expect(nudge?.kind).toBe('prosjekt');
		expect(nudge?.projectId).toBe('p1');
		expect(nudge?.headline).toContain('Vinterlys');
	});

	it('fyller inn brukerens eget materiale', () => {
		const nudge = decideWritingNudge(input());
		expect(nudge?.exercise).toMatch(/Ida|Kaia|Middagen|Hjemkomst/);
	});

	it('lar aldri en plassholder stå igjen i teksten', () => {
		// Et prosjekt uten karakterer må ikke gi «skriv 200 ord der {karakter} lyver».
		for (let seed = 0; seed < 20; seed++) {
			const tynt: NudgeProject = {
				id: 'p2',
				title: 'Tynt',
				characters: [],
				places: [],
				openParts: ['Kapittel 1'],
				emptyParts: []
			};
			const nudge = decideWritingNudge(input({ activeProject: tynt, seed }));
			expect(nudge?.exercise).not.toMatch(/\{[a-zæøå]+\}/i);
		}
	});

	it('faller til fri øvelse når prosjektet er helt tomt', () => {
		const tomt: NudgeProject = {
			id: 'p3',
			title: 'Tomt',
			characters: [],
			places: [],
			openParts: [],
			emptyParts: []
		};
		const nudge = decideWritingNudge(input({ activeProject: tomt }));
		expect(nudge?.kind).toBe('fri');
	});

	it('er deterministisk for samme seed', () => {
		expect(decideWritingNudge(input({ seed: 7 }))?.exercise).toBe(
			decideWritingNudge(input({ seed: 7 }))?.exercise
		);
	});
});

describe('variasjon', () => {
	it('tvinger fri øvelse etter for mange prosjektbundne på rad', () => {
		const recentKinds = Array<'prosjekt'>(MAX_PROJECT_RUN).fill('prosjekt');
		expect(decideWritingNudge(input({ recentKinds }))?.kind).toBe('fri');
	});

	it('teller bare den ledende serien, ikke alle forekomster', () => {
		// En fri øvelse i mellomtiden nullstiller serien.
		const recentKinds: Array<'prosjekt' | 'fri'> = ['prosjekt', 'fri', 'prosjekt', 'prosjekt', 'prosjekt'];
		expect(decideWritingNudge(input({ recentKinds }))?.kind).toBe('prosjekt');
	});

	it('velger fri når det ikke finnes prosjekt', () => {
		const nudge = decideWritingNudge(input({ activeProject: null }));
		expect(nudge?.kind).toBe('fri');
		expect(nudge?.projectId).toBeNull();
		expect(FREE_EXERCISES.map((e) => e.text)).toContain(nudge?.exercise);
	});
});

describe('describeStreak', () => {
	it('sier noe sant på dag null framfor å tie', () => {
		expect(describeStreak(0)).toContain('Én kveld er nok');
		expect(describeStreak(-1)).toContain('Én kveld er nok');
	});

	it('bøyer entall og flertall', () => {
		expect(describeStreak(1)).toContain('i går');
		expect(describeStreak(4)).toBe('4 dager på rad.');
	});
});

describe('writingStreakDays', () => {
	it('teller sammenhengende dager bakover', () => {
		expect(writingStreakDays(['2026-08-05', '2026-08-06', '2026-08-07'], '2026-08-07')).toBe(3);
	});

	it('lar i dag være uskrevet uten å bryte streaken — kvelden er ikke over', () => {
		expect(writingStreakDays(['2026-08-05', '2026-08-06'], '2026-08-07')).toBe(2);
	});

	it('bryter på et hull', () => {
		expect(writingStreakDays(['2026-08-01', '2026-08-06'], '2026-08-07')).toBe(1);
	});

	it('er 0 uten historikk', () => {
		expect(writingStreakDays([], '2026-08-07')).toBe(0);
	});

	it('tåler duplikater samme dag', () => {
		expect(writingStreakDays(['2026-08-06', '2026-08-06', '2026-08-07'], '2026-08-07')).toBe(2);
	});

	it('krysser månedsskifte', () => {
		expect(writingStreakDays(['2026-07-31', '2026-08-01'], '2026-08-01')).toBe(2);
	});

	it('krysser årsskifte', () => {
		expect(writingStreakDays(['2025-12-31', '2026-01-01'], '2026-01-01')).toBe(2);
	});
});
