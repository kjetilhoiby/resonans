import { describe, it, expect } from 'vitest';
import {
	FULL_HOUR_THRESHOLD_MINUTES,
	MIN_PASSIVE_RUN_HOURS,
	DEFAULT_ATTENTION_SETTINGS,
	normalizeAttentionSettings,
	findPassiveRuns,
	computeAttentionDay,
	summarizeAttention,
	describeAttention,
	buildAttentionDays,
	buildWeekAttention,
	type ScreenTimeAttentionSettings
} from './screen-time-attention';

/** Timeprofil: `{ 0: 60, 1: 60 }` → 24-elements array. */
function hours(spec: Record<number, number>): number[] {
	const out = new Array(24).fill(0);
	for (const [h, v] of Object.entries(spec)) out[Number(h)] = v;
	return out;
}

const settings = (over: Partial<ScreenTimeAttentionSettings> = {}): ScreenTimeAttentionSettings => ({
	...DEFAULT_ATTENTION_SETTINGS,
	...over
});

describe('normalizeAttentionSettings', () => {
	it('faller tilbake på standard for tomt og ugyldig', () => {
		expect(normalizeAttentionSettings(undefined)).toEqual(DEFAULT_ATTENTION_SETTINGS);
		expect(normalizeAttentionSettings(null)).toEqual(DEFAULT_ATTENTION_SETTINGS);
		expect(normalizeAttentionSettings('tull')).toEqual(DEFAULT_ATTENTION_SETTINGS);
	});

	it('filtrering er på som standard', () => {
		expect(DEFAULT_ATTENTION_SETTINGS.filterPassiveHours).toBe(true);
	});

	it('ingen apper er ignorert som standard — det må brukeren si selv', () => {
		expect(DEFAULT_ATTENTION_SETTINGS.ignoredApps).toEqual([]);
	});

	it('trimmer og deduperer appnavn uten hensyn til store bokstaver', () => {
		const s = normalizeAttentionSettings({ ignoredApps: ['  Ekko ', 'ekko', 'Spotify', ''] });
		expect(s.ignoredApps).toEqual(['Ekko', 'Spotify']);
	});

	it('avviser minPassiveRunHours utenfor grensene', () => {
		expect(normalizeAttentionSettings({ minPassiveRunHours: 1 }).minPassiveRunHours).toBe(
			MIN_PASSIVE_RUN_HOURS
		);
		expect(normalizeAttentionSettings({ minPassiveRunHours: 99 }).minPassiveRunHours).toBe(
			MIN_PASSIVE_RUN_HOURS
		);
		expect(normalizeAttentionSettings({ minPassiveRunHours: 3 }).minPassiveRunHours).toBe(3);
	});

	it('kapper lista over ignorerte apper', () => {
		const many = Array.from({ length: 50 }, (_, i) => `App ${i}`);
		expect(normalizeAttentionSettings({ ignoredApps: many }).ignoredApps.length).toBe(20);
	});
});

describe('findPassiveRuns', () => {
	it('én full time alene er ikke passiv — det kan være en film', () => {
		expect(findPassiveRuns(hours({ 20: 60 }))).toEqual([]);
	});

	it('to fulle timer på rad er passiv', () => {
		const runs = findPassiveRuns(hours({ 0: 60, 1: 60 }));
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ fromHour: 0, toHour: 2, minutes: 120, runHours: 2 });
	});

	it('leser en søyle som traff taket selv om vision bommer litt', () => {
		// 58 og 57 er samme søyle som 60 — terskelen er derfor under 60.
		expect(findPassiveRuns(hours({ 2: 58, 3: FULL_HOUR_THRESHOLD_MINUTES }))).toHaveLength(1);
		expect(findPassiveRuns(hours({ 2: 56, 3: 56 }))).toEqual([]);
	});

	it('kapper minuttene på 60 når vision leser over taket', () => {
		const runs = findPassiveRuns(hours({ 0: 63, 1: 61 }));
		expect(runs[0].minutes).toBe(120);
	});

	it('bryter rekka på en time under terskelen', () => {
		const runs = findPassiveRuns(hours({ 0: 60, 1: 60, 2: 20, 3: 60, 4: 60 }));
		expect(runs.map((r) => [r.fromHour, r.toHour])).toEqual([
			[0, 2],
			[3, 5]
		]);
	});

	it('finner de seks fulle timene fra en ekte natt (24. august)', () => {
		const runs = findPassiveRuns(hours({ 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 8 }));
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ fromHour: 0, toHour: 6, minutes: 360, runHours: 6 });
	});

	it('respekterer minRunHours', () => {
		const h = hours({ 0: 60, 1: 60 });
		expect(findPassiveRuns(h, { minRunHours: 3 })).toEqual([]);
		expect(findPassiveRuns(h, { minRunHours: 2 })).toHaveLength(1);
	});

	it('skjøter rekka over midnatt med dagen før', () => {
		// Sovnet 22:30, skjermen slukket 01:10: én full time hver dag, altså
		// under terskelen på hver av dem, men to på rad i virkeligheten.
		const previousHourly = hours({ 23: 60 });
		const runs = findPassiveRuns(hours({ 0: 60, 1: 10 }), { previousHourly });
		expect(runs).toHaveLength(1);
		expect(runs[0].runHours).toBe(2);
		expect(runs[0].startsBeforeMidnight).toBe(true);
		// Bare denne dagens minutter trekkes fra — kvelden hører til dagen før.
		expect(runs[0].minutes).toBe(60);
		expect(runs[0].fromHour).toBe(0);
		expect(runs[0].toHour).toBe(1);
	});

	it('skjøter rekka over midnatt med dagen etter', () => {
		const nextHourly = hours({ 0: 60, 1: 60 });
		const runs = findPassiveRuns(hours({ 23: 60 }), { nextHourly });
		expect(runs).toHaveLength(1);
		expect(runs[0]).toMatchObject({ fromHour: 23, toHour: 24, minutes: 60, runHours: 3 });
		expect(runs[0].continuesAfterMidnight).toBe(true);
	});

	it('en nabodag uten detalj bryter ikke rekka feilaktig', () => {
		expect(findPassiveRuns(hours({ 0: 60, 1: 60 }), { previousHourly: null })).toHaveLength(1);
	});

	it('tom eller manglende timeprofil gir ingen rekker', () => {
		expect(findPassiveRuns(undefined)).toEqual([]);
		expect(findPassiveRuns([])).toEqual([]);
		expect(findPassiveRuns(new Array(24).fill(0))).toEqual([]);
	});
});

describe('computeAttentionDay', () => {
	it('trekker fra nattas fulle timer (24. august: 13t 24m → 7t 24m)', () => {
		const day = computeAttentionDay({
			dateISO: '2026-08-24',
			totalMinutes: 804, // 13t 24m
			socialMinutes: 473, // 7t 53m
			hourly: hours({ 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 6: 8, 12: 30, 19: 40 }),
			socialHourly: hours({ 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60, 19: 20 })
		});
		expect(day.passiveMinutes).toBe(360);
		expect(day.attentionMinutes).toBe(444); // 7t 24m
		expect(day.passiveSocialMinutes).toBe(360);
		expect(day.attentionSocialMinutes).toBe(113);
		expect(day.adjusted).toBe(true);
	});

	it('nuller de passive timene i timeprofilen', () => {
		const day = computeAttentionDay({
			dateISO: '2026-08-24',
			totalMinutes: 200,
			hourly: hours({ 0: 60, 1: 60, 12: 40, 20: 40 })
		});
		expect(day.attentionHourly?.[0]).toBe(0);
		expect(day.attentionHourly?.[1]).toBe(0);
		expect(day.attentionHourly?.[12]).toBe(40);
	});

	it('trekker fra apper brukeren har sagt ikke teller', () => {
		const day = computeAttentionDay(
			{
				dateISO: '2026-08-24',
				totalMinutes: 200,
				hourly: hours({ 12: 61, 17: 60, 19: 79 }),
				apps: { Ekko: 61, Instagram: 100 }
			},
			settings({ ignoredApps: ['ekko'] })
		);
		expect(day.ignoredAppMinutes).toBe(61);
		expect(day.ignoredApps).toEqual([{ name: 'Ekko', minutes: 61 }]);
		expect(day.attentionMinutes).toBe(139);
	});

	it('appfradraget rører ikke kategorisplitten', () => {
		const day = computeAttentionDay(
			{ dateISO: '2026-08-24', totalMinutes: 200, socialMinutes: 120, apps: { Ekko: 60 } },
			settings({ ignoredApps: ['Ekko'] })
		);
		expect(day.attentionMinutes).toBe(140);
		expect(day.attentionSocialMinutes).toBe(120);
	});

	it('passive timer og apper trekkes aldri fra samme minutt', () => {
		// Dagen er 120 min og består i sin helhet av to fulle timer; en app på
		// 60 min inne i dem skal ikke gi et fradrag på 180.
		const day = computeAttentionDay(
			{
				dateISO: '2026-08-24',
				totalMinutes: 120,
				hourly: hours({ 0: 60, 1: 60 }),
				apps: { Ekko: 60 }
			},
			settings({ ignoredApps: ['Ekko'] })
		);
		expect(day.passiveMinutes).toBe(120);
		expect(day.ignoredAppMinutes).toBe(0);
		expect(day.attentionMinutes).toBe(0);
	});

	it('kapper fradraget mot dagstotalen når timesummen overstiger den', () => {
		// Vision leser søylehøyder; timesummen kan overstige dagstallet.
		const day = computeAttentionDay({
			dateISO: '2026-08-24',
			totalMinutes: 100,
			hourly: hours({ 0: 60, 1: 60 })
		});
		expect(day.passiveMinutes).toBe(100);
		expect(day.attentionMinutes).toBe(0);
	});

	it('lar dagen stå urørt når filtreringen er av', () => {
		const day = computeAttentionDay(
			{ dateISO: '2026-08-24', totalMinutes: 804, hourly: hours({ 0: 60, 1: 60, 2: 60 }) },
			settings({ filterPassiveHours: false })
		);
		expect(day.passiveMinutes).toBe(0);
		expect(day.attentionMinutes).toBe(804);
		expect(day.adjusted).toBe(false);
	});

	it('en dag uten time-detalj kan ikke filtreres, og sier det', () => {
		const day = computeAttentionDay({ dateISO: '2026-08-20', totalMinutes: 500 });
		expect(day.hasHourly).toBe(false);
		expect(day.passiveMinutes).toBe(0);
		expect(day.attentionMinutes).toBe(500);
		expect(day.attentionHourly).toBeUndefined();
	});

	it('skjøter over midnatt når naboderne sendes med', () => {
		const day = computeAttentionDay(
			{ dateISO: '2026-08-24', totalMinutes: 300, hourly: hours({ 0: 60, 9: 120, 20: 120 }) },
			DEFAULT_ATTENTION_SETTINGS,
			{ previousHourly: hours({ 23: 60 }) }
		);
		expect(day.passiveMinutes).toBe(60);
		expect(day.attentionMinutes).toBe(240);
	});
});

describe('summarizeAttention', () => {
	const week = () =>
		[
			// 21. aug: fire fulle timer 00–04
			{ dateISO: '2026-08-21', totalMinutes: 621, hourly: hours({ 0: 60, 1: 60, 2: 60, 3: 60, 19: 40 }) },
			// 22. aug: ingen fulle timer
			{ dateISO: '2026-08-22', totalMinutes: 507, hourly: hours({ 0: 52, 1: 22, 20: 45 }) },
			// 23. aug: to fulle timer
			{ dateISO: '2026-08-23', totalMinutes: 578, hourly: hours({ 0: 60, 1: 60, 12: 20 }) },
			// 24. aug: seks fulle timer
			{ dateISO: '2026-08-24', totalMinutes: 804, hourly: hours({ 0: 60, 1: 60, 2: 60, 3: 60, 4: 60, 5: 60 }) },
			// 25. aug: dagstall fra ukesbilde, ingen time-detalj
			{ dateISO: '2026-08-25', totalMinutes: 590 }
		].map((d) => computeAttentionDay(d));

	it('summerer rå, passivt og oppmerksomhet', () => {
		const s = summarizeAttention(week());
		expect(s.rawMinutes).toBe(621 + 507 + 578 + 804 + 590);
		expect(s.passiveMinutes).toBe(240 + 0 + 120 + 360);
		expect(s.attentionMinutes).toBe(s.rawMinutes - s.passiveMinutes);
		expect(s.passiveHourCount).toBe(4 + 2 + 6);
	});

	it('skiller dager med time-detalj fra dager uten', () => {
		const s = summarizeAttention(week());
		expect(s.dayCount).toBe(5);
		expect(s.hourlyDayCount).toBe(4);
		expect(s.adjustedDayCount).toBe(3);
	});

	it('summerer ignorerte apper over uka', () => {
		const days = [
			computeAttentionDay(
				{ dateISO: '2026-08-24', totalMinutes: 200, apps: { Ekko: 61 } },
				settings({ ignoredApps: ['Ekko'] })
			),
			computeAttentionDay(
				{ dateISO: '2026-08-25', totalMinutes: 200, apps: { Ekko: 40 } },
				settings({ ignoredApps: ['Ekko'] })
			)
		];
		expect(summarizeAttention(days).ignoredApps).toEqual([{ name: 'Ekko', minutes: 101 }]);
	});

	it('tomme dager teller ikke', () => {
		const s = summarizeAttention([computeAttentionDay({ dateISO: '2026-08-26', totalMinutes: 0 })]);
		expect(s.dayCount).toBe(0);
	});
});

describe('describeAttention', () => {
	it('sier hvor mye som ble trukket fra, og i hvor mange timer', () => {
		const days = [
			computeAttentionDay({ dateISO: '2026-08-24', totalMinutes: 804, hourly: hours({ 0: 60, 1: 60, 2: 60 }) })
		];
		const text = describeAttention(summarizeAttention(days));
		expect(text).toContain('3t');
		expect(text).toContain('3 timer');
		expect(text).toContain('skjermen sto på hele timen');
	});

	it('sier fra om dagene som ikke kunne filtreres', () => {
		const days = [
			computeAttentionDay({ dateISO: '2026-08-24', totalMinutes: 804, hourly: hours({ 0: 60, 1: 60 }) }),
			computeAttentionDay({ dateISO: '2026-08-25', totalMinutes: 500 })
		];
		expect(describeAttention(summarizeAttention(days))).toContain('1 av 2 dager mangler time-for-time');
	});

	it('sier eksplisitt at ingenting ble filtrert', () => {
		const days = [computeAttentionDay({ dateISO: '2026-08-22', totalMinutes: 507, hourly: hours({ 20: 45 }) })];
		expect(describeAttention(summarizeAttention(days))).toContain('Ingenting filtrert bort');
	});

	it('nevner appene ved navn', () => {
		const days = [
			computeAttentionDay(
				{ dateISO: '2026-08-24', totalMinutes: 200, apps: { Ekko: 61 } },
				settings({ ignoredApps: ['Ekko'] })
			)
		];
		expect(describeAttention(summarizeAttention(days), settings({ ignoredApps: ['Ekko'] }))).toContain(
			'1t 1m i Ekko'
		);
	});

	it('er stum når ingen filtrering er slått på', () => {
		const s = summarizeAttention([computeAttentionDay({ dateISO: '2026-08-24', totalMinutes: 200 })]);
		expect(describeAttention(s, settings({ filterPassiveHours: false }))).toBeNull();
	});
});

describe('buildAttentionDays', () => {
	it('skjøter rekka mellom to kalendernaboer', () => {
		const days = buildAttentionDays([
			{ dateISO: '2026-08-23', totalMinutes: 300, hourly: hours({ 23: 60, 12: 240 }) },
			{ dateISO: '2026-08-24', totalMinutes: 300, hourly: hours({ 0: 60, 12: 240 }) }
		]);
		expect(days[0].passiveMinutes).toBe(60);
		expect(days[1].passiveMinutes).toBe(60);
	});

	it('skjøter IKKE over et hull i dataene', () => {
		// 24. august mangler — 23. og 25. er ikke naboer, og natta mellom dem
		// er ikke målt. En skjøt her ville filtrert på en antakelse.
		const days = buildAttentionDays([
			{ dateISO: '2026-08-23', totalMinutes: 300, hourly: hours({ 23: 60, 12: 240 }) },
			{ dateISO: '2026-08-25', totalMinutes: 300, hourly: hours({ 0: 60, 12: 240 }) }
		]);
		expect(days[0].passiveMinutes).toBe(0);
		expect(days[1].passiveMinutes).toBe(0);
	});

	it('en enkelt dag uten naboer beholder sine egne rekker', () => {
		const days = buildAttentionDays([
			{ dateISO: '2026-08-24', totalMinutes: 300, hourly: hours({ 0: 60, 1: 60, 12: 180 }) }
		]);
		expect(days[0].passiveMinutes).toBe(120);
	});

	it('tåler ugyldige datoer uten å kaste', () => {
		const days = buildAttentionDays([{ dateISO: 'tull', totalMinutes: 100, hourly: hours({ 0: 60, 1: 60 }) }]);
		expect(days[0].passiveMinutes).toBe(100);
	});
});

describe('buildWeekAttention', () => {
	const levels = {
		totalMinutes: 4200, // 70t
		avgPerDayMinutes: 600, // 10t (ukesbilde → deler på 7)
		socialMinutes: 2100,
		socialAvgPerDayMinutes: 300
	};

	it('trekker fradraget fra iOS-nivået, ikke fra summen av dagene', () => {
		// Dagsevents dekker bare 3 av 7 dager, men ukesbildet sier 70t. Fradraget
		// legges på 70t — ikke på dagssummen.
		const days = buildAttentionDays([
			{ dateISO: '2026-08-21', totalMinutes: 600, hourly: hours({ 0: 60, 1: 60, 12: 480 }) },
			{ dateISO: '2026-08-22', totalMinutes: 600, hourly: hours({ 12: 600 }) },
			{ dateISO: '2026-08-23', totalMinutes: 600, hourly: hours({ 0: 60, 1: 60, 2: 60, 12: 420 }) }
		]);
		const week = buildWeekAttention(levels, days);
		expect(week.passiveMinutes).toBe(120 + 180);
		expect(week.rawMinutes).toBe(4200);
		expect(week.attentionMinutes).toBe(4200 - 300);
		expect(week.totalMinutes).toBe(week.attentionMinutes);
	});

	it('skalerer snittet med samme brøk som totalen', () => {
		const days = buildAttentionDays([
			{ dateISO: '2026-08-21', totalMinutes: 600, hourly: hours({ 0: 60, 1: 60, 12: 480 }) }
		]);
		const week = buildWeekAttention(levels, days);
		// 4200 → 4080 er 97,14 %; 600 · 0,9714 ≈ 583
		expect(week.avgPerDayMinutes).toBe(583);
	});

	it('går aldri under null', () => {
		const days = buildAttentionDays([
			{ dateISO: '2026-08-21', totalMinutes: 600, hourly: hours({ 0: 60, 1: 60 }) }
		]);
		const week = buildWeekAttention({ ...levels, totalMinutes: 60, avgPerDayMinutes: 60 }, days);
		expect(week.attentionMinutes).toBe(0);
	});

	it('summerer den filtrerte timeprofilen', () => {
		const days = buildAttentionDays([
			{ dateISO: '2026-08-21', totalMinutes: 600, hourly: hours({ 0: 60, 1: 60, 12: 30 }) },
			{ dateISO: '2026-08-22', totalMinutes: 600, hourly: hours({ 12: 45 }) }
		]);
		const week = buildWeekAttention(levels, days);
		expect(week.byHour[0]).toBe(0);
		expect(week.byHour[1]).toBe(0);
		expect(week.byHour[12]).toBe(75);
	});

	it('er ikke aktiv når filtreringen er av og ingen apper er ignorert', () => {
		const week = buildWeekAttention(levels, [], settings({ filterPassiveHours: false }));
		expect(week.enabled).toBe(false);
		expect(week.attentionMinutes).toBe(4200);
	});

	it('er aktiv når en app er ignorert selv om passivfiltrering er av', () => {
		const week = buildWeekAttention(
			levels,
			[],
			settings({ filterPassiveHours: false, ignoredApps: ['Ekko'] })
		);
		expect(week.enabled).toBe(true);
	});

	it('en uke uten dagsdetalj lar nivået stå urørt', () => {
		const week = buildWeekAttention(levels, []);
		expect(week.attentionMinutes).toBe(4200);
		expect(week.avgPerDayMinutes).toBe(600);
		expect(week.hourlyDayCount).toBe(0);
	});
});

describe('scrolling kan ikke alltid filtreres', () => {
	const nightHourly = hours({ 0: 60, 1: 60, 2: 60, 12: 120 });

	it('flagger dagen når passive timer mangler fargefordeling', () => {
		const day = computeAttentionDay({
			dateISO: '2026-08-24',
			totalMinutes: 300,
			socialMinutes: 200,
			hourly: nightHourly
			// ingen socialHourly — vision leste ikke fargene per time
		});
		expect(day.passiveMinutes).toBe(180);
		expect(day.socialFilterable).toBe(false);
		// Scrollingtallet står urørt; det er en 0 vi ikke har målt.
		expect(day.passiveSocialMinutes).toBe(0);
		expect(day.attentionSocialMinutes).toBe(200);
	});

	it('flagger ikke når fargene finnes', () => {
		const day = computeAttentionDay({
			dateISO: '2026-08-24',
			totalMinutes: 300,
			socialMinutes: 200,
			hourly: nightHourly,
			socialHourly: hours({ 0: 60, 1: 60, 2: 60, 12: 20 })
		});
		expect(day.socialFilterable).toBe(true);
		expect(day.attentionSocialMinutes).toBe(20);
	});

	it('flagger ikke en dag uten passive timer — det er ingenting å ta forbehold om', () => {
		const day = computeAttentionDay({
			dateISO: '2026-08-22',
			totalMinutes: 300,
			socialMinutes: 200,
			hourly: hours({ 12: 120, 20: 45 })
		});
		expect(day.passiveMinutes).toBe(0);
		expect(day.socialFilterable).toBe(true);
	});

	it('teller bare dagene der det faktisk manglet', () => {
		const s = summarizeAttention([
			computeAttentionDay({ dateISO: '2026-08-23', totalMinutes: 300, hourly: nightHourly }),
			computeAttentionDay({
				dateISO: '2026-08-25',
				totalMinutes: 300,
				hourly: nightHourly,
				socialHourly: hours({ 0: 60, 1: 60, 2: 60 })
			})
		]);
		expect(s.socialUnfilteredDayCount).toBe(1);
	});

	it('uka rapporterer socialFiltered=false og sier fra i teksten', () => {
		const days = [computeAttentionDay({ dateISO: '2026-08-24', totalMinutes: 300, hourly: nightHourly })];
		const week = buildWeekAttention(
			{ totalMinutes: 300, avgPerDayMinutes: 300, socialMinutes: 200, socialAvgPerDayMinutes: 200 },
			days
		);
		expect(week.socialFiltered).toBe(false);
		expect(week.attentionMinutes).toBe(120);
		expect(week.socialMinutes).toBe(200);
		expect(week.note).toContain('Scrollingtallet er ikke filtrert');
	});

	it('sier ingenting om scrolling når alt kunne filtreres', () => {
		const days = [
			computeAttentionDay({
				dateISO: '2026-08-24',
				totalMinutes: 300,
				socialMinutes: 200,
				hourly: nightHourly,
				socialHourly: hours({ 0: 60, 1: 60, 2: 60 })
			})
		];
		const week = buildWeekAttention(
			{ totalMinutes: 300, avgPerDayMinutes: 300, socialMinutes: 200, socialAvgPerDayMinutes: 200 },
			days
		);
		expect(week.socialFiltered).toBe(true);
		expect(week.note).not.toContain('Scrollingtallet');
	});
});
