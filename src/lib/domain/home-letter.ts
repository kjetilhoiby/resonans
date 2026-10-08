/**
 * Brevet på hjemskjermen — PROTOTYPE. Se `docs/changelog/2026-10-06-brev-prototype.md`.
 *
 * Et brev regner ingenting selv. Det LESER motorene som alt finnes — målene
 * (`describeGoalTrajectory`, samme som `/plan/mal`), effort-budsjettet,
 * dagsoversiktens regler, arrangementenes forberedelser og dagsplanene — og
 * velger blant dem.
 *
 * ## Styring, ikke status (versjon 2, 8. oktober 2026)
 *
 * Første utgave valgte blant push-krydderne og ga «1,99× over snittet siste 30
 * — ta en rolig dag», «Under ukas plan (391–469) — det er rom igjen» og «2,2 kg
 * under i fjor på samme dato». Brukerens dom: ingen av dem er styringssignaler.
 * Snittet var dratt ned av en sykeperiode, kalenderuka står på null hver
 * mandag, og vekta har et MÅL som ikke ble nevnt. Brevet er derfor bygget rundt
 * det brukeren styrer etter:
 *
 * - **Målene** — hvert løpe- og vektmål med frist, og hvor tempoet tar deg.
 * - **Uka** — de sju siste dagene mot rammen (løpende, ikke kalenderuka), og det
 *   som står på ukelista uten en dag.
 * - **Løse tråder** — punkter som ble liggende på dager som har gått, og
 *   arrangementer der noe mangler.
 *
 * Hver linje har i tillegg en LINSE: `venter` ber om en handling, `status` gjør
 * det ikke. Den finnes fordi brukeren var redd brevet ville bli en innboks med
 * rød prikk, og flaten lar de to ses hver for seg.
 *
 * Ingen tellinger og ingen ulest-markør: et brev akkumulerer ikke. Det som ikke
 * fikk plass havner i `dropped`, så prototypen kan vise hva som ble valgt bort.
 */

import type { DigestNugget } from '$lib/domain/digest-nugget-rules';
import { describeOpenItems } from '$lib/domain/digest-nugget-rules';
import type { WeightNugget } from '$lib/domain/health/weight-nugget-rules';
import { describeRollingEffort } from '$lib/domain/health/effort-standing';
import { describeGoalTrajectory, type GoalShape } from '$lib/domain/goals/goal-projection';
import { prepStanding, type EventPrepItem } from '$lib/domain/events/prep';
import { daysBetween } from '$lib/domain/events/event-fields';

export type LetterLens = 'venter' | 'status';
export type LetterSection = 'maal' | 'uka' | 'trader' | 'ellers';

export const SECTION_TITLES: Record<LetterSection, string> = {
	maal: 'Målene',
	uka: 'Uka',
	trader: 'Løse tråder',
	ellers: 'Ellers'
};

export interface LetterLine {
	/** Stabil nøkkel for `{#each}` — regelens navn, ikke teksten. */
	id: string;
	lens: LetterLens;
	section: LetterSection;
	text: string;
	/** Hvilken motor setningen kom fra. Vises i prototypen, ikke i et ferdig brev. */
	source: 'mål' | 'effort' | 'dagsoversikt' | 'vekt' | 'arrangement' | 'dagsplan' | 'ukeliste' | 'siden-sist';
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

/** Et løpe- eller vektmål med frist, med tallene `/plan/mal` regner på. */
export interface LetterGoal {
	id: string;
	title: string;
	shape: GoalShape;
	unit: 'km' | 'kg';
	startDate: string;
	endDate: string;
	startValue: number;
	currentValue: number;
	targetValue: number;
	/** Dagsverdier: km per dag for volum, målt vekt for tilstand. */
	rawSeries: ReadonlyArray<{ date: string; value: number }>;
}

export interface HomeLetterInput {
	/** Dagens Oslo-dato, `YYYY-MM-DD`. */
	today: string;
	/** Oslo-timen, 0–23. Avgjør hilsenen og ingenting annet. */
	hour: number;
	sick: boolean;
	goals: readonly LetterGoal[];
	/** De sju siste dagene mot rammen. Null uten budsjett. */
	rollingEffort: { spentLast7Days: number; bandMin: number; bandMax: number } | null;
	/** `digestNuggets(...)`, sterkest først. Brevet bruker `streak-due` og `load-high`. */
	digest: readonly DigestNugget[];
	/** `weightNuggets(...)`. Brukes bare når det ikke finnes et vektmål. */
	weight: readonly WeightNugget[];
	/** Åpne punkter på dager som har gått, siste sju dager. */
	lostItems: readonly string[];
	/** Ganger på ukelista som ingen dag har tatt ennå, gruppert («Løp» ×2). */
	unplacedWeek: ReadonlyArray<{ label: string; count: number }>;
	/** Dager igjen av uka, i dag medregnet (1 på søndag, 7 på mandag). */
	daysLeftInWeek: number;
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
	/** Det kildene hadde å si, men som ikke fikk plass eller ikke er styringssignaler. */
	dropped: LetterLine[];
}

/**
 * Hvor mange linjer hver del får. Målene er brukerens egne og får flest; et brev
 * som er en liste er ikke et brev.
 */
export const SECTION_CAPS: Record<LetterSection, number> = { maal: 4, uka: 3, trader: 3, ellers: 2 };

/**
 * Hvor lenge borte før «siden sist» er en nyhet. Et døgn minus litt: den som
 * åpner appen hver morgen, skal ikke få en oppsummering av natta.
 */
export const SINCE_LAST_VISIT_HOURS = 20;

/** Hvor langt fram et arrangement med åpne forberedelser nevnes. */
export const EVENT_PREP_HORIZON_DAYS = 14;

/** Hvor langt fram et arrangement nevnes uten at noe mangler: i dag og i morgen. */
export const EVENT_SOON_DAYS = 1;

/** Hvor langt tilbake punkter som ble liggende på en dag, telles. */
export const LOST_ITEMS_DAYS = 7;

export function letterGreeting(hour: number): string {
	if (hour >= 5 && hour < 10) return 'God morgen.';
	if (hour >= 10 && hour < 17) return 'Hei.';
	if (hour >= 17 && hour < 23) return 'God kveld.';
	return 'Sent oppe.';
}

export function joinNorwegian(items: readonly string[]): string {
	if (items.length <= 1) return items[0] ?? '';
	return `${items.slice(0, -1).join(', ')} og ${items[items.length - 1]}`;
}

function formatNumber(value: number, decimals: number): string {
	return value.toLocaleString('nb-NO', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function dayWord(days: number): string {
	if (days === 0) return 'I dag';
	if (days === 1) return 'I morgen';
	return `Om ${days} dager`;
}

/** «Ned til 90 kg: 94,1 kg nå. På dagens tempo er du der rundt …» */
export function goalLine(goal: LetterGoal, today: string): LetterLine {
	const progress =
		goal.unit === 'km'
			? `${formatNumber(goal.currentValue, 0)} av ${formatNumber(goal.targetValue, 0)} km`
			: `${formatNumber(goal.currentValue, 1)} kg nå, målet er ${formatNumber(goal.targetValue, 1)} kg`;
	const trajectory = describeGoalTrajectory({
		startDate: goal.startDate,
		endDate: goal.endDate,
		startValue: goal.startValue,
		currentValue: goal.currentValue,
		targetValue: goal.targetValue,
		today,
		rawSeries: goal.rawSeries,
		shape: goal.shape
	});
	return {
		id: `goal:${goal.id}`,
		lens: 'status',
		section: 'maal',
		text: `${goal.title}: ${progress}.${trajectory ? ` ${trajectory.label}` : ''}`,
		source: 'mål',
		href: '/plan/mal'
	};
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
				section: 'trader',
				text: `${when}. Mangler ${joinNorwegian(standing.openLabels.map((l) => l.toLowerCase()))}.`,
				source: 'arrangement',
				href: '/arrangementer'
			});
		} else if (days <= EVENT_SOON_DAYS) {
			lines.push({
				id: `event-soon:${event.id}`,
				lens: 'status',
				section: 'ellers',
				text: `${when}.`,
				source: 'arrangement',
				href: '/arrangementer'
			});
		}
	}
	return lines;
}

function sinceLastVisitLine(input: HomeLetterInput): LetterLine | null {
	const hours = input.hoursSinceLastVisit;
	const since = input.sinceLastVisit;
	if (hours === null || hours < SINCE_LAST_VISIT_HOURS || !since || since.workouts === 0) return null;
	const days = Math.round(hours / 24);
	const ago = days <= 1 ? 'i går' : `for ${days} dager siden`;
	const count = since.workouts === 1 ? 'én økt' : `${since.workouts} økter`;
	const km =
		since.distanceKm >= 0.5
			? `, ${since.distanceKm.toLocaleString('nb-NO', { maximumFractionDigits: since.distanceKm < 10 ? 1 : 0 })} km`
			: '';
	return {
		id: 'since-last-visit',
		lens: 'status',
		section: 'ellers',
		text: `Siden du var innom ${ago}: ${count}${km}.`,
		source: 'siden-sist'
	};
}

/**
 * Hvor mange ganger et ukepunkt skal gjøres, lest av teksten.
 *
 * Ukelista har to former for «flere ganger»: tre punkter «Løp (1/3)», «Løp (2/3)»
 * … (én per gang, se `addItem` på /ukeplan), og ETT punkt med målet i parentes,
 * «Dele legging i to med Anita (3 ganger)». Den andre formen må telles, ellers
 * forsvinner hele punktet idet det er lagt på én dag, mens to ganger gjenstår.
 */
export function weekItemTarget(text: string): { label: string; times: number } {
	const match = /^(.*?)\s*\((\d{1,2})\s+(?:ganger|gang|dager|dag)\)\s*$/i.exec(text.trim());
	if (!match) return { label: text.trim(), times: 1 };
	const times = Number(match[2]);
	return { label: match[1].trim(), times: times > 0 ? times : 1 };
}

/**
 * Gangene på ukelista som ingen dag har tatt, per etikett.
 *
 * `linkCounts` er hvor mange dagpunkter denne uka som peker på hvert ukepunkt
 * (`metadata.linkedChecklistItemId`). Et punkt med «(3 ganger)» som er lagt på én
 * dag står igjen med to.
 */
export function remainingWeekPlacements(
	items: ReadonlyArray<{ id: string; text: string; open: boolean }>,
	linkCounts: ReadonlyMap<string, number>,
	labelOf: (text: string) => string = (t) => t
): Array<{ label: string; count: number }> {
	const counts = new Map<string, number>();
	for (const item of items) {
		if (!item.open) continue;
		const target = weekItemTarget(item.text);
		const remaining = target.times - (linkCounts.get(item.id) ?? 0);
		if (remaining <= 0) continue;
		const label = labelOf(target.label) || target.label;
		counts.set(label, (counts.get(label) ?? 0) + remaining);
	}
	return [...counts].map(([label, count]) => ({ label, count }));
}

const DAY_COUNT_WORDS = ['null', 'én', 'to', 'tre', 'fire', 'fem', 'seks', 'sju'];

function unplacedLine(unplaced: HomeLetterInput['unplacedWeek'], daysLeft: number): LetterLine | null {
	if (unplaced.length === 0) return null;
	const named = unplaced.map((u) => (u.count > 1 ? `${u.label} ×${u.count}` : u.label));
	const left = daysLeft === 1 ? 'Siste dag i uka' : `${DAY_COUNT_WORDS[daysLeft] ?? daysLeft} dager igjen av uka`;
	const head = daysLeft === 1 ? left : left.charAt(0).toUpperCase() + left.slice(1);
	return {
		id: 'week-unplaced',
		lens: 'venter',
		section: 'uka',
		text: `${head}, og uten en dag ennå: ${joinNorwegian(named)}.`,
		source: 'ukeliste',
		href: '/ukeplan'
	};
}

export function buildHomeLetter(input: HomeLetterInput): HomeLetter {
	const greeting = letterGreeting(input.hour);
	const candidates: LetterLine[] = [];
	const dropped: LetterLine[] = [];

	// ── Målene ──
	for (const goal of input.goals) candidates.push(goalLine(goal, input.today));
	const hasWeightGoal = input.goals.some((g) => g.unit === 'kg');

	// ── Uka ──
	if (input.rollingEffort) {
		const verdict = describeRollingEffort(
			input.rollingEffort.spentLast7Days,
			input.rollingEffort.bandMin,
			input.rollingEffort.bandMax,
			input.sick
		);
		candidates.push({ id: 'effort-7d', lens: 'status', section: 'uka', text: verdict.text, source: 'effort', href: '/tema/helse' });
	}
	const unplaced = unplacedLine(input.unplacedWeek, input.daysLeftInWeek);
	if (unplaced) candidates.push(unplaced);

	for (const nugget of input.digest) {
		const line: LetterLine = {
			id: `digest:${nugget.kind}`,
			lens: nugget.kind === 'streak-due' ? 'venter' : 'status',
			section: nugget.kind === 'streak-due' ? 'trader' : 'uka',
			text: nugget.sentence,
			source: 'dagsoversikt'
		};
		// Belastningen er det eneste restitusjonssignalet, og den er nå regnet uten
		// sykedagene. De tre andre er erstattet: overliggerne av sju dagers løse
		// tråder, kalenderuka av de løpende sju dagene, og ukas vekt av målet.
		if (nugget.kind === 'streak-due' || nugget.kind === 'load-high') candidates.push(line);
		else dropped.push(line);
	}

	// ── Løse tråder ──
	candidates.push(...eventLines(input.events, input.today));
	const lost = describeOpenItems(input.lostItems, 'på dager som har gått');
	if (lost) {
		candidates.push({ id: 'lost-items', lens: 'venter', section: 'trader', text: lost.sentence, source: 'dagsplan', href: '/ukeplan' });
	}
	const todayOpen = describeOpenItems(input.todayOpen, 'på dagens plan');
	if (todayOpen) {
		candidates.push({ id: 'today-open', lens: 'venter', section: 'trader', text: todayOpen.sentence, source: 'dagsplan', href: '/ukeplan' });
	}

	// ── Ellers ──
	const sinceLine = sinceLastVisitLine(input);
	if (sinceLine) candidates.push(sinceLine);
	// Vektkrydderet bare uten et vektmål: med målet er det målet som er spørsmålet,
	// og «2,2 kg under i fjor» svarer på et annet.
	input.weight.forEach((nugget, i) => {
		const line: LetterLine = { id: `weight:${nugget.kind}`, lens: 'status', section: 'ellers', text: nugget.sentence, source: 'vekt' };
		if (!hasWeightGoal && i === 0) candidates.push(line);
		else dropped.push(line);
	});

	// Syk: dagsoversikten sender ingenting da. Et brev som ber om handling når man
	// ligger nede, er nettopp innboksen brukeren fryktet — målene får stå, de ber
	// ikke om noe.
	if (input.sick) {
		const kept = candidates.filter((l) => l.section === 'maal');
		return {
			greeting,
			lines: [
				{ id: 'sick', lens: 'status', section: 'uka', text: 'Du er registrert syk. Ingenting her haster.', source: 'dagsoversikt' },
				...kept
			],
			dropped: [...candidates.filter((l) => l.section !== 'maal'), ...dropped]
		};
	}

	const order: LetterSection[] = ['maal', 'uka', 'trader', 'ellers'];
	const lines: LetterLine[] = [];
	const perSection: Record<LetterSection, number> = { maal: 0, uka: 0, trader: 0, ellers: 0 };
	for (const section of order) {
		for (const line of candidates.filter((l) => l.section === section)) {
			if (perSection[section] < SECTION_CAPS[section]) {
				lines.push(line);
				perSection[section] += 1;
			} else {
				dropped.push(line);
			}
		}
	}

	return { greeting, lines, dropped };
}
