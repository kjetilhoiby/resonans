import { describe, it, expect } from 'vitest';
import {
	buildWeekPlanExamples,
	composeEffortSuggestion,
	composeWeekRecipe,
	computeEffortBudget,
	pickBoostSuggestion,
	projectWeekEffort,
	summarizeWeekSessions
} from './effort-budget';
import type { EnduranceConfig, EnduranceWorkout } from './types';
import { MET_CALIBRATION, MET_FACTOR_BY_FAMILY } from '$lib/domain/health/effort-model';

const CONFIG: EnduranceConfig = { deloadHverNteUke: 4 };
const PLAN_START = '2026-07-06'; // mandag, uke 1

function okt(date: string, effortScore: number, family = 'running'): EnduranceWorkout {
	return { date, family, effortScore, distanceMeters: null, durationSeconds: null };
}

describe('computeEffortBudget', () => {
	it('ankrer intervallet på snittet av ukene som finnes: 200 → 200–240', () => {
		// Forrige uke (2026-07-06..12): 200 effort, og ingen historikk før det.
		// Uker før første økt teller ikke — ellers ville en fersk bruker fått
		// snittet dratt mot null av uker som aldri fantes.
		const budget = computeEffortBudget(
			[okt('2026-07-07', 120), okt('2026-07-09', 80, 'cycling')],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.anchor).toBe('snitt_uker');
		expect(budget.anchorWeeks).toBe(1);
		expect(budget.bandMin).toBe(200);
		expect(budget.bandMax).toBe(240);
	});

	it('én stor uke flytter ikke båndet alene — den midles mot de tre foregående', () => {
		// Den konkrete feilen fra 9. august 2026: seks løp mot forrige ukes fire ga
		// «513 av 235–282», og uka etter ville ankeret vært 513 — altså «du trenger
		// 513 for å være på plan». Snittet demper begge ender.
		const uker = [
			okt('2026-06-15', 200), // uke −4
			okt('2026-06-22', 240), // uke −3
			okt('2026-06-29', 200), // uke −2
			okt('2026-07-06', 520) // uke −1: spissuka
		];
		const budget = computeEffortBudget(uker, CONFIG, PLAN_START, '2026-07-15');
		expect(budget.anchorWeeks).toBe(4);
		expect(budget.bandMin).toBe(290); // (200+240+200+520)/4
		expect(budget.bandMax).toBe(348);

		// Uglattet ville ankeret vært 520 → bånd 520–624.
		expect(budget.bandMin).toBeLessThan(520);
	});

	it('en hvileuke midt i vinduet teller som 0, ikke som manglende data', () => {
		// En reell hvileuke ER informasjon om normalen din. Hoppet vi over den,
		// ville et opphold sett ut som at nivået aldri falt.
		const budget = computeEffortBudget(
			[okt('2026-06-15', 200), okt('2026-06-29', 200), okt('2026-07-06', 200)],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.anchorWeeks).toBe(4);
		expect(budget.bandMin).toBe(150); // (200+0+200+200)/4
	});

	it('respekterer effortAnkerUker fra konfigurasjonen', () => {
		const uker = [okt('2026-06-29', 100), okt('2026-07-06', 300)];
		const toUker = computeEffortBudget(
			uker,
			{ ...CONFIG, effortAnkerUker: 2 },
			PLAN_START,
			'2026-07-15'
		);
		expect(toUker.anchorWeeks).toBe(2);
		expect(toUker.bandMin).toBe(200);
	});

	it('teller både løp, sykkel og el-sykkel — men ikke styrke', () => {
		const budget = computeEffortBudget(
			[
				okt('2026-07-07', 100),
				okt('2026-07-08', 60, 'cycling'),
				okt('2026-07-09', 40, 'ebike'),
				okt('2026-07-10', 500, 'strength')
			],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.bandMin).toBe(200);
	});

	it('trekker forbrukt effort fra intervallet — hard økt tar ned resten av uka', () => {
		// Forrige uke 200 → band 200–240. Planlagt ~160, men økta ble 320:
		const budget = computeEffortBudget(
			[okt('2026-07-07', 200), okt('2026-07-14', 320)],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.spentThisWeek).toBe(320);
		expect(budget.remainingMin).toBe(0);
		expect(budget.remainingMax).toBe(0); // uken er «brukt opp» → forslagene blir hvile
	});

	it('holder ankeret oppe når forrige uke var tom', () => {
		// Aktivitet 3 uker tilbake (uke som starter 2026-06-22), ingenting siden.
		// Vinduet dekker uke −1 til −3 fra første økt: 400 fordelt på tre uker.
		const budget = computeEffortBudget([okt('2026-06-24', 400)], CONFIG, PLAN_START, '2026-07-15');
		expect(budget.anchor).toBe('snitt_uker');
		expect(budget.anchorWeeks).toBe(3);
		expect(budget.bandMin).toBe(133); // 400 / 3
	});

	it('bruker gulv ved helt tom historikk', () => {
		const budget = computeEffortBudget([], CONFIG, PLAN_START, '2026-07-15');
		expect(budget.anchor).toBe('gulv');
		expect(budget.bandMin).toBe(100);
		expect(budget.bandMax).toBe(120);
	});

	it('vedlikeholdsmodus (reise): senker båndet til hold-ved-like (0.5–0.8× anker)', () => {
		// Samme anker som første test (forrige uke 200), men på reise.
		const normal = computeEffortBudget([okt('2026-07-07', 200)], CONFIG, PLAN_START, '2026-07-15');
		const ferie = computeEffortBudget([okt('2026-07-07', 200)], CONFIG, PLAN_START, '2026-07-15', true);
		expect(normal.maintenance).toBe(false);
		expect(ferie.maintenance).toBe(true);
		expect(ferie.bandMin).toBe(100); // 200 × 0.5
		expect(ferie.bandMax).toBe(160); // 200 × 0.8
		expect(ferie.bandMax).toBeLessThan(normal.bandMax);
	});

	it('deload hver 4. uke skalerer intervallet med 0.8', () => {
		// Uke 4 av planen starter 2026-07-27. Forrige uke: 200 effort.
		const budget = computeEffortBudget([okt('2026-07-22', 200)], CONFIG, PLAN_START, '2026-07-29');
		expect(budget.deload).toBe(true);
		expect(budget.bandMin).toBe(160);
		expect(budget.bandMax).toBe(192);
	});

	it('anbefaler hvile når akutt belastning er høy mot kronisk', () => {
		// 30 dager med jevn trening (~20/dag), så 3 voldsomme dager
		const workouts: EnduranceWorkout[] = [];
		for (let i = 29; i >= 3; i--) {
			const d = new Date('2026-07-15T00:00:00Z');
			d.setUTCDate(d.getUTCDate() - i);
			workouts.push(okt(d.toISOString().slice(0, 10), 20));
		}
		workouts.push(okt('2026-07-13', 150), okt('2026-07-14', 150), okt('2026-07-15', 150));
		const budget = computeEffortBudget(workouts, CONFIG, PLAN_START, '2026-07-15');
		expect(budget.acuteChronicRatio).toBeGreaterThan(1.5);
		expect(budget.restRecommended).toBe(true);
	});

	it('gir ingen ratio (og ingen hvileanbefaling) ved under 14 dagers historikk', () => {
		const budget = computeEffortBudget(
			[okt('2026-07-13', 150), okt('2026-07-14', 150), okt('2026-07-15', 150)],
			CONFIG,
			PLAN_START,
			'2026-07-15'
		);
		expect(budget.acuteChronicRatio).toBeNull();
		expect(budget.restRecommended).toBe(false);
	});
});

describe('composeEffortSuggestion', () => {
	it('lite gjenstående → kun løp', () => {
		// midt i intervallet 60–80 = 70 → ~4 km @ 6:40
		const text = composeEffortSuggestion(60, 80, 400)!;
		expect(text).toContain('km løp');
		expect(text).not.toContain('sykkel');
	});

	it('mye gjenstående → løp + sykkel som til sammen treffer intervallet', () => {
		const text = composeEffortSuggestion(200, 240, 400)!;
		expect(text).toContain('km løp');
		expect(text).toContain('min sykkel');
		// Summen av effort-tallene i teksten skal ligge nær midten (220 ± 15 %)
		const efforts = [...text.matchAll(/~(\d+)/g)].map((m) => Number(m[1]));
		const total = efforts.reduce((a, b) => a + b, 0);
		expect(total).toBeGreaterThan(220 * 0.85);
		expect(total).toBeLessThan(220 * 1.15);
	});

	it('returnerer null når uken i praksis er i mål', () => {
		expect(composeEffortSuggestion(0, 10, 400)).toBeNull();
	});
});

describe('summarizeWeekSessions', () => {
	it('tar med denne ukas løp/sykkel-økter som segmenter, ikke forrige uke eller styrke', () => {
		// I dag onsdag 2026-07-15 (uke fra mandag 13.)
		const sessions = summarizeWeekSessions(
			[
				okt('2026-07-10', 100), // forrige uke
				okt('2026-07-13', 130),
				okt('2026-07-14', 60, 'cycling'),
				okt('2026-07-14', 500, 'strength'),
				okt('2026-07-15', 40, 'ebike')
			],
			'2026-07-15'
		);
		expect(sessions).toEqual([
			{ date: '2026-07-13', family: 'running', effort: 130 },
			{ date: '2026-07-14', family: 'cycling', effort: 60 },
			{ date: '2026-07-15', family: 'ebike', effort: 40 }
		]);
	});
});

describe('buildWeekPlanExamples', () => {
	it('regner økter om til effort og andel av ukas mål', () => {
		// Pace 400 sek/km, band 200–240 → mid 220.
		// Tallene uttrykkes gjennom MET_CALIBRATION framfor hardkodet, fordi
		// planleggeren og skåringen nå deler konstanten — en test som låser nivået
		// her ville feilet hver gang modellen rekalibreres, uten å si noe om at
		// planleggeren og skåringen er uenige (som er det den skal vokte).
		const examples = buildWeekPlanExamples(400, 200, 240);

		const lop8 = examples.find((e) => e.label === 'Løp 8 km')!;
		const forventetLop8 = Math.round(8 * (400 / 60) * MET_CALIBRATION);
		expect(lop8.effort).toBe(forventetLop8);
		expect(lop8.pctOfBand).toBe(Math.round((forventetLop8 / 220) * 100));

		const elsykkel = examples.find((e) => e.label === 'El-sykkel 40 min')!;
		expect(elsykkel.effort).toBe(Math.round(40 * MET_FACTOR_BY_FAMILY.ebike * MET_CALIBRATION));

		const sykkel = examples.find((e) => e.label === 'Sykkeltur 40 min')!;
		expect(sykkel.effort).toBe(Math.round(40 * MET_FACTOR_BY_FAMILY.cycling * MET_CALIBRATION));
	});

	it('sykkel koster mer enn el-sykkel, og løp mer enn begge', () => {
		// Det som faktisk skal holde uansett kalibrering: rekkefølgen.
		const examples = buildWeekPlanExamples(400, 200, 240);
		const effortFor = (label: string) => examples.find((e) => e.label === label)!.effort;
		expect(effortFor('Løp 8 km')).toBeGreaterThan(effortFor('Sykkeltur 40 min'));
		expect(effortFor('Sykkeltur 40 min')).toBeGreaterThan(effortFor('El-sykkel 40 min'));
	});

	it('tåler tomt band uten å dele på null', () => {
		const examples = buildWeekPlanExamples(400, 0, 0);
		expect(examples.every((e) => Number.isFinite(e.pctOfBand))).toBe(true);
	});
});

describe('projectWeekEffort', () => {
	it('prognostiserer resten av uka fra vanlig ukedagsmønster', () => {
		// 4 uker med fast mønster: tirsdag 100, torsdag 80 (uker som starter 15.06–06.07).
		// Denne uka (mandag 13.07): tirsdag 14. er gjort (100). I dag onsdag 15.
		const history = ['2026-06-16', '2026-06-23', '2026-06-30', '2026-07-07'].map((d) => okt(d, 100));
		const thursdays = ['2026-06-18', '2026-06-25', '2026-07-02', '2026-07-09'].map((d) => okt(d, 80));
		const thisWeek = [okt('2026-07-14', 100)];
		const projection = projectWeekEffort([...history, ...thursdays, ...thisWeek], '2026-07-15');
		// Gjenstår tor–søn: torsdag pleier å gi 80 → forventet rest 80
		expect(projection.expectedRemaining).toBe(80);
		expect(projection.projectedTotal).toBe(180);
		expect(projection.remainingDays).toBe(4);
	});

	it('søndag: ingen gjenstående dager, prognose = forbrukt', () => {
		const projection = projectWeekEffort([okt('2026-07-14', 100)], '2026-07-19');
		expect(projection.remainingDays).toBe(0);
		expect(projection.expectedRemaining).toBe(0);
		expect(projection.projectedTotal).toBe(100);
	});

	it('styrke teller ikke i prognosen', () => {
		const projection = projectWeekEffort(
			[okt('2026-07-07', 500, 'strength'), okt('2026-07-14', 100)],
			'2026-07-15'
		);
		expect(projection.projectedTotal).toBe(100);
	});
});

describe('composeWeekRecipe', () => {
	it('setter sammen økter som lander i gjenstående intervall, med løp foretrukket', () => {
		// Gjenstår 180–230 @ pace 400: Rolig 8 km (133) + Intervaller 30 min (75) = 208 ✓
		const recipe = composeWeekRecipe(180, 230, 400)!;
		expect(recipe.totalEffort).toBeGreaterThanOrEqual(180);
		expect(recipe.totalEffort).toBeLessThanOrEqual(230);
		expect(recipe.sessions.some((s) => s.includes('km') || s.includes('Intervaller'))).toBe(true);
	});

	it('lite gjenstående → én økt holder', () => {
		const recipe = composeWeekRecipe(70, 100, 400)!;
		expect(recipe.sessions).toHaveLength(1);
		expect(recipe.totalEffort).toBeGreaterThanOrEqual(70);
		expect(recipe.totalEffort).toBeLessThanOrEqual(100);
	});

	it('uken i praksis i mål → null', () => {
		expect(composeWeekRecipe(0, 15, 400)).toBeNull();
	});

	it('preferVariety vekter mot kryss-trening når løp dominerer', () => {
		// Uten variasjonsvekting foretrekkes løp; med preferVariety skal en
		// ikke-løpsøkt inngå i oppskriften (belønner balanse).
		const gap = { min: 70, max: 130 };
		const uten = composeWeekRecipe(gap.min, gap.max, 400)!;
		const med = composeWeekRecipe(gap.min, gap.max, 400, { preferVariety: true })!;
		expect(uten.sessions.every((s) => s.includes('km') || s.includes('Intervaller'))).toBe(true);
		expect(med.sessions.some((s) => /sykkel/i.test(s))).toBe(true);
	});

	it('stort gap → nærmeste kombinasjon over minimum', () => {
		const recipe = composeWeekRecipe(500, 520, 400);
		// 3 × Rolig 8 km = 399 < 500 → ingen når target... eller sykkel-kombos:
		// maks 3 økter: 133+133+133=399; med sykkel 133+133+85=351. Ingen ≥ 500 → null
		expect(recipe).toBeNull();
	});
});

describe('pickBoostSuggestion', () => {
	const EXAMPLES = [
		{ label: 'Løp 5 km', effort: 83, pctOfBand: 38 },
		{ label: 'Løp 8 km', effort: 133, pctOfBand: 61 },
		{ label: 'El-sykkel 40 min', effort: 40, pctOfBand: 18 }
	];

	it('velger minste økt som tetter gapet', () => {
		expect(pickBoostSuggestion(70, EXAMPLES)!.label).toBe('Løp 5 km');
		expect(pickBoostSuggestion(30, EXAMPLES)!.label).toBe('El-sykkel 40 min');
	});

	it('gap større enn alt → største eksempel', () => {
		expect(pickBoostSuggestion(200, EXAMPLES)!.label).toBe('Løp 8 km');
	});

	it('intet gap → null', () => {
		expect(pickBoostSuggestion(0, EXAMPLES)).toBeNull();
		expect(pickBoostSuggestion(-50, EXAMPLES)).toBeNull();
	});
});

describe('computeEffortBudget — sykeuker', () => {
	const sickWeek = (monday: string) =>
		Array.from({ length: 7 }, (_, i) => {
			const d = new Date(`${monday}T00:00:00Z`);
			d.setUTCDate(d.getUTCDate() + i);
			return d.toISOString().slice(0, 10);
		});

	it('senker båndet i uka man er syk, med null som gulv', () => {
		const workouts = [okt('2026-07-08', 200)];
		const frisk = computeEffortBudget(workouts, CONFIG, PLAN_START, '2026-07-15');
		const syk = computeEffortBudget(workouts, CONFIG, PLAN_START, '2026-07-15', false, [
			'2026-07-14'
		]);
		expect(syk.sick).toBe(true);
		expect(syk.bandMin).toBe(0);
		expect(syk.bandMax).toBeLessThan(frisk.bandMax);
	});

	it('holder sykeuker utenfor ankeret — de sier ingenting om normalen', () => {
		// Fire uker: tre normale på 300, én sykeuke på 20.
		const workouts = [
			okt('2026-06-17', 300),
			okt('2026-06-24', 300),
			okt('2026-07-01', 20),
			okt('2026-07-08', 300)
		];
		const uten = computeEffortBudget(workouts, CONFIG, PLAN_START, '2026-07-15');
		const med = computeEffortBudget(workouts, CONFIG, PLAN_START, '2026-07-15', false,
			sickWeek('2026-06-29'));

		expect(med.sickWeeksSkipped).toBe(1);
		expect(med.anchorWeeks).toBe(3);
		// Ankeret uten sykeuka er 300; med den er det 230.
		expect(med.bandMax).toBeGreaterThan(uten.bandMax);
	});

	it('sykdom overstyrer vedlikeholdsmodus', () => {
		const workouts = [okt('2026-07-08', 200)];
		const ferie = computeEffortBudget(workouts, CONFIG, PLAN_START, '2026-07-15', true);
		const begge = computeEffortBudget(workouts, CONFIG, PLAN_START, '2026-07-15', true, [
			'2026-07-15'
		]);
		expect(begge.bandMin).toBe(0);
		expect(begge.bandMax).toBeLessThan(ferie.bandMax);
	});
});
