import { describe, it, expect } from 'vitest';
import {
	newParticipant,
	participantsFromNames,
	participantsFromEntries,
	coercePlayerEntries,
	ageFromBirthDate,
	ageBand,
	applyAnswer,
	findParticipantIndex,
	hasPendingAnswer,
	buildStandings,
	streakLabel,
	parseGeneratedQuestions,
	filterRepeatQuestions,
	normalizeQuestionText,
	nextUnusedQuestion,
	markQuestionUsed,
	unusedCounts,
	nextPlayerName,
	buildKnowledgeSnapshot,
	hasKnowledge,
	projectQuizBoard,
	type QuizBankQuestion,
	type QuizSessionState
} from './quiz-logic';

describe('participantsFromNames', () => {
	it('trimmer navn og fjerner tomme og duplikater (case-insensitivt)', () => {
		const list = participantsFromNames([' Nils ', 'Erle', 'nils', '', '  ']);
		expect(list.map((p) => p.name)).toEqual(['Nils', 'Erle']);
		expect(list[0]).toEqual(newParticipant('Nils'));
	});
});

describe('participantsFromEntries', () => {
	it('registrerer hele laget i ett kall med alder («Erle 7, Nils 9, Kjetil 42»)', () => {
		const list = participantsFromEntries([
			{ name: 'Erle', age: 7 },
			{ name: 'Nils', age: 9 },
			{ name: 'Kjetil', age: 42 }
		]);
		expect(list.map((p) => `${p.name} ${p.age}`)).toEqual(['Erle 7', 'Nils 9', 'Kjetil 42']);
		expect(list.every((p) => p.score === 0 && p.streak === 0)).toBe(true);
	});

	it('runder alder til hele år, forkaster ugyldig alder, og tar med interesser', () => {
		const list = participantsFromEntries([
			{ name: 'Erle', age: 7.6, interests: [' Bluey ', ''] },
			{ name: 'Nils', age: -3 },
			{ name: 'Mormor', age: 200 }
		]);
		expect(list[0].age).toBe(8);
		expect(list[0].interests).toEqual(['Bluey']);
		expect(list[1].age).toBeUndefined();
		expect(list[2].age).toBeUndefined();
	});

	it('fjerner tomme og duplikate navn (case-insensitivt)', () => {
		const list = participantsFromEntries([
			{ name: ' Nils ', age: 9 },
			{ name: 'nils', age: 10 },
			{ name: '' }
		]);
		expect(list).toHaveLength(1);
		expect(list[0]).toMatchObject({ name: 'Nils', age: 9 });
	});
});

describe('coercePlayerEntries', () => {
	it('tolker rå LLM-argumenter og dropper søppel', () => {
		const entries = coercePlayerEntries([
			{ name: 'Erle', age: 7, interests: ['Bluey', 42] },
			{ name: '', age: 9 },
			'tekst',
			{ age: 12 }
		]);
		expect(entries).toEqual([{ name: 'Erle', age: 7, interests: ['Bluey'] }]);
	});

	it('gir tom liste for ikke-array', () => {
		expect(coercePlayerEntries(null)).toEqual([]);
		expect(coercePlayerEntries({ name: 'Erle' })).toEqual([]);
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

	it('følger questionState når banken er i bruk', () => {
		expect(
			hasPendingAnswer({ currentQuestion: 'Q', lastResult: null, questionState: 'open' })
		).toBe(true);
		// «answered» vinner selv om lastResult skulle være null (f.eks. midt i en oppdatering).
		expect(
			hasPendingAnswer({ currentQuestion: 'Q', lastResult: null, questionState: 'answered' })
		).toBe(false);
	});
});

describe('normalizeQuestionText', () => {
	it('kollapser casing, tegnsetting og whitespace til én kanonisk form', () => {
		expect(normalizeQuestionText('Hva heter hovedstaden i Norge?')).toBe(
			'hva heter hovedstaden i norge'
		);
		expect(normalizeQuestionText('  Hva heter   hovedstaden i NORGE!? ')).toBe(
			'hva heter hovedstaden i norge'
		);
		expect(normalizeQuestionText('Hvor mange bein har en edderkopp (åtte)?')).toBe(
			'hvor mange bein har en edderkopp åtte'
		);
	});
});

describe('spørsmålsbank', () => {
	const bank: QuizBankQuestion[] = [
		{ id: 'a', player: 'Erle', text: 'Q1', answer: 'A1', category: 'dyr', used: true },
		{ id: 'b', player: 'Erle', text: 'Q2', answer: 'A2', category: 'tall', used: false },
		{ id: 'c', player: 'Nils', text: 'Q3', answer: 'A3', category: 'geografi', used: false }
	];

	it('nextUnusedQuestion trekker første ubrukte for spilleren (case-insensitivt)', () => {
		expect(nextUnusedQuestion(bank, 'erle')?.id).toBe('b');
		expect(nextUnusedQuestion(bank, 'Nils')?.id).toBe('c');
		expect(nextUnusedQuestion(bank, 'Kjetil')).toBeNull();
	});

	it('markQuestionUsed markerer uten å mutere input', () => {
		const after = markQuestionUsed(bank, 'b');
		expect(after.find((q) => q.id === 'b')?.used).toBe(true);
		expect(bank.find((q) => q.id === 'b')?.used).toBe(false);
	});

	it('unusedCounts teller ubrukte per spiller', () => {
		expect(unusedCounts(bank)).toEqual({ Erle: 1, Nils: 1 });
	});
});

describe('nextPlayerName', () => {
	const list = [newParticipant('Erle'), newParticipant('Nils'), newParticipant('Kjetil')];

	it('roterer i registreringsrekkefølge og wrapper rundt', () => {
		expect(nextPlayerName(list, 'Erle')).toBe('Nils');
		expect(nextPlayerName(list, 'Kjetil')).toBe('Erle');
	});

	it('starter på første deltaker ved null/ukjent current, og gir null for tom liste', () => {
		expect(nextPlayerName(list, null)).toBe('Erle');
		expect(nextPlayerName(list, 'Ukjent')).toBe('Erle');
		expect(nextPlayerName([], 'Erle')).toBeNull();
	});
});

describe('filterRepeatQuestions', () => {
	it('fjerner alt som (normalisert) er stilt før, og dedupliserer innad i batchen', () => {
		const asked = new Set([normalizeQuestionText('Hva heter hovedstaden i Norge?')]);
		const out = filterRepeatQuestions(
			[
				{ player: 'Erle', question: 'Hva heter hovedstaden i NORGE!?', answer: 'Oslo', category: 'geografi' },
				{ player: 'Nils', question: 'Hva er 7 + 5?', answer: '12', category: 'tall' },
				{ player: 'Kjetil', question: 'Hva er 7+5', answer: '12', category: 'tall' }
			],
			asked
		);
		expect(out.map((q) => q.player)).toEqual(['Nils']);
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
	it('aksepterer toppnivå-array og tar med kategori', () => {
		const out = parseGeneratedQuestions([
			{ player: 'Erle', question: 'Hva er 7+5?', answer: '12', category: 'tall' },
			{ player: 'Nils', question: 'Hovedstad i Sverige?', answer: 'Stockholm', category: 'geografi' }
		]);
		expect(out).toHaveLength(2);
		expect(out[0]).toEqual({ player: 'Erle', question: 'Hva er 7+5?', answer: '12', category: 'tall' });
	});

	it('aksepterer { questions: [...] }, trimmer feltene og defaulter kategori', () => {
		const out = parseGeneratedQuestions({
			questions: [{ player: ' Nils ', question: ' 2+2? ', answer: ' 4 ' }]
		});
		expect(out).toEqual([{ player: 'Nils', question: '2+2?', answer: '4', category: 'generelt' }]);
	});

	it('dropper poster som mangler felt og tåler søppel', () => {
		expect(parseGeneratedQuestions(null)).toEqual([]);
		expect(parseGeneratedQuestions('nei')).toEqual([]);
		expect(
			parseGeneratedQuestions([
				{ player: 'Nils', question: 'Q' }, // mangler answer
				{ player: '', question: 'Q', answer: 'A' }, // tomt navn
				{ player: 'Erle', question: 'Q2', answer: 'A2', category: 'dyr' }
			])
		).toEqual([{ player: 'Erle', question: 'Q2', answer: 'A2', category: 'dyr' }]);
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

	it('følger questionState når banken er i bruk', () => {
		expect(projectQuizBoard({ ...base, questionState: 'open' }).answer).toBeNull();
		const answered = projectQuizBoard({
			...base,
			questionState: 'answered',
			lastResult: { player: 'Erle', correct: false }
		});
		expect(answered.answered).toBe(true);
		expect(answered.answer).toBe('Oslo');
	});

	it('sorterer stillingen og markerer hvem sin tur det er', () => {
		const board = projectQuizBoard(base);
		expect(board.standings.map((s) => s.name)).toEqual(['Nils', 'Erle']);
		expect(board.standings.find((s) => s.name === 'Nils')?.streakLabel).toBe('varm');
		expect(board.standings.find((s) => s.name === 'Erle')?.current).toBe(true);
		expect(board.standings.find((s) => s.name === 'Nils')?.current).toBe(false);
	});
});
