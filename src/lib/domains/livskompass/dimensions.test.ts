import { describe, it, expect } from 'vitest';
import {
	LIVSKOMPASS_DIMENSIONS,
	IMPORTANCE_MAX,
	MATCH_MAX,
	NEUTRAL_MATCH,
	computeOutOfSync,
	averageMatch,
	evaluateWeekGoals,
	describeGoalOutcome,
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

describe('matchLabel (relativt til viktighet)', () => {
	it('setter ord på gapet mellom viktighet og samsvar', () => {
		expect(matchLabel(1, 9)).toBe('Langt under det viktige'); // gap 8
		expect(matchLabel(5, 9)).toBe('Klart under det viktige'); // gap 4 (≥ ute-av-synk-terskel)
		expect(matchLabel(8, 10)).toBe('Litt under'); // gap 2
	});

	it('lavt samsvar på en uviktig dimensjon er på linje', () => {
		expect(matchLabel(3, 3)).toBe('På linje'); // gap 0
		expect(matchLabel(2, 3)).toBe('Litt under'); // gap 1
	});

	it('samsvar over viktigheten er på linje — til det bikker over', () => {
		expect(matchLabel(9, 7)).toBe('På linje'); // gap −2
		expect(matchLabel(9, 4)).toBe('Mer rom enn viktigheten tilsier'); // gap −5
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

describe('ukesmål (lukket sløyfe)', () => {
	const goal = { dimensionId: 'egentid', fromMatch: 3, target: 4, label: 'Egen tid', itemsTotal: 3, itemsChecked: 2 };

	it('evaluateWeekGoals vurderer målet mot ukens samsvar', () => {
		const hit = evaluateWeekGoals(scoresFrom({ egentid: { importance: 8, match: 5 } }), [goal]);
		expect(hit[0].achieved).toBe(true);
		expect(hit[0].match).toBe(5);

		const miss = evaluateWeekGoals(scoresFrom({ egentid: { importance: 8, match: 3 } }), [goal]);
		expect(miss[0].achieved).toBe(false);
	});

	it('evaluateWeekGoals tåler null/tom mål-liste', () => {
		expect(evaluateWeekGoals(scoresFrom({}), null)).toEqual([]);
		expect(evaluateWeekGoals(scoresFrom({}), [])).toEqual([]);
	});

	it('describeGoalOutcome oppsummerer mål, utfall og tiltak', () => {
		const [o] = evaluateWeekGoals(scoresFrom({ egentid: { importance: 8, match: 5 } }), [goal]);
		expect(describeGoalOutcome(o)).toBe('«Egen tid»: mål 3 → 4, ble 5 ✓ nådd · tiltak gjennomført 2/3');
	});

	it('describeGoalOutcome utelater tiltak når ingen punkter er tagget', () => {
		const [o] = evaluateWeekGoals(scoresFrom({ egentid: { importance: 8, match: 3 } }), [
			{ ...goal, itemsTotal: 0, itemsChecked: 0 }
		]);
		expect(describeGoalOutcome(o)).toBe('«Egen tid»: mål 3 → 4, ble 3 — ikke nådd');
	});

	it('coaching-prompten anerkjenner forrige ukes mål og ber om dimensjons-tagging', () => {
		const prompt = buildCoachingSystemPrompt(
			scoresFrom({ egentid: { importance: 8, match: 5 }, natur: { importance: 9, match: 2 } }),
			{ weekGoals: [goal] }
		);
		expect(prompt).toContain('FORRIGE UKES MÅL');
		expect(prompt).toContain('«Egen tid»: mål 3 → 4, ble 5 ✓ nådd');
		expect(prompt).toContain('`dimension`');
		// gap-listen eksponerer id-en modellen skal bruke som dimension
		expect(prompt).toContain('(id: natur)');
	});

	it('coaching-prompten er uendret strukturelt uten mål', () => {
		const prompt = buildCoachingSystemPrompt(scoresFrom({ natur: { importance: 9, match: 2 } }));
		expect(prompt).not.toContain('FORRIGE UKES MÅL');
		expect(prompt).toContain('OMRÅDER MED STØRST GAP DENNE UKA');
	});

	it('coaching-seed åpner med utfallet av forrige ukes mål', () => {
		const seedHit = buildCoachingSeed(
			scoresFrom({ egentid: { importance: 8, match: 5 }, natur: { importance: 9, match: 2 } }),
			null,
			{ weekGoals: [goal] }
		);
		expect(seedHit).toContain('heve egen tid fra 3 til 4');
		expect(seedHit).toContain('det gikk');
		expect(seedHit.toLowerCase()).toContain('natur');

		const seedMiss = buildCoachingSeed(scoresFrom({ egentid: { importance: 8, match: 3 } }), null, {
			weekGoals: [goal]
		});
		expect(seedMiss).toContain('men det ble 3');
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
