import { describe, it, expect } from 'vitest';
import {
	newParticipant,
	participantsFromNames,
	ageFromBirthDate,
	ageBand,
	applyAnswer,
	findParticipantIndex,
	hasPendingAnswer,
	buildStandings,
	streakLabel,
	parseGeneratedQuestions,
	buildKnowledgeSnapshot,
	hasKnowledge,
	projectQuizBoard,
	type QuizSessionState
} from './quiz-logic';

describe('participantsFromNames', () => {
	it('trimmer navn og fjerner tomme og duplikater (case-insensitivt)', () => {
		const list = participantsFromNames([' Nils ', 'Erle', 'nils', '', '  ']);
		expect(list.map((p) => p.name)).toEqual(['Nils', 'Erle']);
		expect(list[0]).toEqual(newParticipant('Nils'));
	});
});

describe('ageFromBirthDate', () => {
	const today = new Date('2026-06-25T00:00:00Z');

	it('regner ut alder i hele år', () => {
		expect(ageFromBirthDate('2017-01-10', today)).toBe(9); // Nils
		expect(ageFromBirthDate('2019-03-01', today)).toBe(7); // Erle
		expect(ageFromBirthDate('1984-02-14', today)).toBe(42);
	});

	it('trekker fra ett år når bursdagen ikke er passert i år', () => {
		expect(ageFromBirthDate('2017-12-31', today)).toBe(8);
		expect(ageFromBirthDate('2017-06-25', today)).toBe(9); // bursdag i dag teller
		expect(ageFromBirthDate('2017-06-26', today)).toBe(8); // bursdag i morgen
	});

	it('returnerer null for manglende eller ugyldig dato', () => {
		expect(ageFromBirthDate(null, today)).toBeNull();
		expect(ageFromBirthDate(undefined, today)).toBeNull();
		expect(ageFromBirthDate('1984', today)).toBeNull();
		expect(ageFromBirthDate('ikke-en-dato', today)).toBeNull();
	});
});

describe('ageBand', () => {
	it('plasserer alder i riktig vanskelighetsbånd', () => {
		expect(ageBand(4)).toBe('småbarn');
		expect(ageBand(7)).toBe('barn');
		expect(ageBand(9)).toBe('barn');
		expect(ageBand(12)).toBe('ungdom');
		expect(ageBand(42)).toBe('voksen');
	});

	it('behandler ukjent alder som voksen', () => {
		expect(ageBand(null)).toBe('voksen');
	});
});

describe('applyAnswer', () => {
	it('øker poeng og streak ved riktig svar uten å mutere input', () => {
		const start = newParticipant('Nils');
		const after = applyAnswer(start, true);
		expect(after).toMatchObject({ score: 1, streak: 1, bestStreak: 1, asked: 1, correct: 1 });
		expect(start.score).toBe(0); // uendret
	});

	it('nullstiller streak ved galt svar, men beholder beste streak', () => {
		let p = newParticipant('Nils');
		p = applyAnswer(p, true);
		p = applyAnswer(p, true);
		p = applyAnswer(p, true); // streak 3
		expect(p.streak).toBe(3);
		expect(p.bestStreak).toBe(3);
		p = applyAnswer(p, false);
		expect(p.streak).toBe(0);
		expect(p.bestStreak).toBe(3);
		expect(p.score).toBe(3);
		expect(p.asked).toBe(4);
	});
});

describe('findParticipantIndex', () => {
	const list = [newParticipant('Nils'), newParticipant('Erle')];

	it('finner deltaker uavhengig av store/små bokstaver og mellomrom', () => {
		expect(findParticipantIndex(list, ' nils ')).toBe(0);
		expect(findParticipantIndex(list, 'ERLE')).toBe(1);
	});

	it('returnerer -1 for ukjent eller tomt navn', () => {
		expect(findParticipantIndex(list, 'Pappa')).toBe(-1);
		expect(findParticipantIndex(list, '')).toBe(-1);
	});
});

describe('hasPendingAnswer', () => {
	it('er sann når et spørsmål er stilt men ikke registrert', () => {
		expect(hasPendingAnswer({ currentQuestion: 'Hovedstad i Norge?', lastResult: null })).toBe(true);
	});

	it('er usann når svaret er registrert', () => {
		expect(
			hasPendingAnswer({ currentQuestion: 'Hovedstad i Norge?', lastResult: { player: 'Kjetil', correct: true } })
		).toBe(false);
	});

	it('er usann når ingen spørsmål er stilt ennå', () => {
		expect(hasPendingAnswer({ currentQuestion: null, lastResult: null })).toBe(false);
	});
});

describe('buildStandings', () => {
	it('sorterer synkende på poeng, så streak, så navn', () => {
		const a = { ...newParticipant('Erle'), score: 2, streak: 0 };
		const b = { ...newParticipant('Nils'), score: 3, streak: 1 };
		const c = { ...newParticipant('Pappa'), score: 2, streak: 2 };
		const ranked = buildStandings([a, b, c]);
		expect(ranked.map((p) => p.name)).toEqual(['Nils', 'Pappa', 'Erle']);
	});
});

describe('streakLabel', () => {
	it('gir hint kun fra tre på rad og oppover', () => {
		expect(streakLabel(2)).toBeNull();
		expect(streakLabel(3)).toBe('varm');
		expect(streakLabel(5)).toBe('on fire');
		expect(streakLabel(7)).toBe('uslåelig');
	});
});

describe('parseGeneratedQuestions', () => {
	it('aksepterer toppnivå-array', () => {
		const out = parseGeneratedQuestions([
			{ player: 'Erle', question: 'Hva er 7+5?', answer: '12' },
			{ player: 'Nils', question: 'Hovedstad i Sverige?', answer: 'Stockholm' }
		]);
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({ player: 'Erle', question: 'Hva er 7+5?', answer: '12' });
	});

	it('aksepterer { questions: [...] } og trimmer feltene', () => {
		const out = parseGeneratedQuestions({
			questions: [{ player: ' Nils ', question: ' 2+2? ', answer: ' 4 ' }]
		});
		expect(out).toEqual([{ player: 'Nils', question: '2+2?', answer: '4' }]);
	});

	it('dropper poster som mangler felt og tåler søppel', () => {
		expect(parseGeneratedQuestions(null)).toEqual([]);
		expect(parseGeneratedQuestions('nei')).toEqual([]);
		expect(
			parseGeneratedQuestions([
				{ player: 'Nils', question: 'Q' }, // mangler answer
				{ player: '', question: 'Q', answer: 'A' }, // tomt navn
				{ player: 'Erle', question: 'Q2', answer: 'A2' }
			])
		).toEqual([{ player: 'Erle', question: 'Q2', answer: 'A2' }]);
	});
});

describe('buildKnowledgeSnapshot', () => {
	it('setter sammen notater, interesser og mål kompakt', () => {
		const s = buildKnowledgeSnapshot({
			notes: '  Spiller fotball i Kolbotn  ',
			memories: ['Elsker Pokémon', 'Liker å tegne'],
			goals: ['Lære gangetabellen']
		});
		expect(s).toEqual({
			notes: 'Spiller fotball i Kolbotn',
			interests: ['Elsker Pokémon', 'Liker å tegne'],
			goals: ['Lære gangetabellen']
		});
	});

	it('dedupliserer, kutter antall og lengde', () => {
		const s = buildKnowledgeSnapshot(
			{ memories: ['Pokémon', 'pokémon', 'Fotball', 'Lego', 'Sjakk'] },
			{ maxItems: 2, maxLen: 5 }
		);
		expect(s.interests).toEqual(['Pokém…', 'Fotba…']);
	});

	it('utelater tom notes og gir tomme lister når ingenting finnes', () => {
		const s = buildKnowledgeSnapshot({ notes: '   ' });
		expect(s.notes).toBeUndefined();
		expect(s.interests).toEqual([]);
		expect(s.goals).toEqual([]);
	});
});

describe('hasKnowledge', () => {
	it('er sann bare når snapshotet har innhold', () => {
		expect(hasKnowledge({ interests: [], goals: [] })).toBe(false);
		expect(hasKnowledge({ interests: ['Lego'], goals: [] })).toBe(true);
		expect(hasKnowledge({ notes: 'noe', interests: [], goals: [] })).toBe(true);
	});
});

describe('projectQuizBoard', () => {
	const base: QuizSessionState = {
		participants: [
			{ name: 'Nils', score: 3, streak: 3, bestStreak: 3, asked: 4, correct: 3 },
			{ name: 'Erle', score: 1, streak: 0, bestStreak: 1, asked: 4, correct: 1 }
		],
		theme: 'hovedsteder',
		round: 1,
		active: true,
		currentPlayer: 'Erle',
		currentQuestion: 'Hva er hovedstaden i Norge?',
		currentAnswer: 'Oslo',
		lastResult: null
	};

	it('skjuler fasiten før spørsmålet er besvart', () => {
		const board = projectQuizBoard(base);
		expect(board.answered).toBe(false);
		expect(board.answer).toBeNull();
		expect(board.currentQuestion).toBe('Hva er hovedstaden i Norge?');
	});

	it('avslører fasiten når svaret er registrert', () => {
		const board = projectQuizBoard({ ...base, lastResult: { player: 'Erle', correct: true } });
		expect(board.answered).toBe(true);
		expect(board.answer).toBe('Oslo');
		expect(board.lastResult).toEqual({ player: 'Erle', correct: true });
	});

	it('sorterer stillingen og markerer hvem sin tur det er', () => {
		const board = projectQuizBoard(base);
		expect(board.standings.map((s) => s.name)).toEqual(['Nils', 'Erle']);
		expect(board.standings.find((s) => s.name === 'Nils')?.streakLabel).toBe('varm');
		expect(board.standings.find((s) => s.name === 'Erle')?.current).toBe(true);
		expect(board.standings.find((s) => s.name === 'Nils')?.current).toBe(false);
	});
});
