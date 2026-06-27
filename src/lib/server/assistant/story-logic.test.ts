import { describe, it, expect } from 'vitest';
import {
	projectStoryBoard,
	toStorySessionState,
	mergeWorld,
	coerceWorld,
	coerceChoices,
	normalizeBlanksTotal,
	allBlanksFilled,
	type StorySessionState
} from './story-logic';

/** Liten fabrikk for en branching-tilstand med fornuftige defaults. */
function branching(overrides: Partial<StorySessionState> = {}): StorySessionState {
	return {
		kind: 'branching',
		title: 'Den mørke skogen',
		theme: 'skrekk',
		currentPlayer: 'Erle',
		active: true,
		ended: false,
		story: null,
		phase: 'adventure',
		world: [{ label: 'Univers', value: 'Stjerneskogen' }],
		passage: 'Du står ved en gaffel i stien.',
		choices: [
			{ id: 'a', label: 'Følg lyden av vann' },
			{ id: 'b', label: 'Gå mot vinden' }
		],
		lastChoice: 'Åpne kista',
		step: 3,
		request: null,
		blanksFilled: 0,
		blanksTotal: 0,
		filled: [],
		...overrides
	};
}

/** Liten fabrikk for en madlib-tilstand. */
function madlib(overrides: Partial<StorySessionState> = {}): StorySessionState {
	return {
		kind: 'madlib',
		title: null,
		theme: 'tull',
		currentPlayer: null,
		active: true,
		ended: false,
		story: null,
		phase: null,
		world: [],
		passage: null,
		choices: [],
		lastChoice: null,
		step: 0,
		request: 'et adjektiv',
		blanksFilled: 2,
		blanksTotal: 6,
		filled: [
			{ slot: 'et adjektiv', word: 'klissete' },
			{ slot: 'et dyr', word: 'elg' }
		],
		...overrides
	};
}

describe('projectStoryBoard – branching', () => {
	it('viser passage, world, choices og step under spill', () => {
		const board = projectStoryBoard(branching());
		expect(board.kind).toBe('branching');
		expect(board.passage).toBe('Du står ved en gaffel i stien.');
		expect(board.world).toHaveLength(1);
		expect(board.choices).toHaveLength(2);
		expect(board.step).toBe(3);
		// madlib-felt er nullet/tomme for branching
		expect(board.request).toBeNull();
		expect(board.blanksTotal).toBe(0);
		expect(board.filled).toEqual([]);
	});

	it('skjuler story til ended === true', () => {
		const skjult = projectStoryBoard(branching({ story: 'HELE EVENTYRET' }));
		expect(skjult.story).toBeNull();

		const avslørt = projectStoryBoard(branching({ ended: true, story: 'HELE EVENTYRET' }));
		expect(avslørt.story).toBe('HELE EVENTYRET');
	});

	it('tømmer choices når fortellingen er avsluttet', () => {
		const board = projectStoryBoard(branching({ ended: true, story: 'slutt' }));
		expect(board.choices).toEqual([]);
	});
});

describe('projectStoryBoard – madlib', () => {
	it('viser request, blanks og filled, og nuller branching-felt', () => {
		const board = projectStoryBoard(madlib());
		expect(board.kind).toBe('madlib');
		expect(board.request).toBe('et adjektiv');
		expect(board.blanksFilled).toBe(2);
		expect(board.blanksTotal).toBe(6);
		expect(board.filled).toHaveLength(2);
		// branching-felt er nullet/tomme for madlib
		expect(board.phase).toBeNull();
		expect(board.world).toEqual([]);
		expect(board.passage).toBeNull();
		expect(board.step).toBe(0);
	});

	it('skjuler request når fortellingen er avsluttet, og avslører story', () => {
		const board = projectStoryBoard(madlib({ ended: true, story: 'tulletekst', request: 'et dyr' }));
		expect(board.request).toBeNull();
		expect(board.story).toBe('tulletekst');
	});
});

describe('mergeWorld', () => {
	it('legger til nye fakta bakerst', () => {
		const merged = mergeWorld(
			[{ label: 'Univers', value: 'Stjerneskogen' }],
			[{ label: 'Helter', value: 'Erle og pappa' }]
		);
		expect(merged).toEqual([
			{ label: 'Univers', value: 'Stjerneskogen' },
			{ label: 'Helter', value: 'Erle og pappa' }
		]);
	});

	it('oppdaterer på plass når label finnes (case-insensitivt)', () => {
		const merged = mergeWorld(
			[{ label: 'Oppdrag', value: 'Finne nøkkelen' }],
			[{ label: 'oppdrag', value: 'Vinne Mesterskapet' }]
		);
		expect(merged).toEqual([{ label: 'oppdrag', value: 'Vinne Mesterskapet' }]);
	});

	it('hopper over poster uten label eller value', () => {
		const merged = mergeWorld([], [{ label: 'Tom', value: '' }, { label: '', value: 'x' }]);
		expect(merged).toEqual([]);
	});
});

describe('coerceChoices', () => {
	it('trimmer, dropper ufullstendige og kutter til to', () => {
		const choices = coerceChoices([
			{ id: ' a ', label: ' Følg vann ' },
			{ id: 'b', label: 'Gå mot vinden' },
			{ id: 'c', label: 'For mange valg' }
		]);
		expect(choices).toEqual([
			{ id: 'a', label: 'Følg vann' },
			{ id: 'b', label: 'Gå mot vinden' }
		]);
	});

	it('deduper på id', () => {
		const choices = coerceChoices([
			{ id: 'a', label: 'Første' },
			{ id: 'a', label: 'Duplikat' }
		]);
		expect(choices).toHaveLength(1);
	});

	it('returnerer tom liste for ugyldig input', () => {
		expect(coerceChoices(null)).toEqual([]);
		expect(coerceChoices('nei')).toEqual([]);
	});
});

describe('coerceWorld', () => {
	it('beholder gyldige fakta og dropper ufullstendige', () => {
		const world = coerceWorld([
			{ label: 'Univers', value: 'Stjerneskogen' },
			{ label: 'Tom', value: '' },
			'søppel'
		]);
		expect(world).toEqual([{ label: 'Univers', value: 'Stjerneskogen' }]);
	});
});

describe('normalizeBlanksTotal', () => {
	it('faller tilbake på 6 for ugyldige verdier', () => {
		expect(normalizeBlanksTotal(undefined)).toBe(6);
		expect(normalizeBlanksTotal('mye')).toBe(6);
		expect(normalizeBlanksTotal(NaN)).toBe(6);
	});

	it('runder og klemmer til intervallet 1–20', () => {
		expect(normalizeBlanksTotal(0)).toBe(1);
		expect(normalizeBlanksTotal(6.4)).toBe(6);
		expect(normalizeBlanksTotal(99)).toBe(20);
	});
});

describe('allBlanksFilled', () => {
	it('er sant først når alle ord er samlet', () => {
		expect(allBlanksFilled(2, 6)).toBe(false);
		expect(allBlanksFilled(6, 6)).toBe(true);
		expect(allBlanksFilled(0, 0)).toBe(false); // ingen blanks definert ennå
	});
});

describe('toStorySessionState', () => {
	it('normaliserer ukjent kind til branching og null-jsonb til tomme lister', () => {
		const state = toStorySessionState({
			kind: 'noe-rart',
			title: null,
			theme: null,
			currentPlayer: null,
			active: true,
			ended: false,
			story: null,
			phase: 'ugyldig',
			world: null,
			passage: null,
			choices: null,
			lastChoice: null,
			step: 0,
			request: null,
			blanksFilled: 0,
			blanksTotal: 0,
			filled: null
		});
		expect(state.kind).toBe('branching');
		expect(state.phase).toBeNull();
		expect(state.world).toEqual([]);
		expect(state.choices).toEqual([]);
		expect(state.filled).toEqual([]);
	});
});
