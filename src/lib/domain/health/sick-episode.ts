/**
 * sick-episode.ts — et sykdomsforløp som ÉN flate, med felles tidsakse.
 *
 * En sykeperiode har til nå bare vært en rad som unnskylder streak-dager. Men
 * et forløp er noe man vil se på i ettertid og underveis: vekta, dagpulsen,
 * sovepulsen, søvnen, temperaturen og symptomene, lagt oppå hverandre på de
 * samme dagene. Samme begrunnelse som at livvidde tegnes i `WeightTrendChart`:
 * «vekta stupte samtidig som sovepulsen steg» kan bare LESES når samme dato
 * ligger på samme piksel. To selvstendige kort måtte avtalt det, og avtalen
 * brytes første gang noen endrer en padding.
 *
 * Modulen er ren. Serverlaget henter tallene gjennom de delte leserne
 * (`readWeightDays`, `readNightlyPhysiology`, `readSleepNights` …) og mater dem
 * inn her; ingenting regnes om.
 *
 * ## Reglene
 *
 * 1. **Baselinen er dagene rett FØR, ikke historikken.** Et forløp spør «hvor
 *    mye flyttet dette seg», og referansen må være det du var like før. En
 *    baseline over et år ville blandet inn forrige forløp og formtopper.
 * 2. **Hull er `null`, aldri 0.** En dag uten veiing er ikke en dag du veide
 *    ingenting — samme regel som `history-series.ts`.
 * 3. **Én kilde per serie, navngitt.** `hr_min` betyr ulike ting per kilde
 *    (`sleep_min` er hvilepuls, `daily_min` er dagens laveste, punktpuls fra
 *    vekta måles stående og ligger 5–15 slag over). Blandes de midt i vinduet,
 *    ser et kildebytte ut som en endring i kroppen.
 * 4. **Ingen dom, ingen diagnose.** Vi sier hva som er målt og hvor mye det
 *    avviker. Ingen «feber», ingen forklaring på hvorfor vekta falt, ingen
 *    «normalt varer». Loggen er brukerens journal, ikke en vurdering vi har
 *    dekning for.
 * 5. **Dekningen rapporteres.** Tre målte netter av ni dager er et annet svar
 *    enn ni, og et snitt uten nevner ser like sikkert ut i begge tilfeller.
 */

import { dayKeyFromNumber, dayNumber } from '$lib/domain/streaks';
import {
	isDayKey,
	resolveSickPeriod,
	type ResolvedSickPeriod,
	type SickPeriod
} from './sick-periods';
import { describeSymptom, type ResolvedSymptom } from './symptoms';
import type { SleepNightPoint } from './sleep-overview';

/**
 * Hvor mange dager før onset baselinen bygges av.
 *
 * Fjorten dager er valgt mot KADENSEN, ikke mot statistikk: vekt og dagpuls
 * måles nesten daglig, søvn hver natt, kjernetemperatur bare når man tar den
 * fram. Et kortere vindu ville gjort de sjeldne seriene baseline-løse; et
 * lengre ville dratt inn forrige forløp.
 */
export const BASELINE_DAYS = 14;

/**
 * Færre enn tre målinger er ikke en baseline.
 *
 * Med to kan én avvikende morgen flytte referansen mer enn sykdommen gjorde, og
 * avviket som rapporteres er da et avvik fra støy. Samme gulv som
 * `MIN_TREND_SAMPLES`.
 */
export const MIN_BASELINE_SAMPLES = 3;

/** Dager etter periodens slutt som tas med, så man ser om tallene kom tilbake. */
export const RECOVERY_DAYS = 7;

export interface EpisodeDay {
	day: string;
	/** Ligger dagen i selve sykeperioden? */
	sick: boolean;
	/** Dag N av forløpet (1-indeksert). Null for baseline- og etterdager. */
	dayOfEpisode: number | null;
}

export interface EpisodeWindow {
	/** Hele vinduet, stigende: baseline → periode → etterdager. */
	days: EpisodeDay[];
	/** Indeks i `days` der perioden begynner. */
	onsetIndex: number;
	/** Indeks i `days` for siste sykedag. */
	endIndex: number;
	baselineKeys: string[];
	sickKeys: string[];
	/** Dagsnøkkelen for i dag, Oslo. Dagen som ikke er omme ennå. */
	today: string;
	/** Hvor mange dager forløpet har vart så langt. */
	length: number;
	open: boolean;
	staleOpen: boolean;
}

/**
 * Vinduet forløpet tegnes i: baseline før, perioden, og dagene etter.
 *
 * Etterdagene er ikke pynt. «Kom vekta tilbake?» er spørsmålet man har når
 * forløpet er over, og uten dager etter sluttdatoen kan flaten ikke svare på
 * det. De stopper ved i dag — en dag som ikke har vært har ingen målinger, og
 * en tom kolonne i høyre kant leses som et hull i dataene.
 */
export function buildEpisodeWindow(
	period: SickPeriod,
	todayKey: string,
	options: { baselineDays?: number; recoveryDays?: number } = {}
): EpisodeWindow {
	const baselineDays = options.baselineDays ?? BASELINE_DAYS;
	const recoveryDays = options.recoveryDays ?? RECOVERY_DAYS;

	const resolved = resolveSickPeriod(period, todayKey);
	const today = dayNumber(todayKey);
	const start = dayNumber(resolved.startDate);
	const end = dayNumber(resolved.effectiveEnd);

	const from = start - baselineDays;
	const to = Math.min(today, end + recoveryDays);

	const days: EpisodeDay[] = [];
	for (let d = from; d <= to; d++) {
		const sick = d >= start && d <= end;
		days.push({
			day: dayKeyFromNumber(d),
			sick,
			dayOfEpisode: sick ? d - start + 1 : null
		});
	}

	return {
		days,
		today: todayKey,
		onsetIndex: start - from,
		endIndex: end - from,
		baselineKeys: days.filter((d) => !d.sick && d.day < resolved.startDate).map((d) => d.day),
		sickKeys: days.filter((d) => d.sick).map((d) => d.day),
		length: resolved.days,
		open: resolved.open,
		staleOpen: resolved.staleOpen
	};
}

export type EpisodeTrackId =
	| 'level'
	| 'weight'
	| 'restingHr'
	| 'sleepHr'
	| 'sleep'
	| 'steps'
	| 'activeMinutes'
	| 'coreTemperature'
	| 'skinTemperature'
	| 'hrv';

export interface EpisodeTrackSpec {
	id: EpisodeTrackId;
	label: string;
	unit: string;
	/**
	 * Hvor tallet kommer fra, med ord. Alltid satt der flere kilder finnes for
	 * det samme — se regel 3. Null der det bare finnes én.
	 */
	source: string | null;
	/** Antall desimaler i visning og setning. */
	decimals: number;
	/**
	 * Hvilken RETNING er verdt å merke seg på denne raden?
	 *
	 * Feltet var `risingIsNotable: boolean` fram til HRV kom inn, og det holdt
	 * bare fordi alle radene som skulle markeres pekte samme vei. HRV er den
	 * første der FALLET er signalet — som sovepuls speilvendt — og en boolean
	 * kan ikke uttrykke det uten å invertere betydningen per rad, som er
	 * nøyaktig den slags stille inversjon `computePaceEstimate` gikk på.
	 *
	 * Brukes bare til farge, aldri til en dom: et forløp får ingen varselfarge
	 * av dette. `null` betyr at ingen retning skal markeres — vekt og
	 * selvrapportert nivå er BESKRIVELSEN av forløpet, ikke avvik fra det.
	 */
	notableDirection: 'up' | 'down' | null;
	/**
	 * Er det ABSOLUTTE tallet meningsløst alene?
	 *
	 * Hudtemperatur fra klokka er det: håndleddet ligger flere grader under
	 * kjernen, og det finnes ingen normtabell for 34,2 °C på et håndledd. Tallet
	 * ser autoritativt ut uten å være det, så raden viser bare AVVIKET fra
	 * baselinen — og finnes ingen baseline, sier raden det framfor å vise
	 * målingen. Flagget er kontrakten mot flaten: den skal aldri tegne
	 * `point.value` rått for en slik rad.
	 */
	absoluteIsMeaningless?: boolean;
	/**
	 * AKKUMULERER verdien gjennom døgnet?
	 *
	 * Skritt og aktive minutter gjør det: de teller oppover fra midnatt, så
	 * dagens tall er «så langt», ikke et døgn. Vekt, puls, søvn og temperatur
	 * gjør det ikke — en veiing er et punkt, og natta er ferdig i det du
	 * våkner.
	 *
	 * Forskjellen er ikke akademisk. Kl. 08:01 leste skrittraden **0 skritt**
	 * som overskrift, ved siden av en setning som sa 1 950 under forløpet:
	 * `latest` var dagens uferdige teller. Samme feil som «Underskudd» på en
	 * dag som ikke er omme (`frameDay`), og samme løsning som
	 * `buildDailyBalances`, der dager uten forbrukstall DROPPES framfor å telle
	 * som 0 — en null som ikke er en måling drar både medianen og
	 * overskriften feil vei.
	 *
	 * Er flagget satt, holdes DAGENS dag utenfor raden i sin helhet: ikke i
	 * punktene, ikke i medianen, ikke i dekningen. `todayExcluded` sier fra.
	 */
	accumulates?: boolean;
}

export interface EpisodePoint {
	day: string;
	value: number | null;
}

export interface EpisodeTrack extends EpisodeTrackSpec {
	/** Én per dag i vinduet, i samme rekkefølge. Hull er `null`. */
	points: EpisodePoint[];
	/** Median av baselinedagene, eller null under `MIN_BASELINE_SAMPLES`. */
	baseline: number | null;
	baselineSamples: number;
	/** Median av sykedagene. */
	during: number | null;
	/** Siste måling i vinduet, uansett hvor den ligger. */
	latest: number | null;
	latestDay: string | null;
	/** `during − baseline`. Null når en av dem mangler. */
	delta: number | null;
	/** Målte sykedager / sykedager. 1 = full dekning. */
	coverage: number;
	measuredSickDays: number;
	sickDays: number;
	/** Ble dagens uferdige teller holdt utenfor? Se `accumulates`. */
	todayExcluded: boolean;
	/** Setningen flaten og chatten skal si. Null når det ikke er noe å si. */
	text: string | null;
}

/**
 * Bygg én rad i forløpet.
 *
 * `byDay` er dagsnøkkel → verdi. Kalleren har alt valgt kilde og slått sammen
 * flere målinger per dag; her gjøres ingen tolkning av hva verdien betyr.
 */
export function buildEpisodeTrack(
	spec: EpisodeTrackSpec,
	byDay: ReadonlyMap<string, number>,
	window: EpisodeWindow
): EpisodeTrack {
	// Dagen som ikke er omme kan ikke rapporteres av en teller som fortsatt
	// går. Se `accumulates` — den droppes i sin helhet, ikke bare i medianen,
	// for et punkt på 0 kl. 08 er en falsk bunn i kurven også.
	const skipToday = spec.accumulates === true;
	const usable = (day: string) => !(skipToday && day === window.today);

	const points: EpisodePoint[] = window.days.map((d) => ({
		day: d.day,
		value: usable(d.day) ? (byDay.get(d.day) ?? null) : null
	}));

	const baselineValues = window.baselineKeys
		.filter(usable)
		.map((k) => byDay.get(k))
		.filter((v): v is number => typeof v === 'number');
	const sickKeys = window.sickKeys.filter(usable);
	const sickValues = sickKeys
		.map((k) => byDay.get(k))
		.filter((v): v is number => typeof v === 'number');
	// Nevneren følger med: «10 av 11 målt» der den ellevte er i dag ville sagt
	// at en måling mangler, og det er ikke det som skjedde.
	const todayExcluded = skipToday && window.sickKeys.length !== sickKeys.length;

	const baseline = baselineValues.length >= MIN_BASELINE_SAMPLES ? median(baselineValues) : null;
	const during = sickValues.length > 0 ? median(sickValues) : null;

	let latest: number | null = null;
	let latestDay: string | null = null;
	for (const point of points) {
		if (point.value !== null) {
			latest = point.value;
			latestDay = point.day;
		}
	}

	const sickDays = sickKeys.length;
	const track: EpisodeTrack = {
		...spec,
		points,
		baseline,
		baselineSamples: baselineValues.length,
		during,
		latest,
		latestDay,
		delta: baseline !== null && during !== null ? during - baseline : null,
		coverage: sickDays === 0 ? 0 : sickValues.length / sickDays,
		measuredSickDays: sickValues.length,
		sickDays,
		todayExcluded,
		text: null
	};

	return { ...track, text: describeEpisodeTrack(track) };
}

/**
 * Setningen for én rad.
 *
 * Den bærer forbeholdene sine, som `describeCurrentSwing`: mangler baselinen,
 * sies tallet uten sammenligning framfor å sammenligne med noe vi ikke har.
 * **Ingen forklaring på hvorfor et tall flyttet seg** — det er den grensa som
 * gjør loggen til en journal og ikke en vurdering.
 */
export function describeEpisodeTrack(
	track: Omit<EpisodeTrack, 'text'> & { text?: string | null }
): string | null {
	if (track.measuredSickDays === 0) return null;

	const n = (v: number) => formatNumber(v, track.decimals);

	if (track.baseline === null || track.delta === null || track.during === null) {
		const missing =
			track.baselineSamples === 0
				? 'ingen målinger de siste to ukene før'
				: `bare ${track.baselineSamples} måling${track.baselineSamples === 1 ? '' : 'er'} før`;
		// Uten baseline har en rad som bare gir mening relativt ingenting å si.
		// Å falle tilbake på råtallet ville brutt hele grunnen til flagget.
		if (track.absoluteIsMeaningless) {
			return `Målt under forløpet, men ikke noe å måle mot — ${missing}.`;
		}
		return `${n(track.during ?? track.latest ?? 0)} ${track.unit} i snitt under forløpet. Ingen baseline å måle mot — ${missing}.`;
	}

	const diff = Math.abs(track.delta);
	if (diff < smallestStep(track.decimals)) {
		return track.absoluteIsMeaningless
			? `Som de ${BASELINE_DAYS} dagene før.`
			: `${n(track.during)} ${track.unit} — uendret mot de ${BASELINE_DAYS} dagene før.`;
	}

	const direction = track.delta > 0 ? 'over' : 'under';
	if (track.absoluteIsMeaningless) {
		// Baselinen SKAL med, og det er ikke i strid med «absoluttverdien vises
		// aldri alene» — det er den regelen innfridd. «−17 ms» uten et tall å
		// måle mot er ikke noe. Er baselinen 61, er 17 en fjerdedel; er den 28,
		// er den mer enn halvparten. Det er `hvor mye` spørsmålet handler om,
		// og eneste ærlige referanse er brukerens egen.
		return `${n(diff)} ${track.unit} ${direction} de ${BASELINE_DAYS} dagene før (${n(track.baseline)}).`;
	}
	return `${n(track.during)} ${track.unit} under forløpet, ${n(diff)} ${track.unit} ${direction} de ${BASELINE_DAYS} dagene før (${n(track.baseline)}).`;
}

/**
 * Vekt målt i en sykeperiode hører ikke i vektutviklingen.
 *
 * Setningen står PÅ vektraden, ikke i en hjelpetekst, av samme grunn som
 * måleprotokollen står i livvidde-kortet: et tall man ikke skal sammenligne ser
 * nøyaktig ut som et tall man skal sammenligne. Vi sier at det ikke er
 * sammenlignbart — vi sier IKKE hvorfor, for det ville vært en påstand om
 * kroppen vi ikke måler.
 *
 * NB: det finnes ingen sperre i vekt-krydderet ennå. En rekord satt under et
 * forløp kan fortsatt bli en push. Se changeloggen.
 */
export const WEIGHT_CAVEAT =
	'Vekt målt under et sykdomsforløp er ikke sammenlignbar med vektutviklingen ellers.';

/* ── Søvn: DØGNET, ikke natta ────────────────────────────────────────── */

/**
 * Søvnen per døgn i et forløp — nattesøvn PLUSS dupper.
 *
 * Alle andre lesere av søvn holder dupper utenfor, og har rett i det: en flis
 * om dagen skal ikke dra nattsnittet opp, og «sov du nok i natt» er et
 * spørsmål om natta. Her er det motsatt, og grunnen er hva et forløp SPØR om.
 *
 * Den som ligger nede sover om dagen. Det er ikke støy i målingen av nattas
 * søvn — det ER sykdommen, og det er halve svaret på «hvor mye har kroppen
 * hvilt». Med dupper ute leste raden 4,6 t under et forløp der brukeren sov
 * 8–12 timer i døgnet, altså det motsatte av det som skjedde.
 *
 * Baselinen regnes av de samme reglene, så sammenligningen holder: på friske
 * dager finnes det knapt dupper, og de fjorten dagene før flytter seg nesten
 * ikke.
 *
 * NB: tallet er `total_sleep_time` fra Withings, altså tid SOVET — ikke tid i
 * senga. Åtte timer i senga leses derfor normalt som seks–sju. Raden sier
 * kilden sin, så tallet kan etterprøves framfor å se feil ut.
 */
export function episodeSleepByDay(points: readonly SleepNightPoint[]): Map<string, number> {
	const byDay = new Map<string, number>();
	for (const point of points) {
		byDay.set(point.date, (byDay.get(point.date) ?? 0) + point.hours);
	}
	// Summen av to avrundede timetall får en hale; rund av til samme oppløsning
	// som kildene, ellers viser raden 6,800000000000001 t.
	for (const [day, hours] of byDay) byDay.set(day, Math.round(hours * 100) / 100);
	return byDay;
}

/* ── Aksen ───────────────────────────────────────────────────────────── */

/**
 * Gulv på y-spennet per rad, i radens egen enhet.
 *
 * Uten et gulv strekkes aksen til målingene, og tre hundre gram tegnes som et
 * stup — samme feil `MIN_WEIGHT_AXIS_SPAN_KG` og sparklinen i sovepuls-kortet
 * finnes for å hindre. Tallene er de samme som de flatene alt bruker, så en
 * kurve ikke ser brattere ut her enn på Vekt- eller Søvn-flaten.
 */
export const MIN_AXIS_SPAN: Record<EpisodeTrackId, number> = {
	level: 4,
	weight: 1.5,
	restingHr: 8,
	sleepHr: 8,
	sleep: 1.5,
	// Skritt spriker tusenvis mellom to helt like dager; uten et romslig gulv
	// tegnes normal variasjon som et stup. Aktive minutter er et lite tall der
	// null er en vanlig verdi, så gulvet er det som holder en rolig uke flat.
	steps: 3000,
	activeMinutes: 20,
	coreTemperature: 1,
	skinTemperature: 1,
	// SDNN spriker mer enn puls mellom netter; et for lavt gulv gjør normal
	// nattvariasjon til et stup.
	hrv: 10
};

/** Skalaen er skalaen: en 1–5-akse som strekkes gjør ett hakk til et stup. */
export const FIXED_AXES: Partial<Record<EpisodeTrackId, { min: number; max: number }>> = {
	level: { min: 1, max: 5 }
};

export interface EpisodeAxis {
	min: number;
	max: number;
}

/**
 * Y-spennet raden tegnes i, med gulv og litt luft.
 *
 * Null når raden ikke har et eneste punkt — kalleren skal da la være å tegne,
 * ikke tegne en tom ramme.
 */
export function episodeAxis(
	track: Pick<EpisodeTrack, 'id' | 'points' | 'baseline' | 'during'>
): EpisodeAxis | null {
	const fixed = FIXED_AXES[track.id];
	if (fixed) return fixed;

	const values = track.points
		.map((p) => p.value)
		.filter((v): v is number => v !== null);
	// Begge medianlinjene tegnes som referanser, så begge må få plass i domenet
	// — ellers ligger en av dem utenfor rammen og forsvinner stille.
	//
	// `during` ligger i praksis ALLTID innenfor punktenes eget spenn (den er en
	// median av dem), så linja under er en no-op i dag. Den står likevel: en
	// framtidig endring av hvordan `during` regnes ville ellers flyttet en linje
	// ut av rammen uten at noe sier fra, og det er nøyaktig den klassen feil
	// resten av modulen er skrevet for å unngå.
	if (track.baseline !== null) values.push(track.baseline);
	if (track.during !== null) values.push(track.during);
	if (values.length === 0) return null;

	const lo = Math.min(...values);
	const hi = Math.max(...values);
	const floor = MIN_AXIS_SPAN[track.id] ?? 1;
	const span = Math.max(hi - lo, floor);
	const mid = (lo + hi) / 2;
	// Ti prosent luft, så ytterpunktene ikke klistrer seg til kantene.
	const padded = span * 1.1;
	return { min: mid - padded / 2, max: mid + padded / 2 };
}

/* ── Selvrapportert nivå: forløpets ryggrad ──────────────────────────── */

/**
 * Færre enn tre svar er ikke et forløp.
 *
 * Samme gulv som `predictHunger`: en kurve fra to punkter er en gjetning med
 * selvtillit, og bommer den, slutter brukeren å svare.
 */
export const MIN_LEVEL_OBSERVATIONS = 3;

/**
 * Hvor mange hakk nivået må FALLE fra en topp før vi kaller det et tilbakefall.
 *
 * To, ikke ett. Skalaen har fem trinn, og ett hakk er vingling — 3 → 4 → 3 er
 * en middels dag, ikke en vending. Krever vi to, betyr ordet «tilbakefall»
 * noe. Prisen er at et ekte, langsomt tilbakefall over mange dager kan gå under
 * radaren; kurven viser det uansett.
 */
export const RELAPSE_DROP = 2;

/** Hvor mange hakk nivået må ha STEGET først. En bedring må ha vært der. */
export const RELAPSE_RISE = 1;

export interface LevelObservation {
	day: string;
	level: number;
}

export interface Relapse {
	/** Dagen nivået var på topp før fallet. */
	peakDay: string;
	peakLevel: number;
	/** Dagen nivået var lavest etter toppen. */
	troughDay: string;
	troughLevel: number;
}

/**
 * Fant vi en bedring etterfulgt av en forverring?
 *
 * Leter etter det STØRSTE fallet fra en topp som selv lå over et tidligere
 * lavpunkt. Toppen må altså ha vært en bedring, ikke bare starten av forløpet:
 * uten det ville hver eneste periode som begynner høyt og faller vært et
 * «tilbakefall», og det er bare å bli syk.
 */
export function findRelapse(observations: readonly LevelObservation[]): Relapse | null {
	if (observations.length < MIN_LEVEL_OBSERVATIONS) return null;
	const sorted = [...observations].sort((a, b) => (a.day < b.day ? -1 : 1));

	let best: Relapse | null = null;
	let bestDrop = 0;

	for (let peak = 1; peak < sorted.length - 1; peak++) {
		const lowBefore = Math.min(...sorted.slice(0, peak).map((o) => o.level));
		const rise = sorted[peak]!.level - lowBefore;
		if (rise < RELAPSE_RISE) continue;

		for (let trough = peak + 1; trough < sorted.length; trough++) {
			const drop = sorted[peak]!.level - sorted[trough]!.level;
			if (drop < RELAPSE_DROP || drop <= bestDrop) continue;
			bestDrop = drop;
			best = {
				peakDay: sorted[peak]!.day,
				peakLevel: sorted[peak]!.level,
				troughDay: sorted[trough]!.day,
				troughLevel: sorted[trough]!.level
			};
		}
	}

	return best;
}

/**
 * Forløpet i ord, av de selvrapporterte nivåene.
 *
 * Nivået er det eneste signalet ingen sensor kan hente, og derfor det eneste
 * som kan si «jeg ble bedre og så dårligere igjen». Den holder kjeft under
 * `MIN_LEVEL_OBSERVATIONS`.
 */
export function describeLevelCourse(observations: readonly LevelObservation[]): string | null {
	if (observations.length === 0) return null;
	const sorted = [...observations].sort((a, b) => (a.day < b.day ? -1 : 1));
	const first = sorted[0]!;
	const last = sorted[sorted.length - 1]!;

	if (sorted.length < MIN_LEVEL_OBSERVATIONS) {
		return `${sorted.length} innsjekk så langt, sist ${last.level} av 5. For få til å si noe om retningen.`;
	}

	const relapse = findRelapse(sorted);
	if (relapse) {
		return `${sorted.length} innsjekk. Opp til ${relapse.peakLevel} av 5 ${formatDay(relapse.peakDay)}, ned igjen til ${relapse.troughLevel} ${formatDay(relapse.troughDay)}. Sist ${last.level}.`;
	}

	const change = last.level - first.level;
	if (change === 0) return `${sorted.length} innsjekk, og nivået står på ${last.level} av 5.`;
	return `${sorted.length} innsjekk. Fra ${first.level} til ${last.level} av 5 — ${change > 0 ? 'oppover' : 'nedover'}.`;
}

/* ── Symptomene som bjelker på den samme aksen ───────────────────────── */

export interface SymptomBar {
	id: string;
	label: string;
	severity: ResolvedSymptom['severity'];
	limiting: boolean;
	/** Første og siste indeks i vinduet symptomet dekker. */
	fromIndex: number;
	toIndex: number;
	/** Startet symptomet før vinduet? Da er venstre kant en avkorting. */
	startsBefore: boolean;
	/** Varer det ut over vinduet (eller pågår fortsatt)? */
	endsAfter: boolean;
	/** Symptomet som holdt deg ute av stand til å trene. */
	text: string;
}

/**
 * Symptomene klippet til vinduet, som bjelker på den delte aksen.
 *
 * Avkortingen MERKES i begge ender (`startsBefore`/`endsAfter`) framfor å
 * flyttes: et ømt kne som startet i juli og varer ut september ville sett ut som
 * om det begynte med infeksjonen hvis bjelken bare startet i kanten. Det er
 * nettopp den slutningen loggen finnes for å hindre.
 */
export function buildSymptomBars(
	symptoms: readonly ResolvedSymptom[],
	window: EpisodeWindow
): SymptomBar[] {
	if (window.days.length === 0) return [];
	const first = window.days[0]!.day;
	const last = window.days[window.days.length - 1]!.day;
	const firstNum = dayNumber(first);

	const bars: SymptomBar[] = [];
	for (const symptom of symptoms) {
		if (!isDayKey(symptom.startDate)) continue;
		const end = symptom.endDate ?? last;
		// Ingen overlapp med vinduet i det hele tatt.
		if (symptom.startDate > last || end < first) continue;

		const fromIndex = Math.max(0, dayNumber(symptom.startDate) - firstNum);
		const toIndex = Math.min(window.days.length - 1, dayNumber(end) - firstNum);

		bars.push({
			id: symptom.id,
			label: symptom.label,
			severity: symptom.severity,
			limiting: symptom.limiting,
			fromIndex,
			toIndex,
			startsBefore: symptom.startDate < first,
			endsAfter: end > last,
			text: describeSymptom(symptom)
		});
	}

	// Begrensende først, så de lengste — det som forklarer perioden står øverst.
	return bars.sort((a, b) => {
		if (a.limiting !== b.limiting) return a.limiting ? -1 : 1;
		return b.toIndex - b.fromIndex - (a.toIndex - a.fromIndex);
	});
}

/* ── Overskriften ────────────────────────────────────────────────────── */

/**
 * Én linje som sier hvor i forløpet man er.
 *
 * En åpen periode sier «så langt», nøyaktig som `HistoryDay.partial`: tallene
 * under er et utsnitt av noe som ikke er ferdig, og uten den setningen leses de
 * som en fasit.
 */
export function describeEpisode(window: EpisodeWindow, startDate: string): string {
	const day = formatDay(startDate);
	if (window.staleOpen) {
		return `Startet ${day}. Perioden står åpen uten sluttdato — sett et sluttpunkt for at tallene skal bety noe.`;
	}
	if (window.open) {
		return `Dag ${window.length} av forløpet, som startet ${day}. Tallene er så langt.`;
	}
	return `${window.length} ${window.length === 1 ? 'dag' : 'dager'} fra ${day}.`;
}

/* ── Hele forløpet ───────────────────────────────────────────────────── */

/**
 * Formen serveren fyller og flaten tegner.
 *
 * Typen bor i DOMENELAGET, ikke hos lasteren, og det er ikke en smakssak:
 * `$lib/server/*` kan ikke importeres fra en komponent, heller ikke som en
 * type-only import — og et `/design`-mockobjekt måtte da vært skrevet fritt,
 * altså kunne det ha drevet fra det ekte svaret uten at noe sa fra.
 */
export interface SickEpisode {
	period: ResolvedSickPeriod & { text: string };
	window: EpisodeWindow;
	/** Én linje om hvor i forløpet man er. Sier «så langt» på en åpen periode. */
	headline: string;
	tracks: EpisodeTrack[];
	symptoms: SymptomBar[];
	/** Selvrapporterte nivåer — ryggraden i forløpet. */
	levels: LevelObservation[];
	levelText: string | null;
	relapse: Relapse | null;
	/** Forbeholdet som hører PÅ vektraden. */
	weightCaveat: string;
}

/* ── Småting ─────────────────────────────────────────────────────────── */

function median(values: readonly number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/** Minste forskjell som er synlig med gitt antall desimaler. */
function smallestStep(decimals: number): number {
	return Math.pow(10, -decimals) / 2;
}

/**
 * Tall som de skrives på flaten.
 *
 * **Tusenskille under `decimals === 0`, med hardt mellomrom.** Skritt er den
 * eneste raden som når fire sifre, og «8240» leses ikke som et antall i en
 * kolonne der naboene er «49» og «6,8». Regelen er knyttet til desimaltallet
 * framfor til rad-id-en fordi ingen annen heltallsrad kan komme i nærheten:
 * puls topper på ~200, nivået går til 5.
 *
 * Eksportert fordi `SickEpisodeTrack.svelte` skriver de samme tallene ved
 * siden av setningene herfra — to formatterere ville gitt «8 240 skritt» over
 * en setning som sa «8240».
 */
export function formatEpisodeValue(value: number, decimals: number): string {
	const text = value.toFixed(decimals).replace('.', ',');
	if (decimals !== 0) return text;
	// Hardt mellomrom (U+00A0): et vanlig ville latt tallet brekke midt i to.
	return text.replace(/\B(?=(\d{3})+(?!\d))/g, '\u00A0');
}

function formatNumber(value: number, decimals: number): string {
	return formatEpisodeValue(value, decimals);
}

const MONTHS = [
	'jan',
	'feb',
	'mar',
	'apr',
	'mai',
	'jun',
	'jul',
	'aug',
	'sep',
	'okt',
	'nov',
	'des'
];

function formatDay(dayKey: string): string {
	const [, month, day] = dayKey.split('-');
	return `${Number(day)}. ${MONTHS[Number(month) - 1] ?? ''}`;
}
