import { describe, it, expect } from 'vitest';
import {
	LIVSKOMPASS_DIMENSIONS,
	IMPORTANCE_MAX,
	MATCH_MAX,
	NEUTRAL_MATCH,
	computeOutOfSync,
	averageMatch,
	buildChatSeed,
	buildCoachingSeed,
	buildCoachingSystemPrompt,
	importanceLabel,
	matchLabel,
	localIsoWeek,
	isValidWeekKey,
	defaultScores,
	defaultImportanceMap,
	isValidImportanceMap,
	colorForArea,
	type LivskompassScores
} from './dimensions';

// Baseline: alt «helt på linje» (samsvar = maks), så bare overstyrte dimensjoner kan bli ute av synk.
function scoresFrom(overrides: Record<string, { importance: number; match: number }>): LivskompassScores {
	const base: LivskompassScores = {};
	for (const d of LIVSKOMPASS_DIMENSIONS) base[d.id] = { importance: d.defaultImportance, match: MATCH_MAX };
	return { ...base, ...overrides };
}

describe('Livskompass-dimensjoner', () => {
	it('har 12 dimensjoner med farge fra sitt område', () => {
		expect(LIVSKOMPASS_DIMENSIONS).toHaveLength(12);
		for (const d of LIVSKOMPASS_DIMENSIONS) {
			expect(d.color).toBe(colorForArea(d.area));
		}
	});

	it('viktighet-defaults ligger på 1–10-skalaen', () => {
		for (const d of LIVSKOMPASS_DIMENSIONS) {
			expect(d.defaultImportance).toBeGreaterThanOrEqual(1);
			expect(d.defaultImportance).toBeLessThanOrEqual(IMPORTANCE_MAX);
		}
	});

	it('defaultScores forhåndsutfyller viktighet (1–10) og setter nøytralt samsvar', () => {
		const s = defaultScores();
		expect(s.partner.importance).toBe(9);
		expect(s.partner.match).toBe(NEUTRAL_MATCH);
		expect(Object.keys(s)).toHaveLength(12);
	});

	it('defaultScores bruker prefill-viktighet når den finnes', () => {
		const s = defaultScores({ partner: 4 });
		expect(s.partner.importance).toBe(4);
		expect(s.barn.importance).toBe(9); // faller tilbake til default
	});
});

describe('computeOutOfSync (gap = viktighet − samsvar, begge 1–10)', () => {
	it('flagger viktig dimensjon med stort gap', () => {
		const oos = computeOutOfSync(scoresFrom({ natur: { importance: 9, match: 1 } }));
		expect(oos[0].id).toBe('natur');
		expect(oos[0].gap).toBe(8);
	});

	it('ignorerer lavt samsvar når dimensjonen er uviktig', () => {
		const oos = computeOutOfSync(scoresFrom({ kultur: { importance: 3, match: 1 } }));
		expect(oos.find((d) => d.id === 'kultur')).toBeUndefined();
	});

	it('ignorerer lite gap selv om dimensjonen er viktig', () => {
		// viktighet 9, samsvar 7 → gap 2 < terskel (3)
		const oos = computeOutOfSync(scoresFrom({ partner: { importance: 9, match: 7 } }));
		expect(oos.find((d) => d.id === 'partner')).toBeUndefined();
	});

	it('sorterer på størst gap først', () => {
		const oos = computeOutOfSync(
			scoresFrom({
				partner: { importance: 9, match: 6 }, // gap 3
				natur: { importance: 9, match: 2 } // gap 7
			})
		);
		expect(oos.map((d) => d.id).slice(0, 2)).toEqual(['natur', 'partner']);
	});
});

describe('averageMatch', () => {
	it('regner snitt over alle dimensjoner (samsvar 1–10)', () => {
		const s = defaultScores(); // alle match = NEUTRAL_MATCH
		expect(averageMatch(s)).toBe(NEUTRAL_MATCH);
	});
});

describe('matchLabel', () => {
	it('gir grove ankerord langs 1–10', () => {
		expect(matchLabel(1)).toBe('Langt unna');
		expect(matchLabel(5)).toBe('Sånn passe');
		expect(matchLabel(10)).toBe('Helt på linje');
	});
});

describe('importanceLabel', () => {
	it('gir grove ankerord langs 1–10', () => {
		expect(importanceLabel(1)).toBe('Lite viktig');
		expect(importanceLabel(5)).toBe('Ganske viktig');
		expect(importanceLabel(8)).toBe('Viktig');
		expect(importanceLabel(10)).toBe('Avgjørende');
	});
});

describe('buildChatSeed', () => {
	it('peker på det største gapet med riktige skalaer', () => {
		const oos = computeOutOfSync(scoresFrom({ natur: { importance: 9, match: 1 } }));
		const seed = buildChatSeed(oos);
		expect(seed).toContain('Natur');
		expect(seed).toContain('9/10');
		expect(seed).toContain('1/10');
	});

	it('gir en på-linje-melding når ingenting er ute av synk', () => {
		expect(buildChatSeed([])).toContain('på linje');
	});
});

describe('ACT-coaching (heve ett poeng)', () => {
	it('system-prompten lister de største gapene og ber om ett-poengs-mål', () => {
		const prompt = buildCoachingSystemPrompt(
			scoresFrom({ natur: { importance: 9, match: 2 }, partner: { importance: 9, match: 4 } })
		);
		expect(prompt).toContain('ACT-coach');
		expect(prompt).toContain('Natur');
		expect(prompt).toContain('heve ETT poeng');
		// gap-linjer med begge skalaer
		expect(prompt).toMatch(/Natur.*9\/10.*2\/10/);
	});

	it('coaching-seed inviterer mot ett-poengs-målet og tar med notat', () => {
		const seed = buildCoachingSeed(scoresFrom({ natur: { importance: 9, match: 2 } }), 'Var mye reising.');
		expect(seed.toLowerCase()).toContain('natur');
		expect(seed).toContain('ett poeng');
		expect(seed).toContain('Var mye reising.');
	});

	it('coaching-seed håndterer «alt på linje»', () => {
		const seed = buildCoachingSeed(scoresFrom({})); // baseline = samsvar på maks
		expect(seed.toLowerCase()).toContain('på linje');
	});
});

describe('onboarding-hjelpere', () => {
	it('defaultImportanceMap dekker alle dimensjoner', () => {
		const map = defaultImportanceMap();
		expect(Object.keys(map)).toHaveLength(12);
		expect(map.partner).toBe(9);
	});

	it('isValidImportanceMap krever 1–10-heltall for alle dimensjoner', () => {
		expect(isValidImportanceMap(defaultImportanceMap())).toBe(true);
		const partial = { ...defaultImportanceMap() };
		delete (partial as Record<string, number>).natur;
		expect(isValidImportanceMap(partial)).toBe(false);
		expect(isValidImportanceMap({ ...defaultImportanceMap(), partner: 11 })).toBe(false);
		expect(isValidImportanceMap({ ...defaultImportanceMap(), partner: 0 })).toBe(false);
		expect(isValidImportanceMap(null)).toBe(false);
	});
});

describe('localIsoWeek / isValidWeekKey', () => {
	it('gir ISO-uke på formen YYYY-Www', () => {
		const wk = localIsoWeek(new Date('2026-06-16T12:00:00Z'));
		expect(wk).toMatch(/^\d{4}-W\d{2}$/);
		expect(wk).toBe('2026-W25');
	});

	it('validerer uke-nøkler', () => {
		expect(isValidWeekKey('2026-W25')).toBe(true);
		expect(isValidWeekKey('2026-25')).toBe(false);
		expect(isValidWeekKey(42)).toBe(false);
	});
});
