import type OpenAI from 'openai';
import {
	getProgramSummaries,
	getFullProgram,
	getTodaySession,
	sessionPlannedDate
} from '$lib/server/programs/repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';
import { gatherDayContext } from '$lib/server/day-location-context';
import { getStoredTeslaState } from '$lib/server/integrations/tesla-sync';
import { pickRecentCompletedSessions } from './recent-sessions';
import type { ProgramSessionDTO } from '$lib/server/programs/types';

/**
 * Verktøy for den server-kjørte assistent-agenten. v1 er **kun lesing**, scoped til
 * token-brukeren, og gjenbruker samme datalag som de eksisterende `/api/apps/*`-endepunktene.
 * Ingen muterende verktøy: agenten skal ikke fullføre økter, starte kjøre-økter, sende
 * live-meldinger eller endre programmer. Tesla hentes alltid fra lagret tilstand — aldri live,
 * så agenten ikke vekker bilen.
 */

export interface AssistantTool {
	definition: OpenAI.Chat.Completions.ChatCompletionFunctionTool;
	run: (userId: string, args: Record<string, unknown>) => Promise<unknown>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function optionalDate(args: Record<string, unknown>): string | undefined {
	return typeof args.date === 'string' && ISO_DATE.test(args.date) ? args.date : undefined;
}
function requiredId(args: Record<string, unknown>, key: string): string | null {
	return typeof args[key] === 'string' && (args[key] as string).trim() ? (args[key] as string).trim() : null;
}

export const ASSISTANT_TOOLS: AssistantTool[] = [
	{
		definition: {
			type: 'function',
			function: {
				name: 'programList',
				description:
					'List brukerens treningsprogrammer med status (aktiv/fullført/etc.), mål og varighet. Bruk for å finne riktig programId før du henter detaljer.',
				parameters: { type: 'object', properties: {} }
			}
		},
		run: async (userId) => {
			const programs = await getProgramSummaries(userId);
			return { programs };
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'programDetail',
				description:
					'Hent et helt treningsprogram med uker, økter og øvelser, inkludert hvilke økter som er fullført. Krever programId (se programList).',
				parameters: {
					type: 'object',
					properties: { programId: { type: 'string', description: 'UUID til programmet' } },
					required: ['programId']
				}
			}
		},
		run: async (userId, args) => {
			const programId = requiredId(args, 'programId');
			if (!programId) return { error: 'programId mangler' };
			const program = await getFullProgram(userId, programId);
			return program ? { program } : { error: 'Program ikke funnet' };
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'programToday',
				description:
					'Hent dagens planlagte økt i et program (sett, reps, plan). Valgfri date (YYYY-MM-DD), default i dag. Krever programId.',
				parameters: {
					type: 'object',
					properties: {
						programId: { type: 'string', description: 'UUID til programmet' },
						date: { type: 'string', description: 'YYYY-MM-DD, default i dag' }
					},
					required: ['programId']
				}
			}
		},
		run: async (userId, args) => {
			const programId = requiredId(args, 'programId');
			if (!programId) return { error: 'programId mangler' };
			const today = await getTodaySession(userId, programId, optionalDate(args));
			if (!today) return { session: null };
			return {
				session: today.session,
				weekNumber: today.weekNumber,
				programStartDate: today.programStartDate
			};
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'recentSessions',
				description:
					'Nylig fullførte økter (dato, navn, type), nyeste først. Default det aktive programmet; valgfri programId og limit (default 7). Bruk for «hvordan har treningsuka mi sett ut».',
				parameters: {
					type: 'object',
					properties: {
						programId: { type: 'string', description: 'UUID — default aktivt program' },
						limit: { type: 'number', description: 'Maks antall økter, default 7' }
					}
				}
			}
		},
		run: async (userId, args) => {
			const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(Math.floor(args.limit), 30) : 7;
			let programId = requiredId(args, 'programId');
			if (!programId) {
				const programs = await getProgramSummaries(userId);
				programId = (programs.find((p) => p.status === 'active') ?? programs[0])?.id ?? null;
			}
			if (!programId) return { sessions: [] };

			const program = await getFullProgram(userId, programId);
			if (!program) return { error: 'Program ikke funnet' };

			const completed = pickRecentCompletedSessions<ProgramSessionDTO>(
				program.weeks.flatMap((w) => w.sessions),
				limit
			).map(
				(s) => ({
					name: s.name,
					kind: s.kind,
					weekNumber: s.weekNumber,
					plannedDate: sessionPlannedDate(program.startDate, s.weekNumber, s.dayNumber),
					completedAt: s.completion!.completedAt
				})
			);

			return { programId, programName: program.name, sessions: completed };
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'athleteContext',
				description:
					'Konsolidert øyeblikksbilde av brukeren som utøver (observert treningsvolum, tempo, vekt, etc.). Bruk for generell trenings-/helsekontekst.',
				parameters: { type: 'object', properties: {} }
			}
		},
		run: async (userId) => {
			const snapshot = await buildAthleteSnapshot(userId);
			return { snapshot };
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'dayPlan',
				description:
					'Dagens kontekst: bevegelse/opphold og hvor brukeren er. Valgfri date (YYYY-MM-DD), default i dag.',
				parameters: {
					type: 'object',
					properties: { date: { type: 'string', description: 'YYYY-MM-DD, default i dag' } }
				}
			}
		},
		run: async (userId, args) => {
			const ctx = await gatherDayContext(userId, optionalDate(args));
			return { date: ctx.date, movement: ctx.movement, stay: ctx.stay };
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'teslaState',
				description:
					'Ferskeste LAGREDE biltilstand (batteri, rekkevidde, lading, posisjon). Vekker aldri bilen. Returnerer connected:false hvis bilen ikke er koblet.',
				parameters: { type: 'object', properties: {} }
			}
		},
		run: async (userId) => {
			const stored = await getStoredTeslaState(userId);
			if (!stored.connected) return { connected: false, state: null };
			return { connected: true, state: stored.state };
		}
	}
];

const TOOL_BY_NAME = new Map(ASSISTANT_TOOLS.map((t) => [t.definition.function.name, t]));

/** Kjør et verktøykall server-side. Ukjent navn / kastet feil returneres som `{ error }`. */
export async function runAssistantTool(
	userId: string,
	name: string,
	args: Record<string, unknown>
): Promise<unknown> {
	const tool = TOOL_BY_NAME.get(name);
	if (!tool) return { error: `Ukjent verktøy: ${name}` };
	try {
		return await tool.run(userId, args);
	} catch (error) {
		console.error(`[assistant] verktøy ${name} feilet:`, error);
		return { error: 'Verktøykall feilet' };
	}
}

export const ASSISTANT_TOOL_DEFINITIONS = ASSISTANT_TOOLS.map((t) => t.definition);
