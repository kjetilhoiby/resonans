/**
 * «I dag»: styringssignalene fra brevet som korte, klikkbare linjer øverst på
 * hjemskjermen. Se `docs/changelog/2026-10-06-brev-prototype.md` («Hvor vi står»)
 * og `2026-10-12-i-dag-pa-hjemskjermen.md`.
 *
 * Reglene er brevets (`buildHomeLetter`); denne fila LESER brevet og gjør det
 * kortere. Ingenting regnes på nytt, og ingen modell er med — det brukeren pekte
 * på ved brevet var de klikkbare setningene, ikke prosaen.
 *
 * To grep gjør brevet til linjer:
 * - **Ett mål, én linje.** Brevet ga hvert delmål sin egen linje, og fem mållinjer
 *   sa «På dagens tempo er du der rundt …» fem ganger. Her står anslaget ÉN gang,
 *   på hovedmålet, og delmålene bakes inn med hvordan de ligger an.
 * - **Det som venter på deg først.** Et brev leses fra toppen; en hjemskjerm
 *   skannes. Det som ber om noe (en arrangementforberedelse, punkter som ble
 *   liggende, en rekke som forfaller) står over det som bare forteller.
 *
 * Og ett tak: `MAX_TODAY_LINES`. Det som ikke får plass, telles og lenkes til
 * brevet. En linje som forsvinner stille var det verste ved brevets første utgave.
 */

import {
	goalLine,
	nestPhaseGoals,
	type HomeLetter,
	type LetterGoal,
	type LetterLine,
	type LetterSection
} from '$lib/domain/home-letter';
import { describeGoalTrajectory } from '$lib/domain/goals/goal-projection';

/** Hvor mange linjer hjemskjermen viser. Resten ligger i brevet. */
export const MAX_TODAY_LINES = 5;

export interface TodayLine {
	/** Stabil nøkkel — brevlinjens id, eller `goal-group:<hovedmålets id>`. */
	id: string;
	text: string;
	href: string | null;
	/** `venter` ber om noe; `status` forteller. Flaten gir dem ulik prikk. */
	kind: 'venter' | 'status';
}

export interface HomeToday {
	lines: TodayLine[];
	/** Linjer brevet hadde som ikke fikk plass her. Flaten sier tallet og lenker til brevet. */
	more: number;
}

const SECTION_ORDER: LetterSection[] = ['maal', 'uka', 'trader', 'registrering', 'ellers'];

const PHASE_STANDING = {
	ahead: 'ligger foran planen',
	behind: 'ligger bak planen',
	neutral: 'er i rute'
} as const;

function trajectoryOf(goal: LetterGoal, today: string) {
	return describeGoalTrajectory({
		startDate: goal.startDate,
		endDate: goal.endDate,
		startValue: goal.startValue,
		currentValue: goal.currentValue,
		targetValue: goal.targetValue,
		today,
		rawSeries: goal.rawSeries,
		shape: goal.shape
	});
}

/**
 * Hovedmålet med anslaget, og delmålene etter med bare hvordan de ligger an.
 * Ligger et delmål bak mens hovedmålet holder, sies det — det er den ene
 * beroligelsen som er sann, og den som skiller «sklidd» fra «tapt».
 */
export function groupedGoalLine(goal: LetterGoal, phases: readonly LetterGoal[], today: string): TodayLine {
	const main = goalLine(goal, today);
	const mainTone = trajectoryOf(goal, today)?.tone ?? null;
	const phaseParts = phases.map((phase) => {
		const tone = trajectoryOf(phase, today)?.tone;
		return tone ? `delmålet ${phase.title} ${PHASE_STANDING[tone]}` : `delmålet ${phase.title} har ingen dato ennå`;
	});
	const anyPhaseBehind = phases.some((p) => trajectoryOf(p, today)?.tone === 'behind');
	const reassurance = anyPhaseBehind && mainTone !== 'behind' ? ', men hovedmålet holder' : '';
	const tail = phaseParts.length > 0 ? ` ${capitalize(joinParts(phaseParts))}${reassurance}.` : '';
	return { id: `goal-group:${goal.id}`, text: `${main.text}${tail}`, href: main.href ?? null, kind: 'status' };
}

function joinParts(parts: readonly string[]): string {
	if (parts.length <= 1) return parts[0] ?? '';
	return `${parts.slice(0, -1).join(', ')} og ${parts[parts.length - 1]}`;
}

function capitalize(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function fromLetterLine(line: LetterLine): TodayLine {
	return { id: line.id, text: line.text, href: line.href ?? null, kind: line.lens };
}

/**
 * Brevet som linjer. `goals` og `today` er de samme som brevet ble bygget av —
 * målgrupperingen krever målene, ikke de ferdige setningene.
 */
export function buildHomeToday(letter: HomeLetter, goals: readonly LetterGoal[], today: string): HomeToday {
	const letterGoalIds = new Set(letter.lines.filter((l) => l.section === 'maal').map((l) => l.id));
	const groups = nestPhaseGoals(goals).filter((g) =>
		[g.goal, ...g.phases].some((x) => letterGoalIds.has(`goal:${x.id}`))
	);
	const goalLines = groups.map((g) => groupedGoalLine(g.goal, g.phases, today));

	const ordered: TodayLine[] = [];
	for (const section of SECTION_ORDER) {
		if (section === 'maal') {
			ordered.push(...goalLines);
			continue;
		}
		ordered.push(...letter.lines.filter((l) => l.section === section).map(fromLetterLine));
	}

	// Det som venter først, ellers brevets rekkefølge. Stabil sortering.
	const sorted = [
		...ordered.filter((l) => l.kind === 'venter'),
		...ordered.filter((l) => l.kind === 'status')
	];

	return {
		lines: sorted.slice(0, MAX_TODAY_LINES),
		more: Math.max(0, sorted.length - MAX_TODAY_LINES)
	};
}
