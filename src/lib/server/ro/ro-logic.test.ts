import { describe, it, expect } from 'vitest';
import {
	answerProposal,
	asPhrase,
	buildOverview,
	cleanText,
	closingQuestionFor,
	currentTheme,
	effectiveStatus,
	emptyProfile,
	mergeReflection,
	parseIntakeExtraction,
	parseProfile,
	parseReflectionExtraction,
	pruneNotes,
	MAX_NOTES,
	REVIEW_AFTER_SESSIONS,
	RO_STRUCTURES,
	slugify,
	structureForOpen,
	structureForStage,
	upsertThemeFromIntake,
	withCrisisHelp,
	type RoProfile
} from './ro-logic';

const NOW = new Date('2026-09-27T10:00:00Z');
let counter = 0;
const newId = () => `n${++counter}`;

function profileWithTheme(overrides: Partial<RoProfile['themes'][number]> = {}): RoProfile {
	const p = emptyProfile();
	p.themes.push({
		id: 'ikke_hort',
		label: 'Å ikke bli hørt',
		lifeArea: 'familie',
		pattern: null,
		currentPractice: null,
		situation: null,
		stage: 'observe',
		sessionsAtStage: 0,
		sessionsSinceReview: 0,
		status: 'emerging',
		lastReview: null,
		createdAt: '2026-09-01T00:00:00Z',
		lastTouchedAt: '2026-09-20T00:00:00Z',
		...overrides
	});
	return p;
}

function extraction(overrides: Record<string, unknown> = {}) {
	return parseReflectionExtraction({ reply: 'Det virker viktig.', ...overrides }, ['ikke_hort']);
}

describe('cleanText', () => {
	it('fjerner anførselstegn, markdown og linjeskift', () => {
		expect(cleanText('«Hei»\n**du**')).toBe('Hei du');
	});
	it('kapper på ord og markerer med …', () => {
		const out = cleanText('en to tre fire fem seks sju åtte', 20)!;
		expect(out.endsWith('…')).toBe(true);
		expect(out.length).toBeLessThanOrEqual(21);
	});
	it('gir null for tomt og ikke-strenger', () => {
		expect(cleanText('   ')).toBeNull();
		expect(cleanText(42)).toBeNull();
	});
});

describe('asPhrase', () => {
	it('gjør en hel setning til en frase som passer midt i en setning', () => {
		expect(asPhrase('Merk kjeven før du argumenterer hardere.', 90)).toBe('merk kjeven før du argumenterer hardere');
	});
	it('beholder «Jeg» og forkortelser', () => {
		expect(asPhrase('Jeg merker det først i kjeven', 90)).toBe('Jeg merker det først i kjeven');
		expect(asPhrase('NAV-brevet som kom i går.', 90)).toBe('NAV-brevet som kom i går');
	});
	it('gir null for bare tegnsetting', () => {
		expect(asPhrase(' … ', 90)).toBeNull();
	});
});

describe('slugify', () => {
	it('lager ascii-id av norske etiketter', () => {
		expect(slugify('Å ikke bli hørt')).toBe('a_ikke_bli_hort');
	});
});

describe('katalogen', () => {
	it('har unike id-er', () => {
		const ids = RO_STRUCTURES.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
	it('har en øvelse for hvert trinn', () => {
		for (const stage of ['observe', 'understand', 'tolerate', 'choose', 'try'] as const) {
			expect(structureForStage(stage, 0).stages).toContain(stage);
		}
	});
	it('veksler mellom øvelsene på et trinn med flere', () => {
		expect(structureForStage('understand', 0).id).not.toBe(structureForStage('understand', 1).id);
	});
});

describe('structureForOpen', () => {
	it('første økt noensinne er «Lande og se»', () => {
		expect(structureForOpen(emptyProfile(), 0).id).toBe('lande');
	});
	it('gir aldri samme åpne øvelse to ganger på rad', () => {
		const p = emptyProfile();
		p.lastOpenStructureId = 'lande';
		expect(structureForOpen(p, 3).id).not.toBe('lande');
	});
});

describe('closingQuestionFor', () => {
	it('følger trinnet', () => {
		expect(closingQuestionFor(null)).toBe('Hva la du merke til?');
		expect(closingQuestionFor('choose')).toContain('annerledes');
	});
});

describe('parseProfile', () => {
	it('tåler søppel', () => {
		expect(parseProfile(null)).toEqual(emptyProfile());
		expect(parseProfile({ themes: 'x', notes: [{}] })).toEqual(emptyProfile());
	});
	it('rundtur uten tap', () => {
		const p = profileWithTheme();
		expect(parseProfile(JSON.parse(JSON.stringify(p)))).toEqual(p);
	});
});

describe('effectiveStatus og currentTheme', () => {
	it('et tema ingen har rørt på seks uker er hvilende', () => {
		const p = profileWithTheme({ status: 'active', lastTouchedAt: '2026-07-01T00:00:00Z' });
		expect(effectiveStatus(p.themes[0], NOW)).toBe('dormant');
		expect(currentTheme(p, NOW)).toBeNull();
	});
	it('aktive går foran framvoksende', () => {
		const p = profileWithTheme({ status: 'emerging', lastTouchedAt: '2026-09-26T00:00:00Z' });
		p.themes.push({ ...p.themes[0], id: 'jobb', label: 'Jobb', status: 'active', lastTouchedAt: '2026-09-20T00:00:00Z' });
		expect(currentTheme(p, NOW)?.id).toBe('jobb');
	});
});

describe('parseIntakeExtraction', () => {
	it('godtar bare kjente tema-id-er', () => {
		const e = parseIntakeExtraction({ themeId: 'ukjent', newThemeLabel: 'Nytt' }, ['ikke_hort']);
		expect(e.themeId).toBeNull();
		expect(e.newThemeLabel).toBe('Nytt');
	});
	it('dropper nytt tema når et kjent traff', () => {
		const e = parseIntakeExtraction({ themeId: 'ikke_hort', newThemeLabel: 'Nytt' }, ['ikke_hort']);
		expect(e.newThemeLabel).toBeNull();
	});
	it('ukjent safety blir none', () => {
		expect(parseIntakeExtraction({ safety: 'kanskje' }, []).safety).toBe('none');
	});
});

describe('upsertThemeFromIntake', () => {
	it('et hvilende tema som dukker opp igjen, begynner med å observere', () => {
		const p = profileWithTheme({ status: 'dormant', stage: 'choose', sessionsAtStage: 3 });
		const t = upsertThemeFromIntake(p, parseIntakeExtraction({ themeId: 'ikke_hort' }, ['ikke_hort']), NOW)!;
		expect(t.status).toBe('emerging');
		expect(t.stage).toBe('observe');
	});
	it('nytt tema får unik id', () => {
		const p = profileWithTheme({ id: 'a_ikke_bli_hort' });
		const t = upsertThemeFromIntake(p, parseIntakeExtraction({ newThemeLabel: 'Å ikke bli hørt' }, []), NOW)!;
		expect(t.id).toBe('a_ikke_bli_hort_2');
		expect(p.themes).toHaveLength(2);
	});
});

describe('mergeReflection', () => {
	it('flytter ikke trinnet på første økt, selv om modellen sier advance', () => {
		const p = profileWithTheme();
		const r = mergeReflection(p, extraction({ stageSignal: 'advance' }), {
			sessionThemeId: 'ikke_hort',
			sessionId: 's1',
			now: NOW,
			newId
		});
		expect(r.advanced).toBe(false);
		expect(p.themes[0].stage).toBe('observe');
		expect(p.themes[0].sessionsAtStage).toBe(1);
	});
	it('flytter trinnet etter to økter når modellen sier advance', () => {
		const p = profileWithTheme({ sessionsAtStage: 1 });
		const r = mergeReflection(p, extraction({ stageSignal: 'advance' }), {
			sessionThemeId: 'ikke_hort',
			sessionId: 's2',
			now: NOW,
			newId
		});
		expect(r.advanced).toBe(true);
		expect(p.themes[0].stage).toBe('understand');
		expect(p.themes[0].sessionsAtStage).toBe(0);
	});
	it('revisit går ett trinn tilbake', () => {
		const p = profileWithTheme({ stage: 'tolerate', sessionsAtStage: 2 });
		mergeReflection(p, extraction({ stageSignal: 'revisit' }), { sessionThemeId: 'ikke_hort', sessionId: 's', now: NOW, newId });
		expect(p.themes[0].stage).toBe('understand');
	});
	it('lagrer det brukeren sa som notater, og en hypotese som forslag', () => {
		const p = profileWithTheme();
		const r = mergeReflection(
			p,
			extraction({
				observations: ['Kjeven strammet seg før jeg rakk å tenke'],
				reactions: ['argumenterer hardere'],
				proposal: {
					kind: 'user_hypothesis',
					text: 'Det er frykten for at ingenting endrer seg som trigger',
					question: 'Vil du ta med den til neste økt?'
				}
			}),
			{ sessionThemeId: 'ikke_hort', sessionId: 's1', now: NOW, newId }
		);
		expect(p.notes.map((n) => [n.kind, n.status])).toEqual([
			['observation', 'noted'],
			['reaction', 'noted'],
			['user_hypothesis', 'proposed']
		]);
		expect(r.proposal?.noteId).toBe(p.notes[2].id);
	});
	it('foreslår ikke en hypotese brukeren har avvist før', () => {
		const p = profileWithTheme();
		p.notes.push({
			id: 'old',
			themeId: 'ikke_hort',
			kind: 'assistant_hypothesis',
			text: 'Du trenger kontroll',
			status: 'rejected',
			sessionId: null,
			createdAt: '2026-09-01T00:00:00Z'
		});
		const r = mergeReflection(
			p,
			extraction({ proposal: { kind: 'assistant_hypothesis', text: 'Du trenger kontroll.', question: '?' } }),
			{ sessionThemeId: 'ikke_hort', sessionId: 's', now: NOW, newId }
		);
		expect(r.proposal).toBeNull();
	});
	it('ved krise lagres ingenting', () => {
		const p = profileWithTheme();
		const r = mergeReflection(
			p,
			extraction({ safety: 'crisis', observations: ['noe'], stageSignal: 'advance' }),
			{ sessionThemeId: 'ikke_hort', sessionId: 's', now: NOW, newId }
		);
		expect(r).toEqual({ theme: null, proposal: null, advanced: false });
		expect(p.notes).toHaveLength(0);
		expect(p.themes[0].sessionsAtStage).toBe(0);
	});
	it('maks to aktive temaer – det eldste går i bakgrunnen', () => {
		const p = profileWithTheme({ status: 'active', lastTouchedAt: '2026-09-01T00:00:00Z' });
		p.themes.push({ ...p.themes[0], id: 'jobb', label: 'Jobb', status: 'active', lastTouchedAt: '2026-09-10T00:00:00Z' });
		mergeReflection(
			p,
			parseReflectionExtraction({ reply: 'ok', newThemeLabel: 'Søvn', themeStatus: 'active' }, ['ikke_hort', 'jobb']),
			{ sessionThemeId: null, sessionId: 's', now: NOW, newId }
		);
		const status = Object.fromEntries(p.themes.map((t) => [t.id, t.status]));
		expect(status).toEqual({ ikke_hort: 'background', jobb: 'active', sovn: 'active' });
	});
	it('samme notat to ganger blir ett', () => {
		const p = profileWithTheme();
		const e = extraction({ working: ['Pustet før jeg svarte'] });
		mergeReflection(p, e, { sessionThemeId: 'ikke_hort', sessionId: 's1', now: NOW, newId });
		mergeReflection(p, e, { sessionThemeId: 'ikke_hort', sessionId: 's2', now: NOW, newId });
		expect(p.notes).toHaveLength(1);
	});
});

describe('answerProposal', () => {
	it('bare foreslåtte hypoteser kan besvares', () => {
		const p = profileWithTheme();
		p.notes.push({ id: 'h', themeId: null, kind: 'assistant_hypothesis', text: 'x', status: 'proposed', sessionId: null, createdAt: '' });
		expect(answerProposal(p, 'h', true)).toBe(true);
		expect(p.notes[0].status).toBe('accepted');
		expect(answerProposal(p, 'h', false)).toBe(false);
	});
});

describe('pruneNotes', () => {
	it('kaster vanlige notater før det som virker', () => {
		const p = emptyProfile();
		for (let i = 0; i < MAX_NOTES + 5; i++) {
			p.notes.push({
				id: `o${i}`,
				themeId: null,
				kind: i < 5 ? 'working' : 'observation',
				text: `t${i}`,
				status: 'noted',
				sessionId: null,
				createdAt: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`
			});
		}
		pruneNotes(p);
		expect(p.notes).toHaveLength(MAX_NOTES);
		expect(p.notes.filter((n) => n.kind === 'working')).toHaveLength(5);
	});
});

describe('buildOverview', () => {
	it('foreslår gjennomgang etter nok økter på et aktivt tema', () => {
		const p = profileWithTheme({ status: 'active', sessionsSinceReview: REVIEW_AFTER_SESSIONS });
		expect(buildOverview(p, 7, NOW).reviewSuggested).toEqual({ themeId: 'ikke_hort', label: 'Å ikke bli hørt' });
	});
	it('viser ikke hvilende temaer', () => {
		const p = profileWithTheme({ lastTouchedAt: '2026-06-01T00:00:00Z' });
		expect(buildOverview(p, 0, NOW).themes).toEqual([]);
	});
});

describe('withCrisisHelp', () => {
	it('legger til begge numrene når de mangler', () => {
		expect(withCrisisHelp('Det du sier er alvorlig.')).toBe(
			'Det du sier er alvorlig. Er det akutt, ring 113. Mental Helse Hjelpetelefonen er døgnåpen på 116 123.'
		);
	});
	it('gjentar ikke det modellen alt har sagt', () => {
		expect(withCrisisHelp('Ring 113 hvis det er akutt.')).toBe(
			'Ring 113 hvis det er akutt. Mental Helse Hjelpetelefonen er døgnåpen på 116 123.'
		);
		expect(withCrisisHelp('Ring 113, eller 116 123.')).toBe('Ring 113, eller 116 123.');
	});
});
