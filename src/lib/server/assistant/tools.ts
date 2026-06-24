import type OpenAI from 'openai';
import {
	getProgramSummaries,
	getFullProgram,
	getTodaySession,
	sessionPlannedDate
} from '$lib/server/programs/repository';
import { buildAthleteSnapshot } from '$lib/server/programs/athlete-context';
import { gatherDayContext } from '$lib/server/day-location-context';
import { pickRecentCompletedSessions } from './recent-sessions';
import type { ProgramSessionDTO } from '$lib/server/programs/types';
import { createGoal, createTask } from '$lib/server/goals';
import { logActivity } from '$lib/server/activities';
import { createMemory } from '$lib/server/memories';
import { enqueueBackgroundJob } from '$lib/server/background-jobs';
import { ASSISTANT_SOURCE } from './conversation';
import { SHARED_ASSISTANT_TOOLS } from './shared-tools';
import { CAR_ASSISTANT_TOOLS } from './car-tools';

/**
 * Verktøy for den server-kjørte assistent-agenten, scoped til token-brukeren. Assistenten har nå
 * full paritet med vanlig Resonans-chat (de modulariserte domene-verktøyene gjenbrukes via
 * `shared-tools.ts`), pluss bil/biltur-ekspertise (`car-tools.ts`).
 *
 * Verktøyene her i fila er de assistent-spesifikke: tale-tunede lese-snarveier for trening/dag,
 * og lette fange-handlinger (oppgave/mål/aktivitet/minne). Skrive-verktøy finnes — agenten skal
 * bekrefte konkrete endringer ved tvil, siden tale kan mishøres. Tesla leses via det delte
 * `query_tesla_vehicle` (default lagret tilstand; live kun ved eksplisitt ønske).
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

const BESPOKE_ASSISTANT_TOOLS: AssistantTool[] = [
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
				name: 'create_task',
				description:
					'Opprett en konkret oppgave knyttet til et mål. goalId må være den faktiske UUID-en (bruk programList/query-verktøy for å finne den). Bruk for rask fangst: «lag en oppgave …».',
				parameters: {
					type: 'object',
					properties: {
						goalId: { type: 'string', description: 'UUID til målet oppgaven hører til' },
						title: { type: 'string', description: 'Tittel på oppgaven' },
						description: { type: 'string', description: 'Hvordan oppgaven gjøres' },
						frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'once'] },
						targetValue: { type: 'number', description: 'Målverdi, f.eks. 3 for «3 ganger per uke»' },
						unit: { type: 'string', description: 'Enhet, f.eks. «ganger per uke», «km»' }
					},
					required: ['goalId', 'title', 'frequency']
				}
			}
		},
		run: async (userId, args) => {
			const goalId = requiredId(args, 'goalId');
			const title = typeof args.title === 'string' ? args.title.trim() : '';
			if (!goalId || !title) return { error: 'create_task krever goalId og title' };
			try {
				const task = await createTask({
					userId,
					goalId,
					title,
					description: typeof args.description === 'string' ? args.description : undefined,
					frequency: typeof args.frequency === 'string' ? args.frequency : undefined,
					targetValue: typeof args.targetValue === 'number' ? args.targetValue : undefined,
					unit: typeof args.unit === 'string' ? args.unit : undefined
				});
				const rawText = [task.title, task.description ?? ''].map((v) => v?.trim?.() ?? '').filter(Boolean).join('. ');
				try {
					await enqueueBackgroundJob({
						userId,
						type: 'task_intent_parse',
						payload: { taskId: task.id, rawText },
						priority: 8,
						maxAttempts: 2
					});
				} catch (queueError) {
					console.warn('[assistant] task_intent_parse enqueue feilet:', queueError);
				}
				return { success: true, taskId: task.id, message: `Oppgaven «${task.title}» er opprettet.` };
			} catch (error) {
				const fk = error instanceof Error && error.message.includes('foreign key');
				return { success: false, error: fk ? 'Ugyldig goalId — finn riktig UUID via et query-verktøy.' : 'Kunne ikke opprette oppgave.' };
			}
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'create_goal',
				description:
					'Opprett et nytt mål. Kun konkrete livsmål — aldri meta-titler som «Plan». Bruk for «sett deg et mål om …».',
				parameters: {
					type: 'object',
					properties: {
						categoryName: { type: 'string', enum: ['Trening', 'Parforhold', 'Mental helse', 'Karriere', 'Økonomi', 'Hobby', 'Annet'] },
						title: { type: 'string', description: 'Kort, konkret tittel' },
						description: { type: 'string', description: 'Hvorfor målet er viktig' },
						themeId: { type: 'string', description: 'Valgfri tema-UUID' },
						targetDate: { type: 'string', description: 'Frist (YYYY-MM-DD)' },
						startDate: { type: 'string', description: 'Startdato (YYYY-MM-DD) for tidsbegrensede mål' },
						endDate: { type: 'string', description: 'Sluttdato (YYYY-MM-DD)' },
						targetValue: { type: 'number', description: 'Målverdi når målet er målbart' },
						unit: { type: 'string', description: 'Enhet, f.eks. km, kg, kr' }
					},
					required: ['categoryName', 'title', 'description']
				}
			}
		},
		run: async (userId, args) => {
			const categoryName = typeof args.categoryName === 'string' ? args.categoryName : '';
			const title = typeof args.title === 'string' ? args.title.trim() : '';
			const description = typeof args.description === 'string' ? args.description : '';
			if (!categoryName || !title || !description) return { error: 'create_goal krever categoryName, title og description' };
			try {
				const goal = await createGoal({
					userId,
					categoryName,
					title,
					description,
					themeId: typeof args.themeId === 'string' && args.themeId.trim() ? args.themeId.trim() : undefined,
					targetDate: typeof args.targetDate === 'string' ? args.targetDate : undefined,
					startDate: typeof args.startDate === 'string' ? args.startDate : undefined,
					endDate: typeof args.endDate === 'string' ? args.endDate : undefined,
					targetValue: typeof args.targetValue === 'number' ? args.targetValue : undefined,
					unit: typeof args.unit === 'string' ? args.unit : undefined
				});
				return { success: true, goalId: goal.id, message: `Målet «${goal.title}» er opprettet.` };
			} catch (error) {
				console.error('[assistant] create_goal feilet:', error);
				return { success: false, error: 'Kunne ikke opprette mål.' };
			}
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'log_activity',
				description:
					'Registrer en gjennomført aktivitet/trening med målbare verdier (løp, styrke, date osv.). Kobles automatisk til relevante oppgaver. Bruk for «registrer at jeg løp 5 km».',
				parameters: {
					type: 'object',
					properties: {
						type: { type: 'string', description: 'Aktivitetstype, format kategori_spesifikk, f.eks. workout_run' },
						duration: { type: 'number', description: 'Varighet i minutter' },
						note: { type: 'string', description: 'Brukerens notat' },
						metrics: {
							type: 'array',
							description: 'Målbare verdier',
							items: {
								type: 'object',
								properties: {
									metricType: { type: 'string', description: 'f.eks. distance, quality_rating' },
									value: { type: 'number' },
									unit: { type: 'string', description: 'f.eks. km, rating_1_10' }
								},
								required: ['metricType', 'value']
							}
						}
					},
					required: ['type', 'metrics']
				}
			}
		},
		run: async (userId, args) => {
			const type = typeof args.type === 'string' ? args.type : '';
			const metrics = Array.isArray(args.metrics) ? (args.metrics as never[]) : [];
			if (!type || metrics.length === 0) return { error: 'log_activity krever type og minst én metric' };
			try {
				const result = await logActivity({
					userId,
					type,
					metrics,
					duration: typeof args.duration === 'number' ? args.duration : undefined,
					note: typeof args.note === 'string' ? args.note : undefined
				});
				return {
					success: true,
					activityId: result.activity.id,
					tasksUpdated: result.progressEntries.length,
					message: 'Aktivitet registrert.'
				};
			} catch (error) {
				console.error('[assistant] log_activity feilet:', error);
				return { success: false, error: 'Kunne ikke registrere aktivitet.' };
			}
		}
	},
	{
		definition: {
			type: 'function',
			function: {
				name: 'create_memory',
				description:
					'Lagre viktig informasjon om brukeren som skal huskes permanent. Skriv content som en kort, faktisk påstand.',
				parameters: {
					type: 'object',
					properties: {
						category: { type: 'string', enum: ['personal', 'relationship', 'fitness', 'mental_health', 'preferences', 'other'] },
						content: { type: 'string', description: 'Selve minnet, f.eks. «Foretrekker å trene om morgenen»' },
						importance: { type: 'string', enum: ['high', 'medium', 'low'] },
						themeId: { type: 'string', description: 'Valgfri tema-UUID' }
					},
					required: ['category', 'content']
				}
			}
		},
		run: async (userId, args) => {
			const category = typeof args.category === 'string' ? args.category : '';
			const content = typeof args.content === 'string' ? args.content.trim() : '';
			if (!category || !content) return { error: 'create_memory krever category og content' };
			try {
				const memory = await createMemory({
					userId,
					category: category as never,
					content,
					importance: (typeof args.importance === 'string' ? args.importance : 'medium') as never,
					themeId: typeof args.themeId === 'string' && args.themeId.trim() ? args.themeId.trim() : null,
					source: ASSISTANT_SOURCE
				});
				return { success: true, memoryId: memory.id, message: 'Lagret.' };
			} catch (error) {
				console.error('[assistant] create_memory feilet:', error);
				return { success: false, error: 'Kunne ikke lagre minne.' };
			}
		}
	}
];

/** Hele verktøysettet: tale-tunede snarveier + fange-handlinger + delte domene-verktøy + bil. */
export const ASSISTANT_TOOLS: AssistantTool[] = [
	...BESPOKE_ASSISTANT_TOOLS,
	...SHARED_ASSISTANT_TOOLS,
	...CAR_ASSISTANT_TOOLS
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
