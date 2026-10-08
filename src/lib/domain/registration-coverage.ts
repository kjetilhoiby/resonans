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

/** «Siste sju dager: mat 3, vekt 6, oppgaver 5, egenfrekvens 1 og lesing 0 dager.» */
export function describeCoverage(coverage: readonly DomainCoverage[]): string {
	const parts = coverage.map((c) => `${c.label.toLowerCase()} ${c.last7}`);
	const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} og ${parts[parts.length - 1]}` : parts[0];
	return `Registrert siste sju dager: ${joined} dager.`;
}

/** Områdene som ikke er registrert i dag, i fast rekkefølge. */
export function missingToday(coverage: readonly DomainCoverage[]): string[] {
	return coverage.filter((c) => !c.today).map((c) => c.label.toLowerCase());
}

/**
 * Hva mer registrering låser opp, med motorens egen terskel — eller null når
 * ingen terskel står igjen. Mat først: den dommen er den rikeste, og den som
 * oftest står stille fordi loggen er tynn.
 */
export function nextUnlock(coverage: readonly DomainCoverage[]): string | null {
	const mat = coverage.find((c) => c.domain === 'mat');
	const matNeeded = Math.ceil(MIN_LOGGED_COVERAGE * COVERAGE_WINDOW_DAYS);
	if (mat && mat.last14 < matNeeded) {
		return `Mat er logget ${mat.last14} av de siste ${COVERAGE_WINDOW_DAYS} dagene. Med ${matNeeded} kan jeg si om energiregnskapet stemmer med vekta.`;
	}
	const vekt = coverage.find((c) => c.domain === 'vekt');
	if (vekt && vekt.last7 < MIN_WEEK_WEIGH_INS) {
		return `Du har veid deg ${vekt.last7} av de siste sju dagene. Med ${MIN_WEEK_WEIGH_INS} kan jeg si hva uka ble på vekta.`;
	}
	return null;
}
