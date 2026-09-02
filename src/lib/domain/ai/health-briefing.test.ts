import { describe, it, expect } from 'vitest';
import {
	buildHealthBriefing,
	describeStreaks,
	describeTraining,
	describeWeight,
	MAX_LISTED_DISCIPLINES,
	type BriefingStreak,
	type BriefingTraining,
	type BriefingWeight
} from './health-briefing';
import type { FramedGoal } from '$lib/domain/health/goal-horizon';

const weight: BriefingWeight = {
	latest: { date: '2026-08-23', weightKg: 82.9 },
	trendKg: 82.4,
	changes: [
		{ windowDays: 7, actualDays: 7, deltaKg: -0.3 },
		{ windowDays: 30, actualDays: 31, deltaKg: -1.2 },
		{ windowDays: 90, actualDays: 90, deltaKg: -4.1 }
	],
	currentSentence: 'Ned 5,8 kg siden 3. april, i snitt 0,29 kg per uke. Perioden pågår.',
	goal: { goalKg: 78, remainingKg: 4.4, reached: false },
	coverage: { weighIns: 1204, firstWeighIn: '2017-10-13', daysSinceLatest: 1 }
};

const training: BriefingTraining = {
	week: {
		spentEffort: 426,
		bandMin: 232,
		bandMax: 278,
		planText: 'Du har gjort mer enn planen ba om denne uka.',
		loadText: 'Belastningen er høy — vurder en roligere dag.',
		runKm: 41.2,
		weekTargetKm: 50
	},
	load: {
		ctl: 61,
		atl: 75,
		tsb: -14,
		status: { label: 'Sliten', tone: 'tired' as const, hint: 'Legg inn en rolig dag før neste harde økt.' },
		ctlChange: 4,
		ctlChangeDays: 14,
		ctlSettled: true
	},
	balance: {
		score: 36,
		disciplines: [
			{ family: 'løping', pct: 62, sessions: 11 },
			{ family: 'elsykkel', pct: 24, sessions: 6 },
			{ family: 'styrke', pct: 9, sessions: 3 }
		],
		nudge: 'Du har ikke hatt en styrkeøkt på ni dager.'
	},
	plan: {
		name: 'Base til november',
		startDate: '2026-07-06',
		durationWeeks: 16,
		milestonesAchieved: 3,
		milestonesTotal: 9,
		todaySuggestion: 'Rolig langtur — 90 min i sone 2',
		restReason: null
	}
};

const streak = (over: Partial<BriefingStreak> = {}): BriefingStreak => ({
	title: 'Løpt minst 15 min',
	emoji: '🏃',
	count: 4,
	unit: 'day',
	bestCount: 12,
	status: 'ok',
	gapCount: 0,
	gapUnits: 0,
	windowCount: null,
	windowTarget: null,
	daysUntilDue: null,
	...over
});

const goal = (over: Partial<FramedGoal> = {}): FramedGoal => ({
	title: 'Ned til 78 kg',
	horizon: 'kort',
	daysLeft: 83,
	progressText: '82,4 kg av 78 kg (4,4 kg igjen, fra 88,2 kg)',
	completion: 0.57,
	paused: false,
	...over
});

describe('describeWeight', () => {
	it('leder med trenden og den pågående perioden', () => {
		const lines = describeWeight(weight);
		expect(lines[0]).toContain('Trend 82,4 kg');
		expect(lines[0]).toContain('siste veiing 82,9 kg');
		// Perioden FØR de faste vinduene: den er svaret på «hvor mye har jeg gått ned».
		expect(lines[1]).toBe(weight.currentSentence);
	});

	it('skriver fortegn på endringene', () => {
		const line = describeWeight(weight).find((l) => l.startsWith('Endring'));
		expect(line).toContain('−0,3 kg (7 d)');
		expect(line).toContain('−4,1 kg (90 d)');
	});

	it('flagger et vindu der brukeren ikke veide seg', () => {
		const line = describeWeight({
			...weight,
			changes: [{ windowDays: 7, actualDays: 24, deltaKg: -0.9 }]
		}).find((l) => l.startsWith('Endring'));
		// «siste 7 dager» ville vært feil når referansepunktet lå 24 dager tilbake.
		expect(line).toContain('målt over 24');
	});

	it('navngir kilden til målvekta', () => {
		// Terskelarket og sensor_goals er to kilder som begge betyr «målvekt». Uten
		// kilde blir to tall enten valgt tilfeldig eller sagt begge — «85 kg og 95 kg».
		expect(describeWeight(weight).join('\n')).toContain('Målvekt satt i metrikk-arket: 78,0 kg');
	});

	it('skriver årstall på første veiing', () => {
		// «fra 13. okt.» om en måling fra 2017 leses som i år — ni år feil dekning.
		expect(describeWeight(weight).join('\n')).toContain('fra 13. oktober 2017');
	});

	it('sier fra når siste veiing er gammel', () => {
		const lines = describeWeight({
			...weight,
			coverage: { ...weight.coverage, daysSinceLatest: 19 }
		});
		// Uten dette kan ikke modellen skille «vekta står stille» fra «ingen veiing».
		expect(lines.join('\n')).toContain('siste for 19 dager siden');
	});

	it('utelater trenden framfor å gjette når den mangler', () => {
		const lines = describeWeight({ ...weight, trendKg: null, changes: [] });
		expect(lines[0]).toContain('for få målinger til en trend');
		expect(lines.join('\n')).not.toContain('Trend ');
	});

	it('sier at målet er nådd framfor å oppgi 0 igjen', () => {
		const lines = describeWeight({
			...weight,
			goal: { goalKg: 83, remainingKg: 0, reached: true }
		});
		expect(lines.join('\n')).toContain('Målvekt satt i metrikk-arket: 83,0 kg — nådd');
	});
});

describe('describeTraining', () => {
	it('gjentar flatens egne setninger om uka og belastningen', () => {
		const text = describeTraining(training).join('\n');
		// planText og loadText er to ulike dommer og skal ikke smeltes sammen:
		// budsjettet sier «fulgte du planen», akutt/kronisk sier «tåler kroppen det».
		expect(text).toContain('Du har gjort mer enn planen ba om denne uka.');
		expect(text).toContain('Belastningen er høy — vurder en roligere dag.');
		expect(text).toContain('426 effort av båndet 232–278');
	});

	it('skriver balansen med fortegn og status', () => {
		const line = describeTraining(training).find((l) => l.startsWith('Belastning:'));
		expect(line).toContain('form 61');
		expect(line).toContain('balanse −14 (Sliten)');
		expect(line).toContain('steget 4 på 14 dager');
	});

	it('gjentar flatens hint om hva tallet betyr for neste økt', () => {
		// `label` er en tilstand, `hint` er rådet. Uten hintet finner modellen sine
		// egne ord for hva «Sliten» bør føre til.
		expect(describeTraining(training).join('\n')).toContain(
			'Legg inn en rolig dag før neste harde økt.'
		);
	});

	it('kvalifiserer formtallet før CTL har svingt inn', () => {
		const line = describeTraining({
			...training,
			load: { ...training.load!, ctlSettled: false }
		}).find((l) => l.startsWith('Belastning:'));
		expect(line).toContain('har ikke svingt inn ennå');
	});

	it('lister sammensetningen med økter, og kapper halen', () => {
		const many = Array.from({ length: 9 }, (_, i) => ({
			family: `gren${i}`,
			pct: 10,
			sessions: 1
		}));
		const line = describeTraining({
			...training,
			balance: { ...training.balance!, disciplines: many }
		}).find((l) => l.startsWith('Sammensetning'));
		expect(line).toContain('gren0 10 % (1 økt)');
		expect(line).not.toContain(`gren${MAX_LISTED_DISCIPLINES}`);
	});

	it('viser treningsløpet med fremdrift', () => {
		const text = describeTraining(training).join('\n');
		expect(text).toContain('Treningsløp «Base til november»');
		expect(text).toContain('3 av 9 milepæler nådd');
		expect(text).toContain('Planlagt i dag: Rolig langtur');
	});

	it('sier hvile når det er hvile', () => {
		const text = describeTraining({
			...training,
			plan: { ...training.plan!, todaySuggestion: null, restReason: 'To harde dager på rad' }
		}).join('\n');
		expect(text).toContain('Hvile i dag: To harde dager på rad');
		expect(text).not.toContain('Planlagt i dag');
	});
});

describe('describeStreaks', () => {
	it('bruker flatens egen etikett', () => {
		expect(describeStreaks([streak()])[0]).toBe('🏃 Løpt minst 15 min: 4 dager på rad — beste 12');
	});

	it('viser perioden for count_per_window', () => {
		const line = describeStreaks([
			streak({ unit: 'week', count: 3, bestCount: 3, windowCount: 1, windowTarget: 2 })
		])[0];
		expect(line).toContain('3 uker på rad');
		expect(line).toContain('1 av 2 denne perioden');
	});

	it('sier BRUTT og overtid på max_interval', () => {
		const line = describeStreaks([
			streak({ status: 'overdue', daysUntilDue: -3, count: 0, bestCount: 5 })
		])[0];
		expect(line).toContain('3 dager på overtid');
		expect(line).toContain('BRUTT');
		// count 0 gir tom streakLabel — briefingen må likevel si noe forståelig.
		expect(line).toContain('ingen aktiv rekke');
	});

	it('markerer det som må holdes snart', () => {
		expect(describeStreaks([streak({ status: 'due_soon', daysUntilDue: 1 })])[0]).toContain(
			'forfaller om 1 dag'
		);
	});
});

describe('buildHealthBriefing', () => {
	it('bygger alle seksjonene med overskrift og fot', () => {
		const text = buildHealthBriefing({
			weight,
			training,
			streaks: [streak()],
			goals: [goal()], sick: null, symptoms: null, temperature: null
		});
		expect(text).toContain('--- HELSE: HVOR BRUKEREN STÅR NÅ ---');
		expect(text).toContain('VEKT:');
		expect(text).toContain('TRENING:');
		expect(text).toContain('STREAKS:');
		expect(text).toContain('MÅL I HELSE-FAMILIEN:');
		expect(text).toContain('--- SLUTT PÅ HELSE ---');
	});

	it('sier at briefingen er et utsnitt', () => {
		// Uten denne setningen slutter modellen å hente historikk den trenger.
		const text = buildHealthBriefing({ weight, training: null, streaks: [], goals: [], sick: null, symptoms: null, temperature: null });
		expect(text).toContain('UTSNITT');
	});

	it('dropper seksjoner uten innhold framfor tomme overskrifter', () => {
		const text = buildHealthBriefing({ weight, training: null, streaks: [], goals: [], sick: null, symptoms: null, temperature: null });
		expect(text).toContain('VEKT:');
		expect(text).not.toContain('TRENING:');
		expect(text).not.toContain('STREAKS:');
		expect(text).not.toContain('MÅL I HELSE-FAMILIEN:');
	});

	it('gir tom streng når det ikke er noe å si', () => {
		// En overskrift uten innhold ser ut som at data mangler.
		expect(buildHealthBriefing({ weight: null, training: null, streaks: [], goals: [], sick: null, symptoms: null, temperature: null })).toBe('');
	});

	it('tar med målene med progresjon og pause', () => {
		const text = buildHealthBriefing({
			weight: null,
			training: null,
			streaks: [],
			goals: [goal(), goal({ title: 'Løpe 5 km under 25 min', progressText: null, paused: true })],
			sick: null, symptoms: null, temperature: null
		});
		expect(text).toContain('4,4 kg igjen');
		expect(text).toContain('83 dager igjen');
		expect(text).toContain('PÅ PAUSE');
	});
});

describe('buildHealthBriefing — sykdom', () => {
	it('står øverst, før vekt og trening', () => {
		const text = buildHealthBriefing({
			weight: null,
			training: null,
			streaks: [],
			goals: [],
			sick: 'Syk siden 1. sep (3 dager, ingen sluttdato satt)', symptoms: null, temperature: null
		});
		expect(text).toContain('SYKDOM:');
		expect(text).toContain('Syk siden 1. sep');
	});

	it('sier at streaks er pauset, så modellen ikke lover det på egen hånd', () => {
		const text = buildHealthBriefing({
			weight: null,
			training: null,
			streaks: [],
			goals: [],
			sick: 'Syk 1.–3. sep (3 dager)', symptoms: null, temperature: null
		});
		expect(text).toContain('Streaks er pauset');
		expect(text).toContain('ikke som sviktende rytme');
		// Regelen står nå i den lengre grense-linja, sammen med symptomforbudet.
		expect(text).toContain('ikke gi medisinske råd');
	});

	it('ingen seksjon uten en aktiv periode', () => {
		const text = buildHealthBriefing({
			weight: null,
			training: null,
			streaks: [],
			goals: [goal()],
			sick: null, symptoms: null, temperature: null
		});
		expect(text).not.toContain('SYKDOM');
	});
});

describe('buildHealthBriefing — symptomer og temperatur', () => {
	const sick = (over: Record<string, unknown> = {}) =>
		buildHealthBriefing({
			weight: null,
			training: null,
			streaks: [],
			goals: [],
			sick: 'Syk siden 1. sep (3 dager, ingen sluttdato satt)',
			symptoms: null,
			temperature: null,
			...over
		});

	it('tar med symptomene brukeren selv har meldt', () => {
		const text = sick({
			symptoms: 'vondt i halsen (mye) er det som begrenser; også: slimhoste (merkbart)'
		});
		expect(text).toContain('Symptomer brukeren selv har meldt');
		expect(text).toContain('slimhoste');
	});

	it('navngir temperaturkilden — de to tallene er ikke sammenlignbare', () => {
		const text = sick({
			temperature: {
				core: '38,9 °C',
				skin: 'Hudtemperatur 0,8 °C over ditt eget snitt'
			}
		});
		expect(text).toContain('Termometer (kjernetemperatur): 38,9 °C');
		expect(text).toContain('Klokka (hudtemperatur, avvik fra eget snitt)');
	});

	it('forbyr tolkning eksplisitt — loggen er en journal, ikke et grunnlag for råd', () => {
		const text = sick({ symptoms: 'vondt i halsen (mye) er det som begrenser' });
		expect(text).toContain('ikke tolk dem');
		expect(text).toContain('ikke antyd en diagnose');
		expect(text).toContain('heller ikke om å oppsøke lege');
	});

	it('uten sykeperiode finnes ingen seksjon å legge symptomene i', () => {
		const text = buildHealthBriefing({
			weight: null,
			training: null,
			streaks: [],
			goals: [goal()],
			sick: null,
			symptoms: 'ømt kne (litt)',
			temperature: null
		});
		expect(text).not.toContain('SYKDOM');
		expect(text).not.toContain('ømt kne');
	});
});
