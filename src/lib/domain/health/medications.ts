/**
 * medications.ts — hva som ble GJORT med kroppen, ved siden av hva som skjedde med den.
 *
 * ## Hvorfor i det hele tatt
 *
 * Forløpsflaten har en tidsakse for hva som skjedde med kroppen — nivå, søvn,
 * puls, vekt, bevegelse — og ingenting om hva som ble gjort med den. Nivået er
 * ryggraden nettopp fordi det er det eneste signalet som kan si «jeg ble bedre
 * og så dårligere igjen». Men når kurven snur, sier ingenting HVORFOR, og en kur
 * startet på dag 4 er den mest sannsynlige forklaringen som finnes.
 *
 * ## En kur er en PERIODE, en dose er en HENDELSE
 *
 * Samme todeling som sykeperiode mot symptom, og sykeperiode mot nivå-innsjekk.
 * Kuren har startdato, kanskje sluttdato, og en rytme; dosen er et tidspunkt.
 *
 * ## Rytmen er et strukturelt skille, ikke et innstillingsfelt
 *
 * De to formene stiller ULIKE SPØRSMÅL, og det avgjør hva en dag SER UT som:
 *
 *  - **`fast`**: planen sier hvor mange doser dagen har, så dagen er en rekke
 *    SLOTS man haker av. Spørsmålet er «har jeg tatt den», og med to medisiner
 *    på ulik frekvens er det ikke et spørsmål man kan holde i hodet.
 *  - **`ved_behov`**: ingen plan, ingen slots. Dosene legges til fortløpende, og
 *    ANTALLET per dag er det som betyr noe — «fire ganger mandag, én gang
 *    fredag». Det er ærlig: det påstår ikke at medisinen virket, bare at du
 *    trengte den sjeldnere.
 *
 * ## Klokkeslett, ikke «3 × daglig» som fritekst
 *
 * Første utgave lagret planen som fritekst, fordi et strukturert intervall
 * inviterte til en påminnelse vi ikke leverer. Det var feil prioritering: uten
 * klokkeslett kan ingen slot ORDNES, og da finnes verken «neste dose» eller en
 * felles tidslinje for to medisiner med ulik frekvens — som er nettopp det man
 * har en dosekalender for.
 *
 * `times` er derfor `HH:MM` i Oslo-tid, stigende. Flaten tilbyr presets
 * (1–4 × daglig) så ingen må skrive klokkeslett for hånd, men de KAN rettes:
 * en plan man ikke kjenner igjen blir ikke fulgt.
 *
 * Vi VARSLER fortsatt ikke. Kalenderen er en flate man åpner; en påminnelse er
 * en annen mekanisme (repoets påminnelser er slots på ukelista, ikke push), og
 * et varsel som svikter stille er verre enn ingen.
 *
 * ## Vi sier ALDRI om den virket
 *
 * Ikke av forsiktighet — det er en konkret statistisk felle. En infeksjon går
 * over av seg selv, så HVA SOM HELST startet midt i forløpet ser virksomt ut:
 * n = 1, ingen kontroll, konfundert av det naturlige forløpet. En effektdom her
 * ville vært den andre «for mye»-dommen CLAUDE.md advarer mot, i verste
 * innpakning — to modeller om samme sak blir aldri enige, og denne ene ville
 * dessuten lest som et medisinsk råd.
 *
 * Vi registrerer, vi plasserer på tidsaksen, vi tolker ingenting. Ingen
 * doseringssjekk, ingen interaksjoner, ingen «du glemte en dose». Samme
 * tolkningsforbud som symptomene har i briefingen.
 *
 * ## Ingen kategorier — `purpose` er brukerens egne ord
 *
 * «Mot hoste», «betennelsesdempende». Ikke et legemiddelregister og ikke en
 * enum vi validerer mot: en tvungen kategorisering er verre enn en åpen, samme
 * begrunnelse som `annet` blant symptom-typene.
 *
 * ## Ingen foreldelse, i motsetning til sykeperioden
 *
 * En åpen sykeperiode UNNSKYLDER streak-dager, så en glemt bryter har
 * konsekvenser og må ha et tak (`MAX_OPEN_SICK_DAYS`). En åpen medisinkur
 * BESKRIVER bare, og en fast medisin man går på i årevis er helt normal. Et tak
 * her ville vært en påstand om at behandling er midlertidig.
 *
 * Modulen er DB-fri og regner på dagsnøkler ('YYYY-MM-DD').
 */

import { dayKeyFromNumber, dayNumber } from '$lib/domain/streaks';
import { isDayKey } from './sick-periods';

/**
 * Rytmen. Se modulkommentaren: dette avgjør HVA som logges, ikke bare hvordan
 * kuren beskrives.
 */
export const MEDICATION_RHYTHMS = ['fast', 'ved_behov'] as const;
export type MedicationRhythm = (typeof MEDICATION_RHYTHMS)[number];

export const MEDICATION_RHYTHM_LABELS: Record<MedicationRhythm, string> = {
	fast: 'Fast',
	ved_behov: 'Ved behov'
};

/** Lang nok til «Amoksicillin 500 mg», kort nok til å stå på én linje. */
export const MAX_MEDICATION_NAME = 80;
/** Lang nok til «betennelsesdempende, mot hovne bihuler». */
export const MAX_MEDICATION_PURPOSE = 120;
/** Ingen tar en tablett tjuefire ganger om dagen; taket stopper en tastefeil. */
export const MAX_DOSES_PER_DAY = 12;

/**
 * Standardtider per antall doser, så ingen må skrive klokkeslett for hånd.
 *
 * Valgt mot en våken dag (ikke jevnt over døgnet): fire doser er 08–20, ikke
 * 00–18. De KAN rettes — en plan man ikke kjenner igjen blir ikke fulgt.
 */
export const DEFAULT_TIMES: Record<number, string[]> = {
	1: ['09:00'],
	2: ['09:00', '21:00'],
	3: ['08:00', '14:00', '20:00'],
	4: ['08:00', '12:00', '16:00', '20:00'],
	5: ['08:00', '11:00', '14:00', '17:00', '20:00'],
	6: ['08:00', '11:00', '14:00', '17:00', '20:00', '23:00']
};

/** «HH:MM», 00:00–23:59. */
export function isClockTime(value: unknown): value is string {
	return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export interface Medication {
	id: string;
	/** Brukerens egne ord: «Paracet», «Amoksicillin 500 mg». */
	name: string;
	/**
	 * Hva DU forventer at den gjør. Fritekst, ikke en kategori — se
	 * modulkommentaren. Null når du ikke gadd å skrive noe.
	 */
	purpose: string | null;
	rhythm: MedicationRhythm;
	/**
	 * Klokkeslettene dagens doser ligger på, «HH:MM» i Oslo-tid, stigende.
	 *
	 * ER planen — antallet er `times.length`. Tom for `ved_behov`, som ikke har
	 * en plan å hake av mot.
	 */
	times: string[];
	startDate: string;
	/** Siste dagen du tok den, eller null for «går fortsatt på den». */
	endDate: string | null;
	note: string | null;
}

export interface ResolvedMedication extends Medication {
	/** Går du fortsatt på den (ingen sluttdato, eller sluttdato i dag/senere). */
	ongoing: boolean;
	/** Dager fra start til og med i dag eller sluttdato — aldri fram i tid. */
	days: number;
	/** Logges doser for denne? Bare `ved_behov` — se modulkommentaren. */
	tracksDoses: boolean;
}

export function resolveMedication(med: Medication, todayKey: string): ResolvedMedication {
	const start = dayNumber(med.startDate);
	const today = dayNumber(todayKey);
	const end = med.endDate === null ? null : dayNumber(med.endDate);
	// En kur som startet «i dag» varer én dag, ikke null. Som `resolveSymptom`.
	const lastCounted = Math.min(end ?? today, today);

	return {
		...med,
		ongoing: end === null || end >= today,
		days: Math.max(1, lastCounted - start + 1),
		tracksDoses: med.rhythm === 'ved_behov'
	};
}

/** Kurene som var i gang en gitt dag. Til markørene på forløpet. */
export function medicationsOnDay(
	meds: readonly Medication[],
	dayKey: string
): Medication[] {
	return meds.filter(
		(m) => m.startDate <= dayKey && (m.endDate === null || m.endDate >= dayKey)
	);
}

/**
 * Kurer som overlapper en periode.
 *
 * Datooverlapp, ikke en lagret fremmednøkkel — samme valg som
 * `symptomsDuringPeriod`, og av samme grunn: en blodtrykksmedisin du går på i
 * årevis «tilhører» ikke denne influensaen i noen meningsfull forstand.
 */
export function medicationsDuringPeriod(
	meds: readonly Medication[],
	period: { startDate: string; endDate: string | null },
	todayKey: string
): Medication[] {
	const periodEnd = period.endDate ?? todayKey;
	return meds.filter(
		(m) => m.startDate <= periodEnd && (m.endDate === null || m.endDate >= period.startDate)
	);
}

/**
 * Pågående kurer, viktigste først: ved-behov øverst (de har et tall som
 * beveger seg), deretter den som ble startet sist — en fersk kur er den man
 * lurer på.
 */
export function rankOngoingMedications(
	meds: readonly Medication[],
	todayKey: string
): ResolvedMedication[] {
	return meds
		.map((m) => resolveMedication(m, todayKey))
		.filter((m) => m.ongoing)
		.sort((a, b) => {
			if (a.tracksDoses !== b.tracksDoses) return a.tracksDoses ? -1 : 1;
			return a.startDate < b.startDate ? 1 : -1;
		});
}

/* ── Doser ───────────────────────────────────────────────────────────────── */

export interface MedicationDose {
	id: string;
	medicationId: string;
	/** Oslo-dagen dosen ble tatt. */
	day: string;
	/** ISO-tidspunkt. Flere doser samme dag er normalen — se `medication-log.ts`. */
	takenAt: string;
	/**
	 * Hvilken slot dosen fyller, «HH:MM». Null for `ved_behov` (ingen plan) og
	 * for en ekstradose utenom planen.
	 *
	 * Sloten sies EKSPLISITT av den som haker av, den utledes aldri av
	 * klokkeslettet. «Jeg tok morgendosen først kl. 11» er helt vanlig, og en
	 * nærmeste-slot-gjetning ville da fylt formiddagssloten og latt morgenen stå
	 * som glemt — altså gjort loggen gal i akkurat det tilfellet den skal fange.
	 */
	slot: string | null;
	note: string | null;
}

/* ── Dosekalenderen ──────────────────────────────────────────────────────── */

/**
 * Tilstanden til én slot.
 *
 * `due` og `missed` er ARITMETIKK mot brukerens egen plan, ikke en vurdering:
 * klokka har passert, og ingen dose er haket av. Vi maser ikke og tolker ikke
 * hva et hopp betyr.
 */
export type DoseSlotStatus = 'taken' | 'due' | 'upcoming' | 'missed';

export interface DoseSlot {
	time: string;
	status: DoseSlotStatus;
	doseId: string | null;
	/** ISO-tidspunktet dosen faktisk ble haket av. */
	takenAt: string | null;
}

export interface MedicationDay {
	day: string;
	/** Dekker kuren denne dagen? Er den ikke det, finnes ingen slots. */
	inCourse: boolean;
	/** Planlagte doser. Tom for `ved_behov`. */
	slots: DoseSlot[];
	/** Doser uten slot: alle for `ved_behov`, ekstradoser for `fast`. */
	extra: MedicationDose[];
	taken: number;
	/** Hvor mange planlagte doser dagen hadde. 0 for `ved_behov`. */
	planned: number;
}

/**
 * Én dag for én kur: hvilke slots som er haket av, og hva som er igjen.
 *
 * **Dagens dag er ikke ferdig, og det er hele skillet mellom `due` og
 * `missed`.** En slot kl. 20 er ikke glemt kl. 08 — den har ikke vært ennå.
 * Samme regel som `accumulates` på skritt og `frameDay` i ernæringen: et tall
 * fra en dag som ikke er omme skal ikke leses som et resultat.
 *
 * `nowHm` er Oslo-veggklokka, siden slottene er det.
 */
export function buildMedicationDay(
	med: Medication,
	doses: readonly MedicationDose[],
	day: string,
	todayKey: string,
	nowHm: string
): MedicationDay {
	const inCourse = day >= med.startDate && (med.endDate === null || day <= med.endDate);
	const forDay = doses.filter((d) => d.medicationId === med.id && d.day === day);

	if (!inCourse) {
		return { day, inCourse: false, slots: [], extra: [], taken: 0, planned: 0 };
	}

	const bySlot = new Map<string, MedicationDose>();
	const extra: MedicationDose[] = [];
	for (const dose of forDay) {
		// To doser på samme slot: den FØRSTE står. En gjentatt haking er et
		// feiltrykk, ikke en ny dose, og skal ikke se ut som en ekstradose.
		if (dose.slot && med.times.includes(dose.slot) && !bySlot.has(dose.slot)) {
			bySlot.set(dose.slot, dose);
		} else {
			extra.push(dose);
		}
	}

	const slots: DoseSlot[] = med.times.map((time) => {
		const dose = bySlot.get(time);
		if (dose) {
			return { time, status: 'taken' as const, doseId: dose.id, takenAt: dose.takenAt };
		}
		let status: DoseSlotStatus;
		if (day < todayKey) status = 'missed';
		else if (day > todayKey) status = 'upcoming';
		else status = time <= nowHm ? 'due' : 'upcoming';
		return { time, status, doseId: null, takenAt: null };
	});

	return {
		day,
		inCourse: true,
		slots,
		extra,
		taken: forDay.length,
		planned: med.times.length
	};
}

export interface NextDose {
	medicationId: string;
	name: string;
	time: string;
	/** Gjelder den i dag, eller først i morgen? */
	day: string;
}

/**
 * Neste planlagte dose på tvers av alle kurer.
 *
 * Det er SPØRSMÅLET man har med to medisiner på ulik frekvens, og det eneste
 * som krever at slottene er klokkeslett framfor et antall: to planer kan ikke
 * flettes uten en felles akse.
 *
 * Ser bare framover — en `due` slot er noe å hake av, ikke noe som kommer. Den
 * teller ikke som «neste», ellers ville linja stått fast på en glemt morgendose
 * resten av dagen og aldri pekt på den som faktisk kommer.
 */
export function nextDose(
	meds: readonly Medication[],
	doses: readonly MedicationDose[],
	todayKey: string,
	nowHm: string
): NextDose | null {
	const tomorrow = dayKeyAfter(todayKey);
	const candidates: NextDose[] = [];

	for (const med of meds) {
		if (med.rhythm !== 'fast' || med.times.length === 0) continue;

		for (const day of [todayKey, tomorrow]) {
			const built = buildMedicationDay(med, doses, day, todayKey, nowHm);
			if (!built.inCourse) continue;
			const slot = built.slots.find((s) => s.status === 'upcoming');
			if (slot) {
				candidates.push({ medicationId: med.id, name: med.name, time: slot.time, day });
				break;
			}
		}
	}

	if (candidates.length === 0) return null;
	return candidates.sort((a, b) =>
		a.day === b.day ? a.time.localeCompare(b.time) : a.day.localeCompare(b.day)
	)[0]!;
}

function dayKeyAfter(dayKey: string): string {
	return dayKeyFromNumber(dayNumber(dayKey) + 1);
}

/**
 * Doser per dag for ÉN kur, over et vindu.
 *
 * ## `null` utenfor kuren, `0` inne i den — og det er motsatt av ernæringsregelen
 *
 * `history-series.ts` sier «hull i serien er null, aldri 0», fordi en dag man
 * glemte å logge ikke er en dag man ikke spiste. Her er det omvendt INNE i
 * kuren: en dag uten doser er en dag du **ikke trengte den**, og det er hele
 * signalet — nullen er målingen. Utenfor kuren finnes det derimot ingenting å
 * måle, og da er `null` riktig.
 *
 * Blandes de to, leses «ikke trengt den» som «ikke logget» og bedringen
 * forsvinner ut av raden.
 */
export function dosesPerDay(
	doses: readonly MedicationDose[],
	medication: Medication,
	dayKeys: readonly string[]
): Map<string, number | null> {
	const counts = new Map<string, number>();
	for (const dose of doses) {
		if (dose.medicationId !== medication.id) continue;
		counts.set(dose.day, (counts.get(dose.day) ?? 0) + 1);
	}

	const out = new Map<string, number | null>();
	for (const day of dayKeys) {
		const inCourse =
			day >= medication.startDate && (medication.endDate === null || day <= medication.endDate);
		out.set(day, inCourse ? (counts.get(day) ?? 0) : null);
	}
	return out;
}

/* ── Validering ──────────────────────────────────────────────────────────── */

export interface MedicationInput {
	id?: string;
	name: string;
	purpose?: string | null;
	rhythm?: string;
	/** «HH:MM»-liste, eller et ANTALL som slås opp i `DEFAULT_TIMES`. */
	times?: unknown;
	startDate?: string;
	endDate?: string | null;
	note?: string | null;
}

export type MedicationValidation =
	| {
			ok: true;
			value: {
				id?: string;
				name: string;
				purpose: string | null;
				rhythm: MedicationRhythm;
				times: string[];
				startDate: string;
				endDate: string | null;
				note: string | null;
			};
	  }
	| { ok: false; error: string };

function trimmed(value: unknown, max: number): string | null {
	if (typeof value !== 'string') return null;
	const t = value.trim();
	return t ? t.slice(0, max) : null;
}

/**
 * Validering delt av endepunktet og flaten, så en verdi som godtas ett sted
 * ikke avvises et annet — samme arbeidsdeling som `validateSickPeriod`.
 */
export function validateMedication(
	input: MedicationInput,
	todayKey: string
): MedicationValidation {
	const name = trimmed(input.name, MAX_MEDICATION_NAME);
	if (!name) return { ok: false, error: 'Medisinen må ha et navn.' };

	const rhythm = input.rhythm ?? 'fast';
	if (!(MEDICATION_RHYTHMS as readonly string[]).includes(rhythm)) {
		return { ok: false, error: 'Rytmen må være «fast» eller «ved_behov».' };
	}

	const startDate = input.startDate ?? todayKey;
	if (!isDayKey(startDate)) {
		return { ok: false, error: 'Startdato må være på formen ÅÅÅÅ-MM-DD.' };
	}
	// En kur fram i tid er en plan, ikke en registrering — samme regel som
	// sykeperioden: du vet ikke at du kommer til å ta den.
	if (startDate > todayKey) {
		return { ok: false, error: 'Startdato kan ikke være fram i tid.' };
	}

	const rawEnd = input.endDate;
	let endDate: string | null = null;
	if (rawEnd !== undefined && rawEnd !== null && rawEnd !== '') {
		if (!isDayKey(rawEnd)) {
			return { ok: false, error: 'Sluttdato må være på formen ÅÅÅÅ-MM-DD.' };
		}
		if (rawEnd < startDate) {
			return { ok: false, error: 'Sluttdato kan ikke være før startdato.' };
		}
		endDate = rawEnd;
	}

	// En sluttdato fram i tid er lov her, i motsetning til på sykeperioden: «kuren
	// varer ut uka» er en FAKTISK opplysning fra resepten, og den unnskylder
	// ingenting. `resolveMedication` teller uansett aldri dager som ikke har vært.

	// En plan på en ved-behov-medisin er en selvmotsigelse, og tider som ble
	// stående fra et rytmebytte ville blitt vist som om de gjaldt.
	let times: string[] = [];
	if (rhythm === 'fast') {
		const parsed = parseTimes(input.times);
		if (!parsed.ok) return parsed;
		times = parsed.times;
		// En fast kur uten et eneste klokkeslett har ingen dag å hake av, altså
		// ingen kalender. Det er ikke en gyldig tilstand, det er en halvferdig
		// registrering som ville sett ut som en flate som ikke virker.
		if (times.length === 0) {
			return { ok: false, error: 'En fast kur trenger minst ett klokkeslett.' };
		}
	}

	return {
		ok: true,
		value: {
			id: input.id,
			name,
			purpose: trimmed(input.purpose, MAX_MEDICATION_PURPOSE),
			rhythm: rhythm as MedicationRhythm,
			times,
			startDate,
			endDate,
			note: trimmed(input.note, 200)
		}
	};
}

/**
 * Tar imot enten en ferdig «HH:MM»-liste eller et ANTALL doser per dag.
 *
 * Antallet finnes fordi ingen skal måtte skrive klokkeslett for hånd for å
 * komme i gang — flaten sender «3» og får standardtidene. Tidene KAN rettes
 * etterpå; en plan man ikke kjenner igjen blir ikke fulgt.
 */
function parseTimes(
	raw: unknown
): { ok: true; times: string[] } | { ok: false; error: string } {
	if (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw))) {
		const count = Number(raw);
		if (!Number.isInteger(count) || count < 1 || count > MAX_DOSES_PER_DAY) {
			return { ok: false, error: `Antall doser per dag må være mellom 1 og ${MAX_DOSES_PER_DAY}.` };
		}
		const preset = DEFAULT_TIMES[count];
		if (preset) return { ok: true, times: [...preset] };
		// Over presetene: fordel jevnt over den våkne dagen framfor å avvise.
		const times: string[] = [];
		for (let i = 0; i < count; i++) {
			const minutes = Math.round(8 * 60 + (i * 14 * 60) / Math.max(1, count - 1));
			times.push(`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`);
		}
		return { ok: true, times };
	}

	if (!Array.isArray(raw)) return { ok: true, times: [] };
	if (raw.length > MAX_DOSES_PER_DAY) {
		return { ok: false, error: `Maks ${MAX_DOSES_PER_DAY} doser per dag.` };
	}
	const times: string[] = [];
	for (const value of raw) {
		if (!isClockTime(value)) {
			return { ok: false, error: 'Klokkeslett må være på formen TT:MM.' };
		}
		// Duplikater ville gitt to slots som ikke kan skilles: en haking på den
		// ene ville sett vilkårlig ut på den andre.
		if (!times.includes(value)) times.push(value);
	}
	return { ok: true, times: times.sort() };
}

/* ── Ord ─────────────────────────────────────────────────────────────────── */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];

function shortDate(dayKey: string): string {
	const [, m, d] = dayKey.split('-');
	return `${Number(d)}. ${MONTHS[Number(m) - 1]}`;
}

/**
 * «Amoksicillin 500 mg — 3 × daglig siden 14. sep (4 dager)».
 *
 * Setningen bor her og ikke i `.svelte`-fila fordi helsechatten må si det samme
 * som skjermen — samme grunn som `describeSickPeriod`.
 */
export function describeMedication(med: ResolvedMedication): string {
	const days = `${med.days} ${med.days === 1 ? 'dag' : 'dager'}`;
	const rhythm = med.rhythm === 'ved_behov' ? 'ved behov' : describeSchedule(med.times);

	if (med.ongoing) {
		return `${med.name} — ${rhythm} siden ${shortDate(med.startDate)} (${days})`;
	}
	const end = med.endDate as string;
	if (med.startDate === end) return `${med.name} — ${rhythm}, ${shortDate(end)}`;
	// Samme månedssammentrekning som `describeSickPeriod`: «10.–16. sep», ikke
	// «10. sep–16. sep». To datoformer for det samme i én flate leses som to
	// ulike slags datoer.
	const sameMonth = med.startDate.slice(0, 7) === end.slice(0, 7);
	const from = sameMonth ? `${Number(med.startDate.slice(8))}.` : shortDate(med.startDate);
	return `${med.name} — ${rhythm}, ${from}–${shortDate(end)} (${days})`;
}

/**
 * «3 × daglig (08, 14, 20)» — antallet FØRST, klokkeslettene etter.
 *
 * Frekvensen er det man kjenner medisinen sin på; klokkeslettene er detaljen man
 * sjekker. Omvendt rekkefølge gjør to medisiner umulige å skille på en linje.
 */
export function describeSchedule(times: readonly string[]): string {
	if (times.length === 0) return 'fast';
	const clock = times.map((t) => (t.endsWith(':00') ? t.slice(0, 2) : t)).join(', ');
	return `${times.length} × daglig (${clock})`;
}

/**
 * «2 av 3 doser i dag. Neste 20:00.»
 *
 * Setningen bor her og ikke i `.svelte`-fila fordi kortet, forløpet og (senere)
 * chatten må si det samme — samme grunn som `describeSickPeriod`.
 *
 * Sier ALDRI noe om hva en glemt dose betyr. Tallet er aritmetikk mot brukerens
 * egen plan, ikke en vurdering.
 */
export function describeMedicationDay(med: Medication, day: MedicationDay): string | null {
	if (!day.inCourse) return null;

	if (med.rhythm === 'ved_behov') {
		const n = day.taken;
		return n === 0 ? 'Ingen doser i dag' : `${n} ${n === 1 ? 'dose' : 'doser'} i dag`;
	}

	const taken = day.slots.filter((s) => s.status === 'taken').length;
	const head = `${taken} av ${day.planned} doser i dag`;
	const next = day.slots.find((s) => s.status === 'upcoming');
	const due = day.slots.filter((s) => s.status === 'due');

	// «Klar nå» før «neste»: det er den man kan gjøre noe med i dette øyeblikket.
	if (due.length > 0) {
		const which = due.map((s) => s.time).join(', ');
		return `${head}. Klar nå: ${which}.`;
	}
	if (next) return `${head}. Neste ${next.time}.`;
	return taken === day.planned ? `${head} — alle tatt.` : head;
}

/**
 * Hvor ofte en ved-behov-medisin faktisk ble brukt.
 *
 * **Sier ALDRI at bruken gikk ned fordi medisinen virket.** Setningen oppgir
 * tallene og lar dem stå; et forløp går over av seg selv, og «du trengte den
 * sjeldnere» er alt vi har dekning for. Se modulkommentaren.
 *
 * Dagens dag holdes utenfor av kalleren (`accumulates`), siden en teller som
 * fortsatt går ikke er et døgn.
 */
export function describeDoseUse(
	countsByDay: ReadonlyMap<string, number | null>,
	med: Medication
): string | null {
	if (med.rhythm !== 'ved_behov') return null;

	const measured = [...countsByDay.values()].filter((v): v is number => v !== null);
	if (measured.length === 0) return null;

	const total = measured.reduce((a, b) => a + b, 0);
	if (total === 0) {
		return `${med.name}: ingen doser logget på ${measured.length} ${measured.length === 1 ? 'dag' : 'dager'}.`;
	}

	const used = measured.filter((v) => v > 0).length;
	const most = Math.max(...measured);
	return (
		`${med.name}: ${total} ${total === 1 ? 'dose' : 'doser'} på ${measured.length} ` +
		`${measured.length === 1 ? 'dag' : 'dager'}, brukt ${used} av dem, mest ${most} på én dag.`
	);
}
