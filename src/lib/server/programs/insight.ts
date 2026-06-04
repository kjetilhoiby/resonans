import { openai } from '$lib/server/openai';
import { env } from '$env/dynamic/private';
import { getFullProgram, mondayOf } from './repository';
import type { ProgramDTO, ProgramSessionDTO, ProgramWeekDTO } from './types';

/**
 * LLM-genererte programinnsikter for Ekko-klienten («Innsikt»-arket).
 * To scope-er:
 *  - "week":        oppsummer én uke (planlagt vs fullført, treff mot måltempo).
 *  - "progression": utvikling over hele programmet (trend, fullføringsgrad, mål).
 *
 * Kontrakt: ekko forventer ALLTID et `summary` (ikke-valgfritt felt klient-side).
 * Derfor har vi en regelbasert fallback som garanterer at vi aldri returnerer
 * 200 uten summary — bedre å levere en enkel faktasetning enn å bryte dekodingen.
 */

export type ProgramInsightScope = 'week' | 'progression';

export interface ProgramInsightResult {
	scope: ProgramInsightScope;
	title?: string;
	summary: string;
	highlights?: string[];
}

const DEFAULT_MODEL = 'gpt-4o-mini';
const model = () => env.EKKO_COACH_MODEL?.trim() || DEFAULT_MODEL;

const SYSTEM_PROMPT = `Du er en erfaren, varm løpetrener som oppsummerer treningsdata på norsk.
Du får strukturerte data om et treningsprogram (planlagte og fullførte økter).

Regler:
- Returner KUN JSON som matcher schemaet under. Ingen tekst utenom JSON.
- "summary": 3-6 hele setninger på norsk. Talevennlig (kan leses høyt), UTEN markdown,
  UTEN lange tallremser. Vær konkret og oppmuntrende, men ærlig.
- "title": kort overskrift på norsk (under 40 tegn), f.eks. "Uke 3 – fart" eller "Slik ligger du an".
- "highlights": 0-4 svært korte nøkkelpunkter (én kort frase hver), eller utelat helt.
- Bruk KUN tallene du får i datagrunnlaget. Aldri dikt opp pace, puls eller distanser
  som ikke står der. Hvis lite data finnes, si det heller enn å spekulere.

Schema:
{ "title": "string", "summary": "string", "highlights": ["string"] }`;

function fmtPace(secPerKm?: number | null): string | null {
	if (!secPerKm || !Number.isFinite(secPerKm)) return null;
	const m = Math.floor(secPerKm / 60);
	const s = Math.round(secPerKm % 60);
	return `${m}:${String(s).padStart(2, '0')} per km`;
}

function fmtKm(meters?: number | null): string | null {
	if (!meters || !Number.isFinite(meters)) return null;
	return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * Hvilken uke er "nå" for et program, gitt startdato og varighet.
 * Speiler uke-beregningen i getTodaySession (ankret mot kalenderuker),
 * men klemt inn i [1, durationWeeks] så vi alltid har en gyldig uke å vise.
 */
function resolveCurrentWeek(startDate: string, durationWeeks: number): number {
	const today = new Date().toISOString().slice(0, 10);
	if (today < startDate) return 1;
	const week1Monday = mondayOf(startDate);
	const offset = Math.floor(
		(new Date(mondayOf(today) + 'T00:00:00Z').getTime() -
			new Date(week1Monday + 'T00:00:00Z').getTime()) /
			(1000 * 60 * 60 * 24 * 7)
	);
	return Math.min(Math.max(offset + 1, 1), durationWeeks);
}

function describeSession(session: ProgramSessionDTO): string {
	const lines: string[] = [];
	const done = session.completion ? '✓ fullført' : 'ikke fullført';
	lines.push(`  - ${session.name} (${session.kind}, ${done})`);

	if (session.kind === 'run' && session.plannedRun) {
		const r = session.plannedRun;
		const planned: string[] = [`type ${r.runType}`];
		const dist = fmtKm(r.targetDistanceMeters);
		if (dist) planned.push(`mål ${dist}`);
		const pace = fmtPace(r.paceHintSecPerKm);
		if (pace) planned.push(`måltempo ${pace}`);
		if (r.hrZoneHint) planned.push(`sone ${r.hrZoneHint}`);
		lines.push(`      planlagt: ${planned.join(', ')}`);
	}
	if (session.kind === 'strength' && session.plannedExercises?.length) {
		const ex = session.plannedExercises
			.map((e) => `${e.exerciseName} ${e.sets}×${e.repsTarget ?? `${e.durationSecondsTarget}s`}`)
			.join(', ');
		lines.push(`      planlagt: ${ex}`);
	}

	const a = session.completion?.actuals;
	if (a) {
		const facts: string[] = [];
		const dist = fmtKm(a.distance);
		if (dist) facts.push(dist);
		const pace = fmtPace(a.paceSecondsPerKm);
		if (pace) facts.push(`tempo ${pace}`);
		if (a.avgHeartRate) facts.push(`snittpuls ${a.avgHeartRate}`);
		if (a.totalReps) facts.push(`${a.totalReps} reps totalt`);
		if (facts.length) lines.push(`      faktisk: ${facts.join(', ')}`);
	}
	return lines.join('\n');
}

function buildWeekDataBlock(program: ProgramDTO, week: ProgramWeekDTO): string {
	const completed = week.sessions.filter((s) => s.completion).length;
	const lines: string[] = [];
	lines.push(`Program: ${program.name}`);
	lines.push(`Mål: ${program.goal}`);
	lines.push(`Uke ${week.weekNumber} av ${program.durationWeeks}${week.deload ? ' (deload)' : ''}${week.phase ? `, fase: ${week.phase}` : ''}`);
	lines.push(`Fullført denne uka: ${completed} av ${week.sessions.length} økter`);
	if (week.notes) lines.push(`Notat: ${week.notes}`);
	lines.push('Økter:');
	for (const s of week.sessions) lines.push(describeSession(s));
	return lines.join('\n');
}

function buildProgressionDataBlock(program: ProgramDTO): string {
	const allSessions = program.weeks.flatMap((w) => w.sessions);
	const completed = allSessions.filter((s) => s.completion);
	const lines: string[] = [];
	lines.push(`Program: ${program.name}`);
	lines.push(`Mål: ${program.goal}`);
	lines.push(`Varighet: ${program.durationWeeks} uker, ${program.sessionsPerWeek} økter/uke`);
	lines.push(`Fullført totalt: ${completed.length} av ${allSessions.length} økter`);

	lines.push('Per uke (fullført/totalt):');
	for (const w of program.weeks) {
		const c = w.sessions.filter((s) => s.completion).length;
		lines.push(`  - Uke ${w.weekNumber}${w.deload ? ' (deload)' : ''}: ${c}/${w.sessions.length}`);
	}

	// Tempo-trend: kronologisk liste av fullførte løp med pace, så modellen kan beskrive utvikling.
	const completedRuns = completed
		.filter((s) => s.kind === 'run' && s.completion?.actuals?.paceSecondsPerKm)
		.sort((a, b) => (a.completion!.completedAt < b.completion!.completedAt ? -1 : 1));
	if (completedRuns.length) {
		lines.push('Fullførte løp (kronologisk):');
		for (const s of completedRuns) {
			const a = s.completion!.actuals!;
			const parts = [`uke ${s.weekNumber}`, s.name];
			const dist = fmtKm(a.distance);
			if (dist) parts.push(dist);
			const pace = fmtPace(a.paceSecondsPerKm);
			if (pace) parts.push(pace);
			lines.push(`  - ${parts.join(' · ')}`);
		}
	}
	return lines.join('\n');
}

function ruleBasedWeekSummary(program: ProgramDTO, week: ProgramWeekDTO): ProgramInsightResult {
	const completed = week.sessions.filter((s) => s.completion).length;
	const summary =
		week.sessions.length === 0
			? `Uke ${week.weekNumber} har ingen planlagte økter ennå.`
			: `I uke ${week.weekNumber} har du fullført ${completed} av ${week.sessions.length} planlagte økter. Fortsett det gode arbeidet mot målet ditt: ${program.goal}.`;
	return {
		scope: 'week',
		title: `Uke ${week.weekNumber}`,
		summary
	};
}

function ruleBasedProgressionSummary(program: ProgramDTO): ProgramInsightResult {
	const all = program.weeks.flatMap((w) => w.sessions);
	const completed = all.filter((s) => s.completion).length;
	const pct = all.length ? Math.round((completed / all.length) * 100) : 0;
	return {
		scope: 'progression',
		title: 'Slik ligger du an',
		summary: `Du har fullført ${completed} av ${all.length} økter (${pct} %) i programmet «${program.name}». Målet er: ${program.goal}. Hold rytmen så er du godt på vei.`
	};
}

/**
 * Genererer programinnsikt. Returnerer null hvis programmet ikke finnes for brukeren
 * (route mapper det til 404). Kaster aldri for LLM-feil — faller tilbake til en
 * regelbasert oppsummering så `summary` alltid er satt.
 */
export async function buildProgramInsight(
	userId: string,
	programId: string,
	scope: ProgramInsightScope,
	weekNumber?: number | null
): Promise<ProgramInsightResult | null> {
	const program = await getFullProgram(userId, programId);
	if (!program) return null;

	let dataBlock: string;
	let fallback: ProgramInsightResult;

	if (scope === 'week') {
		const targetWeek =
			weekNumber != null && Number.isFinite(weekNumber)
				? weekNumber
				: resolveCurrentWeek(program.startDate, program.durationWeeks);
		const week =
			program.weeks.find((w) => w.weekNumber === targetWeek) ??
			program.weeks.find((w) => w.weekNumber === resolveCurrentWeek(program.startDate, program.durationWeeks)) ??
			program.weeks[0];
		if (!week) {
			return {
				scope: 'week',
				title: program.name,
				summary: `Programmet «${program.name}» har ingen uker registrert ennå.`
			};
		}
		dataBlock = buildWeekDataBlock(program, week);
		fallback = ruleBasedWeekSummary(program, week);
	} else {
		dataBlock = buildProgressionDataBlock(program);
		fallback = ruleBasedProgressionSummary(program);
	}

	try {
		const response = await openai.chat.completions.create({
			model: model(),
			messages: [
				{ role: 'system', content: SYSTEM_PROMPT },
				{
					role: 'user',
					content: `Scope: ${scope}\n\nDatagrunnlag:\n${dataBlock}\n\nGi innsikt som JSON.`
				}
			],
			temperature: 0.4,
			response_format: { type: 'json_object' }
		});
		const content = response.choices[0]?.message?.content ?? '{}';
		const parsed = JSON.parse(content) as { title?: string; summary?: string; highlights?: string[] };
		if (parsed.summary && parsed.summary.trim()) {
			return {
				scope,
				title: parsed.title?.trim() || fallback.title,
				summary: parsed.summary.trim(),
				highlights: Array.isArray(parsed.highlights)
					? parsed.highlights.map((h) => String(h).trim()).filter(Boolean).slice(0, 4)
					: undefined
			};
		}
		console.warn('[program-insight] LLM-svar manglet summary, bruker fallback');
	} catch (error) {
		console.error('[program-insight] LLM-generering feilet, bruker fallback:', error);
	}

	return fallback;
}
