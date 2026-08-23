import { describe, it, expect } from 'vitest';
import { dailyWeights, type WeightDay, type WeightMeasurement } from './weight-series';
import {
	buildWeightMilestones,
	qualifyByMuscleLoss,
	longestGapBetween,
	describeSpan,
	formatMilestoneDate,
	MAX_MILESTONES,
	MEANINGFUL_DROP_KG,
	MIN_HISTORY_WEIGH_INS,
	type MilestoneKind
} from './weight-milestones';

const TODAY = '2026-08-05';

function iso(dayNumber: number): string {
	return new Date(dayNumber * 86_400_000).toISOString().slice(0, 10);
}

const TODAY_NUMBER = Math.round(Date.parse(`${TODAY}T00:00:00Z`) / 86_400_000);

/**
 * Bygger en dagsserie som slutter `endOffset` dager før TODAY. `values` er eldste
 * først, én per kalenderdag.
 */
function build(
	values: number[],
	opts: { endOffset?: number; muscle?: number[]; fat?: number[]; skip?: (i: number) => boolean } = {}
): WeightDay[] {
	const endOffset = opts.endOffset ?? 0;
	const firstDay = TODAY_NUMBER - endOffset - (values.length - 1);
	const rows: WeightMeasurement[] = [];
	values.forEach((weightKg, i) => {
		if (opts.skip?.(i)) return;
		rows.push({
			date: iso(firstDay + i),
			weightKg,
			muscleMassKg: opts.muscle?.[i] ?? null,
			fatMassKg: opts.fat?.[i] ?? null
		});
	});
	return dailyWeights(rows);
}

/** Lineær serie fra `from` til `to` over `length` dager. */
function ramp(from: number, to: number, length: number): number[] {
	return Array.from({ length }, (_, i) =>
		Math.round((from + ((to - from) * i) / (length - 1)) * 10) / 10
	);
}

function flat(value: number, length: number): number[] {
	return Array.from({ length }, () => value);
}

function kinds(days: WeightDay[], goalKg?: number | null): MilestoneKind[] {
	return buildWeightMilestones({ days, today: TODAY, goalKg }).milestones.map((m) => m.kind);
}

function find(days: WeightDay[], kind: MilestoneKind, goalKg?: number | null) {
	return buildWeightMilestones({ days, today: TODAY, goalKg }).milestones.find(
		(m) => m.kind === kind
	);
}

describe('formatering', () => {
	it('tar alltid med årstallet — dybden er hele poenget', () => {
		expect(formatMilestoneDate('2025-03-12')).toBe('12. mars 2025');
	});

	it('beskriver spenn i dager, måneder og år', () => {
		expect(describeSpan(45)).toBe('45 dager');
		expect(describeSpan(120)).toBe('4 måneder');
		expect(describeSpan(365)).toBe('1 år');
		expect(describeSpan(517)).toBe('1 år og 5 måneder');
	});
});

describe('historikk-porten', () => {
	it('gir ingen milepæler uten målinger', () => {
		const result = buildWeightMilestones({ days: [], today: TODAY });
		expect(result.milestones).toEqual([]);
		expect(result.enoughHistory).toBe(false);
	});

	it('regner ikke rekorder på en kort historikk', () => {
		// Ti veiinger over ti dager: alt er en «rekord», og ingenting betyr noe.
		const result = buildWeightMilestones({ days: build(ramp(84, 82, 10)), today: TODAY });
		expect(result.enoughHistory).toBe(false);
		expect(result.milestones.map((m) => m.kind)).not.toContain('lowest-trend');
		expect(result.milestones.map((m) => m.kind)).not.toContain('largest-drop');
	});

	it('åpner for rekorder når historikken er dyp nok', () => {
		const result = buildWeightMilestones({ days: build(ramp(84, 82, 120)), today: TODAY });
		expect(result.enoughHistory).toBe(true);
		expect(result.weighIns).toBeGreaterThanOrEqual(MIN_HISTORY_WEIGH_INS);
		expect(result.historyDays).toBe(119);
	});
});

describe('laveste trend', () => {
	it('sier «laveste vi har målt» når ingenting er lavere', () => {
		const milestone = find(build(ramp(86, 81, 200)), 'lowest-trend');
		expect(milestone?.sentence).toContain('den laveste vi har målt');
		expect(milestone?.tone).toBe('positiv');
	});

	it('peker på forrige gang du var like lav', () => {
		// Ned til 80, opp til 85 i tre måneder, så ned til 81 igjen.
		const days = build([...flat(85, 30), ...flat(80, 30), ...flat(85, 90), ...flat(81, 30)]);
		const milestone = find(days, 'lowest-trend');
		expect(milestone?.sentence).toMatch(/har ikke vært lavere enn 81,\d kg siden/);
		expect(milestone?.sinceDate).toBeTruthy();
	});

	it('holder kjeft på et platå', () => {
		// Samme vekt i 200 dager: ingen rekord, selv om dagens trend teknisk sett
		// er den laveste vi har målt. `hasRecentProgress` er vakta.
		expect(kinds(build(flat(82, 200)))).not.toContain('lowest-trend');
	});

	it('fyrer på en jevn, treg nedgang', () => {
		/**
		 * Regresjonen som `RECORD_MARGIN_KG` ble skrevet for. 0,75 kg i måneden gir
		 * en trend som står stille i tre-fire dager i strekk etter avrunding, og
		 * `<=`-varianten pekte derfor på i forgårs og ble filtrert bort. Nettopp
		 * denne brukeren — jevn nedgang over en høst — fikk aldri milepælen.
		 */
		const days = build(ramp(84, 81, 120));
		expect(kinds(days)).toContain('lowest-trend');
	});
});

describe('største nedgang', () => {
	/**
	 * Fixturene her slutter med en OPPGANG, og det er ikke tilfeldig: er en nedgang
	 * fortsatt i gang, viker det faste vinduet for `current-swing`, som forteller
	 * samme historie fra der den begynte. Se «pågående periode» under.
	 */
	it('navngir vinduet og sier at det er en rekord', () => {
		const days = build([...ramp(86, 80, 150), ...ramp(80, 83, 60)]);
		const milestone = find(days, 'largest-drop');
		expect(milestone?.sentence).toMatch(/^Ned \d+,\d kg på \d+ dager/);
		expect(milestone?.sentence).toContain('vi har målt');
	});

	it('krever at nedgangen overstiger støyen', () => {
		// 0,3 kg over hundre dager er vektas egen usikkerhet, ikke et vekttap.
		const days = build([...flat(82, 100), ...ramp(82, 82 - MEANINGFUL_DROP_KG + 0.2, 90)]);
		expect(kinds(days)).not.toContain('largest-drop');
	});

	it('sammenligner bare med perioder som ikke overlapper dagens', () => {
		/**
		 * Ett langt, jevnt fall. Hvert 90-dagersvindu inne i fallet er like bratt
		 * som dagens, men de overlapper — og «bratteste 90 dager siden for to uker
		 * siden» er en sammenligning av en periode med seg selv. Referansen må
		 * derfor ligge minst et helt vindu tilbake.
		 */
		const days = build([...ramp(90, 80, 400), ...ramp(80, 82, 40)]);
		const milestone = find(days, 'largest-drop');
		expect(milestone).toBeTruthy();
		if (milestone?.sinceDate) {
			const sinceNumber = Math.round(Date.parse(`${milestone.sinceDate}T00:00:00Z`) / 86_400_000);
			expect(TODAY_NUMBER - sinceNumber).toBeGreaterThanOrEqual(30);
		}
	});

	it('krever et vindu som ikke bare gjenforteller en pågående nedgang', () => {
		// Ett langt fall som fortsatt pågår: `current-swing` sier det samme fra
		// toppen, og to setninger om samme nedgang med ULIKE tall («ned 2,2 kg på
		// 180 dager» ved siden av «ned 5,9 kg siden januar») leses som en selvmotsigelse.
		const list = kinds(build(ramp(90, 80, 400)));
		expect(list).toContain('current-swing');
		expect(list).not.toContain('largest-drop');
	});
});

describe('pågående periode', () => {
	it('sier retning, ankerdato og tempo', () => {
		const days = build(ramp(90, 80, 400));
		const milestone = find(days, 'current-swing');
		expect(milestone?.sentence).toMatch(/^Ned \d+,\d kg siden toppen \d+\. \w+ \d{4}/);
		expect(milestone?.sentence).toContain('kg i måneden');
		expect(milestone?.tone).toBe('positiv');
	});

	it('er nøytral når perioden går oppover', () => {
		const days = build([...ramp(86, 80, 150), ...ramp(80, 83, 60)]);
		const milestone = find(days, 'current-swing');
		expect(milestone?.sentence).toMatch(/^Opp \d+,\d kg siden bunnen/);
		expect(milestone?.tone).toBe('nøytral');
	});

	it('lar det faste vinduet stå når perioden går oppover — det er to ulike historier', () => {
		const list = kinds(build([...ramp(86, 80, 150), ...ramp(80, 83, 60)]));
		expect(list).toContain('current-swing');
		expect(list).toContain('largest-drop');
	});

	it('avlyser feiringen når nedgangen er muskel', () => {
		const values = ramp(84, 82, 200);
		const muscle = ramp(61, 59.5, 200);
		const milestone = find(build(values, { muscle }), 'current-swing');
		expect(milestone?.sentence).toContain('muskel');
		expect(milestone?.tone).toBe('nøytral');
	});

	it('feirer uforbeholdent når fettet står for nedgangen', () => {
		const values = ramp(84, 82, 200);
		const muscle = flat(60, 200);
		const milestone = find(build(values, { muscle }), 'current-swing');
		expect(milestone?.sentence).not.toContain('muskel');
		expect(milestone?.tone).toBe('positiv');
	});
});

describe('qualifyByMuscleLoss', () => {
	const day = (weightKg: number, muscleMassKg: number | null): WeightDay => ({
		date: '2026-01-01',
		weightKg,
		weighInCount: 1,
		fatMassKg: null,
		fatRatio: null,
		muscleMassKg,
		fatFreeMassKg: null
	});

	it('sier fra når over halve nedgangen er muskel', () => {
		const result = qualifyByMuscleLoss(day(84, 61), day(82, 59.6));
		expect(result?.muscleShare).toBeGreaterThan(0.5);
		expect(result?.sentence).toContain('muskel');
	});

	it('tier når muskelen står stille', () => {
		expect(qualifyByMuscleLoss(day(84, 60), day(82, 60))).toBeNull();
	});

	it('krever måling i begge ender framfor å gjette', () => {
		expect(qualifyByMuscleLoss(day(84, null), day(82, 60))).toBeNull();
		expect(qualifyByMuscleLoss(day(84, 61), day(82, null))).toBeNull();
	});

	it('sier ingenting om en oppgang', () => {
		expect(qualifyByMuscleLoss(day(82, 60), day(84, 59))).toBeNull();
	});
});

describe('gamle målinger', () => {
	it('stopper rekordene og sier hvorfor', () => {
		const days = build(ramp(86, 81, 200), { endOffset: 20 });
		const result = buildWeightMilestones({ days, today: TODAY });
		const list = result.milestones.map((m) => m.kind);
		expect(list).toContain('stale');
		expect(list).not.toContain('lowest-trend');
		expect(list).not.toContain('largest-drop');
		expect(result.milestones.find((m) => m.kind === 'stale')?.sentence).toContain('20 dager siden');
	});

	it('slipper målvekta gjennom likevel — den er ikke en rekord', () => {
		const days = build(ramp(86, 81, 200), { endOffset: 20 });
		expect(kinds(days, 80)).toContain('goal-distance');
	});
});

describe('atferdsmilepæler', () => {
	it('teller veiestreak fram til i dag', () => {
		const milestone = find(build(flat(82, 90)), 'weigh-in-streak');
		expect(milestone?.sentence).toMatch(/^\d+ dager på rad med veiing\.$/);
		expect(milestone?.basis).toBe('atferd');
	});

	it('nuller ikke streaken fordi morgenveiingen ikke har skjedd ennå', () => {
		// Serien slutter i går. Klokka sju om morgenen skal atten dager fortsatt
		// være atten dager.
		const milestone = find(build(flat(82, 90), { endOffset: 1 }), 'weigh-in-streak');
		expect(milestone).toBeTruthy();
	});

	it('faller tilbake på dekning når streaken er brutt', () => {
		// Hver sjuende dag mangler, så streaken blir maks seks — men dekningen er høy.
		const days = build(flat(82, 120), { skip: (i) => i % 7 === 0 });
		const list = kinds(days);
		expect(list).not.toContain('weigh-in-streak');
		expect(list).toContain('weigh-in-coverage');
	});

	it('sier ingenting om dekning når du nesten ikke veier deg', () => {
		const days = build(flat(82, 200), { skip: (i) => i % 10 !== 0 });
		expect(kinds(days)).not.toContain('weigh-in-coverage');
	});
});

describe('målvekt', () => {
	it('feirer å være under målet', () => {
		const milestone = find(build(ramp(86, 79, 200)), 'below-goal', 80);
		expect(milestone?.sentence).toContain('under målvekta på 80,0 kg');
		expect(milestone?.tone).toBe('positiv');
	});

	it('sier «på målvekta» framfor «0,0 kg under»', () => {
		const milestone = find(build(flat(80, 200)), 'below-goal', 80);
		expect(milestone?.sentence).toBe('Du er på målvekta på 80,0 kg.');
	});

	it('oppgir avstanden når du er over', () => {
		const milestone = find(build(flat(82, 200)), 'goal-distance', 80);
		expect(milestone?.sentence).toMatch(/^\d+,\d kg til målet på 80,0 kg\.$/);
		expect(milestone?.tone).toBe('nøytral');
	});

	it('gjør ingenting uten et mål', () => {
		const list = kinds(build(flat(82, 200)));
		expect(list).not.toContain('goal-distance');
		expect(list).not.toContain('below-goal');
	});
});

describe('avstand til lavpunktet', () => {
	it('orienterer når vekta har gått opp igjen', () => {
		// Oppgangen starter i en LOKAL bunn, ikke i historikkens lavpunkt: da sier de
		// to setningene ulike ting, og begge får stå.
		const days = build([
			...ramp(84, 80, 60),
			...ramp(80, 83, 50),
			...ramp(83, 81, 30),
			...ramp(81, 84, 30)
		]);
		const milestone = find(days, 'above-nadir');
		expect(milestone?.sentence).toMatch(/kg over lavpunktet på \d+,\d kg, målt/);
		expect(milestone?.tone).toBe('nøytral');
	});

	it('tier når en pågående oppgang starter PÅ lavpunktet — da er det samme setning', () => {
		const days = build([...ramp(86, 80, 150), ...ramp(80, 83, 60)]);
		const list = kinds(days);
		expect(list).toContain('current-swing');
		expect(list).not.toContain('above-nadir');
	});

	it('tier når du står på lavpunktet — da sier trend-rekorden det bedre', () => {
		const days = build(ramp(86, 81, 200));
		const list = kinds(days);
		expect(list).toContain('lowest-trend');
		expect(list).not.toContain('above-nadir');
	});
});

describe('rangering og antall', () => {
	it('viser aldri mer enn MAX_MILESTONES', () => {
		const days = build(ramp(90, 79, 400), { muscle: flat(60, 400) });
		expect(buildWeightMilestones({ days, today: TODAY, goalKg: 80 }).milestones.length).toBeLessThanOrEqual(
			MAX_MILESTONES
		);
	});

	it('setter trend-rekorden først', () => {
		const days = build(ramp(90, 79, 400));
		expect(kinds(days)[0]).toBe('lowest-trend');
	});

	it('dropper rå-rekorden når den handler om samme periode', () => {
		// Én lang nedgang: både trend og enkeltmåling er all-time-lave, og to
		// setninger om samme hendelse leses som to hendelser.
		const days = build(ramp(90, 79, 400));
		expect(kinds(days)).not.toContain('lowest-raw');
	});
});

describe('longestGapBetween', () => {
	it('finner lengste strekk uten veiing', () => {
		const days = build([82, 82, 82, 82], { skip: (i) => i === 1 || i === 2 });
		expect(longestGapBetween(days, days[0].date, days.at(-1)!.date)).toBe(3);
	});

	it('gir hele spennet når det ikke finnes to målinger inni', () => {
		const days = build(flat(82, 5));
		expect(longestGapBetween(days, '2026-01-01', '2026-01-20')).toBe(19);
	});
});
