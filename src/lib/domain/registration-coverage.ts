/**
 * Hvor mye brukeren REGISTRERER — mat, vekt, oppgaver, egenfrekvens og lesing.
 * Se `docs/changelog/2026-10-06-brev-prototype.md`, fase 4.
 *
 * Brukeren sa det selv: «jeg registrerer mindre enn ønsket, og å registrere mer
 * ville stimulert til bedre bruk av appen». Registreringen er ikke bruk for
 * brukens skyld — den er innputten coachen trenger, og flere motorer holder
 * innsikt tilbake til den finnes. Belønningen er derfor ikke poeng, men det
 * dataene LÅSER OPP, sagt med motorens egen terskel:
 *
 * - Mat: `checkAgainstWeight` dømmer energiregnskapet mot vekta først når
 *   `MIN_LOGGED_COVERAGE` av `MIN_DAYS_FOR_VERDICT` dager er logget.
 * - Vekt: ukesoppgjøret på vekta krever `MIN_WEEK_WEIGH_INS` veiinger siste sju.
 *
 * Tersklene importeres, aldri skrives av: et tall som sier «logg to dager til»
 * og et motorkrav som har flyttet seg, ville lovet noe som ikke kommer.
 *
 * Ingen skår og ingen rangering mellom områdene. En prikk per dag og en setning
 * er en observasjon; en skår er en dom brukeren må forsvare seg mot.
 */

import { MIN_DAYS_FOR_VERDICT, MIN_LOGGED_COVERAGE } from '$lib/domain/nutrition/weight-reality-check';
import { MIN_WEEK_WEIGH_INS } from '$lib/domain/digest-nugget-rules';

export type RegistrationDomain = 'mat' | 'vekt' | 'oppgaver' | 'egenfrekvens' | 'lesing';

export const REGISTRATION_DOMAINS: readonly RegistrationDomain[] = ['mat', 'vekt', 'oppgaver', 'egenfrekvens', 'lesing'];

export const REGISTRATION_LABELS: Record<RegistrationDomain, string> = {
	mat: 'Mat',
	vekt: 'Vekt',
	oppgaver: 'Oppgaver',
	egenfrekvens: 'Egenfrekvens',
	lesing: 'Lesing'
};

/** Hvor langt tilbake det telles. Matens dom trenger fjorten dager, så vinduet følger den. */
export const COVERAGE_WINDOW_DAYS = MIN_DAYS_FOR_VERDICT;

export interface DomainCoverage {
	domain: RegistrationDomain;
	label: string;
	/** Siste sju dager, eldst først, i dag sist. */
	week: boolean[];
	last7: number;
	last14: number;
	today: boolean;
}

function addDays(dayIso: string, days: number): string {
	const date = new Date(`${dayIso}T12:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

/** `registered` er Oslo-dagene (`YYYY-MM-DD`) med minst én registrering, per område. */
export function buildCoverage(
	registered: Readonly<Record<RegistrationDomain, ReadonlySet<string>>>,
	today: string
): DomainCoverage[] {
	const window = Array.from({ length: COVERAGE_WINDOW_DAYS }, (_, i) => addDays(today, i - COVERAGE_WINDOW_DAYS + 1));
	return REGISTRATION_DOMAINS.map((domain) => {
		const days = registered[domain];
		const hits = window.map((d) => days.has(d));
		const week = hits.slice(-7);
		return {
			domain,
			label: REGISTRATION_LABELS[domain],
			week,
			last7: week.filter(Boolean).length,
			last14: hits.filter(Boolean).length,
			today: hits[hits.length - 1]
		};
	});
}

/**
 * Hvilke registreringsområder brukeren har gjort til et FOKUS — ved å sette det
 * som mål eller legge det på ukelista («Måltidslogg (7 dager)»).
 *
 * Brukeren ville ikke ha en daglig påminnelse om alt som ikke er registrert i
 * dag, men en påminnelse om at registreringen er et valgt fokus. Mønstrene er
 * derfor smale med vilje: «Redusere vekt til 85 kg» er et vektmål, ikke et mål
 * om å VEIE seg, og «Lese eller leke med barna» handler ikke om boklesing. En
 * bom her ville gjort et fokus brukeren aldri har valgt til en påminnelse.
 */
export const REGISTRATION_FOCUS_PATTERNS: Record<RegistrationDomain, RegExp> = {
	mat: /m[åa]ltid|matlogg|logg(?:e|er)? mat|kostholdslogg/i,
	vekt: /\bvei(?:e|er|ing|inger)\b|vektlogg/i,
	oppgaver: /\boppgaver?\b.*\b(?:hak|logg|registrer)|(?:hak|logg|registrer)\w*\b.*\boppgaver?\b/i,
	egenfrekvens: /egenfrekvens/i,
	lesing: /\bbok(?:a|en|lesing)?\b|\bbøker(?:ne)?\b|\blese\b.*\bsider\b/i
};

export type FocusSource = 'mål' | 'ukeliste';

export interface RegistrationFocus {
	domain: RegistrationDomain;
	/** Teksten brukeren skrev, slik den står i målet eller på ukelista. */
	text: string;
	source: FocusSource;
}

export function registrationDomainOf(text: string): RegistrationDomain | null {
	for (const domain of REGISTRATION_DOMAINS) {
		if (REGISTRATION_FOCUS_PATTERNS[domain].test(text)) return domain;
	}
	return null;
}

/** Ett fokus per område; et mål går foran et punkt på ukelista. */
export function findRegistrationFocus(
	texts: ReadonlyArray<{ text: string; source: FocusSource }>
): RegistrationFocus[] {
	const byDomain = new Map<RegistrationDomain, RegistrationFocus>();
	for (const { text, source } of [...texts].sort((a, b) => (a.source === b.source ? 0 : a.source === 'mål' ? -1 : 1))) {
		const domain = registrationDomainOf(text);
		if (domain && !byDomain.has(domain)) byDomain.set(domain, { domain, text: text.trim(), source });
	}
	return REGISTRATION_DOMAINS.filter((d) => byDomain.has(d)).map((d) => byDomain.get(d)!);
}

/**
 * Hva mer registrering i ett område låser opp, med motorens egen terskel — eller
 * null når ingen terskel står igjen.
 */
export function unlockFor(domain: RegistrationDomain, coverage: DomainCoverage): string | null {
	if (domain === 'mat') {
		const needed = Math.ceil(MIN_LOGGED_COVERAGE * COVERAGE_WINDOW_DAYS);
		if (coverage.last14 < needed) {
			return `Med ${needed} av ${COVERAGE_WINDOW_DAYS} dager kan jeg si om energiregnskapet stemmer med vekta; nå er det ${coverage.last14}.`;
		}
	}
	if (domain === 'vekt' && coverage.last7 < MIN_WEEK_WEIGH_INS) {
		return `Med ${MIN_WEEK_WEIGH_INS} veiinger i uka kan jeg si hva uka ble på vekta.`;
	}
	return null;
}

/**
 * «Måltidslogg (7 dager) står på ukelista. Mat er registrert 3 av de siste sju
 * dagene.» Fokuset først, med brukerens egne ord — det er hen som valgte det.
 */
export function describeFocus(focus: RegistrationFocus, coverage: DomainCoverage): string {
	const where = focus.source === 'mål' ? 'er et av målene dine' : 'står på ukelista';
	const unlock = unlockFor(focus.domain, coverage);
	return `${focus.text} ${where}. ${coverage.label} er registrert ${coverage.last7} av de siste sju dagene.${unlock ? ` ${unlock}` : ''}`;
}
