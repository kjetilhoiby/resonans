import { describe, it, expect } from 'vitest';
import {
	MEDICATION_RHYTHMS,
	buildMedicationDay,
	describeDoseUse,
	describeMedicationDay,
	nextDose,
	describeMedication,
	dosesPerDay,
	medicationsDuringPeriod,
	medicationsOnDay,
	rankOngoingMedications,
	resolveMedication,
	validateMedication,
	type Medication
} from './medications';
import { buildEpisodeWindow, buildMedicationBars } from './sick-episode';

const med = (over: Partial<Medication> = {}): Medication => ({
	id: 'm1',
	name: 'Paracet',
	purpose: null,
	rhythm: 'ved_behov',
	times: [],
	startDate: '2026-09-10',
	endDate: null,
	note: null,
	...over
});

const dose = (day: string, id = 'm1', slot: string | null = null) => ({
	id: `d-${day}-${slot ?? 'x'}-${Math.random()}`,
	medicationId: id,
	day,
	takenAt: `${day}T09:00:00Z`,
	slot,
	note: null
});

describe('resolveMedication', () => {
	it('en kur som startet i dag varer én dag', () => {
		const r = resolveMedication(med({ startDate: '2026-09-17' }), '2026-09-17');
		expect(r.days).toBe(1);
		expect(r.ongoing).toBe(true);
	});

	it('teller aldri dager fram i tid', () => {
		// «Kuren varer ut uka» er en opplysning fra resepten, ikke dager som har vært.
		const r = resolveMedication(med({ endDate: '2026-09-30' }), '2026-09-17');
		expect(r.days).toBe(8);
		expect(r.ongoing).toBe(true);
	});

	it('avsluttet kur teller til sluttdatoen', () => {
		const r = resolveMedication(med({ endDate: '2026-09-14' }), '2026-09-17');
		expect(r.ongoing).toBe(false);
		expect(r.days).toBe(5);
	});

	it('bare ved_behov sporer doser', () => {
		expect(resolveMedication(med(), '2026-09-17').tracksDoses).toBe(true);
		expect(resolveMedication(med({ rhythm: 'fast' }), '2026-09-17').tracksDoses).toBe(false);
	});

	it('ingen foreldelse — en fast medisin kan gå i årevis', () => {
		// Motsatt av sykeperioden: en åpen kur UNNSKYLDER ingenting, den beskriver.
		const r = resolveMedication(med({ rhythm: 'fast', times: ['09:00'], startDate: '2024-01-01' }), '2026-09-17');
		expect(r.ongoing).toBe(true);
		expect(r.days).toBeGreaterThan(900);
	});
});

describe('dosesPerDay', () => {
	const days = ['2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12'];

	it('0 inne i kuren er en MÅLING, null utenfor er fravær av en', () => {
		// Motsatt av ernæringsregelen, og hele signalet: «trengte den ikke i dag»
		// er det som sporer bedringen. Leses den som «ikke logget», forsvinner den.
		const counts = dosesPerDay([dose('2026-09-10'), dose('2026-09-10')], med(), days);
		expect(counts.get('2026-09-09')).toBeNull();
		expect(counts.get('2026-09-10')).toBe(2);
		expect(counts.get('2026-09-11')).toBe(0);
	});

	it('etter sluttdatoen er null igjen', () => {
		const counts = dosesPerDay([], med({ endDate: '2026-09-10' }), days);
		expect(counts.get('2026-09-10')).toBe(0);
		expect(counts.get('2026-09-11')).toBeNull();
	});

	it('teller bare doser for sin egen kur', () => {
		const counts = dosesPerDay([dose('2026-09-10'), dose('2026-09-10', 'm2')], med(), days);
		expect(counts.get('2026-09-10')).toBe(1);
	});
});

describe('medicationsDuringPeriod', () => {
	it('kobles på datooverlapp, ikke på en fremmednøkkel', () => {
		const flu = { startDate: '2026-09-10', endDate: '2026-09-16' };
		const found = medicationsDuringPeriod(
			[
				med({ id: 'under', startDate: '2026-09-12', endDate: '2026-09-15' }),
				med({ id: 'foer', startDate: '2026-08-01', endDate: '2026-08-05' }),
				med({ id: 'evig', startDate: '2024-01-01', endDate: null })
			],
			flu,
			'2026-09-17'
		);
		expect(found.map((m) => m.id).sort()).toEqual(['evig', 'under']);
	});
});

describe('medicationsOnDay', () => {
	it('tar med kurer som var i gang den dagen', () => {
		const on = medicationsOnDay([med({ startDate: '2026-09-10', endDate: '2026-09-12' })], '2026-09-11');
		expect(on).toHaveLength(1);
		expect(medicationsOnDay([med({ startDate: '2026-09-10', endDate: '2026-09-12' })], '2026-09-13')).toHaveLength(0);
	});
});

describe('rankOngoingMedications', () => {
	it('ved behov øverst, deretter sist startet', () => {
		const ranked = rankOngoingMedications(
			[
				med({ id: 'fast-gammel', rhythm: 'fast', times: ['09:00'], startDate: '2026-09-01' }),
				med({ id: 'fast-ny', rhythm: 'fast', times: ['09:00'], startDate: '2026-09-15' }),
				med({ id: 'behov', rhythm: 'ved_behov', startDate: '2026-09-05' })
			],
			'2026-09-17'
		);
		expect(ranked.map((m) => m.id)).toEqual(['behov', 'fast-ny', 'fast-gammel']);
	});

	it('avsluttede kurer faller ut', () => {
		expect(rankOngoingMedications([med({ endDate: '2026-09-01' })], '2026-09-17')).toHaveLength(0);
	});
});

describe('validateMedication', () => {
	it('krever et navn', () => {
		expect(validateMedication({ name: '   ' }, '2026-09-17').ok).toBe(false);
	});

	it('avviser en startdato fram i tid', () => {
		const r = validateMedication({ name: 'Paracet', startDate: '2026-09-20' }, '2026-09-17');
		expect(r.ok).toBe(false);
	});

	it('godtar en sluttdato fram i tid — resepten sier når kuren er ferdig', () => {
		const r = validateMedication(
			{ name: 'Amoksicillin', rhythm: 'fast', times: 3, endDate: '2026-09-24' },
			'2026-09-17'
		);
		expect(r.ok).toBe(true);
	});

	it('tvinger times til tom på ved_behov', () => {
		// En plan på en ved-behov-medisin er en selvmotsigelse, og tider som ble
		// stående fra et rytmebytte ville blitt vist som om de gjaldt.
		const r = validateMedication(
			{ name: 'Paracet', rhythm: 'ved_behov', times: ['08:00'] },
			'2026-09-17'
		);
		expect(r.ok && r.value.times).toEqual([]);
	});

	it('en fast kur uten klokkeslett avvises', () => {
		// Uten tider har dagen ingen slots å hake av — altså ingen kalender, og en
		// halvferdig registrering som ville sett ut som en flate som ikke virker.
		expect(validateMedication({ name: 'Amoksicillin', rhythm: 'fast' }, '2026-09-17').ok).toBe(false);
	});

	it('et ANTALL gir standardtidene', () => {
		const r = validateMedication({ name: 'A', rhythm: 'fast', times: 3 }, '2026-09-17');
		expect(r.ok && r.value.times).toEqual(['08:00', '14:00', '20:00']);
	});

	it('klokkeslett sorteres og dedupliseres', () => {
		// To like slots kunne ikke skilles: en haking på den ene ville sett
		// vilkårlig ut på den andre.
		const r = validateMedication(
			{ name: 'A', rhythm: 'fast', times: ['20:00', '08:00', '08:00'] },
			'2026-09-17'
		);
		expect(r.ok && r.value.times).toEqual(['08:00', '20:00']);
	});

	it('avviser et klokkeslett som ikke er TT:MM', () => {
		expect(validateMedication({ name: 'A', rhythm: 'fast', times: ['8'] }, '2026-09-17').ok).toBe(false);
		expect(validateMedication({ name: 'A', rhythm: 'fast', times: ['25:00'] }, '2026-09-17').ok).toBe(false);
	});

	it('avviser en ukjent rytme framfor å gjette', () => {
		const r = validateMedication({ name: 'Paracet', rhythm: 'av og til' }, '2026-09-17');
		expect(r.ok).toBe(false);
	});

	it('rytmene er de to modulen er bygget rundt', () => {
		expect([...MEDICATION_RHYTHMS]).toEqual(['fast', 'ved_behov']);
	});
});

describe('describeMedication', () => {
	it('fast kur navngir planen', () => {
		const r = resolveMedication(
			med({ name: 'Amoksicillin', rhythm: 'fast', times: ['08:00', '14:00', '20:00'] }),
			'2026-09-13'
		);
		expect(describeMedication(r)).toBe('Amoksicillin — 3 × daglig (08, 14, 20) siden 10. sep (4 dager)');
	});

	it('avsluttet kur får spennet', () => {
		const r = resolveMedication(
			med({ name: 'Amoksicillin', rhythm: 'fast', times: ['08:00', '14:00', '20:00'], endDate: '2026-09-16' }),
			'2026-09-17'
		);
		expect(describeMedication(r)).toBe('Amoksicillin — 3 × daglig (08, 14, 20), 10.–16. sep (7 dager)');
	});

	it('ved behov sier «ved behov», ikke en plan', () => {
		expect(describeMedication(resolveMedication(med(), '2026-09-11'))).toContain('ved behov');
	});
});

describe('describeDoseUse', () => {
	const days = ['2026-09-10', '2026-09-11', '2026-09-12'];

	it('oppgir tallene og lar dem stå', () => {
		const counts = dosesPerDay(
			[dose('2026-09-10'), dose('2026-09-10'), dose('2026-09-10'), dose('2026-09-12')],
			med(),
			days
		);
		const text = describeDoseUse(counts, med());
		expect(text).toBe('Paracet: 4 doser på 3 dager, brukt 2 av dem, mest 3 på én dag.');
	});

	it('sier ALDRI at medisinen virket', () => {
		// Et forløp går over av seg selv, så alt startet midt i det ser virksomt ut.
		// «Du trengte den sjeldnere» er alt vi har dekning for — og selv det sies
		// bare som tall, ikke som en utvikling.
		const counts = dosesPerDay([dose('2026-09-10'), dose('2026-09-10')], med(), days);
		const text = describeDoseUse(counts, med()) ?? '';
		for (const forbidden of ['virk', 'hjalp', 'hjelper', 'effekt', 'bedre', 'bedring']) {
			expect(text.toLowerCase()).not.toContain(forbidden);
		}
	});

	it('tier for en fast kur', () => {
		const fast = med({ rhythm: 'fast' });
		expect(describeDoseUse(dosesPerDay([], fast, days), fast)).toBeNull();
	});

	it('skiller «ingen doser» fra «ingen målte dager»', () => {
		expect(describeDoseUse(dosesPerDay([], med(), days), med())).toContain('ingen doser logget');
		// Bare dager utenfor kuren: ingenting er målt, så det sies ingenting.
		const outside = dosesPerDay([], med({ startDate: '2026-09-20' }), days);
		expect(describeDoseUse(outside, med({ startDate: '2026-09-20' }))).toBeNull();
	});
});

describe('buildMedicationBars', () => {
	// Vinduet gjenbrukes fra forløpsmodulen, så bjelkene ligger på de samme
	// dato-pikslene som radene over — hele grunnen til at de tegnes der.
	const window = buildEpisodeWindow(
		{ id: 'p1', startDate: '2026-09-10', endDate: '2026-09-14', note: null },
		'2026-09-17',
		{ baselineDays: 3, recoveryDays: 3 }
	);
	// days: 07.09 → 17.09 (baseline 3, periode 5, etter 3)

	it('kuren blir et spenn på vinduets indekser', () => {
		const [bar] = buildMedicationBars(
			[med({ rhythm: 'fast', times: ['08:00', '14:00', '20:00'], startDate: '2026-09-11', endDate: '2026-09-13' })],
			[],
			window
		);
		expect(window.days[bar!.fromIndex]!.day).toBe('2026-09-11');
		expect(window.days[bar!.toIndex]!.day).toBe('2026-09-13');
		expect(bar!.startsBefore).toBe(false);
		expect(bar!.endsAfter).toBe(false);
	});

	it('merker avkorting i begge ender framfor å flytte kuren', () => {
		const [bar] = buildMedicationBars(
			[med({ rhythm: 'fast', times: ['09:00'], startDate: '2026-01-01', endDate: null })],
			[],
			window
		);
		expect(bar!.startsBefore).toBe(true);
		expect(bar!.endsAfter).toBe(false); // åpen kur klippes til siste dag i vinduet
		expect(bar!.fromIndex).toBe(0);
	});

	it('en kur helt utenfor vinduet faller ut', () => {
		expect(
			buildMedicationBars([med({ startDate: '2026-01-01', endDate: '2026-01-05' })], [], window)
		).toHaveLength(0);
	});

	it('fast rytme bærer ingen doser — antallet er gitt av planen', () => {
		const [bar] = buildMedicationBars(
			[med({ rhythm: 'fast', times: ['08:00', '14:00', '20:00'] })],
			[dose('2026-09-11')],
			window
		);
		expect(bar!.peakDoses).toBe(0);
		expect(bar!.dosesByIndex.every((v) => v === null)).toBe(true);
	});

	it('ved behov teller doser per dag, og topphøyden er skalaen', () => {
		const [bar] = buildMedicationBars(
			[med()],
			[dose('2026-09-11'), dose('2026-09-11'), dose('2026-09-11'), dose('2026-09-13')],
			window
		);
		const at = (day: string) => bar!.dosesByIndex[window.days.findIndex((d) => d.day === day)!];
		expect(at('2026-09-11')).toBe(3);
		expect(at('2026-09-13')).toBe(1);
		// Inne i kuren, ingen doser: en dag du ikke trengte den. Det ER målingen.
		expect(at('2026-09-12')).toBe(0);
		// Før kuren startet: ingenting å måle.
		expect(at('2026-09-09')).toBeNull();
		expect(bar!.peakDoses).toBe(3);
	});

	it('DAGENS dag holdes utenfor dosetellingen, men ikke utenfor kuren', () => {
		// Doser akkumulerer fra midnatt, så dagens teller er «så langt». En 0 der
		// er en falsk bunn, ikke en dag du klarte deg uten — samme regel som
		// skritt. Kuren selv strekker seg til og med i dag: det er en dag du går
		// på den, uansett om dagens dose er tatt.
		const [bar] = buildMedicationBars([med()], [dose('2026-09-17')], window);
		const todayIndex = window.days.findIndex((d) => d.day === '2026-09-17');
		expect(bar!.dosesByIndex[todayIndex]).toBeNull();
		expect(bar!.todayExcluded).toBe(true);
		expect(window.days[bar!.toIndex]!.day).toBe('2026-09-17');
	});

	it('todayExcluded er falsk når i dag lå utenfor kuren uansett', () => {
		// Ellers ville fotnoten «i dag er ikke med» vært en påstand om en dag som
		// aldri hørte til kuren.
		const [bar] = buildMedicationBars([med({ endDate: '2026-09-12' })], [], window);
		expect(bar!.todayExcluded).toBe(false);
	});

	it('ved behov først, deretter den som varte lengst', () => {
		const bars = buildMedicationBars(
			[
				med({ id: 'lang', rhythm: 'fast', times: ['09:00'], startDate: '2026-09-08', endDate: '2026-09-16' }),
				med({ id: 'kort', rhythm: 'fast', times: ['09:00'], startDate: '2026-09-11', endDate: '2026-09-12' }),
				med({ id: 'behov', rhythm: 'ved_behov', startDate: '2026-09-13' })
			],
			[],
			window
		);
		expect(bars.map((b) => b.id)).toEqual(['behov', 'lang', 'kort']);
	});
});

describe('buildMedicationDay — dosekalenderen', () => {
	const fast = med({
		id: 'a',
		name: 'Amoksicillin',
		rhythm: 'fast',
		times: ['08:00', '14:00', '20:00'],
		startDate: '2026-09-10'
	});

	it('en slot som er haket av er tatt', () => {
		const day = buildMedicationDay(fast, [dose('2026-09-17', 'a', '08:00')], '2026-09-17', '2026-09-17', '10:00');
		expect(day.slots.map((s) => s.status)).toEqual(['taken', 'upcoming', 'upcoming']);
		expect(day.slots[0]!.takenAt).toBeTruthy();
	});

	it('DAGENS dag skiller «klar nå» fra «kommer»', () => {
		// En dose kl. 20 er ikke glemt kl. 10 — den har ikke vært ennå. Samme regel
		// som `accumulates` på skritt: et tall fra en dag som ikke er omme skal ikke
		// leses som et resultat.
		const day = buildMedicationDay(fast, [], '2026-09-17', '2026-09-17', '15:00');
		expect(day.slots.map((s) => s.status)).toEqual(['due', 'due', 'upcoming']);
	});

	it('en slot er klar PÅ minuttet, ikke etter', () => {
		expect(buildMedicationDay(fast, [], '2026-09-17', '2026-09-17', '08:00').slots[0]!.status).toBe('due');
		expect(buildMedicationDay(fast, [], '2026-09-17', '2026-09-17', '07:59').slots[0]!.status).toBe('upcoming');
	});

	it('en dag som er omme har glemte doser, ikke ventende', () => {
		const day = buildMedicationDay(fast, [dose('2026-09-16', 'a', '08:00')], '2026-09-16', '2026-09-17', '10:00');
		expect(day.slots.map((s) => s.status)).toEqual(['taken', 'missed', 'missed']);
	});

	it('en dag fram i tid er bare ventende', () => {
		const day = buildMedicationDay(fast, [], '2026-09-18', '2026-09-17', '23:00');
		expect(day.slots.every((s) => s.status === 'upcoming')).toBe(true);
	});

	it('utenfor kuren finnes ingen slots', () => {
		const day = buildMedicationDay(fast, [], '2026-09-09', '2026-09-17', '10:00');
		expect(day.inCourse).toBe(false);
		expect(day.slots).toEqual([]);
	});

	it('en dose uten slot er en EKSTRAdose, ikke en haket plan', () => {
		const day = buildMedicationDay(fast, [dose('2026-09-17', 'a', null)], '2026-09-17', '2026-09-17', '23:00');
		expect(day.extra).toHaveLength(1);
		expect(day.slots.every((s) => s.status !== 'taken')).toBe(true);
		// Men den telles: `taken` er hva som faktisk ble tatt.
		expect(day.taken).toBe(1);
	});

	it('en dose på en slot som ikke finnes i planen blir en ekstradose', () => {
		// Kan bare oppstå hvis planen ble rettet etterpå. Raden skal ikke bli
		// usynlig — den skjedde.
		const day = buildMedicationDay(fast, [dose('2026-09-17', 'a', '11:00')], '2026-09-17', '2026-09-17', '23:00');
		expect(day.extra).toHaveLength(1);
	});

	it('to hakinger på samme slot er ett feiltrykk, ikke to doser', () => {
		const day = buildMedicationDay(
			fast,
			[dose('2026-09-17', 'a', '08:00'), dose('2026-09-17', 'a', '08:00')],
			'2026-09-17',
			'2026-09-17',
			'23:00'
		);
		expect(day.slots[0]!.status).toBe('taken');
		expect(day.extra).toHaveLength(1);
	});

	it('ved behov har ingen slots, bare doser', () => {
		const day = buildMedicationDay(med(), [dose('2026-09-17'), dose('2026-09-17')], '2026-09-17', '2026-09-17', '12:00');
		expect(day.slots).toEqual([]);
		expect(day.extra).toHaveLength(2);
		expect(day.planned).toBe(0);
		expect(day.taken).toBe(2);
	});
});

describe('nextDose — spørsmålet med to medisiner på ulik frekvens', () => {
	const morgen = med({ id: 'a', name: 'A', rhythm: 'fast', times: ['08:00', '20:00'], startDate: '2026-09-10' });
	const tre = med({ id: 'b', name: 'B', rhythm: 'fast', times: ['09:00', '15:00', '21:00'], startDate: '2026-09-10' });

	it('fletter to planer på én akse', () => {
		const next = nextDose([morgen, tre], [], '2026-09-17', '10:00');
		expect(next).toMatchObject({ name: 'B', time: '15:00', day: '2026-09-17' });
	});

	it('hopper over en slot som alt er haket av', () => {
		const next = nextDose([tre], [dose('2026-09-17', 'b', '15:00')], '2026-09-17', '10:00');
		expect(next?.time).toBe('21:00');
	});

	it('en FORFALT dose er ikke «neste»', () => {
		// Ellers ville linja stått fast på en glemt morgendose resten av dagen og
		// aldri pekt på den som faktisk kommer. Den glemte vises som «klar nå».
		const next = nextDose([tre], [], '2026-09-17', '16:00');
		expect(next?.time).toBe('21:00');
	});

	it('går over til i morgen når dagen er brukt opp', () => {
		const next = nextDose([tre], [], '2026-09-17', '23:00');
		expect(next).toMatchObject({ time: '09:00', day: '2026-09-18' });
	});

	it('ved behov har ingen neste — den har ingen plan', () => {
		expect(nextDose([med()], [], '2026-09-17', '10:00')).toBeNull();
	});

	it('en avsluttet kur teller ikke', () => {
		const ferdig = med({ id: 'c', rhythm: 'fast', times: ['09:00'], startDate: '2026-09-01', endDate: '2026-09-05' });
		expect(nextDose([ferdig], [], '2026-09-17', '08:00')).toBeNull();
	});
});

describe('describeMedicationDay', () => {
	const fast = med({ rhythm: 'fast', times: ['08:00', '14:00', '20:00'], startDate: '2026-09-10' });

	it('«klar nå» vinner over «neste» — det er det man kan gjøre nå', () => {
		const day = buildMedicationDay(fast, [], '2026-09-17', '2026-09-17', '15:00');
		expect(describeMedicationDay(fast, day)).toBe('0 av 3 doser i dag. Klar nå: 08:00, 14:00.');
	});

	it('peker på neste når ingenting står og venter', () => {
		const day = buildMedicationDay(
			fast,
			[dose('2026-09-17', 'm1', '08:00'), dose('2026-09-17', 'm1', '14:00')],
			'2026-09-17',
			'2026-09-17',
			'15:00'
		);
		expect(describeMedicationDay(fast, day)).toBe('2 av 3 doser i dag. Neste 20:00.');
	});

	it('sier fra når dagen er ferdig', () => {
		const doses = ['08:00', '14:00', '20:00'].map((t) => dose('2026-09-17', 'm1', t));
		const day = buildMedicationDay(fast, doses, '2026-09-17', '2026-09-17', '21:00');
		expect(describeMedicationDay(fast, day)).toContain('alle tatt');
	});

	it('ved behov teller doser, den måler ikke mot en plan', () => {
		const day = buildMedicationDay(med(), [dose('2026-09-17')], '2026-09-17', '2026-09-17', '12:00');
		expect(describeMedicationDay(med(), day)).toBe('1 dose i dag');
	});

	it('sier aldri noe om hva en glemt dose betyr', () => {
		const day = buildMedicationDay(fast, [], '2026-09-17', '2026-09-17', '21:00');
		const text = describeMedicationDay(fast, day) ?? '';
		for (const forbidden of ['glemt', 'bør', 'husk', 'viktig', 'virk']) {
			expect(text.toLowerCase()).not.toContain(forbidden);
		}
	});
});
