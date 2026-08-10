/**
 * Øktvurderingen: henting av kontekst, kall til modellen, og cache.
 *
 * Se `docs/changelog/2026-08-10-oktvurdering-med-terreng-og-mal.md`.
 *
 * Beslutningene og formuleringene bor rent i
 * `$lib/domain/health/workout-assessment-context.ts`. Her er bare
 * datainnhentingen — samme arbeidsdeling som `getEffortBaseline` mot
 * `heart-rate-baseline.ts`.
 */

import { createHash } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/db';
import { canonicalWorkouts, goals, sensorGoals, workoutAssessments } from '$lib/db/schema';
import { openai } from '$lib/server/openai';
import { computeKmSplits, type TrackPoint } from '$lib/utils/track-stats';
import { parseWorkoutAnalysis, type WorkoutAnalysis } from '$lib/domain/health/workout-analysis';
import { frameGoals, type GoalInput } from '$lib/domain/health/goal-horizon';
import {
	ASSESSMENT_SYSTEM_PROMPT,
	buildAssessmentContext,
	type AssessmentWorkout
} from '$lib/domain/health/workout-assessment-context';

/**
 * GPT-4o, ikke mini.
 *
 * Den gamle vurderingen kjørte `gpt-4o-mini` på seks tall. Nå får modellen
 * navngitte strekninger, historikk-sammenligninger og mål med progresjon, og
 * jobben er å velge hva som er verdt å si — det er nettopp der mini svikter.
 * Kallet skjer én gang per økt (se cachen under), ikke per sidevisning, så
 * kostnaden er lavere enn før selv med den større modellen.
 */
export const ASSESSMENT_MODEL = 'gpt-4o';

/**
 * Lav temperatur med vilje. Den gamle kjørte 0.6 og ble regenerert ved hvert
 * besøk, så samme økt fikk ulik tekst hver gang du åpnet den.
 */
const ASSESSMENT_TEMPERATURE = 0.2;

const MAX_TOKENS = 320;

function hashContext(context: string): string {
	// Systemprompten er med i hashen: endrer vi instruksene, skal gamle
	// vurderinger skrives om, ikke bli stående med den gamle tonen.
	return createHash('sha256')
		.update(`${ASSESSMENT_MODEL}\n${ASSESSMENT_SYSTEM_PROMPT}\n${context}`)
		.digest('hex')
		.slice(0, 32);
}

function toNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const n = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(n) ? n : null;
}

/** Målene i helse-familien, med progresjonstallene fra `sensor_goals`. */
async function readGoalsWithProgress(userId: string, themeIds: string[]): Promise<GoalInput[]> {
	if (themeIds.length === 0) return [];

	const rows = await db.query.goals.findMany({
		where: and(
			eq(goals.userId, userId),
			inArray(goals.themeId, themeIds),
			inArray(goals.status, ['active', 'paused'])
		),
		columns: { id: true, title: true, description: true, targetDate: true, periodKey: true, status: true }
	});
	if (rows.length === 0) return [];

	// Tallene ligger i sensor_goals — currentValue, targetValue, baselineValue og
	// enhet. Den gamle vurderingen leste dem aldri, og fikk derfor «redusere
	// vekten til 85 kg og 95 kg» ut av to måltitler uten kontekst.
	const sensorRows = await db.query.sensorGoals.findMany({
		where: inArray(
			sensorGoals.goalId,
			rows.map((r) => r.id)
		),
		columns: {
			goalId: true,
			metricType: true,
			targetValue: true,
			currentValue: true,
			baselineValue: true,
			unit: true
		}
	});
	const byGoal = new Map(sensorRows.map((s) => [s.goalId, s]));

	return rows.map((row) => {
		const sensor = byGoal.get(row.id);
		return {
			title: row.title,
			description: row.description,
			targetDate: row.targetDate ?? null,
			periodKey: row.periodKey ?? null,
			status: row.status,
			sensor: sensor
				? {
						metricType: sensor.metricType ?? null,
						targetValue: toNumber(sensor.targetValue),
						currentValue: toNumber(sensor.currentValue),
						baselineValue: toNumber(sensor.baselineValue),
						unit: sensor.unit ?? null
					}
				: null
		};
	});
}

export type AssessmentSources = {
	workout: AssessmentWorkout;
	trackPoints: TrackPoint[];
	/** Rå `data` fra sensor-eventen — bærer `ekkoAnalysis` når Ekko sendte den. */
	eventData: Record<string, unknown> | null;
	healthThemeIds: string[];
	nugget: string | null;
	weekStanding: { planText: string | null; loadText: string | null } | null;
};

/**
 * Bygger konteksten for én økt. Eksportert fordi chat-vedlegget på
 * aktivitetssida skal ha nøyaktig samme fakta som vurderingen — to veier inn til
 * ulike tall er den feilen dette repoet har betalt for flest ganger.
 */
export async function buildWorkoutAssessmentContext(
	userId: string,
	sources: AssessmentSources
): Promise<string> {
	const points = sources.trackPoints ?? [];

	const analysis: WorkoutAnalysis | null = sources.eventData?.ekkoAnalysis
		? parseWorkoutAnalysis(sources.eventData.ekkoAnalysis).analysis
		: null;

	const [canonical, goalRows] = await Promise.all([
		db.query.canonicalWorkouts.findFirst({
			where: and(
				eq(canonicalWorkouts.userId, userId),
				eq(canonicalWorkouts.startTime, new Date(sources.workout.timestamp))
			),
			columns: { effortScore: true, effortMethod: true, bestEfforts: true }
		}),
		readGoalsWithProgress(userId, sources.healthThemeIds)
	]);

	return buildAssessmentContext({
		workout: sources.workout,
		splits: points.length >= 2 ? computeKmSplits(points) : [],
		// Bakker, runder og strekk kommer fra Ekko, ikke fra sporet — se
		// filhodet i workout-assessment-context.ts.
		analysis,
		effort: {
			score: toNumber(canonical?.effortScore),
			method: canonical?.effortMethod ?? null
		},
		bestEfforts: (canonical?.bestEfforts as Record<string, number> | null) ?? null,
		weekStanding: sources.weekStanding,
		nugget: sources.nugget,
		goals: frameGoals(goalRows, new Date())
	});
}

/**
 * Vurderingen for en økt — fra cache når konteksten er uendret, ellers generert
 * på nytt og lagret.
 *
 * Returnerer null når modellen ikke svarer. Kallstedet skal da vise flata uten
 * vurdering; en økt uten coach-tekst er fortsatt en økt.
 */
export async function getWorkoutAssessment(
	userId: string,
	sensorEventId: string,
	sources: AssessmentSources
): Promise<{ assessment: string | null; context: string; cached: boolean }> {
	const context = await buildWorkoutAssessmentContext(userId, sources);
	const contextHash = hashContext(context);

	const existing = await db.query.workoutAssessments.findFirst({
		where: and(
			eq(workoutAssessments.userId, userId),
			eq(workoutAssessments.sensorEventId, sensorEventId)
		),
		columns: { assessment: true, contextHash: true }
	});

	if (existing && existing.contextHash === contextHash) {
		return { assessment: existing.assessment, context, cached: true };
	}

	let text: string;
	try {
		const response = await openai.chat.completions.create({
			model: ASSESSMENT_MODEL,
			messages: [
				{ role: 'system', content: ASSESSMENT_SYSTEM_PROMPT },
				{ role: 'user', content: context }
			],
			max_tokens: MAX_TOKENS,
			temperature: ASSESSMENT_TEMPERATURE
		});
		text = response.choices[0]?.message?.content?.trim() ?? '';
	} catch (err) {
		console.error(
			`[workout-assessment] generering feilet user=${userId} event=${sensorEventId}: ${err instanceof Error ? err.message : String(err)}`
		);
		// Bedre en gammel vurdering enn ingen: konteksten har endret seg, men
		// teksten som står er fortsatt om den samme økta.
		return { assessment: existing?.assessment ?? null, context, cached: Boolean(existing) };
	}

	if (!text) return { assessment: existing?.assessment ?? null, context, cached: Boolean(existing) };

	await db
		.insert(workoutAssessments)
		.values({ userId, sensorEventId, assessment: text, model: ASSESSMENT_MODEL, contextHash })
		.onConflictDoUpdate({
			target: [workoutAssessments.userId, workoutAssessments.sensorEventId],
			set: {
				assessment: text,
				model: ASSESSMENT_MODEL,
				contextHash,
				updatedAt: new Date()
			}
		});

	return { assessment: text, context, cached: false };
}
