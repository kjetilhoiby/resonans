/**
 * Datainnhentingen bak helse-briefingen.
 *
 * Beslutningene og formuleringene bor rent i `$lib/domain/ai/health-briefing.ts`.
 * Her er bare hentingen — samme arbeidsdeling som `getWorkoutAssessment` mot
 * `workout-assessment-context.ts`.
 *
 * ## Hvorfor dashboard-lasterne, ikke egne spørringer
 *
 * `loadTrainingDashboardData` og `loadWeightDashboardData` er de SAMME kildene
 * flatene og `query_training`/`query_weight` bruker. En tredje vei inn til de
 * samme tallene ville drevet fra de to andre, og en briefing som sier noe annet
 * enn skjermen er verre enn ingen briefing. Sammendragene
 * (`summarizeTrainingForChat`, `summarizeWeightForChat`) er rene funksjoner over
 * den ene payloaden, så flere utsnitt koster ingen ekstra spørringer.
 *
 * ## Kostnaden, og hvorfor den er akseptabel
 *
 * To dashboard-lastere per melding er ikke gratis. Men briefingen erstatter 1–3
 * verktøyrunder — hver av dem et helt modellkall — så på en helsemelding som
 * faktisk handler om helse er den billigere enn alternativet. Derfor er den også
 * gatet: se `shouldBuildHealthContext`.
 *
 * Hver del er best-effort. En feilende laster skal ikke velte svaret; da mangler
 * den seksjonen, og resten av briefingen står. Samme mønster som
 * `buildDayContextBlock` og `buildTripContext` i chat-endepunktet.
 */

import { loadTrainingDashboardData } from '$lib/server/training-dashboard';
import { loadWeightDashboardData } from '$lib/server/weight-dashboard';
import { loadHealthFamilyStreaks } from '$lib/server/services/streak-service';
import { readGoalsWithProgress } from '$lib/server/health/goals-with-progress';
import { getHealthThemeIds } from '$lib/server/themes';
import { summarizeTrainingForChat } from '$lib/domain/ai/training-summary';
import { summarizeWeightForChat } from '$lib/domain/ai/weight-summary';
import { frameGoals } from '$lib/domain/health/goal-horizon';
import { getSickState } from '$lib/server/health/sick-log';
import { describeSickPeriod } from '$lib/domain/health/sick-periods';
import {
	buildHealthBriefing,
	type BriefingStreak,
	type BriefingTraining,
	type BriefingWeight
} from '$lib/domain/ai/health-briefing';

/**
 * Skal briefingen bygges for denne meldingen?
 *
 * To innganger, med vilje:
 *
 * - **Meldingen handler om helse** (`health` blant de rutede domenene). Dekker
 *   helsespørsmål uansett hvor de stilles — hjemskjermen, en tema-chat, Ekko.
 * - **Samtalen ligger på et helse-tema.** Dekker det ruteren ikke kan se: «hva
 *   tenker du om dette?» midt i en tråd på Trening-temaet er et helsespørsmål,
 *   men ingen av ordene sier det. Uten denne mister briefingen nettopp den
 *   reflekterende meldingen den finnes for.
 */
export function shouldBuildHealthContext(input: {
	domains: readonly string[];
	conversationThemeId: string | null;
	healthThemeIds: readonly string[];
}): boolean {
	if (input.domains.includes('health')) return true;
	return (
		input.conversationThemeId !== null &&
		input.healthThemeIds.includes(input.conversationThemeId)
	);
}

function toBriefingWeight(payload: Awaited<ReturnType<typeof loadWeightDashboardData>>): BriefingWeight | null {
	const trend = summarizeWeightForChat(payload, 'trend');
	const periods = summarizeWeightForChat(payload, 'periods');

	// Ingen veiinger = ingen vektseksjon. En overskrift med bare «0 veiinger»
	// forteller ingenting brukeren ikke vet.
	if (trend.coverage.weighIns === 0) return null;

	return {
		latest: trend.latest ? { date: trend.latest.date, weightKg: trend.latest.weightKg } : null,
		trendKg: trend.trendKg ?? null,
		changes: (trend.changes ?? []).map((c) => ({
			windowDays: c.windowDays,
			actualDays: c.actualDays,
			deltaKg: c.deltaKg
		})),
		currentSentence: periods.currentSentence ?? null,
		goal: trend.goal ?? null,
		coverage: {
			weighIns: trend.coverage.weighIns,
			firstWeighIn: trend.coverage.firstWeighIn,
			daysSinceLatest: trend.coverage.daysSinceLatest
		}
	};
}

function toBriefingTraining(
	payload: Awaited<ReturnType<typeof loadTrainingDashboardData>>
): BriefingTraining | null {
	const load = summarizeTrainingForChat(payload, 'load');
	const balance = summarizeTrainingForChat(payload, 'balance');
	const plan = summarizeTrainingForChat(payload, 'plan');

	const week = load.week ?? null;
	const loadPart = load.load ?? null;
	const balancePart = balance.balance ?? null;
	const planPart = plan.plan ?? null;

	// Uten belastningsserie finnes ingenting å si om trening — det er tilfellet
	// for en bruker som ikke har registrert økter, og da skal seksjonen ut.
	if (!week && !planPart && (!loadPart || loadPart.ctl === null) && !balancePart) return null;

	return {
		week: week
			? {
					spentEffort: week.spentEffort,
					bandMin: week.bandMin,
					bandMax: week.bandMax,
					planText: week.planText,
					loadText: week.loadText,
					runKm: week.runKm,
					weekTargetKm: week.weekTargetKm
				}
			: null,
		load: loadPart
			? {
					ctl: loadPart.ctl,
					atl: loadPart.atl,
					tsb: loadPart.tsb,
					status: loadPart.status,
					ctlChange: loadPart.ctlChange,
					ctlChangeDays: loadPart.ctlChangeDays,
					ctlSettled: loadPart.ctlSettled
				}
			: null,
		balance: balancePart
			? {
					score: balancePart.score,
					disciplines: balancePart.disciplines.map((d) => ({
						family: d.family,
						pct: d.pct,
						sessions: d.sessions
					})),
					// Nudgen er ett objekt med kind/severity, men det er meldingen som
					// sier hva som er skjevt. `score` alene sier bare at noe er det.
					nudge: balancePart.nudge?.message ?? null
				}
			: null,
		plan: planPart
			? {
					name: planPart.name,
					startDate: planPart.startDate,
					durationWeeks: planPart.durationWeeks,
					milestonesAchieved: planPart.milestones.achieved,
					milestonesTotal: planPart.milestones.total,
					todaySuggestion: planPart.todaySuggestion
						? `${planPart.todaySuggestion.name}${planPart.todaySuggestion.notes ? ` — ${planPart.todaySuggestion.notes}` : ''}`
						: null,
					restReason: planPart.restReason
				}
			: null
	};
}

/**
 * Helse-briefingen som tekstblokk, eller tom streng.
 *
 * `healthThemeIds` sendes inn framfor å hentes her: kallstedet trenger dem
 * allerede til `shouldBuildHealthContext`, og to oppslag av samme liste i samme
 * forespørsel er sløsing.
 */
export async function buildHealthChatContext(
	userId: string,
	healthThemeIds: readonly string[]
): Promise<string> {
	const [training, weight, streaks, goalRows, sick] = await Promise.all([
		// evaluateMilestones utelates: en kontekstbygger skal ikke skrive til basen.
		loadTrainingDashboardData(userId).catch(() => null),
		loadWeightDashboardData(userId).catch(() => null),
		loadHealthFamilyStreaks(userId, healthThemeIds).catch(() => []),
		readGoalsWithProgress(userId, [...healthThemeIds]).catch(() => []),
		getSickState(userId).catch(() => null)
	]);

	const briefingStreaks: BriefingStreak[] = streaks.map(({ definition, state }) => ({
		title: definition.title,
		emoji: definition.emoji ?? null,
		count: state.count,
		unit: state.unit,
		bestCount: state.bestCount,
		status: state.status,
		gapCount: state.gapCount,
		gapUnits: state.gapUnits,
		windowCount: state.windowCount,
		windowTarget: state.windowTarget,
		daysUntilDue: state.daysUntilDue
	}));

	const framed = frameGoals(goalRows, new Date());

	const briefing = buildHealthBriefing({
		weight: weight ? toBriefingWeight(weight) : null,
		training: training ? toBriefingTraining(training) : null,
		streaks: briefingStreaks,
		// short først: `frameGoals` rangerer innad i hver bøtte, og de med frist er
		// de coachen skal se på før de løpende.
		goals: [...framed.short, ...framed.long],
		// Bare en ekte periode gir en setning. Det gamle nå-flagget (uten periode)
		// utelates: det pauser readiness, men ingen streak-dager, og en briefing som
		// lovet noe annet ville vært usann.
		sick: sick?.period ? describeSickPeriod(sick.period) : null
	});

	return briefing ? `\n\n${briefing}\n` : '';
}
