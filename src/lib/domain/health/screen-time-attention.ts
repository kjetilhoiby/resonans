/**
 * screen-time-attention.ts
 *
 * Skiller **skjermtid** fra **oppmerksomhet**. iOS teller minutter der skjermen
 * var på; det er ikke det samme som minutter brukeren var der.
 *
 * To mønstre gjør dagstallet ubrukelig som mål på oppmerksomhet:
 *
 *  1. **Sovnet fra telefonen.** Skjermen står på hele timer. I time-for-time-grafen
 *     ser det ut som en rekke søyler som treffer taket (60 av 60 minutter) — typisk
 *     fra midnatt og utover. Målt på denne brukerens uke: 24. august hadde seks
 *     fulle timer 00–05, altså 6 av dagens 13t 24m.
 *  2. **En app som kjører mens man gjør noe annet.** En treningscoach med skjermen
 *     på under en løpetur er 30–60 minutter «skjermtid» uten et blikk på skjermen.
 *
 * De to krever ulike mekanismer, og det er derfor de er to felt og ikke ett:
 * det første kan **leses ut av timeprofilen** (ingen konfigurasjon), det andre kan
 * bare brukeren fortelle oss (en liste over apper som ikke teller).
 *
 * Ingen DB-avhengigheter — samme beregning brukes av flaten, chatten og målene.
 */

/* ── Terskler ────────────────────────────────────────────── */

/** Minutter i en klokketime. */
export const MAX_HOUR_MINUTES = 60;

/**
 * En time regnes som «full» — skjermen sto på hele timen — fra dette tallet.
 *
 * NB: 57 og ikke 60. Timeprofilen leses av GPT-4o fra søylehøyder i et
 * skjermbilde, så en søyle som treffer taket kommer tilbake som 57–63. En
 * terskel på 60 ville sluppet gjennom nettopp de timene regelen finnes for.
 */
export const FULL_HOUR_THRESHOLD_MINUTES = 57;

/**
 * Hvor mange fulle timer på rad som kreves før rekka regnes som passiv.
 *
 * Én full time er en film. To eller flere på rad er skjermen som står på:
 * ingen ser på telefonen 120 minutter uten et avbrudd som gir en søyle under
 * taket. Terskelen er den ene knappen som avgjør hvor aggressivt vi filtrerer,
 * og den er bevisst forsiktig — å filtrere bort en time brukeren faktisk brukte
 * er verre enn å la en passiv time stå.
 */
export const MIN_PASSIVE_RUN_HOURS = 2;

/* ── Innstillinger ───────────────────────────────────────── */

export interface ScreenTimeAttentionSettings {
	/** Passivfiltrering av/på. */
	filterPassiveHours: boolean;
	/** Appnavn som ikke skal telle som skjermtid. Sammenlignes uten hensyn til store bokstaver. */
	ignoredApps: string[];
	/** Antall fulle timer på rad som kreves. */
	minPassiveRunHours: number;
}

export const DEFAULT_ATTENTION_SETTINGS: ScreenTimeAttentionSettings = {
	filterPassiveHours: true,
	ignoredApps: [],
	minPassiveRunHours: MIN_PASSIVE_RUN_HOURS
};

/** Nedre/øvre grense for `minPassiveRunHours`. 1 ville filtrert bort enkeltfilmer. */
export const MIN_RUN_HOURS_LIMITS = { min: 2, max: 6 } as const;
export const MAX_IGNORED_APPS = 20;

/**
 * Valider og normaliser innstillinger fra en klient eller fra `metricSettings`.
 * Ukjente og ugyldige felt faller tilbake på standardverdien — aldri på et kast,
 * siden en lagret rad fra en tidligere versjon ikke skal kunne velte flaten.
 */
export function normalizeAttentionSettings(raw: unknown): ScreenTimeAttentionSettings {
	const rec = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

	const filterPassiveHours =
		typeof rec.filterPassiveHours === 'boolean'
			? rec.filterPassiveHours
			: DEFAULT_ATTENTION_SETTINGS.filterPassiveHours;

	const seen = new Set<string>();
	const ignoredApps: string[] = [];
	if (Array.isArray(rec.ignoredApps)) {
		for (const entry of rec.ignoredApps) {
			if (typeof entry !== 'string') continue;
			const name = entry.trim();
			if (!name) continue;
			const key = appKey(name);
			if (seen.has(key)) continue;
			seen.add(key);
			ignoredApps.push(name);
			if (ignoredApps.length >= MAX_IGNORED_APPS) break;
		}
	}

	let minPassiveRunHours = DEFAULT_ATTENTION_SETTINGS.minPassiveRunHours;
	if (typeof rec.minPassiveRunHours === 'number' && Number.isFinite(rec.minPassiveRunHours)) {
		const rounded = Math.round(rec.minPassiveRunHours);
		if (rounded >= MIN_RUN_HOURS_LIMITS.min && rounded <= MIN_RUN_HOURS_LIMITS.max) {
			minPassiveRunHours = rounded;
		}
	}

	return { filterPassiveHours, ignoredApps, minPassiveRunHours };
}

/** Appnavn-nøkkel for sammenligning: trimmet og små bokstaver. */
export function appKey(name: string): string {
	return name.trim().toLowerCase();
}

/* ── Passive timer ───────────────────────────────────────── */

export interface PassiveRun {
	/** Første time i rekka som ligger på DENNE dagen (0–23). */
	fromHour: number;
	/** Siste time i rekka på denne dagen, eksklusiv (1–24). */
	toHour: number;
	/** Minutter denne dagen bidrar med i rekka. */
	minutes: number;
	/** Rekkas fulle lengde i timer, også de som ligger på dagen før/etter. */
	runHours: number;
	/** Rekka startet før midnatt (dagen før). */
	startsBeforeMidnight: boolean;
	/** Rekka fortsetter etter midnatt (dagen etter). */
	continuesAfterMidnight: boolean;
}

function isFullHour(minutes: number | undefined, threshold: number): boolean {
	return typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= threshold;
}

/**
 * Finn rekker av fulle timer som berører denne dagen.
 *
 * Naboderne sendes med fordi **natta krysser midnatt**, og hver dag er sin egen
 * rad. Sovner man 22:30 og skjermen slukker 01:10, er hver av dagene bare én
 * full time — under terskelen — mens rekka i virkeligheten er to. Uten
 * naboene er nettopp innsovningen usynlig for regelen.
 *
 * Rekkene finnes over et 72-timers strekk (dagen før, dagen, dagen etter), men
 * `minutes` teller **bare denne dagens** timer: et minutt skal trekkes fra én dag.
 */
export function findPassiveRuns(
	hourly: number[] | undefined | null,
	opts: {
		previousHourly?: number[] | null;
		nextHourly?: number[] | null;
		minRunHours?: number;
		threshold?: number;
	} = {}
): PassiveRun[] {
	if (!Array.isArray(hourly) || hourly.length === 0) return [];

	const minRun = Math.max(1, opts.minRunHours ?? MIN_PASSIVE_RUN_HOURS);
	const threshold = opts.threshold ?? FULL_HOUR_THRESHOLD_MINUTES;

	// Strekk på 72 timer: [0,24) = dagen før, [24,48) = dagen, [48,72) = dagen etter.
	const strip = new Array<number | undefined>(72).fill(undefined);
	const place = (arr: number[] | null | undefined, offset: number) => {
		if (!Array.isArray(arr)) return;
		for (let h = 0; h < 24; h++) {
			const v = arr[h];
			if (typeof v === 'number' && Number.isFinite(v)) strip[offset + h] = Math.max(0, v);
		}
	};
	place(opts.previousHourly, 0);
	place(hourly, 24);
	place(opts.nextHourly, 48);

	const runs: PassiveRun[] = [];
	let i = 0;
	while (i < 72) {
		if (!isFullHour(strip[i], threshold)) {
			i += 1;
			continue;
		}
		let end = i;
		while (end + 1 < 72 && isFullHour(strip[end + 1], threshold)) end += 1;

		const runHours = end - i + 1;
		const touchesDay = end >= 24 && i < 48;
		if (runHours >= minRun && touchesDay) {
			const from = Math.max(24, i);
			const to = Math.min(47, end);
			let minutes = 0;
			for (let h = from; h <= to; h++) {
				// Kapp på 60: en søyle lest som 63 skal ikke fjerne 63 minutter.
				minutes += Math.min(MAX_HOUR_MINUTES, strip[h] ?? 0);
			}
			runs.push({
				fromHour: from - 24,
				toHour: to - 24 + 1,
				minutes,
				runHours,
				startsBeforeMidnight: i < 24,
				continuesAfterMidnight: end >= 48
			});
		}
		i = end + 1;
	}
	return runs;
}

/* ── Dagsberegning ───────────────────────────────────────── */

export interface AttentionDayInput {
	dateISO: string;
	/** iOS' dagstotal. Autoritativ for nivået. */
	totalMinutes: number;
	/** 24 verdier, minutter per klokketime. Utelatt = dagen har ingen time-detalj. */
	hourly?: number[];
	/** 24 verdier, minutter «Sosialt» per klokketime. */
	socialHourly?: number[];
	/** iOS' kategoritall for Sosialt (scrolling). */
	socialMinutes?: number;
	/** «Mest brukt»-lista for dagen: appnavn → minutter. */
	apps?: Record<string, number>;
}

export interface IgnoredAppHit {
	name: string;
	minutes: number;
}

export interface AttentionDay {
	dateISO: string;
	/** Det iOS rapporterte. Uendret. */
	rawMinutes: number;
	/** Minutter i passive timerekker. */
	passiveMinutes: number;
	/** Minutter i apper brukeren har sagt ikke teller. */
	ignoredAppMinutes: number;
	/** Det som står igjen: `raw − passive − apper`, aldri under 0. */
	attentionMinutes: number;
	rawSocialMinutes: number;
	passiveSocialMinutes: number;
	attentionSocialMinutes: number;
	passiveRuns: PassiveRun[];
	ignoredApps: IgnoredAppHit[];
	/** Timeprofil med passive timer nullet. Utelatt når dagen ikke har time-detalj. */
	attentionHourly?: number[];
	attentionSocialHourly?: number[];
	/** Falsk = dagen kom fra et ukesbilde og kan ikke filtreres. */
	hasHourly: boolean;
	/** Sant når noe faktisk ble trukket fra. */
	adjusted: boolean;
}

function sumIn(arr: number[] | undefined, runs: PassiveRun[]): number {
	if (!Array.isArray(arr)) return 0;
	let sum = 0;
	for (const run of runs) {
		for (let h = run.fromHour; h < run.toHour; h++) {
			const v = arr[h];
			if (typeof v === 'number' && Number.isFinite(v)) sum += Math.min(MAX_HOUR_MINUTES, Math.max(0, v));
		}
	}
	return sum;
}

function zeroRuns(arr: number[] | undefined, runs: PassiveRun[]): number[] | undefined {
	if (!Array.isArray(arr)) return undefined;
	const out = arr.slice(0, 24);
	while (out.length < 24) out.push(0);
	for (const run of runs) {
		for (let h = run.fromHour; h < run.toHour; h++) out[h] = 0;
	}
	return out;
}

/**
 * Beregn oppmerksomhetstid for én dag.
 *
 * Rekkefølgen er ikke tilfeldig: passive timer trekkes FØRST, og appfradraget
 * kappes mot det som er igjen. Ellers kan de to trekke fra samme minutt — en
 * app som kjørte inne i en passiv time ville blitt trukket to ganger, og
 * dagstallet endt under det som faktisk skjedde.
 */
export function computeAttentionDay(
	day: AttentionDayInput,
	settings: ScreenTimeAttentionSettings = DEFAULT_ATTENTION_SETTINGS,
	neighbours: { previousHourly?: number[] | null; nextHourly?: number[] | null } = {}
): AttentionDay {
	const rawMinutes = Math.max(0, Math.round(day.totalMinutes ?? 0));
	const rawSocialMinutes = Math.max(0, Math.round(day.socialMinutes ?? 0));
	const hasHourly = Array.isArray(day.hourly) && day.hourly.some((v) => (v ?? 0) > 0);

	const runs =
		settings.filterPassiveHours && hasHourly
			? findPassiveRuns(day.hourly, {
					previousHourly: neighbours.previousHourly,
					nextHourly: neighbours.nextHourly,
					minRunHours: settings.minPassiveRunHours
				})
			: [];

	// Timeprofilen er et vision-anslag av søylehøyder, mens dagstotalen er lest
	// som tekst. Summen av timene kan derfor overstige dagen — fradraget kappes,
	// slik at oppmerksomhetstiden ikke kan bli negativ.
	const passiveMinutes = Math.min(rawMinutes, Math.round(sumIn(day.hourly, runs)));
	const passiveSocialMinutes = Math.min(rawSocialMinutes, Math.round(sumIn(day.socialHourly, runs)));

	const ignoredKeys = new Set(settings.ignoredApps.map(appKey));
	const ignoredApps: IgnoredAppHit[] = [];
	if (ignoredKeys.size > 0 && day.apps) {
		for (const [name, minutes] of Object.entries(day.apps)) {
			if (!ignoredKeys.has(appKey(name))) continue;
			const m = typeof minutes === 'number' && Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0;
			if (m > 0) ignoredApps.push({ name, minutes: m });
		}
		ignoredApps.sort((a, b) => b.minutes - a.minutes);
	}
	const ignoredRaw = ignoredApps.reduce((s, a) => s + a.minutes, 0);
	const ignoredAppMinutes = Math.min(ignoredRaw, Math.max(0, rawMinutes - passiveMinutes));

	return {
		dateISO: day.dateISO,
		rawMinutes,
		passiveMinutes,
		ignoredAppMinutes,
		attentionMinutes: Math.max(0, rawMinutes - passiveMinutes - ignoredAppMinutes),
		rawSocialMinutes,
		passiveSocialMinutes,
		// Appfradraget rører IKKE kategorisplitten: skjermbildet sier ikke hvilken
		// kategori en app hører til, så vi kan ikke vite om minuttene var Sosialt.
		attentionSocialMinutes: Math.max(0, rawSocialMinutes - passiveSocialMinutes),
		passiveRuns: runs,
		ignoredApps,
		attentionHourly: zeroRuns(day.hourly, runs),
		attentionSocialHourly: zeroRuns(day.socialHourly, runs),
		hasHourly,
		adjusted: passiveMinutes > 0 || ignoredAppMinutes > 0
	};
}

/* ── Ukesoppsummering ────────────────────────────────────── */

export interface AttentionSummary {
	rawMinutes: number;
	passiveMinutes: number;
	ignoredAppMinutes: number;
	attentionMinutes: number;
	rawSocialMinutes: number;
	passiveSocialMinutes: number;
	attentionSocialMinutes: number;
	/** Dager med skjermtid i perioden. */
	dayCount: number;
	/** Av dem: dager som HAR time-detalj, altså dager regelen kunne se. */
	hourlyDayCount: number;
	/** Dager der noe faktisk ble trukket fra. */
	adjustedDayCount: number;
	/** Antall passive timer funnet i perioden. */
	passiveHourCount: number;
	/** Apper som ble trukket fra, summert over perioden. */
	ignoredApps: IgnoredAppHit[];
}

export function summarizeAttention(days: AttentionDay[]): AttentionSummary {
	const summary: AttentionSummary = {
		rawMinutes: 0,
		passiveMinutes: 0,
		ignoredAppMinutes: 0,
		attentionMinutes: 0,
		rawSocialMinutes: 0,
		passiveSocialMinutes: 0,
		attentionSocialMinutes: 0,
		dayCount: 0,
		hourlyDayCount: 0,
		adjustedDayCount: 0,
		passiveHourCount: 0,
		ignoredApps: []
	};

	const appTotals = new Map<string, IgnoredAppHit>();
	for (const day of days) {
		if (day.rawMinutes <= 0 && !day.hasHourly) continue;
		summary.dayCount += 1;
		if (day.hasHourly) summary.hourlyDayCount += 1;
		if (day.adjusted) summary.adjustedDayCount += 1;
		summary.rawMinutes += day.rawMinutes;
		summary.passiveMinutes += day.passiveMinutes;
		summary.ignoredAppMinutes += day.ignoredAppMinutes;
		summary.attentionMinutes += day.attentionMinutes;
		summary.rawSocialMinutes += day.rawSocialMinutes;
		summary.passiveSocialMinutes += day.passiveSocialMinutes;
		summary.attentionSocialMinutes += day.attentionSocialMinutes;
		for (const run of day.passiveRuns) summary.passiveHourCount += run.toHour - run.fromHour;
		for (const app of day.ignoredApps) {
			const key = appKey(app.name);
			const hit = appTotals.get(key);
			if (hit) hit.minutes += app.minutes;
			else appTotals.set(key, { name: app.name, minutes: app.minutes });
		}
	}
	summary.ignoredApps = [...appTotals.values()].sort((a, b) => b.minutes - a.minutes);
	return summary;
}

/* ── Ord ─────────────────────────────────────────────────── */

function fmt(minutes: number): string {
	const m = Math.max(0, Math.round(minutes));
	const h = Math.floor(m / 60);
	const rest = m % 60;
	if (h <= 0) return `${rest}m`;
	if (rest <= 0) return `${h}t`;
	return `${h}t ${rest}m`;
}

/**
 * Én setning om hva som ble filtrert bort, og hva den ikke dekker.
 *
 * Setningen bor her og ikke i komponenten fordi den bærer forbeholdet: dager
 * uten time-detalj er ikke filtrert i det hele tatt, og et filtrert ukestall
 * som later som det gjelder hele uka er verre enn et ufiltrert.
 */
export function describeAttention(
	summary: AttentionSummary,
	settings: ScreenTimeAttentionSettings = DEFAULT_ATTENTION_SETTINGS
): string | null {
	if (!settings.filterPassiveHours && settings.ignoredApps.length === 0) return null;
	if (summary.dayCount === 0) return null;

	const parts: string[] = [];
	if (summary.passiveMinutes > 0) {
		const hours = summary.passiveHourCount;
		parts.push(
			`${fmt(summary.passiveMinutes)} i ${hours} time${hours === 1 ? '' : 'r'} der skjermen sto på hele timen`
		);
	}
	if (summary.ignoredAppMinutes > 0) {
		const names = summary.ignoredApps.map((a) => a.name).join(', ');
		parts.push(`${fmt(summary.ignoredAppMinutes)} i ${names}`);
	}

	const missing = summary.dayCount - summary.hourlyDayCount;
	const caveat =
		missing > 0
			? ` ${missing} av ${summary.dayCount} dager mangler time-for-time og er ikke filtrert — last opp dagsbilder for dem.`
			: '';

	if (parts.length === 0) {
		return `Ingenting filtrert bort denne uka.${caveat}`;
	}
	return `Trukket fra: ${parts.join(' og ')}.${caveat}`;
}

/* ── Flere dager ─────────────────────────────────────────── */

/** Dagen før `dateISO`, som YYYY-MM-DD. */
function previousDateISO(dateISO: string): string | null {
	const m = dateISO?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (!m) return null;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

/**
 * Beregn en rekke dager, og gi hver dag naboene sine slik at nattas rekke kan
 * skjøtes over midnatt.
 *
 * **Naboen må være kalendernaboen.** En liste som mangler 24. august gjør ikke
 * 23. til nabo av 25. — gjorde vi det, ville en rekke bli skjøtt over et hull i
 * dataene, altså over en natt vi ikke har målt. Oppslaget går derfor på dato,
 * ikke på posisjon i lista.
 */
export function buildAttentionDays(
	days: AttentionDayInput[],
	settings: ScreenTimeAttentionSettings = DEFAULT_ATTENTION_SETTINGS
): AttentionDay[] {
	const byDate = new Map<string, AttentionDayInput>();
	for (const day of days) if (day?.dateISO) byDate.set(day.dateISO, day);

	const nextOf = new Map<string, AttentionDayInput>();
	for (const day of days) {
		const prev = previousDateISO(day.dateISO);
		if (prev && byDate.has(prev)) nextOf.set(prev, day);
	}

	return days.map((day) => {
		const prevISO = previousDateISO(day.dateISO);
		return computeAttentionDay(day, settings, {
			previousHourly: prevISO ? byDate.get(prevISO)?.hourly ?? null : null,
			nextHourly: nextOf.get(day.dateISO)?.hourly ?? null
		});
	});
}

/* ── Uke: fradrag mot iOS' eget nivå ─────────────────────── */

/** Den delen av ukesmetrikken oppmerksomhetstiden regnes mot. */
export interface ScreenTimeLevels {
	totalMinutes: number;
	avgPerDayMinutes: number;
	socialMinutes: number;
	socialAvgPerDayMinutes: number;
}

export interface WeekAttention extends ScreenTimeLevels {
	/** Filtrering er aktiv: passivfiltrering på, eller minst én app ignorert. */
	enabled: boolean;
	rawMinutes: number;
	rawSocialMinutes: number;
	passiveMinutes: number;
	passiveSocialMinutes: number;
	ignoredAppMinutes: number;
	/** Alias for `totalMinutes` — leses som «oppmerksomhet» på flatene. */
	attentionMinutes: number;
	attentionSocialMinutes: number;
	byHour: number[];
	socialByHour: number[];
	dayCount: number;
	hourlyDayCount: number;
	adjustedDayCount: number;
	passiveHourCount: number;
	ignoredApps: IgnoredAppHit[];
	note: string | null;
}

/**
 * Legg fradragene på iOS' eget ukesnivå.
 *
 * **Fradraget er det nye; nivået er fortsatt iOS'.** Ukesbildet er autoritativt
 * for ukestotalen og kan avvike fra summen av dagsevents (en dag kan mangle et
 * skjermbilde). Bygde vi et eget nivå av dagene, ville flaten hatt to
 * konkurrerende ukestotaler som begge ser plausible ut — og de ville sprikt
 * nettopp i ukene der data mangler.
 *
 * Snittet skaleres med samme brøk framfor å regne nevneren på nytt: aggregatet
 * deler på 7 når det finnes et ukesbilde og på antall dager ellers, og en
 * utledet nevner ville drevet fra den regelen ved neste endring.
 */
export function buildWeekAttention(
	levels: ScreenTimeLevels,
	days: AttentionDay[],
	settings: ScreenTimeAttentionSettings = DEFAULT_ATTENTION_SETTINGS
): WeekAttention {
	const summary = summarizeAttention(days);

	const attentionMinutes = Math.max(
		0,
		levels.totalMinutes - summary.passiveMinutes - summary.ignoredAppMinutes
	);
	// Appfradraget rører ikke kategorisplitten — se `computeAttentionDay`.
	const attentionSocialMinutes = Math.max(0, levels.socialMinutes - summary.passiveSocialMinutes);

	const scale = (avg: number, from: number, to: number) =>
		from > 0 ? Math.round(avg * (to / from)) : 0;

	const byHour = new Array(24).fill(0);
	const socialByHour = new Array(24).fill(0);
	for (const day of days) {
		for (let h = 0; h < 24; h++) {
			byHour[h] += day.attentionHourly?.[h] ?? 0;
			socialByHour[h] += day.attentionSocialHourly?.[h] ?? 0;
		}
	}

	const avgPerDayMinutes = scale(levels.avgPerDayMinutes, levels.totalMinutes, attentionMinutes);
	const socialAvgPerDayMinutes = scale(
		levels.socialAvgPerDayMinutes,
		levels.socialMinutes,
		attentionSocialMinutes
	);

	return {
		enabled: settings.filterPassiveHours || settings.ignoredApps.length > 0,
		rawMinutes: levels.totalMinutes,
		rawSocialMinutes: levels.socialMinutes,
		passiveMinutes: summary.passiveMinutes,
		passiveSocialMinutes: summary.passiveSocialMinutes,
		ignoredAppMinutes: summary.ignoredAppMinutes,
		attentionMinutes,
		attentionSocialMinutes,
		totalMinutes: attentionMinutes,
		socialMinutes: attentionSocialMinutes,
		avgPerDayMinutes,
		socialAvgPerDayMinutes,
		byHour,
		socialByHour,
		dayCount: summary.dayCount,
		hourlyDayCount: summary.hourlyDayCount,
		adjustedDayCount: summary.adjustedDayCount,
		passiveHourCount: summary.passiveHourCount,
		ignoredApps: summary.ignoredApps,
		note: describeAttention(summary, settings)
	};
}
