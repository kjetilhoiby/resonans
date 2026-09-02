/**
 * symptoms.ts — hva som faktisk er galt, uavhengig av om du holder senga.
 *
 * ## Hvorfor symptomer ikke er felter på sykeperioden
 *
 * «Syk» er en proxy for **ute av stand til å trene**. Det er en mekanisk
 * tilstand: den pauser streaks og senker effort-rammen. Symptomene er noe annet,
 * og de har tre egenskaper som gjør dem umulige å presse inn i perioden:
 *
 *  1. **Flere samtidig.** «Vondt i halsen, slimhoste, og et litt ømt kne» er tre
 *     rader, ikke ett felt.
 *  2. **Bare én holder deg i senga.** Kneet er der, men det er luftveisinfeksjonen
 *     som er grunnen. `limiting` er det feltet som gjør sykeperioden presis: den
 *     sier HVORFOR du er ute, framfor å la deg gjette i ettertid.
 *  3. **De overlever perioden, og finnes uten den.** Et ømt kne varer lenger enn
 *     infeksjonen, og et vondt ankel finnes når du ellers er frisk — det er
 *     nettopp da det betyr noe for hva du kan trene. Var symptomene felter på
 *     perioden, hadde de ingen plass å bo utenom sykdom.
 *
 * Derfor: symptomer er sin egen logg med egne datoer, og sykeperioden peker på
 * det som begrenser. Nøyaktig samme forhold som mellom en økt og en tur — to
 * ting med hver sin levetid, koblet der de faktisk møtes.
 *
 * ## Alvorlighet er tre nivåer, ikke ti
 *
 * Sultskalaen (1–5) virker fordi den er DAGLIG: `predictHunger` krever fem
 * observasjoner og to sterke før den sier noe, og får dem på ei uke. Symptomer
 * under sykdom er kanskje fire målinger per forløp og to-tre forløp i året. En
 * 1–10-skala ville aldri blitt kalibrert mot dine egne svar, så en 7 i mars og en
 * 7 i november ville ikke betydd det samme — et tall som SER ut som data.
 *
 * Tre nivåer trenger ingen kalibrering fordi ordene bærer betydningen selv:
 * «litt», «merkbart», «mye». Det er hvor langt vi kan strekke oss uten å lyve.
 *
 * ## Vi diagnostiserer ingenting
 *
 * En symptomlogg er en JOURNAL for brukeren — ikke et grunnlag for råd. Verdien
 * er at perioden blir konkret framfor binær, at forløpene kan sammenlignes, og
 * at det finnes noe å vise en lege. Ingenting av det krever at coachen tolker
 * noe, og prompten sier eksplisitt at den ikke skal. Se `DOMAIN_PROMPTS.health`.
 */

import { dayKeyFromNumber, dayNumber } from '$lib/domain/streaks';
import { isDayKey } from './sick-periods';

/**
 * Alvorlighet. Ordene ER skalaen — se modulkommentaren for hvorfor det ikke er
 * et tall.
 */
export const SYMPTOM_SEVERITIES = ['litt', 'merkbart', 'mye'] as const;
export type SymptomSeverity = (typeof SYMPTOM_SEVERITIES)[number];

/**
 * Grov inndeling, og den finnes av én grunn: en luftveisinfeksjon og et ømt kne
 * krever motsatt håndtering. Infeksjonen går over og du hviler; en
 * belastningsskade kan vare i måneder og betyr oftest at du bytter aktivitet
 * framfor å slutte. Vi handler ikke på skillet ennå (se «Kjent rest» i
 * changeloggen), men å ikke lagre det ville gjort det umulig senere.
 *
 * `annet` er med fordi en tvungen kategorisering er verre enn en åpen: «sliten»
 * er ikke luftveier og ikke muskel/skjelett, og skal ikke tvinges til å være det.
 */
export const SYMPTOM_KINDS = ['luftveier', 'mage', 'muskel_skjelett', 'annet'] as const;
export type SymptomKind = (typeof SYMPTOM_KINDS)[number];

export const SYMPTOM_KIND_LABELS: Record<SymptomKind, string> = {
	luftveier: 'Luftveier',
	mage: 'Mage',
	muskel_skjelett: 'Muskel/skjelett',
	annet: 'Annet'
};

export interface Symptom {
	id: string;
	/** Brukerens egne ord: «vondt i halsen», «slimhoste», «ømt kne». */
	label: string;
	kind: SymptomKind;
	severity: SymptomSeverity;
	/** Første dagen symptomet var der. */
	startDate: string;
	/** Siste dagen, eller null for «har det fortsatt». */
	endDate: string | null;
	/**
	 * Er DETTE grunnen til at du ikke kan trene?
	 *
	 * Kneet i «vondt i halsen, slimhoste og et litt ømt kne» er ikke det;
	 * infeksjonen er. Uten flagget kan ingen si i ettertid hvorfor du sto over.
	 */
	limiting: boolean;
	note: string | null;
}

export interface ResolvedSymptom extends Symptom {
	/** Har det fortsatt (ingen sluttdato, eller sluttdato i dag eller senere). */
	ongoing: boolean;
	/** Dager fra start til og med i dag eller sluttdato — aldri fram i tid. */
	days: number;
}

export function resolveSymptom(symptom: Symptom, todayKey: string): ResolvedSymptom {
	const start = dayNumber(symptom.startDate);
	const today = dayNumber(todayKey);
	const end = symptom.endDate === null ? null : dayNumber(symptom.endDate);
	// Et symptom «i dag» varer én dag, ikke null.
	const lastCounted = Math.min(end ?? today, today);

	return {
		...symptom,
		ongoing: end === null || end >= today,
		days: Math.max(1, lastCounted - start + 1)
	};
}

/** Symptomene som var der en gitt dag. Til historikken på et forløp. */
export function symptomsOnDay(
	symptoms: readonly Symptom[],
	dayKey: string
): Symptom[] {
	return symptoms.filter(
		(s) => s.startDate <= dayKey && (s.endDate === null || s.endDate >= dayKey)
	);
}

/**
 * Pågående symptomer, viktigste først: det begrensende øverst, deretter etter
 * alvorlighet, deretter det som har vart lengst.
 *
 * Rekkefølgen er ikke pynt — den er svaret på «hva er galt nå», og det
 * begrensende symptomet er det svaret starter med.
 */
export function rankOngoingSymptoms(
	symptoms: readonly Symptom[],
	todayKey: string
): ResolvedSymptom[] {
	const order: Record<SymptomSeverity, number> = { mye: 0, merkbart: 1, litt: 2 };
	return symptoms
		.map((s) => resolveSymptom(s, todayKey))
		.filter((s) => s.ongoing)
		.sort((a, b) => {
			if (a.limiting !== b.limiting) return a.limiting ? -1 : 1;
			if (a.severity !== b.severity) return order[a.severity] - order[b.severity];
			return b.days - a.days;
		});
}

export interface SymptomInput {
	id?: string;
	label: string;
	kind?: string;
	severity?: string;
	startDate?: string;
	endDate?: string | null;
	limiting?: boolean;
	note?: string | null;
}

export type SymptomValidation =
	| {
			ok: true;
			value: {
				id?: string;
				label: string;
				kind: SymptomKind;
				severity: SymptomSeverity;
				startDate: string;
				endDate: string | null;
				limiting: boolean;
				note: string | null;
			};
	  }
	| { ok: false; error: string };

/** Maks lengde på etiketten. Lang nok til «vondt i halsen når jeg svelger». */
export const MAX_SYMPTOM_LABEL = 80;

/**
 * Validering delt av endepunktet og flaten, som `validateSickPeriod`.
 *
 * `kind` og `severity` faller tilbake på trygge defaults framfor å avvise: en
 * ukjent verdi her kan ikke gjøre noe galt (i motsetning til `startWorkout.type`
 * i Gemini-profilene, der en gjettet verdi ble en løpeøkt på en elsykkel). Det som
 * IKKE kan gjettes er etiketten og datoene.
 */
export function validateSymptom(input: SymptomInput, todayKey: string): SymptomValidation {
	const label = (input.label ?? '').trim();
	if (!label) return { ok: false, error: 'Symptomet må ha en beskrivelse.' };
	if (label.length > MAX_SYMPTOM_LABEL) {
		return { ok: false, error: `Beskrivelsen kan være maks ${MAX_SYMPTOM_LABEL} tegn.` };
	}

	const startDate = input.startDate ?? todayKey;
	if (!isDayKey(startDate)) {
		return { ok: false, error: 'Startdato må være på formen ÅÅÅÅ-MM-DD.' };
	}
	if (startDate > todayKey) {
		return { ok: false, error: 'Startdato kan ikke være fram i tid.' };
	}

	let endDate: string | null = null;
	const rawEnd = input.endDate;
	if (rawEnd !== undefined && rawEnd !== null && rawEnd !== '') {
		if (!isDayKey(rawEnd)) {
			return { ok: false, error: 'Sluttdato må være på formen ÅÅÅÅ-MM-DD.' };
		}
		if (rawEnd < startDate) {
			return { ok: false, error: 'Sluttdato kan ikke være før startdato.' };
		}
		endDate = rawEnd;
	}

	const kind = (SYMPTOM_KINDS as readonly string[]).includes(input.kind ?? '')
		? (input.kind as SymptomKind)
		: 'annet';
	const severity = (SYMPTOM_SEVERITIES as readonly string[]).includes(input.severity ?? '')
		? (input.severity as SymptomSeverity)
		: 'merkbart';

	return {
		ok: true,
		value: {
			id: input.id,
			label,
			kind,
			severity,
			startDate,
			endDate,
			limiting: input.limiting === true,
			note: typeof input.note === 'string' ? input.note.trim() || null : null
		}
	};
}

/* ── Ord ─────────────────────────────────────────────────────────────────── */

function shortDate(dayKey: string): string {
	const months = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
	return `${Number(dayKey.slice(8))}. ${months[Number(dayKey.slice(5, 7)) - 1]}`;
}

/** «Vondt i halsen (mye, 3 dager) — grunnen til at du står over». */
export function describeSymptom(symptom: ResolvedSymptom): string {
	const bits = [symptom.severity, `${symptom.days} ${symptom.days === 1 ? 'dag' : 'dager'}`];
	const head = `${symptom.label} (${bits.join(', ')})`;
	if (!symptom.ongoing) return `${head} — over ${shortDate(symptom.endDate as string)}`;
	return symptom.limiting ? `${head} — grunnen til at du står over` : head;
}

/**
 * Én linje om hva som er galt nå, til briefingen og til kortet.
 *
 * **Beskriver, tolker ikke.** Setningen navngir symptomene og hvilket som
 * begrenser; den sier ingenting om hva de betyr eller hva som bør gjøres. Det er
 * ikke forsiktighet for forsiktighetens skyld: vi måler ingenting her, brukeren
 * har skrevet det selv, og en tolkning fra oss ville vært en gjetning forkledd
 * som en vurdering.
 */
export function summarizeSymptoms(
	symptoms: readonly Symptom[],
	todayKey: string
): string | null {
	const ranked = rankOngoingSymptoms(symptoms, todayKey);
	if (ranked.length === 0) return null;

	const limiting = ranked.find((s) => s.limiting);
	const others = ranked.filter((s) => s !== limiting);

	const parts: string[] = [];
	if (limiting) {
		parts.push(`${limiting.label} (${limiting.severity}) er det som begrenser`);
	}
	if (others.length > 0) {
		parts.push(
			`${limiting ? 'også' : 'pågående'}: ${others.map((s) => `${s.label} (${s.severity})`).join(', ')}`
		);
	}
	return parts.join('; ');
}
