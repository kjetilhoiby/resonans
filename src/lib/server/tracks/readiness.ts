import { and, eq } from 'drizzle-orm';
import { db } from '$lib/db';
import { trackReadinessAssessments } from '$lib/db/schema';
import { getActiveEgenfrekvensFlags } from '$lib/server/egenfrekvens-checkin';
import {
	buildFingerprint,
	deriveState,
	evaluateEgenfrekvensFlag,
	evaluateSleepFlag,
	fetchActiveTrip,
	fetchRecentSleep,
	type ReadinessAlternative,
	type ReadinessSignals,
	type ReadinessState
} from '$lib/server/programs/readiness';
import { generateSessionAlternative } from '$lib/server/programs/session-alternative';
import type { ProgramSessionDTO } from '$lib/server/programs/types';

/**
 * Daglig readiness for treningsløp — samme signaler og terskler som den gamle
 * program-readinessen (gjenbruker de rene funksjonene derfra), men cacher i
 * track_readiness_assessments med FK mot training_plans.
 */

export interface PlanReadinessAssessment {
	state: ReadinessState;
	reasons: string[];
	signals: ReadinessSignals;
	alternative: ReadinessAlternative | null;
	cached: boolean;
	date: string;
}

function todayIsoDate(): string {
	return new Date().toISOString().slice(0, 10);
}

export async function evaluatePlanReadiness(args: {
	userId: string;
	planId: string;
	trackSessionId: string | null;
	plannedSession: ProgramSessionDTO | null;
	date?: string;
}): Promise<PlanReadinessAssessment> {
	const date = args.date ?? todayIsoDate();
	const { userId, planId } = args;

	const [nights, egenfrekvens, trip] = await Promise.all([
		fetchRecentSleep(userId, date),
		getActiveEgenfrekvensFlags(userId, date),
		fetchActiveTrip(userId, date)
	]);

	const lastNight = nights[0] ?? null;
	const signals: ReadinessSignals = {
		sleep: {
			score: lastNight?.score ?? null,
			nights,
			flag: evaluateSleepFlag(nights)
		},
		egenfrekvens: {
			level: egenfrekvens.level,
			balance: egenfrekvens.balance,
			loggedAt: egenfrekvens.loggedAt,
			flag: evaluateEgenfrekvensFlag(egenfrekvens.level, egenfrekvens.balance)
		},
		sick: egenfrekvens.sick,
		crunch: egenfrekvens.crunch,
		trip: {
			active: !!trip,
			themeId: trip?.themeId ?? null,
			destination: trip?.destination ?? null,
			endDate: trip?.endDate ?? null
		}
	};

	const { state, reasons } = deriveState(signals);
	const fingerprint = buildFingerprint({ plannedSessionId: args.trackSessionId, signals, state });

	const existing = await db.query.trackReadinessAssessments.findFirst({
		where: and(
			eq(trackReadinessAssessments.userId, userId),
			eq(trackReadinessAssessments.planId, planId),
			eq(trackReadinessAssessments.assessmentDate, date)
		)
	});

	if (existing && existing.signalFingerprint === fingerprint) {
		return {
			state: existing.state as ReadinessState,
			reasons: existing.reasons ?? reasons,
			signals: (existing.signals as ReadinessSignals) ?? signals,
			alternative: (existing.alternative as ReadinessAlternative | null) ?? null,
			cached: true,
			date
		};
	}

	let alternative: ReadinessAlternative | null = null;
	if (state !== 'klar') {
		if (!args.plannedSession) {
			alternative = {
				kind: 'rest',
				name: 'Hvile',
				summary: 'Hviledag — bare lytt til kroppen.',
				rationale: reasons.join(', ')
			};
		} else if (state === 'rest') {
			alternative = {
				kind: 'rest',
				name: 'Hopp dagen',
				summary: 'Hopp dagens økt og hvil.',
				rationale: reasons.join(', ')
			};
		} else {
			alternative = await generateSessionAlternative({
				userId,
				originalSession: args.plannedSession,
				state,
				reasons,
				signals
			});
		}
	}

	await db
		.insert(trackReadinessAssessments)
		.values({
			userId,
			planId,
			trackSessionId: args.trackSessionId,
			assessmentDate: date,
			state,
			reasons,
			signals,
			alternative,
			signalFingerprint: fingerprint
		})
		.onConflictDoUpdate({
			target: [
				trackReadinessAssessments.userId,
				trackReadinessAssessments.planId,
				trackReadinessAssessments.assessmentDate
			],
			set: {
				trackSessionId: args.trackSessionId,
				state,
				reasons,
				signals,
				alternative,
				signalFingerprint: fingerprint,
				updatedAt: new Date()
			}
		});

	return { state, reasons, signals, alternative, cached: false, date };
}

export async function recordPlanReadinessChoice(args: {
	userId: string;
	planId: string;
	date: string;
	choice: 'alternative' | 'original';
}): Promise<boolean> {
	const result = await db
		.update(trackReadinessAssessments)
		.set({ userChoice: args.choice, userChoiceAt: new Date(), updatedAt: new Date() })
		.where(
			and(
				eq(trackReadinessAssessments.userId, args.userId),
				eq(trackReadinessAssessments.planId, args.planId),
				eq(trackReadinessAssessments.assessmentDate, args.date)
			)
		)
		.returning({ id: trackReadinessAssessments.id });
	return result.length > 0;
}
