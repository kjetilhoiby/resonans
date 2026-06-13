/**
 * AI-verktøy: lar coachen forklare og ENDRE et adaptivt treningsprogram direkte
 * når brukeren foreslår justeringer (f.eks. etter et adaptiv-varsel).
 *
 * Handlinger:
 *   get            — hent program-struktur (denne + neste uke) + siste justeringer,
 *                    så modellen kan forklare hva som endret seg og hvorfor.
 *   move_session   — flytt en økt til en annen ukedag (bytter automatisk ved kollisjon).
 *   set_pace       — sett tempo (sek/km) på én økt eller alle fremtidige av en type.
 *   scale_volume   — skaler volum (distanse/varighet) for en uke eller fremover.
 *   set_preference — varige føringer som den ukentlige rekalkuleringen respekterer
 *                    (pinnedDays, lockPace, volumeBias, notes).
 *
 * Programmet velges automatisk (aktivt, adaptivt foretrukket) når programId
 * utelates — de fleste brukere har ett aktivt program.
 */

import { getRecentAdaptations, runWeeklyAdaptation } from '$lib/server/programs/adaptive-service';
import {
	moveSessionToDay,
	resolveTargetProgram,
	scaleVolume,
	setRunPace,
	updatePreferences
} from '$lib/server/programs/program-edits';
import { getFullProgram } from '$lib/server/programs/repository';
import type { ProgramPreferences } from '$lib/server/programs/types';
import { isRunType, type RunType } from '$lib/server/programs/constants';

export interface ManageTrainingProgramArgs {
	userId: string;
	action: 'get' | 'move_session' | 'set_pace' | 'scale_volume' | 'set_preference';
	programId?: string;
	// move_session
	sessionId?: string;
	newDay?: number;
	// set_pace
	paceSecPerKm?: number;
	runType?: string;
	fromWeek?: number;
	// scale_volume
	factor?: number;
	weekNumber?: number;
	// set_preference
	pinnedDays?: number[];
	lockPace?: boolean;
	volumeBias?: number;
	note?: string;
}

function asRunType(value: unknown): RunType | undefined {
	return isRunType(value) ? (value as RunType) : undefined;
}

export const manageTrainingProgramTool = {
	name: 'manage_training_program',
	execute: async (args: ManageTrainingProgramArgs) => {
		const { userId } = args;
		const program = await resolveTargetProgram(userId, args.programId ?? null);
		if (!program) {
			return { success: false, error: 'Fant ingen aktivt treningsprogram for brukeren.' };
		}

		switch (args.action) {
			case 'get': {
				const full = await getFullProgram(userId, program.id);
				if (!full) return { success: false, error: 'Kunne ikke hente programmet.' };

				// Finn gjeldende uke ut fra startdato (ankret mot kalenderuker).
				const todayISO = new Date().toISOString().slice(0, 10);
				const adaptations = await getRecentAdaptations(userId, program.id, 5);

				// Returner kun de to mest relevante ukene for å holde svaret lite nok.
				const weeks = full.weeks.map((w) => ({
					weekNumber: w.weekNumber,
					deload: w.deload,
					phase: w.phase,
					sessions: w.sessions.map((s) => ({
						sessionId: s.id,
						dayNumber: s.dayNumber,
						kind: s.kind,
						name: s.name,
						isTest: s.isTest ?? false,
						runType: s.plannedRun?.runType,
						targetDistanceMeters: s.plannedRun?.targetDistanceMeters,
						targetDurationSeconds: s.plannedRun?.targetDurationSeconds,
						paceHintSecPerKm: s.plannedRun?.paceHintSecPerKm,
						completed: !!s.completion
					}))
				}));

				return {
					success: true,
					program: {
						id: full.id,
						name: full.name,
						goal: full.goal,
						mode: full.mode,
						durationWeeks: full.durationWeeks,
						startDate: full.startDate
					},
					preferences: (full as { preferences?: ProgramPreferences }).preferences ?? {},
					recentAdaptations: adaptations,
					weeks,
					today: todayISO,
					hint: 'dayNumber: 1=mandag..7=søndag. Bruk sessionId fra denne lista for move_session/set_pace.'
				};
			}

			case 'move_session': {
				if (!args.sessionId || args.newDay == null) {
					return { success: false, error: 'move_session krever sessionId og newDay (1-7).' };
				}
				const res = await moveSessionToDay({
					userId,
					programId: program.id,
					sessionId: args.sessionId,
					newDay: args.newDay
				});
				return { success: res.ok, message: res.summary, error: res.error };
			}

			case 'set_pace': {
				if (args.paceSecPerKm == null) {
					return { success: false, error: 'set_pace krever paceSecPerKm.' };
				}
				const res = await setRunPace({
					userId,
					programId: program.id,
					paceSecPerKm: args.paceSecPerKm,
					sessionId: args.sessionId,
					runType: asRunType(args.runType),
					fromWeek: args.fromWeek
				});
				return { success: res.ok, message: res.summary, error: res.error };
			}

			case 'scale_volume': {
				if (args.factor == null) {
					return { success: false, error: 'scale_volume krever factor (f.eks. 0.9 eller 1.1).' };
				}
				const res = await scaleVolume({
					userId,
					programId: program.id,
					factor: args.factor,
					weekNumber: args.weekNumber,
					fromWeek: args.fromWeek
				});
				return { success: res.ok, message: res.summary, error: res.error };
			}

			case 'set_preference': {
				const patch: Partial<ProgramPreferences> = {};
				if (args.pinnedDays !== undefined) patch.pinnedDays = args.pinnedDays;
				if (args.lockPace !== undefined) patch.lockPace = args.lockPace;
				if (args.volumeBias !== undefined) patch.volumeBias = args.volumeBias;
				if (args.note) patch.notes = [args.note];
				if (Object.keys(patch).length === 0) {
					return { success: false, error: 'set_preference krever minst ett felt (pinnedDays/lockPace/volumeBias/note).' };
				}
				const res = await updatePreferences({ userId, programId: program.id, patch });
				return { success: res.ok, message: res.summary, error: res.error };
			}

			default:
				return { success: false, error: `Ukjent action: ${args.action}` };
		}
	}
};

// Eksportert for evt. fremtidig bruk (re-kjøring av justering på forespørsel).
export { runWeeklyAdaptation };
