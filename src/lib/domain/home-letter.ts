/**
 * Brevet på hjemskjermen — PROTOTYPE. Se `docs/changelog/2026-10-06-brev-prototype.md`.
 *
 * Et brev regner ingenting selv. Det LESER reglene som alt lager push-varslene
 * (`digest-nugget-rules.ts`, `weight-nugget-rules.ts`) og arrangementenes
 * forberedelser, og velger blant dem. Samme regler bak varselet og brevet betyr
 * at de aldri kan si to ulike ting.
 *
 * Hver linje har en LINSE, og den er spørsmålet prototypen finnes for å
 * besvare: brukeren var redd brevet ville bli en innboks med rød prikk.
 * - `venter` er det som ber om en handling (en rekke som ryker, et åpent punkt,
 *   en barnevakt som mangler). Det er påminnelser, og det er dem som kan føles
 *   som en innboks.
 * - `status` er hvor du står (uka, vekta, siden sist). Det ber ikke om noe.
 * Flaten lar brukeren se de to hver for seg og sammen, med sine egne data.
 *
 * Ingen tellinger, ingen ulest-markør: et brev akkumulerer ikke. Det som ikke
 * fikk plass havner i `dropped`, så prototypen kan vise hva som ble valgt bort.
 */

import type { DigestNugget } from '$lib/domain/digest-nugget-rules';
import { describeOpenItems } from '$lib/domain/digest-nugget-rules';
import type { WeightNugget } from '$lib/domain/health/weight-nugget-rules';
import { prepStanding, type EventPrepItem } from '$lib/domain/events/prep';
import { daysBetween } from '$lib/domain/events/event-fields';

export type LetterLens = 'venter' | 'status';

export interface LetterLine {
	/** Stabil nøkkel for `{#each}` — regelens navn, ikke teksten. */
	id: string;
	lens: LetterLens;
	text: string;
	/** Hvilken motor setningen kom fra. Vises i prototypen, ikke i et ferdig brev. */
	source: 'dagsoversikt' | 'vekt' | 'arrangement' | 'dagsplan' | 'siden-sist';
	href?: string;
}

export interface LetterEvent {
	id: string;
	title: string;
	/** `YYYY-MM-DD`. */
	eventDate: string;
	startTime: string | null;
	prep: EventPrepItem[];
}

export interface HomeLetterInput {
	/** Dagens Oslo-dato, `YYYY-MM-DD`. */
	today: string;
	/** Oslo-timen, 0–23. Avgjør hilsenen og ingenting annet. */
	hour: number;
	sick: boolean;
	/** `digestNuggets(...)`, sterkest først. */
	digest: readonly DigestNugget[];
	/** `weightNuggets(...)`, sterkest først. */
	weight: readonly WeightNugget[];
	/** Åpne punkter på dagens dagsplan. */
	todayOpen: readonly string[];
	/** Kommende arrangementer, stigende. */
	events: readonly LetterEvent[];
	/** Timer siden forrige besøk, eller null når vi ikke vet. */
	hoursSinceLastVisit: number | null;
	/** Økter siden forrige besøk (deduplisert), eller null når det ikke er regnet. */
	sinceLastVisit: { workouts: number; distanceKm: number } | null;
}

export interface HomeLetter {
	greeting: string;
	lines: LetterLine[];
	/** Det reglene hadde å si, men som ikke fikk plass. */
	dropped: LetterLine[];
}

/** Hvor mange linjer hver linse får. Et brev som er en liste er ikke et brev. */
export const MAX_LINES_PER_LENS = 3;

/**
 * Hvor lenge borte før «siden sist» er en nyhet. Et døgn minus litt: den som
 * åpner appen hver morgen, skal ikke få en oppsummering av natta.
 */
export const SINCE_LAST_VISIT_HOURS = 20;

/** Hvor langt fram et arrangement med åpne forberedelser nevnes. */
export const EVENT_PREP_HORIZON_DAYS = 14;

/** Hvor langt fram et arrangement nevnes uten at noe mangler: i dag og i morgen. */
export const EVENT_SOON_DAYS = 1;

export function letterGreeting(hour: number): string {
	if (hour >= 5 && hour < 10) return 'God morgen.';
	if (hour >= 10 && hour < 17) return 'Hei.';
	if (hour >= 17 && hour < 23) return 'God kveld.';
	return 'Sent oppe.';
}

const DIGEST_LENS: Record<DigestNugget['kind'], LetterLens> = {
	'streak-due': 'venter',
	carryover: 'venter',
	// «Ta en rolig dag» er et råd, men det sier hvor kroppen står — ingen oppgave.
	'load-high': 'status',
	'week-change': 'status',
	'week-load': 'status'
};

function dayWord(days: number): string {
	if (days === 0) return 'I dag';
	if (days === 1) return 'I morgen';
	return `Om ${days} dager`;
}

function eventLines(events: readonly LetterEvent[], today: string): LetterLine[] {
	const lines: LetterLine[] = [];
	for (const event of events) {
		const days = daysBetween(today, event.eventDate);
		if (days < 0) continue;
		const when = `${dayWord(days)}: ${event.title}${event.startTime ? ` kl. ${event.startTime}` : ''}`;
		const standing = prepStanding(event.prep);
		if (standing.openLabels.length > 0 && days <= EVENT_PREP_HORIZON_DAYS) {
			lines.push({
				id: `event-prep:${event.id}`,
				lens: 'venter',
				text: `${when}. Mangler ${joinNorwegian(standing.openLabels.map((l) => l.toLowerCase()))}.`,
				source: 'arrangement',
				href: '/arrangementer'
			});
		} else if (days <= EVENT_SOON_DAYS) {
			lines.push({
				id: `event-soon:${event.id}`,
				lens: 'status',
				text: `${when}.`,
				source: 'arrangement',
				href: '/arrangementer'
			});
		}
	}
	return lines;
}

export function joinNorwegian(items: readonly string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} og ${items[items.length - 1]}`;
}

function formatKm(km: number): string {
	return km.toLocaleString('nb-NO', { maximumFractionDigits: km < 10 ? 1 : 0 });
}

function sinceLastVisitLine(input: HomeLetterInput): LetterLine | null {
	const hours = input.hoursSinceLastVisit;
	const since = input.sinceLastVisit;
	if (hours === null || hours < SINCE_LAST_VISIT_HOURS || !since || since.workouts === 0) return null;
	const days = Math.round(hours / 24);
	const ago = days <= 1 ? 'i går' : `for ${days} dager siden`;
	const count = since.workouts === 1 ? 'én økt' : `${since.workouts} økter`;
	const km = since.distanceKm >= 0.5 ? `, ${formatKm(since.distanceKm)} km` : '';
	return {
		id: 'since-last-visit',
		lens: 'status',
		text: `Siden du var innom ${ago}: ${count}${km}.`,
		source: 'siden-sist'
	};
}

export function buildHomeLetter(input: HomeLetterInput): HomeLetter {
	const greeting = letterGreeting(input.hour);

	const candidates: LetterLine[] = [];
	const sinceLine = sinceLastVisitLine(input);
	if (sinceLine) candidates.push(sinceLine);

	for (const nugget of input.digest) {
		candidates.push({
			id: `digest:${nugget.kind}`,
			lens: DIGEST_LENS[nugget.kind],
			text: nugget.sentence,
			source: 'dagsoversikt'
		});
	}

	// Bare den sterkeste vektsetningen: rekordene er kontinuerlige, og tre av dem
	// om samme kurve er metning, ikke informasjon (samme grunn som PUSH_RANK).
	const [topWeight, ...restWeight] = input.weight;
	if (topWeight) {
		candidates.push({ id: `weight:${topWeight.kind}`, lens: 'status', text: topWeight.sentence, source: 'vekt' });
	}

	// Arrangementene før dagsplanen: barnevakt ordnes uker i forveien, og det
	// er det punktet som er dyrt å glemme. Dagsplanen satte brukeren selv.
	candidates.push(...eventLines(input.events, input.today));

	const todayOpen = describeOpenItems(input.todayOpen, 'på dagens plan');
	if (todayOpen) {
		candidates.push({ id: 'today-open', lens: 'venter', text: todayOpen.sentence, source: 'dagsplan', href: '/ukeplan' });
	}

	const extraWeight: LetterLine[] = restWeight.map((n) => ({
		id: `weight:${n.kind}`,
		lens: 'status',
		text: n.sentence,
		source: 'vekt'
	}));

	// Syk: samme regel som dagsoversikten, som ikke sender noe da. Ett brev som
	// ber om handling når man ligger nede, er nettopp innboksen brukeren fryktet.
	if (input.sick) {
		return {
			greeting,
			lines: [
				{
					id: 'sick',
					lens: 'status',
					text: 'Du er registrert syk. Ingenting her haster.',
					source: 'dagsoversikt'
				}
			],
			dropped: [...candidates, ...extraWeight]
		};
	}

	const lines: LetterLine[] = [];
	const dropped: LetterLine[] = [];
	const perLens: Record<LetterLens, number> = { venter: 0, status: 0 };
	for (const line of candidates) {
		if (perLens[line.lens] < MAX_LINES_PER_LENS) {
			lines.push(line);
			perLens[line.lens] += 1;
		} else {
			dropped.push(line);
		}
	}
	dropped.push(...extraWeight);

	return { greeting, lines, dropped };
}
